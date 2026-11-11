from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma"}
TEXT_EXTENSIONS = {".txt", ".csv", ".tsv"}
PDF_EXTENSIONS = {".pdf"}
DOCX_EXTENSIONS = {".docx"}


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise RuntimeError(
                f"'{tool}' was not found. Install ffmpeg and restart the terminal."
            )


def probe_duration_seconds(path: Path) -> float:
    """Return media duration in seconds via ffprobe. Raises RuntimeError on failure."""
    require_ffmpeg()
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    result = subprocess.run(cmd, check=True, capture_output=True, text=True)
    raw = (result.stdout or "").strip()
    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"Could not read media duration ({raw!r}).") from exc


def is_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS


def is_audio(path: Path) -> bool:
    return path.suffix.lower() in AUDIO_EXTENSIONS


def convert_to_audio(source: Path, destination: Path) -> Path:
    """Convert video/audio to mp3. Returns the destination path."""
    require_ffmpeg()
    destination.parent.mkdir(parents=True, exist_ok=True)

    if source.suffix.lower() == ".mp3" and source.resolve() != destination.resolve():
        shutil.copyfile(source, destination)
        return destination

    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-vn",
        "-c:a",
        "libmp3lame",
        "-q:a",
        "2",
        str(destination),
    ]
    subprocess.run(cmd, check=True)
    return destination


def compress_video(
    source: Path,
    destination: Path,
    *,
    max_width: int = 1280,
    crf: int = 28,
    audio_bitrate: str = "96k",
) -> Path:
    """
    Re-encode video to a compact H.264/AAC MP4 (capped width, modest CRF).
    If the result is larger than the source and source is already MP4, keep the source.
    """
    require_ffmpeg()
    destination.parent.mkdir(parents=True, exist_ok=True)

    vf = f"scale='min({int(max_width)},iw)':-2"
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        str(int(crf)),
        "-c:a",
        "aac",
        "-b:a",
        audio_bitrate,
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        "-pix_fmt",
        "yuv420p",
        str(destination),
    ]
    subprocess.run(cmd, check=True)

    if (
        destination.exists()
        and source.exists()
        and source.suffix.lower() == ".mp4"
        and destination.stat().st_size >= source.stat().st_size
    ):
        shutil.copyfile(source, destination)
    return destination


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in TEXT_EXTENSIONS:
        return path.read_text(encoding="utf-8-sig")
    if suffix in PDF_EXTENSIONS:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        parts = [(page.extract_text() or "") for page in reader.pages]
        return "\n".join(parts)
    if suffix in DOCX_EXTENSIONS:
        from docx import Document

        document = Document(str(path))
        return "\n".join(p.text for p in document.paragraphs if p.text.strip())
    raise ValueError(f"Unsupported document type: {suffix}")


def split_into_chunks(text: str) -> list[str]:
    """
    One content item per block separated by a blank line.

    Soft wraps stay in the same piece. Supports optional import markup
    (highlights + sentence meaning); see courses.services.import_markup.
    """
    from .import_markup import split_into_chunks as parse_chunks

    return parse_chunks(text)
