from __future__ import annotations

from django.core.exceptions import PermissionDenied
from django.http import Http404
from django.shortcuts import get_object_or_404

from .models import Course, CourseEnrollment, Lesson, Section


def can_manage_course(user, course: Course) -> bool:
    if not user.is_authenticated:
        return False
    if user.is_staff:
        return True
    return bool(course.owner_id and course.owner_id == user.id)


def is_enrolled(user, course: Course) -> bool:
    if not user.is_authenticated:
        return False
    return CourseEnrollment.objects.filter(user=user, course=course).exists()


def can_view_course(user, course: Course) -> bool:
    if course.is_public:
        return True
    return can_manage_course(user, course)


def can_study_course(user, course: Course) -> bool:
    """Study: login + (owner/staff OR enrolled in a viewable course)."""
    if not user.is_authenticated:
        return False
    if can_manage_course(user, course):
        return True
    if not can_view_course(user, course):
        return False
    return is_enrolled(user, course)


def can_open_lesson(user, course: Course) -> bool:
    """Open lesson page (read-only for learners): owner/staff or enrolled."""
    return can_study_course(user, course)


def require_course_manage(user, course: Course) -> None:
    if not can_manage_course(user, course):
        raise PermissionDenied("You do not have permission to manage this course.")


def require_course_view(user, course: Course) -> None:
    if not can_view_course(user, course):
        raise Http404("Course not found.")


def require_course_study(user, course: Course) -> None:
    if not user.is_authenticated:
        raise PermissionDenied("Log in to study.")
    if not can_view_course(user, course):
        raise Http404("Course not found.")
    if not can_study_course(user, course):
        raise PermissionDenied("Enroll in this course to study.")


def require_lesson_open(user, course: Course) -> None:
    """Enrolled learners (and managers) may open lesson pages; others cannot."""
    if not user.is_authenticated:
        raise PermissionDenied("Log in to open this lesson.")
    if not can_view_course(user, course):
        raise Http404("Course not found.")
    if not can_open_lesson(user, course):
        raise PermissionDenied("Enroll in this course to open lessons.")


def get_managed_course(user, pk: int) -> Course:
    course = get_object_or_404(Course, pk=pk)
    require_course_manage(user, course)
    return course


def get_viewable_course(user, pk: int) -> Course:
    course = get_object_or_404(Course, pk=pk)
    require_course_view(user, course)
    return course


def course_from_section(section: Section) -> Course:
    return section.course


def course_from_lesson(lesson: Lesson) -> Course:
    return lesson.section.course
