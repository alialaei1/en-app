"""
Audio/text alignment helpers adapted from split/split_audio.py.
Uses Whisper forced alignment (stable-ts) + ffmpeg cuts.
"""
from __future__ import annotations

import os
import ssl
import subprocess
from pathlib import Path

from .timings import relative_word_timings


def _maybe_allow_insecure_model_download() -> None:
    """Allow Whisper model download when VPS SSL interception breaks cert verify."""
    try:
        from django.conf import settings

        enabled = bool(getattr(settings, "WHISPER_INSECURE_DOWNLOAD", False))
    except Exception:  # noqa: BLE001 - allow use outside Django
        enabled = os.getenv("WHISPER_INSECURE_DOWNLOAD", "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
    if not enabled:
        return
    ssl._create_default_https_context = ssl._create_unverified_context  # noqa: S323


def resolve_whisper_model(model_name: str | None = None) -> str:
    if model_name:
        return model_name
    try:
        from django.conf import settings

        return getattr(settings, "WHISPER_MODEL", "small.en")
    except Exception:  # noqa: BLE001
        return os.getenv("WHISPER_MODEL", "small.en").strip() or "small.en"


def map_chunks_to_words(chunks: list[str], words, excluded: set[int] | None = None):
    excluded = excluded or set()
    spans, pos = [], 0
    for i, chunk in enumerate(chunks, 1):
        if i in excluded:
            spans.append(None)
            continue
        n = len(chunk.split())
        group = words[pos : pos + n]
        pos += n
        if not group:
            spans.append(None)
            continue
        spans.append((group[0].start, group[-1].end, group))
    return spans


def cut_with_ffmpeg(src: Path, dst: Path, start: float, end: float) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-ss",
        f"{start:.3f}",
        "-to",
        f"{end:.3f}",
        "-i",
        str(src),
        "-vn",
        "-c:a",
        "libmp3lame",
        "-q:a",
        "2",
        str(dst),
    ]
    subprocess.run(cmd, check=True)


def align_and_cut(
    audio_path: Path,
    chunks: list[str],
    out_dir: Path,
    *,
    prefix: str = "chunk",
    model_name: str | None = None,
    language: str = "en",
    padding_ms: int = 150,
    progress_callback=None,
) -> list[dict]:
    """
    Align chunk texts to audio and cut per-chunk mp3 files.
    Returns dicts with: index, text, start, end, path, words.
    `words` timings are relative to the cut clip.
    Model comes from `model_name` or env/settings `WHISPER_MODEL`.
    """
    def report(percent: int, message: str) -> None:
        if progress_callback:
            progress_callback(percent, message)

    try:
        import stable_whisper
    except ImportError as exc:
        raise RuntimeError(
            "stable-ts is not installed. Run: pip install stable-ts"
        ) from exc

    selected_model = resolve_whisper_model(model_name)
    text = " ".join(chunks)
    report(10, f"Loading Whisper model ({selected_model})…")
    _maybe_allow_insecure_model_download()
    model = stable_whisper.load_model(selected_model)
    report(35, "Aligning text to audio…")
    result = model.align(str(audio_path), text, language=language)
    words = result.all_words()
    spans = map_chunks_to_words(chunks, words)

    out_dir.mkdir(parents=True, exist_ok=True)
    width = max(2, len(str(len(chunks))))
    outputs: list[dict] = []
    total = max(len(chunks), 1)

    for i, (chunk, span) in enumerate(zip(chunks, spans), 1):
        report(40 + int((i / total) * 55), f"Cutting audio clip {i} of {total}…")
        if span is None:
            outputs.append(
                {
                    "index": i,
                    "text": chunk,
                    "start": None,
                    "end": None,
                    "path": None,
                    "words": [],
                }
            )
            continue
        abs_start, abs_end, group = span
        start = max(0.0, abs_start - padding_ms / 1000)
        end = abs_end + padding_ms / 1000
        name = f"{prefix}_{i:0{width}d}.mp3"
        path = out_dir / name
        cut_with_ffmpeg(audio_path, path, start, end)
        outputs.append(
            {
                "index": i,
                "text": chunk,
                "start": round(start, 3),
                "end": round(end, 3),
                "path": path,
                "words": relative_word_timings(group, start),
            }
        )
    report(100, "Audio split complete")
    return outputs
