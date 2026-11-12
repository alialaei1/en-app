import uuid

from django.conf import settings
from django.db import models
from django.db.models import Max


class OrderedModel(models.Model):
    position = models.PositiveIntegerField(default=0, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["position", "id"]

    @classmethod
    def next_position(cls, **filters) -> int:
        current = cls.objects.filter(**filters).aggregate(m=Max("position"))["m"]
        return 0 if current is None else current + 1

    def move(self, direction: str, siblings) -> None:
        siblings = list(siblings)
        try:
            index = next(i for i, item in enumerate(siblings) if item.pk == self.pk)
        except StopIteration:
            return

        if direction == "up" and index > 0:
            sibling = siblings[index - 1]
        elif direction == "down" and index < len(siblings) - 1:
            sibling = siblings[index + 1]
        else:
            return

        self.position, sibling.position = sibling.position, self.position
        type(self).objects.bulk_update([self, sibling], ["position", "updated_at"])


class Course(OrderedModel):
    class Visibility(models.TextChoices):
        PUBLIC = "public", "Public"
        PRIVATE = "private", "Private"

    class ContentKind(models.TextChoices):
        GENERAL = "general", "General"
        PODCAST = "podcast", "Podcast"
        VIDEO = "video", "Video"
        WRITING = "writing", "Writing"
        LISTENING = "listening", "Listening"
        READING = "reading", "Reading"
        GRAMMAR = "grammar", "Grammar"
        VOCAB = "vocab", "Vocabulary"

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to="courses/", blank=True, null=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="courses",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
    )
    visibility = models.CharField(
        max_length=20,
        choices=Visibility.choices,
        default=Visibility.PRIVATE,
        db_index=True,
        help_text="Public courses appear in Explore for everyone.",
    )
    content_kind = models.CharField(
        max_length=20,
        choices=ContentKind.choices,
        default=ContentKind.GENERAL,
        db_index=True,
        help_text="Used by Explore filters (podcast, video, writing, …).",
    )

    class Meta(OrderedModel.Meta):
        verbose_name = "course"
        verbose_name_plural = "courses"

    def __str__(self) -> str:
        return self.title

    def save(self, *args, **kwargs):
        if self._state.adding and self.position == 0:
            filters = {"owner": self.owner} if self.owner_id else {}
            self.position = Course.next_position(**filters)
        super().save(*args, **kwargs)

    def siblings(self):
        if self.owner_id:
            return Course.objects.filter(owner_id=self.owner_id)
        return Course.objects.filter(owner__isnull=True)

    @property
    def is_public(self) -> bool:
        return self.visibility == self.Visibility.PUBLIC

    @property
    def author_name(self) -> str:
        if not self.owner_id:
            return "Mimivo"
        profile = getattr(self.owner, "profile", None)
        if profile is not None:
            return profile.public_name
        email = (self.owner.email or self.owner.username or "").strip()
        return email.split("@")[0] if email else f"User {self.owner_id}"


class CourseEnrollment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="course_enrollments",
        on_delete=models.CASCADE,
    )
    course = models.ForeignKey(
        Course,
        related_name="enrollments",
        on_delete=models.CASCADE,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.APPROVED,
        db_index=True,
    )
    responded_at = models.DateTimeField(blank=True, null=True)
    responded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="enrollment_responses",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "course"],
                name="unique_course_enrollment",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id} → {self.course_id} ({self.status})"

    @property
    def is_approved(self) -> bool:
        return self.status == self.Status.APPROVED

    @property
    def is_pending(self) -> bool:
        return self.status == self.Status.PENDING


class CourseReview(models.Model):
    course = models.ForeignKey(
        Course,
        related_name="reviews",
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="course_reviews",
        on_delete=models.CASCADE,
    )
    rating = models.PositiveSmallIntegerField()
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "course"],
                name="unique_course_review",
            ),
            models.CheckConstraint(
                condition=models.Q(rating__gte=1, rating__lte=5),
                name="course_review_rating_1_5",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.course_id} ★{self.rating} by {self.user_id}"


