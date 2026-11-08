from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import Profile, UserLimits

User = get_user_model()

admin.site.unregister(User)


class ProfileInline(admin.StackedInline):
    model = Profile
    can_delete = False
    extra = 0


class UserLimitsInline(admin.StackedInline):
    model = UserLimits
    can_delete = False
    extra = 0
    fieldsets = (
        (
            "Text limits (characters)",
            {
                "fields": (
                    "display_name_max",
                    "bio_max",
                    "course_title_max",
                    "course_description_max",
                    "section_title_max",
                    "section_description_max",
                    "lesson_title_max",
                    "lesson_notes_max",
                    "pasted_text_max",
                    "review_comment_max",
                    "chunk_text_max",
                    "sentence_meaning_max",
                    "highlight_meaning_max",
                )
            },
        ),
        (
            "File limits",
            {
                "fields": (
                    "media_max_mb",
                    "media_max_seconds",
                    "document_max_mb",
                    "image_max_mb",
                )
            },
        ),
    )


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("email", "username", "is_staff", "is_active", "date_joined")
    ordering = ("email",)
    search_fields = ("email", "username", "first_name", "last_name")
    inlines = [ProfileInline, UserLimitsInline]


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("display_name", "user", "updated_at")
    search_fields = ("display_name", "user__email", "user__username")


@admin.register(UserLimits)
class UserLimitsAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "media_max_seconds",
        "media_max_mb",
        "document_max_mb",
        "course_title_max",
        "updated_at",
    )
    search_fields = ("user__email", "user__username", "user__profile__display_name")
    autocomplete_fields = ("user",)
