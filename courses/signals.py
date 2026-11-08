from django.db.models.signals import pre_delete
from django.dispatch import receiver

from .cleanup import (
    cleanup_chunk_files,
    cleanup_course_files,
    cleanup_lesson_files,
    cleanup_temp_upload_files,
)
from .models import Course, Lesson, LessonChunk, TempUpload


@receiver(pre_delete, sender=Course)
def course_pre_delete(sender, instance, **kwargs):
    cleanup_course_files(instance)


@receiver(pre_delete, sender=Lesson)
def lesson_pre_delete(sender, instance, **kwargs):
    cleanup_lesson_files(instance)


@receiver(pre_delete, sender=LessonChunk)
def lesson_chunk_pre_delete(sender, instance, **kwargs):
    cleanup_chunk_files(instance)


@receiver(pre_delete, sender=TempUpload)
def temp_upload_pre_delete(sender, instance, **kwargs):
    cleanup_temp_upload_files(instance)
