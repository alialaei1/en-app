"""Transcribe a short learner recording for speaking practice."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from .audio_split import _maybe_allow_insecure_model_download, resolve_whisper_model
from .media import require_ffmpeg

_MODEL = None


def _get_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    _maybe_allow_insecure_model_download()
    import stable_whisper

    _MODEL = stable_whisper.load_model(resolve_whisper_model())
    return _MODEL


def _to_wav(src: Path) -> Path:
    """Normalize browser recordings (webm/mp4/m4a/ogg) to 16k mono wav for Whisper."""
    require_ffmpeg()
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
    subprocess.run(cmd, check=True)
    return wav_path


def transcribe_learner_audio(path: Path, *, language: str = "en") -> str:
    """Return plain transcript text for a short practice clip."""
    wav_path = None
    try:
        wav_path = _to_wav(path)
        model = _get_model()
        result = model.transcribe(
            str(wav_path),
            language=language or "en",
            vad=True,
            verbose=False,
        )
        text = getattr(result, "text", None) or ""
        return " ".join(str(text).split()).strip()
    finally:
        if wav_path is not None and wav_path != path:
            try:
                wav_path.unlink(missing_ok=True)
            except OSError:
                pass
