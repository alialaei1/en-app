"""
Audio/text alignment helpers adapted from split/split_audio.py.
Uses Whisper forced alignment (stable-ts) + ffmpeg cuts.
"""
from __future__ import annotations

import os
import ssl
import subprocess
import threading
import time
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


def resolve_whisper_model(model_name: str | None = None, *, speak: bool = False) -> str:
    if model_name:
        return model_name
    try:
        from django.conf import settings

        if speak:
            return getattr(
                settings,
                "SPEAK_WHISPER_MODEL",
                getattr(settings, "WHISPER_MODEL", "small.en"),
            )
        return getattr(settings, "WHISPER_MODEL", "small.en")
    except Exception:  # noqa: BLE001
        if speak:
            return (
                os.getenv("SPEAK_WHISPER_MODEL", "").strip()
                or os.getenv("WHISPER_MODEL", "small.en").strip()
                or "small.en"
            )
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


def cut_with_ffmpeg(
    src: Path,
    dst: Path,
    start: float,
    end: float,
    *,
    as_video: bool = False,
) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if as_video:
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
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "28",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            "-pix_fmt",
            "yuv420p",
            "-avoid_negative_ts",
            "make_zero",
            str(dst),
        ]
    else:
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
    cut_source: Path | None = None,
    cut_as_video: bool = False,
) -> list[dict]:
    """
    Align chunk texts to audio and cut per-chunk media files.
    Returns dicts with: index, text, start, end, path, words.
    `words` timings are relative to the cut clip.
    When `cut_as_video` is True, cuts MP4 clips from `cut_source` (or audio_path).
    Model comes from `model_name` or env/settings `WHISPER_MODEL`.
    """
    source_for_cuts = cut_source or audio_path
    last_report = {"percent": -1, "at": 0.0}

    def report(percent: int, message: str, *, force: bool = False) -> None:
        if not progress_callback:
            return
        percent = max(0, min(100, int(percent)))
        now = time.monotonic()
        # Avoid hammering the DB on every Whisper tqdm tick.
        if not force and percent < 100:
            if percent <= last_report["percent"] and (now - last_report["at"]) < 1.0:
                return
            if (now - last_report["at"]) < 0.7 and percent < last_report["percent"] + 1:
                return
        last_report["percent"] = percent
        last_report["at"] = now
        progress_callback(percent, message)

    try:
        import stable_whisper
    except ImportError as exc:
        raise RuntimeError(
            "stable-ts is not installed. Run: pip install stable-ts"
        ) from exc

    selected_model = resolve_whisper_model(model_name)
    text = " ".join(chunks)
    report(8, f"Loading Whisper model ({selected_model})…", force=True)
    _maybe_allow_insecure_model_download()
    model = stable_whisper.load_model(selected_model)
    report(18, "Starting audio alignment…", force=True)

    align_state = {"current": 0.0, "total": 0.0, "started": time.monotonic()}

    def emit_align_progress(*, force: bool = False) -> None:
        total = float(align_state["total"] or 0)
        current = float(align_state["current"] or 0)
        elapsed = time.monotonic() - align_state["started"]
        if total <= 0:
            report(
                20,
                f"Aligning text with audio… ({elapsed:.0f}s elapsed)",
                force=force,
            )
            return
        # Never let displayed progress go backwards within alignment.
        current = max(0.0, min(current, total))
        frac = current / total
        percent = 20 + int(frac * 58)
        remaining = max(0.0, total - current)
        report(
            percent,
            (
                f"Aligning audio… {int(frac * 100)}% "
                f"({current:.0f}s / {total:.0f}s"
                f"{f', ~{remaining:.0f}s left' if remaining > 1 else ''}"
                f", {elapsed:.0f}s elapsed)"
            ),
            force=force,
        )

    def on_whisper_progress(current: float, total: float) -> None:
        try:
            total = float(total or 0)
            current = float(current or 0)
            if total > 0:
                align_state["total"] = total
            # Keep the highest progress we have seen.
            align_state["current"] = max(align_state["current"], current)
            emit_align_progress()
        except Exception:  # noqa: BLE001 - never break alignment for UI updates
            return

    # stable-ts feeds progress_callback from tqdm.n. With verbose=None, tqdm is
    # disabled and n stays at 0. Patch _update_pbar to use last_ts directly.
    from stable_whisper.non_whisper.alignment import Aligner

    original_update_pbar = Aligner._update_pbar

    def patched_update_pbar(self, tqdm_pbar, last_ts, finish: bool = False):
        original_update_pbar(self, tqdm_pbar, last_ts, finish)
        try:
            total = float(getattr(tqdm_pbar, "total", 0) or align_state["total"] or 0)
            current = float(total if finish else last_ts or 0)
            on_whisper_progress(current, total)
        except Exception:  # noqa: BLE001
            return

    stop_heartbeat = threading.Event()

    def heartbeat() -> None:
        while not stop_heartbeat.wait(2.0):
            emit_align_progress(force=True)

    Aligner._update_pbar = patched_update_pbar
    heartbeat_thread = threading.Thread(target=heartbeat, daemon=True)
    heartbeat_thread.start()
    try:
        result = model.align(
            str(audio_path),
            text,
            language=language,
            verbose=None,  # quiet console; patched pbar drives UI progress
            progress_callback=on_whisper_progress,
        )
    finally:
        stop_heartbeat.set()
        Aligner._update_pbar = original_update_pbar

    report(80, "Alignment done — cutting clips…", force=True)
    words = result.all_words()
    spans = map_chunks_to_words(chunks, words)

    out_dir.mkdir(parents=True, exist_ok=True)
    width = max(2, len(str(len(chunks))))
    outputs: list[dict] = []
    total = max(len(chunks), 1)

    for i, (chunk, span) in enumerate(zip(chunks, spans), 1):
        report(
            80 + int((i / total) * 18),
            f"Cutting {'video' if cut_as_video else 'audio'} clip {i} of {total}…",
            force=(i == 1 or i == total),
        )
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
        ext = "mp4" if cut_as_video else "mp3"
        name = f"{prefix}_{i:0{width}d}.{ext}"
        path = out_dir / name
        cut_with_ffmpeg(source_for_cuts, path, start, end, as_video=cut_as_video)
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
    report(100, "Video split complete" if cut_as_video else "Audio split complete", force=True)
    return outputs
