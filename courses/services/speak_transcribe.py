"""Transcribe a short learner recording for speaking practice."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from .audio_split import _maybe_allow_insecure_model_download, resolve_whisper_model
from .media import require_ffmpeg

_MODEL = None


class SpeakTranscribeError(RuntimeError):
    """Raised with a stable machine code + human detail for the study UI."""

    def __init__(self, code: str, detail: str):
        self.code = code
        self.detail = detail
        super().__init__(detail)


def _get_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    try:
        _maybe_allow_insecure_model_download()
        import stable_whisper
    except Exception as exc:  # noqa: BLE001
        raise SpeakTranscribeError(
            "whisper_import",
            f"Whisper/stable-ts is not available: {exc}",
        ) from exc

    try:
        _MODEL = stable_whisper.load_model(resolve_whisper_model())
    except Exception as exc:  # noqa: BLE001
        raise SpeakTranscribeError(
            "whisper_model",
            f"Could not load Whisper model: {exc}",
        ) from exc
    return _MODEL


def _to_wav(src: Path) -> Path:
    """Normalize browser recordings (webm/mp4/m4a/ogg) to 16k mono wav for Whisper."""
    try:
        require_ffmpeg()
    except RuntimeError as exc:
        raise SpeakTranscribeError("ffmpeg_missing", str(exc)) from exc

    wav_path = src.with_suffix(".wav")
    if wav_path.resolve() == src.resolve():
        fd, tmp_name = tempfile.mkstemp(suffix=".wav")
        Path(tmp_name).unlink(missing_ok=True)
        wav_path = Path(tmp_name)

    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(src),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(wav_path),
    ]
    try:
        completed = subprocess.run(cmd, check=False, capture_output=True, text=True)
    except OSError as exc:
        raise SpeakTranscribeError("ffmpeg_missing", f"Could not run ffmpeg: {exc}") from exc

    if completed.returncode != 0:
        err = (completed.stderr or completed.stdout or "ffmpeg failed").strip()
        raise SpeakTranscribeError(
            "ffmpeg_decode",
            f"Could not decode recording ({src.suffix or 'unknown'}): {err[:300]}",
        )
    if not wav_path.exists() or wav_path.stat().st_size < 44:
        raise SpeakTranscribeError(
            "ffmpeg_decode",
            "Decoded audio is empty. Try recording a bit longer.",
        )
    return wav_path


def transcribe_learner_audio(path: Path, *, language: str = "en") -> str:
    """Return plain transcript text for a short practice clip."""
    if not path.exists() or path.stat().st_size < 64:
        raise SpeakTranscribeError(
            "empty_upload",
            f"Uploaded audio is too small ({path.stat().st_size if path.exists() else 0} bytes).",
        )

    wav_path = None
    try:
        wav_path = _to_wav(path)
        model = _get_model()
        try:
            result = model.transcribe(
                str(wav_path),
                language=language or "en",
                vad=True,
                verbose=False,
            )
        except Exception as exc:  # noqa: BLE001
            raise SpeakTranscribeError(
                "whisper_run",
                f"Whisper failed while transcribing: {exc}",
            ) from exc
        text = getattr(result, "text", None) or ""
        return " ".join(str(text).split()).strip()
    finally:
        if wav_path is not None and wav_path != path:
            try:
                wav_path.unlink(missing_ok=True)
            except OSError:
                pass
