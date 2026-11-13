from django.urls import path

from . import views

urlpatterns = [
    path("", views.explore, name="explore"),
    path("library/", views.course_list, name="course_list"),
    path("enrolled/", views.enrolled_courses, name="enrolled_courses"),
    path("courses/new/", views.course_create, name="course_create"),
    path("courses/<int:pk>/", views.course_detail, name="course_detail"),
    path("courses/<int:pk>/edit/", views.course_edit, name="course_edit"),
    path("courses/<int:pk>/delete/", views.course_delete, name="course_delete"),
    path("courses/<int:pk>/enroll/", views.course_enroll, name="course_enroll"),
    path("courses/<int:pk>/unenroll/", views.course_unenroll, name="course_unenroll"),
    path(
        "courses/<int:pk>/enrollments/<int:enrollment_id>/approve/",
        views.enrollment_approve,
        name="enrollment_approve",
    ),
    path(
        "courses/<int:pk>/enrollments/<int:enrollment_id>/reject/",
        views.enrollment_reject,
        name="enrollment_reject",
    ),
    path(
        "courses/<int:pk>/enrollments/<int:enrollment_id>/revoke/",
        views.enrollment_revoke,
        name="enrollment_revoke",
    ),
    path("courses/<int:pk>/review/", views.course_review, name="course_review"),
    path(
        "courses/<int:pk>/review/delete/",
        views.course_review_delete,
        name="course_review_delete",
    ),
    path("courses/<int:pk>/reviews/", views.course_reviews, name="course_reviews"),
    path("courses/<int:pk>/move/<str:direction>/", views.course_move, name="course_move"),
    path(
        "courses/<int:course_pk>/sections/new/",
        views.section_create,
        name="section_create",
    ),
    path("sections/<int:pk>/edit/", views.section_edit, name="section_edit"),
    path("sections/<int:pk>/delete/", views.section_delete, name="section_delete"),
    path("sections/<int:pk>/move/<str:direction>/", views.section_move, name="section_move"),
    path(
        "courses/<int:course_pk>/sections/reorder/",
        views.section_reorder,
        name="section_reorder",
    ),
    path(
        "sections/<int:section_pk>/lessons/reorder/",
        views.lesson_reorder,
        name="lesson_reorder",
    ),
    path("uploads/temp/", views.temp_upload, name="temp_upload"),
    path(
        "sections/<int:section_pk>/lessons/new/",
        views.lesson_create,
        name="lesson_create",
    ),
    path("lessons/<int:pk>/", views.lesson_detail, name="lesson_detail"),
    path("lessons/<int:pk>/status/", views.lesson_status, name="lesson_status"),
    path("lessons/<int:pk>/export/", views.lesson_export, name="lesson_export"),
    path("lessons/<int:pk>/study/", views.lesson_study, name="lesson_study"),
    path(
        "lessons/<int:pk>/study-settings/",
        views.lesson_study_settings,
        name="lesson_study_settings",
    ),
    path("lessons/<int:pk>/edit/", views.lesson_edit, name="lesson_edit"),
    path("lessons/<int:pk>/reprocess/", views.lesson_reprocess, name="lesson_reprocess"),
    path("lessons/<int:pk>/delete/", views.lesson_delete, name="lesson_delete"),
    path("lessons/<int:pk>/move/<str:direction>/", views.lesson_move, name="lesson_move"),
    path(
        "chunks/<int:pk>/study-level/",
        views.chunk_study_level,
        name="chunk_study_level",
    ),
    path(
        "chunks/<int:pk>/study-record/",
        views.chunk_study_record,
        name="chunk_study_record",
    ),
    path(
        "chunks/<int:pk>/speak-transcribe/",
        views.chunk_speak_transcribe,
        name="chunk_speak_transcribe",
    ),
    path(
        "lessons/<int:lesson_pk>/chunks/bulk-delete/",
        views.chunk_bulk_delete,
        name="chunk_bulk_delete",
    ),
    path(
        "lessons/<int:lesson_pk>/chunks/reorder/",
        views.chunk_reorder,
        name="chunk_reorder",
    ),
    path("chunks/<int:pk>/edit/", views.chunk_edit, name="chunk_edit"),
    path("chunks/<int:pk>/delete/", views.chunk_delete, name="chunk_delete"),
    path("chunks/<int:pk>/move/<str:direction>/", views.chunk_move, name="chunk_move"),
    path(
        "chunks/<int:chunk_pk>/highlights/add/",
        views.highlight_add,
        name="highlight_add",
    ),
    path(
        "highlights/<int:pk>/delete/",
        views.highlight_delete,
        name="highlight_delete",
    ),
    path(
        "highlights/<int:pk>/update/",
        views.highlight_update,
        name="highlight_update",
    ),
]
