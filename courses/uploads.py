from __future__ import annotations

import threading

from django.core.files import File
from django.db import connection

from .models import Lesson, TempUpload
from .services import process_lesson_media


def attach_temp_upload(lesson: Lesson, temp_id, field_name: str) -> None:
    if not temp_id:
        return
    temp = TempUpload.objects.get(pk=temp_id)
    field = getattr(lesson, field_name)
    if field:
        field.delete(save=False)
    with temp.file.open("rb") as handle:
        field.save(temp.original_name, File(handle), save=False)
    temp.file.delete(save=False)
    temp.delete()


def start_lesson_processing(lesson_id: int, *, align: bool = True) -> None:
    def run() -> None:
        try:
            lesson = Lesson.objects.get(pk=lesson_id)
            process_lesson_media(lesson, align=align)
        except Exception:
            # Errors are persisted on the lesson by process_lesson_media.
            pass
        finally:
            connection.close()

    threading.Thread(target=run, daemon=True).start()
