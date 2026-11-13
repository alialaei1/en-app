"""Per-user input / upload limits (editable in Django admin)."""

from __future__ import annotations

from dataclasses import dataclass

from django.core.exceptions import ValidationError


# Global fallbacks when no UserLimits row exists yet
DEFAULTS = {
    "display_name_max": 80,
    "bio_max": 500,
    "course_title_max": 120,
    "course_description_max": 2000,
    "section_title_max": 120,
    "section_description_max": 1000,
    "lesson_title_max": 120,
    "lesson_notes_max": 2000,
    "pasted_text_max": 100_000,
    "review_comment_max": 1000,
    "chunk_text_max": 2000,
    "sentence_meaning_max": 1000,
    "highlight_meaning_max": 500,
    "media_max_mb": 50,
    "media_max_seconds": 600,  # 10 minutes
    "document_max_mb": 1,
    "image_max_mb": 5,
    # Structure creation caps (superuser-editable per user)
    "max_courses": 5,
    "max_sections_per_course": 70,
    "max_lessons_per_section": 5,
}


@dataclass(frozen=True)
class LimitsSnapshot:
    display_name_max: int
    bio_max: int
    course_title_max: int
    course_description_max: int
    section_title_max: int
    section_description_max: int
    lesson_title_max: int
    lesson_notes_max: int
    pasted_text_max: int
    review_comment_max: int
    chunk_text_max: int
    sentence_meaning_max: int
    highlight_meaning_max: int
    media_max_mb: int
    media_max_seconds: int
    document_max_mb: int
    image_max_mb: int
    max_courses: int
    max_sections_per_course: int
    max_lessons_per_section: int

    @property
    def media_max_bytes(self) -> int:
        return max(1, self.media_max_mb) * 1024 * 1024

    @property
    def document_max_bytes(self) -> int:
        return max(1, self.document_max_mb) * 1024 * 1024

    @property
    def image_max_bytes(self) -> int:
        return max(1, self.image_max_mb) * 1024 * 1024

    def as_dict(self) -> dict:
        return {
            "display_name_max": self.display_name_max,
            "bio_max": self.bio_max,
            "course_title_max": self.course_title_max,
            "course_description_max": self.course_description_max,
            "section_title_max": self.section_title_max,
            "section_description_max": self.section_description_max,
            "lesson_title_max": self.lesson_title_max,
            "lesson_notes_max": self.lesson_notes_max,
            "pasted_text_max": self.pasted_text_max,
            "review_comment_max": self.review_comment_max,
            "chunk_text_max": self.chunk_text_max,
            "sentence_meaning_max": self.sentence_meaning_max,
            "highlight_meaning_max": self.highlight_meaning_max,
            "media_max_mb": self.media_max_mb,
            "media_max_seconds": self.media_max_seconds,
            "document_max_mb": self.document_max_mb,
            "image_max_mb": self.image_max_mb,
            "media_max_bytes": self.media_max_bytes,
            "document_max_bytes": self.document_max_bytes,
            "image_max_bytes": self.image_max_bytes,
            "max_courses": self.max_courses,
            "max_sections_per_course": self.max_sections_per_course,
            "max_lessons_per_section": self.max_lessons_per_section,
        }


def defaults_snapshot() -> LimitsSnapshot:
    return LimitsSnapshot(**DEFAULTS)


def ensure_user_limits(user):
    from .models import UserLimits

    if user is None or not getattr(user, "is_authenticated", False):
        return None
    limits, _ = UserLimits.objects.get_or_create(user=user)
    return limits


def get_limits_for_user(user) -> LimitsSnapshot:
    limits = ensure_user_limits(user) if user is not None else None
    if limits is None:
        return defaults_snapshot()
    return LimitsSnapshot(
        display_name_max=limits.display_name_max,
        bio_max=limits.bio_max,
        course_title_max=limits.course_title_max,
        course_description_max=limits.course_description_max,
        section_title_max=limits.section_title_max,
        section_description_max=limits.section_description_max,
        lesson_title_max=limits.lesson_title_max,
        lesson_notes_max=limits.lesson_notes_max,
        pasted_text_max=limits.pasted_text_max,
        review_comment_max=limits.review_comment_max,
        chunk_text_max=limits.chunk_text_max,
        sentence_meaning_max=limits.sentence_meaning_max,
        highlight_meaning_max=limits.highlight_meaning_max,
        media_max_mb=limits.media_max_mb,
        media_max_seconds=limits.media_max_seconds,
        document_max_mb=limits.document_max_mb,
        image_max_mb=limits.image_max_mb,
        max_courses=limits.max_courses,
        max_sections_per_course=limits.max_sections_per_course,
        max_lessons_per_section=limits.max_lessons_per_section,
    )


def creation_counts_for_course_owner(user) -> int:
    from courses.models import Course

    if user is None or not getattr(user, "is_authenticated", False):
        return 0
    return Course.objects.filter(owner_id=user.pk).count()


def can_create_course(user) -> bool:
    limits = get_limits_for_user(user)
    return creation_counts_for_course_owner(user) < max(0, int(limits.max_courses))


def can_create_section(user, course) -> bool:
    limits = get_limits_for_user(user)
    current = course.sections.count() if course is not None else 0
    return current < max(0, int(limits.max_sections_per_course))


def can_create_lesson(user, section) -> bool:
    limits = get_limits_for_user(user)
    current = section.lessons.count() if section is not None else 0
    return current < max(0, int(limits.max_lessons_per_section))


def apply_char_limit(field, max_chars: int, *, model_cap: int | None = None) -> None:
    cap = max(1, int(max_chars))
    if model_cap is not None:
        cap = min(cap, int(model_cap))
    field.max_length = cap
    field.widget.attrs["maxlength"] = str(cap)


def validate_text_length(
    value: str,
    max_chars: int,
    label: str = "Text",
    *,
    lang: str | None = None,
) -> str:
    text = value or ""
    if len(text) > max_chars:
        if lang:
            from .ui_i18n import tf

            raise ValidationError(
                tf(lang, "limit_text_too_long", label=label, max=max_chars, got=len(text))
            )
        raise ValidationError(f"{label}: max {max_chars} characters (got {len(text)}).")
    return text


def validate_file_size(
    upload,
    max_bytes: int,
    label: str = "File",
    *,
    lang: str | None = None,
) -> None:
    size = getattr(upload, "size", None)
    if size is None:
        return
    if size > max_bytes:
        mb = max(1, int(round(max_bytes / (1024 * 1024))))
        got = f"{size / (1024 * 1024):.1f}"
        if lang:
            from .ui_i18n import tf

            raise ValidationError(
                tf(lang, "limit_file_too_large", label=label, max_mb=mb, got_mb=got)
            )
        raise ValidationError(f"{label}: max {mb} MB (got {got} MB).")
