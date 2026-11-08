from __future__ import annotations

import shutil
from pathlib import Path

from django.db.models.fields.files import FieldFile


def delete_file_field(field_file: FieldFile | None) -> None:
    """Remove a FileField/ImageField from storage if it exists."""
    if not field_file:
        return
    name = getattr(field_file, "name", "") or ""
    if not name:
        return
    storage = field_file.storage
    try:
        if storage.exists(name):
            storage.delete(name)
    except Exception:
        # Best-effort cleanup; never block the DB delete.
        pass


def delete_path(path: str | Path | None) -> None:
    if not path:
        return
    target = Path(path)
    try:
        if target.is_file():
            target.unlink(missing_ok=True)
        elif target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
    except Exception:
        pass


def cleanup_course_files(course) -> None:
    delete_file_field(course.image)


def cleanup_lesson_files(lesson) -> None:
    delete_file_field(lesson.media_file)
    delete_file_field(lesson.document_file)
    delete_file_field(lesson.source_audio)
    delete_path(lesson.media_workdir())


def cleanup_chunk_files(chunk) -> None:
    delete_file_field(chunk.audio)


def cleanup_temp_upload_files(temp) -> None:
    delete_file_field(temp.file)
