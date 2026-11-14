from django.conf import settings
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver

from .limits import DEFAULTS


class Profile(models.Model):
    class Theme(models.TextChoices):
        DARK = "dark", "Dark"
        LIGHT = "light", "Light"
        SYSTEM = "system", "System"

    class AppLanguage(models.TextChoices):
        EN = "en", "English"
        FA = "fa", "Persian (فارسی)"

    class LearningLanguage(models.TextChoices):
        EN = "en", "English"
        # Future: more target languages

    class NativeLanguage(models.TextChoices):
        FA = "fa", "Persian (فارسی)"
        # Future: more native languages for word/sentence translation

    SUPPORTED_APP_LANGUAGES = {AppLanguage.EN, AppLanguage.FA}
    SUPPORTED_LEARNING_LANGUAGES = {LearningLanguage.EN}
    SUPPORTED_NATIVE_LANGUAGES = {NativeLanguage.FA}

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    display_name = models.CharField(max_length=80, blank=True)
    bio = models.TextField(blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    theme = models.CharField(
        max_length=20,
        choices=Theme.choices,
        default=Theme.DARK,
    )
    app_language = models.CharField(
        max_length=10,
        choices=AppLanguage.choices,
        default=AppLanguage.EN,
        help_text="Language of the Mimivo interface.",
    )
    learning_language = models.CharField(
        max_length=10,
        choices=LearningLanguage.choices,
        default=LearningLanguage.EN,
        help_text="Language you are learning.",
    )
    native_language = models.CharField(
        max_length=10,
        choices=NativeLanguage.choices,
        default=NativeLanguage.FA,
        help_text="Your native language — used for word and sentence meanings.",
    )
    ui_prefs = models.JSONField(
        default=dict,
        blank=True,
        help_text="Per-user UI prefs (e.g. study video dock position/size).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_name", "id"]

    def __str__(self) -> str:
        return self.public_name

    @property
    def public_name(self) -> str:
        name = (self.display_name or "").strip()
        if name:
            return name
        email = getattr(self.user, "email", "") or ""
        if email:
            return email.split("@")[0]
        return getattr(self.user, "username", "") or f"User {self.user_id}"

    def resolved_theme(self) -> str:
        if self.theme == self.Theme.SYSTEM:
            return self.Theme.DARK  # server-side fallback; JS refines with prefers-color-scheme
        return self.theme

    def get_video_dock(self) -> dict | None:
        return normalize_video_dock((self.ui_prefs or {}).get("video_dock"))

    def set_video_dock(self, dock) -> dict | None:
        normalized = normalize_video_dock(dock)
        prefs = dict(self.ui_prefs or {})
        if normalized is None:
            prefs.pop("video_dock", None)
        else:
            prefs["video_dock"] = normalized
        self.ui_prefs = prefs
        self.save(update_fields=["ui_prefs", "updated_at"])
        return normalized


def normalize_video_dock(raw) -> dict | None:
    """Sanitize floating study-video window geometry for a user."""
    if not isinstance(raw, dict):
        return None
    out: dict = {}
    for key in ("x", "y", "w", "h"):
        try:
            value = float(raw.get(key))
        except (TypeError, ValueError):
            continue
        if value != value:  # NaN
            continue
        out[key] = round(value, 1)
    if "w" in out:
        out["w"] = max(140.0, min(640.0, out["w"]))
    if "h" in out:
        out["h"] = max(90.0, min(480.0, out["h"]))
    if not out:
        return None
    out["minimized"] = bool(raw.get("minimized"))
    return out


class UserLimits(models.Model):
    """Per-user text/upload caps. Edit in Django admin for each account."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="limits",
    )
    display_name_max = models.PositiveIntegerField(default=DEFAULTS["display_name_max"])
    bio_max = models.PositiveIntegerField(default=DEFAULTS["bio_max"])
    course_title_max = models.PositiveIntegerField(default=DEFAULTS["course_title_max"])
    course_description_max = models.PositiveIntegerField(
        default=DEFAULTS["course_description_max"]
    )
    section_title_max = models.PositiveIntegerField(default=DEFAULTS["section_title_max"])
    section_description_max = models.PositiveIntegerField(
        default=DEFAULTS["section_description_max"]
    )
    lesson_title_max = models.PositiveIntegerField(default=DEFAULTS["lesson_title_max"])
    lesson_notes_max = models.PositiveIntegerField(default=DEFAULTS["lesson_notes_max"])
    pasted_text_max = models.PositiveIntegerField(default=DEFAULTS["pasted_text_max"])
    review_comment_max = models.PositiveIntegerField(default=DEFAULTS["review_comment_max"])
    chunk_text_max = models.PositiveIntegerField(default=DEFAULTS["chunk_text_max"])
    sentence_meaning_max = models.PositiveIntegerField(
        default=DEFAULTS["sentence_meaning_max"]
    )
    highlight_meaning_max = models.PositiveIntegerField(
        default=DEFAULTS["highlight_meaning_max"]
    )
    media_max_mb = models.PositiveIntegerField(
        default=DEFAULTS["media_max_mb"],
        help_text="Max audio/video upload size in megabytes.",
    )
    media_max_seconds = models.PositiveIntegerField(
        default=DEFAULTS["media_max_seconds"],
        help_text="Max audio/video duration in seconds (default 600 = 10 minutes).",
    )
    document_max_mb = models.PositiveIntegerField(
        default=DEFAULTS["document_max_mb"],
        help_text="Max text/PDF/Word upload size in megabytes.",
    )
    image_max_mb = models.PositiveIntegerField(
        default=DEFAULTS["image_max_mb"],
        help_text="Max course cover / avatar image size in megabytes.",
    )
    max_courses = models.PositiveIntegerField(
        default=DEFAULTS["max_courses"],
        help_text="Max courses this user may create.",
    )
    max_sections_per_course = models.PositiveIntegerField(
        default=DEFAULTS["max_sections_per_course"],
        help_text="Max sections allowed in each of this user's courses.",
    )
    max_lessons_per_section = models.PositiveIntegerField(
        default=DEFAULTS["max_lessons_per_section"],
        help_text="Max lessons allowed in each section.",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "user limits"
        verbose_name_plural = "user limits"

    def __str__(self) -> str:
        return f"Limits for {self.user_id}"


def ensure_profile(user) -> Profile:
    profile, _ = Profile.objects.get_or_create(user=user)
    if not profile.display_name:
        email = (user.email or user.username or "").strip()
        profile.display_name = email.split("@")[0] if email else f"User {user.pk}"
        profile.save(update_fields=["display_name", "updated_at"])
    from .limits import ensure_user_limits

    ensure_user_limits(user)
    return profile


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_profile_for_user(sender, instance, created, **kwargs):
    if created:
        ensure_profile(instance)
