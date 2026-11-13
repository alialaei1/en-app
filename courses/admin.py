from django.contrib import admin

from .models import (
    ChunkHighlight,
    Course,
    CourseEnrollment,
    Lesson,
    LessonChunk,
    Section,
    UserChunkStudyProgress,
    UserLessonStudySettings,
)


class SectionInline(admin.TabularInline):
    model = Section
    extra = 0


class LessonInline(admin.TabularInline):
    model = Lesson
    extra = 0
    fields = ("title", "processing_status", "position")


class LessonChunkInline(admin.TabularInline):
    model = LessonChunk
    extra = 0


class ChunkHighlightInline(admin.TabularInline):
    model = ChunkHighlight
    extra = 0


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "visibility", "position", "updated_at")
    list_filter = ("visibility",)
    search_fields = ("title", "description", "owner__email")
    raw_id_fields = ("owner",)
    inlines = [SectionInline]


@admin.register(CourseEnrollment)
class CourseEnrollmentAdmin(admin.ModelAdmin):
    list_display = ("user", "course", "status", "created_at", "responded_at")
    list_filter = ("status", "created_at")
    search_fields = ("user__email", "course__title")
    raw_id_fields = ("user", "course", "responded_by")


@admin.register(Section)
class SectionAdmin(admin.ModelAdmin):
    list_display = ("title", "course", "position", "updated_at")
    list_filter = ("course",)
    search_fields = ("title",)
    inlines = [LessonInline]


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):
    list_display = ("title", "section", "processing_status", "position", "updated_at")
    list_filter = ("processing_status", "section__course")
    search_fields = ("title", "extracted_text")
    inlines = [LessonChunkInline]


@admin.register(LessonChunk)
class LessonChunkAdmin(admin.ModelAdmin):
    list_display = ("text_preview", "lesson", "position", "start_sec", "end_sec")
    list_filter = ("lesson__section__course",)
    search_fields = ("text", "sentence_meaning")
    inlines = [ChunkHighlightInline]

    @admin.display(description="text")
    def text_preview(self, obj):
        return obj.text[:80]


@admin.register(ChunkHighlight)
class ChunkHighlightAdmin(admin.ModelAdmin):
    list_display = ("text", "chunk", "start_char", "end_char", "start_sec", "end_sec")
    search_fields = ("text", "meaning")


@admin.register(UserLessonStudySettings)
class UserLessonStudySettingsAdmin(admin.ModelAdmin):
    list_display = ("user", "lesson", "updated_at")
    search_fields = ("user__email", "lesson__title")
    raw_id_fields = ("user", "lesson")


@admin.register(UserChunkStudyProgress)
class UserChunkStudyProgressAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "chunk",
        "study_level",
        "best_type_ms",
        "best_speak_ms",
        "updated_at",
    )
    list_filter = ("study_level",)
    search_fields = ("user__email", "chunk__text")
    raw_id_fields = ("user", "chunk")