class Section(OrderedModel):
    course = models.ForeignKey(Course, related_name="sections", on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)

    class Meta(OrderedModel.Meta):
        verbose_name = "section"
        verbose_name_plural = "sections"

    def __str__(self) -> str:
        return f"{self.course.title} / {self.title}"

    def save(self, *args, **kwargs):
        if self._state.adding and self.position == 0:
            self.position = Section.next_position(course=self.course)
        super().save(*args, **kwargs)

    def siblings(self):
        return Section.objects.filter(course=self.course)


class Lesson(OrderedModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PROCESSING = "processing", "Processing"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    section = models.ForeignKey(Section, related_name="lessons", on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
    notes = models.TextField(blank=True)
    media_file = models.FileField(
        upload_to="lessons/media/",
        blank=True,
        null=True,
        help_text="Upload an audio or video file. Video is compressed and kept as video.",
    )
    document_file = models.FileField(
        upload_to="lessons/docs/",
        blank=True,
        null=True,
        help_text="Upload .txt, .pdf, or .docx",
    )
    pasted_text = models.TextField(
        blank=True,
        help_text="Optional pasted text (one sentence/line per chunk).",
    )
    source_audio = models.FileField(upload_to="lessons/audio/", blank=True, null=True)
    source_video = models.FileField(upload_to="lessons/video/", blank=True, null=True)
    extracted_text = models.TextField(blank=True)
    processing_status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    processing_progress = models.PositiveSmallIntegerField(default=0)
    processing_message = models.CharField(max_length=255, blank=True)
    processing_error = models.TextField(blank=True)
    # Extensible study UI settings for this lesson (playback, autoplay, …)
    study_settings = models.JSONField(
        default=dict,
        blank=True,
        help_text="Study settings: playback_rate, autoplay, and future options.",
    )

    DEFAULT_STUDY_SETTINGS = {
        "playback_rate": 1.0,
        "autoplay": False,
        "speaking_score_threshold": 90,
    }

    class Meta(OrderedModel.Meta):
        verbose_name = "lesson"
        verbose_name_plural = "lessons"

    def __str__(self) -> str:
        return self.title

    def save(self, *args, **kwargs):
        if self._state.adding and self.position == 0:
            self.position = Lesson.next_position(section=self.section)
        super().save(*args, **kwargs)

    def siblings(self):
        return Lesson.objects.filter(section=self.section)

    def media_workdir(self) -> str:
        from django.conf import settings

        return str(settings.MEDIA_ROOT / "work" / f"lesson_{self.pk}")

    def set_progress(self, percent: int, message: str = "") -> None:
        self.processing_progress = max(0, min(100, int(percent)))
        self.processing_message = message[:255]
        self.save(
            update_fields=["processing_progress", "processing_message", "updated_at"]
        )

    def get_study_settings(self) -> dict:
        """Legacy lesson-wide defaults. Prefer UserLessonStudySettings for learners."""
        return normalize_study_settings(self.study_settings)

    def update_study_settings(self, **updates) -> dict:
        """Legacy lesson-wide defaults writer. Prefer UserLessonStudySettings."""
        current = apply_study_settings_updates(self.study_settings, **updates)
        self.study_settings = current
        self.save(update_fields=["study_settings", "updated_at"])
        return current


class TempUpload(models.Model):
    class Kind(models.TextChoices):
        MEDIA = "media", "Media"
        DOCUMENT = "document", "Document"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    original_name = models.CharField(max_length=255)
    file = models.FileField(upload_to="tmp/")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.original_name


class LessonChunk(OrderedModel):
    lesson = models.ForeignKey(Lesson, related_name="chunks", on_delete=models.CASCADE)
    text = models.TextField()
    sentence_meaning = models.TextField(
        blank=True,
        help_text="Optional meaning of the whole sentence/piece.",
    )
    # How many visual lines to show (null = single flowing paragraph unless line_breaks set)
    display_lines = models.PositiveSmallIntegerField(
        blank=True,
        null=True,
        help_text="Optional: split this piece across N display lines.",
    )
    # Character offsets in `text` AFTER which a visual line break is inserted
    line_breaks = models.JSONField(default=list, blank=True)
    # [{"text": "AJ", "color": "red", "start_char": 0, "end_char": 2}, ...]
    color_spans = models.JSONField(default=list, blank=True)
    audio = models.FileField(upload_to="lessons/chunks/", blank=True, null=True)
    video = models.FileField(upload_to="lessons/chunks/video/", blank=True, null=True)
    start_sec = models.FloatField(blank=True, null=True)
    end_sec = models.FloatField(blank=True, null=True)
    # [{"word": "Hello", "start": 0.12, "end": 0.40}, ...] relative to this chunk's media
    word_timings = models.JSONField(default=list, blank=True)
    # Legacy shared fields — learner progress lives on UserChunkStudyProgress.
    study_level = models.PositiveSmallIntegerField(
        blank=True,
        null=True,
        help_text="Deprecated: use UserChunkStudyProgress.study_level.",
    )
    best_type_ms = models.PositiveIntegerField(
        blank=True,
        null=True,
        help_text="Deprecated: use UserChunkStudyProgress.best_type_ms.",
    )

    class Meta(OrderedModel.Meta):
        verbose_name = "lesson chunk"
        verbose_name_plural = "lesson chunks"

    def __str__(self) -> str:
        return self.text[:60]

    def siblings(self):
        return LessonChunk.objects.filter(lesson=self.lesson)


def normalize_study_settings(raw=None) -> dict:
    from accounts.models import normalize_video_dock

    data = dict(Lesson.DEFAULT_STUDY_SETTINGS)
    if isinstance(raw, dict):
        data.update(raw)
    try:
        rate = float(data.get("playback_rate", 1.0))
    except (TypeError, ValueError):
        rate = 1.0
    data["playback_rate"] = max(0.5, min(2.0, round(rate, 2)))
    data["autoplay"] = bool(data.get("autoplay", False))
    try:
        threshold = float(data.get("speaking_score_threshold", 90))
    except (TypeError, ValueError):
        threshold = 90.0
    data["speaking_score_threshold"] = max(50.0, min(100.0, round(threshold, 1)))
    dock = normalize_video_dock(data.get("video_dock"))
    if dock is None:
        data.pop("video_dock", None)
    else:
        data["video_dock"] = dock
    return data


def apply_study_settings_updates(current: dict, **updates) -> dict:
    from accounts.models import normalize_video_dock

    current = normalize_study_settings(current)
    if "playback_rate" in updates and updates["playback_rate"] is not None:
        try:
            rate = float(updates["playback_rate"])
        except (TypeError, ValueError) as exc:
            raise ValueError("playback_rate must be a number") from exc
        current["playback_rate"] = max(0.5, min(2.0, round(rate, 2)))
    if "autoplay" in updates and updates["autoplay"] is not None:
        value = updates["autoplay"]
        if isinstance(value, str):
            current["autoplay"] = value.strip().lower() in {
                "1",
                "true",
                "yes",
                "on",
            }
        else:
            current["autoplay"] = bool(value)
    if "speaking_score_threshold" in updates and updates["speaking_score_threshold"] is not None:
        try:
            threshold = float(updates["speaking_score_threshold"])
        except (TypeError, ValueError) as exc:
            raise ValueError("speaking_score_threshold must be a number") from exc
        current["speaking_score_threshold"] = max(50.0, min(100.0, round(threshold, 1)))
    if "video_dock" in updates and updates["video_dock"] is not None:
        raw = updates["video_dock"]
        if isinstance(raw, str):
            import json

            try:
                raw = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError("video_dock must be valid JSON") from exc
        dock = normalize_video_dock(raw)
        if dock is None:
            raise ValueError("video_dock is invalid")
        current["video_dock"] = dock
    return current


class UserLessonStudySettings(models.Model):
    """Per-user study UI preferences for a lesson."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="lesson_study_settings",
        on_delete=models.CASCADE,
    )
    lesson = models.ForeignKey(
        Lesson,
        related_name="user_study_settings",
        on_delete=models.CASCADE,
    )
    settings = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "lesson"],
                name="unique_user_lesson_study_settings",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id} · lesson {self.lesson_id}"

    def get_settings(self) -> dict:
        return normalize_study_settings(self.settings)

    def update_settings(self, **updates) -> dict:
        current = apply_study_settings_updates(self.settings, **updates)
        self.settings = current
        self.save(update_fields=["settings", "updated_at"])
        return current

    @classmethod
    def for_user_lesson(cls, user, lesson) -> "UserLessonStudySettings":
        obj, _ = cls.objects.get_or_create(user=user, lesson=lesson)
        return obj


class UserChunkStudyProgress(models.Model):
    """Per-user mastery/progress for one lesson card (chunk)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="chunk_study_progress",
        on_delete=models.CASCADE,
    )
    chunk = models.ForeignKey(
        LessonChunk,
        related_name="user_progress",
        on_delete=models.CASCADE,
    )
    study_level = models.PositiveSmallIntegerField(blank=True, null=True)
    best_type_ms = models.PositiveIntegerField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "chunk"],
                name="unique_user_chunk_study_progress",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id} · chunk {self.chunk_id}"

    def set_study_level(self, level: int | None) -> None:
        if level is None:
            self.study_level = None
        else:
            level = int(level)
            if level < 1 or level > 7:
                raise ValueError("Study level must be between 1 and 7.")
            self.study_level = level
        self.save(update_fields=["study_level", "updated_at"])

    def record_type_time(self, time_ms: int, *, text: str = "") -> dict:
        from .services.study_scoring import suggest_study_level

        time_ms = max(1, int(time_ms))
        previous_best = self.best_type_ms
        is_new_best = previous_best is None or time_ms < previous_best
        if is_new_best:
            self.best_type_ms = time_ms
            self.save(update_fields=["best_type_ms", "updated_at"])

        suggested = suggest_study_level(text or "", time_ms)
        return {
            "time_ms": time_ms,
            "previous_best_ms": previous_best,
            "best_type_ms": self.best_type_ms,
            "is_new_best": is_new_best,
            "suggested_level": suggested,
        }

    @classmethod
    def for_user_chunk(cls, user, chunk) -> "UserChunkStudyProgress":
        obj, _ = cls.objects.get_or_create(user=user, chunk=chunk)
        return obj


class ChunkHighlight(OrderedModel):
    """
    Optional highlighted word/phrase inside a lesson piece.
    During study mode the phrase can be hidden for guessing.
    """

    chunk = models.ForeignKey(
        LessonChunk,
        related_name="highlights",
        on_delete=models.CASCADE,
    )
    text = models.CharField(max_length=255)
    meaning = models.TextField(blank=True)
    start_char = models.PositiveIntegerField()
    end_char = models.PositiveIntegerField()
    start_sec = models.FloatField(blank=True, null=True)
    end_sec = models.FloatField(blank=True, null=True)

    class Meta(OrderedModel.Meta):
        verbose_name = "chunk highlight"
        verbose_name_plural = "chunk highlights"

    def __str__(self) -> str:
        return self.text

    def save(self, *args, **kwargs):
        if self._state.adding and self.position == 0 and self.chunk_id:
            self.position = ChunkHighlight.next_position(chunk=self.chunk)
        super().save(*args, **kwargs)

    def siblings(self):
        return ChunkHighlight.objects.filter(chunk=self.chunk)
