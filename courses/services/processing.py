from __future__ import annotations

import shutil
from pathlib import Path

from django.core.files import File

from .audio_split import align_and_cut
from .import_markup import ParsedChunk, parse_lesson_document
from .media import compress_video, convert_to_audio, extract_text, is_video
from .timings import highlight_audio_span


def process_lesson_media(lesson, *, align: bool = True) -> int:
    """
    Convert uploaded media/document into LessonChunk rows.
    Video uploads are compressed and kept as video; audio stays audio.
    Returns the number of chunks created.
    """
    from courses.models import ChunkHighlight, LessonChunk

    work_dir = Path(lesson.media_workdir())
    if work_dir.exists():
        shutil.rmtree(work_dir, ignore_errors=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    lesson.chunks.all().delete()
    lesson.processing_status = lesson.Status.PROCESSING
    lesson.processing_error = ""
    lesson.extracted_text = ""
    lesson.processing_progress = 5
    lesson.processing_message = "Starting lesson processing…"
    lesson.save(
        update_fields=[
            "processing_status",
            "processing_error",
            "extracted_text",
            "processing_progress",
            "processing_message",
            "updated_at",
        ]
    )

    try:
        lesson.set_progress(15, "Preparing media…")
        audio_source, video_source = _resolve_media(lesson, work_dir)
        is_video_lesson = video_source is not None

        lesson.set_progress(35, "Extracting text from document…")
        parsed_chunks = _resolve_chunks(lesson)
        chunks_text = [item.text for item in parsed_chunks]
        lesson.extracted_text = "\n".join(chunks_text)

        if lesson.source_audio:
            lesson.source_audio.delete(save=False)
        if lesson.source_video:
            lesson.source_video.delete(save=False)

        if video_source and video_source.exists():
            lesson.set_progress(42, "Saving compressed lesson video…")
            with video_source.open("rb") as handle:
                lesson.source_video.save(
                    f"lesson_{lesson.pk}_full.mp4",
                    File(handle),
                    save=False,
                )

        if audio_source and audio_source.exists():
            lesson.set_progress(45, "Saving full lesson audio…")
            with audio_source.open("rb") as handle:
                lesson.source_audio.save(
                    f"lesson_{lesson.pk}_full.mp3",
                    File(handle),
                    save=False,
                )

        created = 0
        aligned = None
        if align and audio_source and chunks_text:
            try:
                lesson.set_progress(
                    55,
                    "Preparing alignment… this can take a few minutes",
                )

                def on_progress(percent: int, message: str) -> None:
                    # Map align/cut progress into 55–92 so the UI keeps moving.
                    from django.db import close_old_connections

                    close_old_connections()
                    mapped = 55 + int((max(0, min(100, percent)) / 100) * 37)
                    lesson.set_progress(mapped, message or "Processing media…")

                aligned = align_and_cut(
                    audio_source,
                    chunks_text,
                    work_dir / "clips",
                    prefix=f"l{lesson.pk}",
                    progress_callback=on_progress,
                    cut_source=video_source if is_video_lesson else audio_source,
                    cut_as_video=is_video_lesson,
                )
            except Exception as exc:  # noqa: BLE001 - keep text chunks even if align fails
                lesson.processing_error = f"Media split skipped: {exc}"
                aligned = None

        lesson.set_progress(92, "Saving content items…")
        if aligned:
            for item in aligned:
                index = item["index"] - 1
                parsed = parsed_chunks[index] if 0 <= index < len(parsed_chunks) else None
                chunk = LessonChunk(
                    lesson=lesson,
                    text=item["text"],
                    sentence_meaning=(parsed.sentence_meaning if parsed else ""),
                    display_lines=(parsed.display_lines if parsed else None),
                    line_breaks=(list(parsed.line_breaks) if parsed else []),
                    color_spans=(_color_spans_payload(parsed) if parsed else []),
                    position=index,
                    start_sec=item["start"],
                    end_sec=item["end"],
                    word_timings=item.get("words") or [],
                )
                clip = item.get("path")
                if clip and Path(clip).exists():
                    with Path(clip).open("rb") as handle:
                        if is_video_lesson:
                            chunk.video.save(Path(clip).name, File(handle), save=False)
                        else:
                            chunk.audio.save(Path(clip).name, File(handle), save=False)
                chunk.save()
                if parsed:
                    _save_imported_highlights(chunk, parsed, ChunkHighlight)
                created += 1
        else:
            for index, parsed in enumerate(parsed_chunks):
                chunk = LessonChunk.objects.create(
                    lesson=lesson,
                    text=parsed.text,
                    sentence_meaning=parsed.sentence_meaning,
                    display_lines=parsed.display_lines,
                    line_breaks=list(parsed.line_breaks),
                    color_spans=_color_spans_payload(parsed),
                    position=index,
                    word_timings=[],
                )
                _save_imported_highlights(chunk, parsed, ChunkHighlight)
                created += 1

        lesson.processing_status = lesson.Status.READY
        lesson.processing_progress = 100
        lesson.processing_message = "Done"
        lesson.save(
            update_fields=[
                "source_audio",
                "source_video",
                "extracted_text",
                "processing_status",
                "processing_error",
                "processing_progress",
                "processing_message",
                "updated_at",
            ]
        )
        return created
    except Exception as exc:  # noqa: BLE001
        lesson.processing_status = lesson.Status.FAILED
        lesson.processing_error = str(exc)
        lesson.processing_progress = 100
        lesson.processing_message = "Failed"
        lesson.save(
            update_fields=[
                "processing_status",
                "processing_error",
                "processing_progress",
                "processing_message",
                "updated_at",
            ]
        )
        raise


def _resolve_media(lesson, work_dir: Path) -> tuple[Path | None, Path | None]:
    """
    Prepare working media files.
    Returns (audio_path_for_alignment, video_path_or_none).
    """
    if not lesson.media_file:
        return None, None

    source = Path(lesson.media_file.path)
    if is_video(source):
        video_target = work_dir / "full.mp4"
        lesson.set_progress(18, "Compressing video…")
        compress_video(source, video_target)
        audio_target = work_dir / "full.mp3"
        lesson.set_progress(28, "Extracting audio for sync…")
        convert_to_audio(video_target, audio_target)
        return audio_target, video_target

    audio_target = work_dir / "full.mp3"
    if source.suffix.lower() != ".mp3":
        convert_to_audio(source, audio_target)
    else:
        shutil.copyfile(source, audio_target)
    return audio_target, None


def _resolve_chunks(lesson) -> list[ParsedChunk]:
    parsed: list[ParsedChunk] = []
    if lesson.document_file:
        parsed = parse_lesson_document(extract_text(Path(lesson.document_file.path)))
    if lesson.pasted_text.strip():
        pasted = parse_lesson_document(lesson.pasted_text)
        parsed = pasted if pasted else parsed
    if not parsed and lesson.extracted_text.strip():
        parsed = parse_lesson_document(lesson.extracted_text)
    if not parsed:
        raise ValueError("Provide a text/PDF/Word file or paste lesson text.")
    return parsed


def _color_spans_payload(parsed: ParsedChunk) -> list[dict]:
    payload = []
    for item in parsed.color_spans:
        if item.end_char <= item.start_char:
            continue
        payload.append(
            {
                "text": item.text,
                "color": item.color,
                "start_char": item.start_char,
                "end_char": item.end_char,
            }
        )
    return payload


def _save_imported_highlights(chunk, parsed: ParsedChunk, highlight_model) -> None:
    for item in parsed.highlights:
        start = item.start_char
        end = item.end_char
        if end <= start:
            continue
        snippet = chunk.text[start:end]
        if snippet != item.text:
            continue
        start_sec, end_sec = highlight_audio_span(
            chunk.text,
            chunk.word_timings or [],
            start,
            end,
        )
        highlight_model.objects.create(
            chunk=chunk,
            text=item.text,
            meaning=item.meaning or "",
            start_char=start,
            end_char=end,
            start_sec=start_sec,
            end_sec=end_sec,
        )
