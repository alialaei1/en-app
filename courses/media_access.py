"""Authorize access to lesson media files under /media/lessons/."""

from __future__ import annotations

from django.db.models import Q

from .access import can_manage_course, can_open_lesson
from .models import Lesson, LessonChunk


def lesson_for_media_path(path: str) -> Lesson | None:
    rel = (path or "").lstrip("/")
    if not rel.startswith("lessons/"):
        return None

    lesson = (
        Lesson.objects.filter(
            Q(source_video=rel)
            | Q(source_audio=rel)
            | Q(media_file=rel)
            | Q(document_file=rel)
        )
        .select_related("section__course")
        .first()
    )
    if lesson:
        return lesson

    chunk = (
        LessonChunk.objects.filter(Q(audio=rel) | Q(video=rel))
        .select_related("lesson__section__course")
        .first()
    )
    if chunk:
        return chunk.lesson
    return None


def user_can_access_media_path(user, path: str) -> bool:
    """
    Non-lesson media stays public (course images, tmp cleanup, etc.).
    Lesson media requires login + open/study permission for that course.
    Unresolved lesson paths still require authentication.
    """
    rel = (path or "").lstrip("/")
    if not rel.startswith("lessons/"):
        return True

    if not getattr(user, "is_authenticated", False):
        return False

    if getattr(user, "is_staff", False):
        return True

    lesson = lesson_for_media_path(rel)
    if lesson is None:
        # Unknown lesson asset: only staff (already returned) — deny others.
        return False

    course = lesson.section.course
    return can_manage_course(user, course) or can_open_lesson(user, course)
