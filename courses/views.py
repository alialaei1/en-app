import json

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Avg, Count, Prefetch, Q
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .access import (
    can_manage_course,
    can_open_lesson,
    can_study_course,
    enrollment_for,
    enrollment_status,
    is_enrolled,
    require_course_manage,
    require_course_study,
    require_course_view,
    require_lesson_open,
)
from .forms import (
    ChunkHighlightForm,
    CourseForm,
    CourseReviewForm,
    LessonChunkForm,
    LessonForm,
    SectionForm,
)
from .models import (
    ChunkHighlight,
    Course,
    CourseEnrollment,
    CourseReview,
    Lesson,
    LessonChunk,
    Section,
    TempUpload,
    UserChunkStudyProgress,
    UserLessonStudySettings,
)
from .feed import (
    REVIEW_PAGE_SIZE,
    feed_json,
    page_count,
    page_number,
    paginate_items,
    wants_feed_json,
)
from .serializers import chunk_payload, highlight_payload, study_lesson_payload
from .services.import_markup import export_lesson_document
from .services.timings import highlight_audio_span
from .uploads import attach_temp_upload, start_lesson_processing

from accounts.ui_i18n import localize_form_help, localize_form_labels, request_app_lang, t, tf


def _localize_course_form(form, lang):
    localize_form_labels(
        form,
        lang,
        {
            "title": "title",
            "description": "description",
            "image": "image",
            "visibility": "visibility",
            "content_kind": "content_kind",
        },
    )
    localize_form_help(
        form,
        lang,
        {
            "visibility": "visibility_help",
            "content_kind": "content_kind_help",
        },
    )
    if "visibility" in form.fields:
        form.fields["visibility"].choices = [
            (Course.Visibility.PUBLIC, t(lang, "public")),
            (Course.Visibility.PRIVATE, t(lang, "private")),
        ]
    if "content_kind" in form.fields:
        form.fields["content_kind"].choices = [
            (value, t(lang, f"kind_{value}"))
            for value, _label in Course.ContentKind.choices
        ]
    for name, ph_key in (("title", "course_title_ph"), ("description", "short_description_ph")):
        if name in form.fields:
            form.fields[name].widget.attrs["placeholder"] = t(lang, ph_key)


EXPLORE_RANK_FILTERS = ("suggested", "trend", "new", "private")
EXPLORE_KIND_FILTERS = tuple(value for value, _ in Course.ContentKind.choices if value != "general")
EXPLORE_FILTERS = EXPLORE_RANK_FILTERS + EXPLORE_KIND_FILTERS


def _explore_filters(lang: str) -> list[dict]:
    items = []
    for key in EXPLORE_FILTERS:
        items.append({"key": key, "label": t(lang, f"filter_{key}")})
    return items


def _apply_explore_filter(qs, filter_key: str):
    approved = Count(
        "enrollments",
        filter=Q(enrollments__status=CourseEnrollment.Status.APPROVED),
        distinct=True,
    )
    if filter_key == "private":
        return qs.filter(visibility=Course.Visibility.PRIVATE).order_by("-updated_at", "id")
    if filter_key in EXPLORE_KIND_FILTERS:
        return qs.filter(content_kind=filter_key).order_by("-updated_at", "id")
    if filter_key == "trend":
        return qs.annotate(enroll_count=approved).order_by(
            "-enroll_count", "-lesson_count", "-updated_at", "id"
        )
    if filter_key == "new":
        return qs.order_by("-created_at", "id")
    # suggested: fresh activity with some content first
    return qs.annotate(enroll_count=approved).order_by(
        "-updated_at", "-enroll_count", "-lesson_count", "id"
    )


def _localize_section_form(form, lang):
    localize_form_labels(form, lang, {"title": "title", "description": "description"})
    for name, ph_key in (("title", "section_title_ph"), ("description", "optional_notes_ph")):
        if name in form.fields:
            form.fields[name].widget.attrs["placeholder"] = t(lang, ph_key)


def _localize_lesson_form(form, lang):
    localize_form_labels(
        form,
        lang,
        {
            "title": "title",
            "notes": "notes_optional",
            "pasted_text": "or_paste_text",
        },
    )
    for name, ph_key in (("title", "lesson_title_ph"), ("notes", "internal_notes_ph")):
        if name in form.fields:
            form.fields[name].widget.attrs["placeholder"] = t(lang, ph_key)



def _validate_direction(direction: str) -> str:
    if direction not in {"up", "down"}:
        raise Http404("Invalid direction")
    return direction


def _wants_json(request) -> bool:
    return wants_feed_json(request)


def _should_process(form: LessonForm) -> bool:
    changed = set(form.changed_data)
    return bool({"media_temp_id", "document_temp_id", "pasted_text"} & changed)


def _form_errors_json(form: LessonForm) -> dict:
    errors = {field: [str(e) for e in errs] for field, errs in form.errors.items()}
    return {"ok": False, "errors": errors}


def _course_queryset():
    return Course.objects.select_related("owner", "owner__profile").annotate(
        section_count=Count("sections", distinct=True),
        lesson_count=Count("sections__lessons", distinct=True),
        rating_avg=Avg("reviews__rating"),
        rating_count=Count("reviews", distinct=True),
    )


def _enrolled_course_ids(user) -> set[int]:
    if not user.is_authenticated:
        return set()
    return set(
        CourseEnrollment.objects.filter(
            user=user, status=CourseEnrollment.Status.APPROVED
        ).values_list("course_id", flat=True)
    )


def _user_enrollment_maps(user, course_ids) -> tuple[set[int], set[int]]:
    """Return (approved_ids, pending_ids) for the current user."""
    if not user.is_authenticated or not course_ids:
        return set(), set()
    rows = CourseEnrollment.objects.filter(
        user=user, course_id__in=course_ids
    ).values_list("course_id", "status")
    approved: set[int] = set()
    pending: set[int] = set()
    for course_id, status in rows:
        if status == CourseEnrollment.Status.APPROVED:
            approved.add(course_id)
        elif status == CourseEnrollment.Status.PENDING:
            pending.add(course_id)
    return approved, pending


def explore(request):
    query = (request.GET.get("q") or "").strip()
    filter_key = (request.GET.get("f") or "suggested").strip().lower()
    if filter_key not in EXPLORE_FILTERS:
        filter_key = "suggested"

    lang = request_app_lang(request)
    base = _course_queryset()
    filters = _explore_filters(lang)
    filter_label = t(lang, f"filter_{filter_key}")

    qs = base
    if query:
        qs = qs.filter(
            Q(title__icontains=query)
            | Q(description__icontains=query)
            | Q(owner__email__icontains=query)
            | Q(owner__username__icontains=query)
            | Q(owner__profile__display_name__icontains=query)
        )
    qs = _apply_explore_filter(qs, filter_key)
    page = page_number(request)
    total = qs.count()
    courses, has_more = paginate_items(qs, page)
    enrolled_ids, pending_ids = _user_enrollment_maps(
        request.user, [c.pk for c in courses]
    )

    ctx = {
        "query": query,
        "active_filter": filter_key,
        "explore_filters": filters,
        "courses": courses,
        "result_count": total,
        "enrolled_ids": enrolled_ids,
        "pending_ids": pending_ids,
        "filter_label": filter_label,
        "feed_page": page,
        "feed_has_more": has_more,
    }

    if wants_feed_json(request):
        html = render_to_string(
            "courses/_feed_explore_items.html",
            {
                "courses": courses,
                "enrolled_ids": enrolled_ids,
                "pending_ids": pending_ids,
            },
            request=request,
        )
        return feed_json(
            html=html,
            page=page,
            has_more=has_more,
            total=total,
            meta={
                "filter_label": filter_label,
                "query": query,
                "active_filter": filter_key,
            },
        )

    return render(request, "courses/explore.html", ctx)


@login_required
def course_list(request):
    from accounts.limits import can_create_course, get_limits_for_user

    qs = (
        _course_queryset()
        .filter(owner=request.user)
        .order_by("position", "id")
    )
    page = page_number(request)
    total = qs.count()
    courses, has_more = paginate_items(qs, page)
    limits = get_limits_for_user(request.user)
    ctx = {
        "courses": courses,
        "feed_page": page,
        "feed_has_more": has_more,
        "result_count": total,
        "can_create_course": can_create_course(request.user),
        "max_courses": limits.max_courses,
    }
    if wants_feed_json(request):
        html = render_to_string(
            "courses/_feed_library_items.html",
            {"courses": courses},
            request=request,
        )
        return feed_json(html=html, page=page, has_more=has_more, total=total)
    return render(request, "courses/course_list.html", ctx)


ENROLLED_KIND_FILTERS = tuple(value for value, _ in Course.ContentKind.choices)
ENROLLED_FILTERS = ("all",) + ENROLLED_KIND_FILTERS


def _enrolled_filters(lang: str) -> list[dict]:
    items = [{"key": "all", "label": t(lang, "filter_all")}]
    for key in ENROLLED_KIND_FILTERS:
        items.append({"key": key, "label": t(lang, f"kind_{key}")})
    return items


def _apply_enrolled_filter(qs, filter_key: str):
    if filter_key in ENROLLED_KIND_FILTERS:
        return qs.filter(course__content_kind=filter_key).order_by("-created_at", "id")
    # all: recently enrolled
    return qs.order_by("-created_at", "id")


@login_required
def enrolled_courses(request):
    query = (request.GET.get("q") or "").strip()
    filter_key = (request.GET.get("f") or "all").strip().lower()
    if filter_key not in ENROLLED_FILTERS:
        filter_key = "all"

    lang = request_app_lang(request)
    filters = _enrolled_filters(lang)
    filter_label = (
        t(lang, "filter_all") if filter_key == "all" else t(lang, f"kind_{filter_key}")
    )

    enrollments = (
        CourseEnrollment.objects.filter(
            user=request.user, status=CourseEnrollment.Status.APPROVED
        )
        .select_related("course", "course__owner", "course__owner__profile")
        .annotate(
            section_count=Count("course__sections", distinct=True),
            lesson_count=Count("course__sections__lessons", distinct=True),
            rating_avg=Avg("course__reviews__rating"),
            rating_count=Count("course__reviews", distinct=True),
        )
    )
    if query:
        enrollments = enrollments.filter(
            Q(course__title__icontains=query)
            | Q(course__description__icontains=query)
            | Q(course__owner__email__icontains=query)
            | Q(course__owner__username__icontains=query)
            | Q(course__owner__profile__display_name__icontains=query)
        )
    enrollments = _apply_enrolled_filter(enrollments, filter_key)

    page = page_number(request)
    total = enrollments.count()
    page_rows, has_more = paginate_items(enrollments, page)
    courses = []
    for enrollment in page_rows:
        course = enrollment.course
        course.section_count = enrollment.section_count
        course.lesson_count = enrollment.lesson_count
        course.rating_avg = enrollment.rating_avg
        course.rating_count = enrollment.rating_count
        courses.append(course)
    ctx = {
        "courses": courses,
        "enrolled_ids": {c.pk for c in courses},
        "query": query,
        "active_filter": filter_key,
        "enrolled_filters": filters,
        "filter_label": filter_label,
        "feed_page": page,
        "feed_has_more": has_more,
        "result_count": total,
    }
    if wants_feed_json(request):
        html = render_to_string(
            "courses/_feed_enrolled_items.html",
            {"courses": courses},
            request=request,
        )
        return feed_json(
            html=html,
            page=page,
            has_more=has_more,
            total=total,
            meta={
                "filter_label": filter_label,
                "query": query,
                "active_filter": filter_key,
            },
        )
    return render(request, "courses/enrolled_courses.html", ctx)


def _redirect_next_or(request, fallback_name, **kwargs):
    next_url = request.POST.get("next") or ""
    if next_url.startswith("/") and not next_url.startswith("//"):
        return redirect(next_url)
    return redirect(fallback_name, **kwargs) if kwargs else redirect(fallback_name)


@login_required
@require_POST
def course_enroll(request, pk):
    course = get_object_or_404(Course, pk=pk)
    require_course_view(request.user, course)
    lang = request_app_lang(request)

    if can_manage_course(request.user, course):
        messages.info(request, t(lang, "owner_no_enroll_needed"))
        return _redirect_next_or(request, "course_detail", pk=course.pk)

    enrollment = enrollment_for(request.user, course)
    if course.is_public:
        if enrollment and enrollment.is_approved:
            messages.info(request, t(lang, "already_enrolled"))
        else:
            CourseEnrollment.objects.update_or_create(
                user=request.user,
                course=course,
                defaults={
                    "status": CourseEnrollment.Status.APPROVED,
                    "responded_at": timezone.now(),
                    "responded_by": None,
                },
            )
            messages.success(
                request, f'{t(lang, "enrolled_in")} “{course.title}”.'
            )
        return _redirect_next_or(request, "enrolled_courses")

    # Private course: request enrollment
    if enrollment and enrollment.is_approved:
        messages.info(request, t(lang, "already_enrolled"))
    elif enrollment and enrollment.is_pending:
        messages.info(request, t(lang, "enroll_request_pending"))
    else:
        CourseEnrollment.objects.update_or_create(
            user=request.user,
            course=course,
            defaults={
                "status": CourseEnrollment.Status.PENDING,
                "responded_at": None,
                "responded_by": None,
            },
        )
        messages.success(request, t(lang, "enroll_request_sent"))
    return _redirect_next_or(request, "course_detail", pk=course.pk)


@login_required
@require_POST
def course_unenroll(request, pk):
    course = get_object_or_404(Course, pk=pk)
    deleted, _ = CourseEnrollment.objects.filter(
        user=request.user,
        course=course,
    ).delete()
    lang = request_app_lang(request)
    if deleted:
        messages.success(
            request,
            f'{t(lang, "removed_from_enrolled")} (“{course.title}”).',
        )
    else:
        messages.info(request, t(lang, "not_in_enrolled"))
    return _redirect_next_or(request, "enrolled_courses")


@login_required
@require_POST
def enrollment_approve(request, pk, enrollment_id):
    course = get_object_or_404(Course, pk=pk)
    require_course_manage(request.user, course)
    lang = request_app_lang(request)
    if course.is_public:
        messages.error(request, t(lang, "public_no_enrollment_mgmt"))
        return redirect("course_detail", pk=course.pk)

    enrollment = get_object_or_404(CourseEnrollment, pk=enrollment_id, course=course)
    enrollment.status = CourseEnrollment.Status.APPROVED
    enrollment.responded_at = timezone.now()
    enrollment.responded_by = request.user
    enrollment.save(update_fields=["status", "responded_at", "responded_by"])
    messages.success(request, t(lang, "enroll_approved"))
    return redirect("course_detail", pk=course.pk)


@login_required
@require_POST
def enrollment_reject(request, pk, enrollment_id):
    course = get_object_or_404(Course, pk=pk)
    require_course_manage(request.user, course)
    lang = request_app_lang(request)
    if course.is_public:
        messages.error(request, t(lang, "public_no_enrollment_mgmt"))
        return redirect("course_detail", pk=course.pk)

    enrollment = get_object_or_404(CourseEnrollment, pk=enrollment_id, course=course)
    enrollment.status = CourseEnrollment.Status.REJECTED
    enrollment.responded_at = timezone.now()
    enrollment.responded_by = request.user
    enrollment.save(update_fields=["status", "responded_at", "responded_by"])
    messages.success(request, t(lang, "enroll_rejected"))
    return redirect("course_detail", pk=course.pk)


@login_required
@require_POST
def enrollment_revoke(request, pk, enrollment_id):
    course = get_object_or_404(Course, pk=pk)
    require_course_manage(request.user, course)
    lang = request_app_lang(request)
    if course.is_public:
        messages.error(request, t(lang, "public_no_enrollment_mgmt"))
        return redirect("course_detail", pk=course.pk)

    enrollment = get_object_or_404(CourseEnrollment, pk=enrollment_id, course=course)
    enrollment.delete()
    messages.success(request, t(lang, "enroll_revoked"))
    return redirect("course_detail", pk=course.pk)


def _can_review_course(user, course) -> bool:
    if not user.is_authenticated:
        return False
    if can_manage_course(user, course):
        return True
    if course.is_public:
        return True
    return is_enrolled(user, course)


@login_required
@require_http_methods(["GET", "POST"])
def course_review(request, pk):
    course = get_object_or_404(Course, pk=pk)
    require_course_view(request.user, course)
    if not _can_review_course(request.user, course):
        messages.error(request, t(request_app_lang(request), "review_not_allowed"))
        return redirect("course_detail", pk=course.pk)

    lang = request_app_lang(request)
    existing = CourseReview.objects.filter(user=request.user, course=course).first()
    form = CourseReviewForm(request.POST or None, instance=existing, user=request.user, lang=lang)
    localize_form_labels(
        form,
        lang,
        {"rating": "review_rating", "comment": "review_comment"},
    )
    if request.method == "POST" and form.is_valid():
        review = form.save(commit=False)
        review.user = request.user
        review.course = course
        review.save()
        messages.success(
            request,
            t(lang, "review_updated" if existing else "review_created"),
        )
        return redirect(f"{reverse('course_detail', kwargs={'pk': course.pk})}?reviews=1")

    if request.method == "POST":
        messages.error(request, t(lang, "review_invalid"))
    return redirect(f"{reverse('course_detail', kwargs={'pk': course.pk})}?reviews=1")


@login_required
@require_POST
def course_review_delete(request, pk):
    course = get_object_or_404(Course, pk=pk)
    deleted, _ = CourseReview.objects.filter(user=request.user, course=course).delete()
    if deleted:
        messages.success(request, t(request_app_lang(request), "review_deleted"))
    return redirect(f"{reverse('course_detail', kwargs={'pk': course.pk})}?reviews=1")


@login_required
@require_http_methods(["GET", "POST"])
def course_create(request):
    from accounts.limits import can_create_course, get_limits_for_user

    lang = request_app_lang(request)
    limits = get_limits_for_user(request.user)
    if not can_create_course(request.user):
        messages.error(
            request,
            tf(lang, "limit_max_courses", max=limits.max_courses),
        )
        return redirect("course_list")
    form = CourseForm(request.POST or None, request.FILES or None, user=request.user, lang=lang)
    _localize_course_form(form, lang)
    if request.method == "POST" and form.is_valid():
        if not can_create_course(request.user):
            messages.error(
                request,
                tf(lang, "limit_max_courses", max=limits.max_courses),
            )
            return redirect("course_list")
        course = form.save(commit=False)
        course.owner = request.user
        course.save()
        messages.success(request, t(request_app_lang(request), "course_created"))
        return redirect("course_detail", pk=course.pk)
    return render(
        request,
        "courses/course_form.html",
        {"form": form, "page_title": t(request_app_lang(request), "page_new_course"), "submit_label": t(request_app_lang(request), "submit_create_course")},
    )


def _reviews_queryset(course):
    return CourseReview.objects.filter(course=course).select_related(
        "user", "user__profile"
    ).order_by("-updated_at", "-id")


def _attach_lesson_study_progress(course, user) -> None:
    """Attach per-lesson graded % for the current user (study_level set = done)."""
    if user is None or not getattr(user, "is_authenticated", False):
        return
    lesson_ids: list[int] = []
    for section in course.sections.all():
        for lesson in section.lessons.all():
            lesson_ids.append(lesson.pk)
            lesson.study_done = 0
            lesson.study_left = int(getattr(lesson, "chunk_count", 0) or 0)
            lesson.study_done_pct = 0
            lesson.study_left_pct = 100 if lesson.study_left else 0
    if not lesson_ids:
        return

    graded_rows = (
        UserChunkStudyProgress.objects.filter(
            user=user,
            chunk__lesson_id__in=lesson_ids,
            study_level__isnull=False,
        )
        .values("chunk__lesson_id")
        .annotate(n=Count("id"))
    )
    graded_map = {row["chunk__lesson_id"]: int(row["n"] or 0) for row in graded_rows}
    for section in course.sections.all():
        for lesson in section.lessons.all():
            total = int(getattr(lesson, "chunk_count", 0) or 0)
            done = min(graded_map.get(lesson.pk, 0), total) if total else 0
            left = max(0, total - done)
            if total > 0:
                done_pct = int(round(100.0 * done / total))
                # Keep done + left = 100 for display.
                if done == total:
                    done_pct = 100
                elif done == 0:
                    done_pct = 0
                left_pct = 100 - done_pct
            else:
                done_pct = 0
                left_pct = 0
            lesson.study_done = done
            lesson.study_left = left
            lesson.study_done_pct = done_pct
            lesson.study_left_pct = left_pct


def course_detail(request, pk):
    course = get_object_or_404(
        _course_queryset().prefetch_related(
            Prefetch(
                "sections",
                queryset=Section.objects.order_by("position", "id").prefetch_related(
                    Prefetch(
                        "lessons",
                        queryset=Lesson.objects.annotate(chunk_count=Count("chunks")).order_by(
                            "position", "id"
                        ),
                    )
                ),
            ),
        ),
        pk=pk,
    )
    require_course_view(request.user, course)
    can_manage = can_manage_course(request.user, course)
    enrolled = is_enrolled(request.user, course)
    my_status = enrollment_status(request.user, course)
    lang = request_app_lang(request)
    user_review = None
    if request.user.is_authenticated:
        user_review = CourseReview.objects.filter(
            user=request.user, course=course
        ).first()
    review_form = CourseReviewForm(instance=user_review, user=request.user if request.user.is_authenticated else None, lang=lang)
    localize_form_labels(
        review_form,
        lang,
        {"rating": "review_rating", "comment": "review_comment"},
    )
    if "comment" in review_form.fields:
        review_form.fields["comment"].widget.attrs["placeholder"] = t(
            lang, "review_comment_ph"
        )
    lesson_reorder_template = reverse(
        "lesson_reorder", kwargs={"section_pk": 999999999}
    ).replace("999999999", "{id}")
    rating_avg = course.rating_avg or 0
    rating_count = course.rating_count or 0

    pending_enrollments = []
    approved_enrollments = []
    rejected_enrollments = []
    if can_manage and not course.is_public:
        managed = list(
            course.enrollments.select_related("user", "user__profile").order_by(
                "-created_at", "id"
            )
        )
        pending_enrollments = [
            e for e in managed if e.status == CourseEnrollment.Status.PENDING
        ]
        approved_enrollments = [
            e for e in managed if e.status == CourseEnrollment.Status.APPROVED
        ]
        rejected_enrollments = [
            e for e in managed if e.status == CourseEnrollment.Status.REJECTED
        ]

    from accounts.limits import can_create_section, get_limits_for_user

    limits = get_limits_for_user(request.user) if request.user.is_authenticated else None
    max_sections = limits.max_sections_per_course if limits else 0
    max_lessons = limits.max_lessons_per_section if limits else 0
    section_add_allowed = (
        can_manage and limits is not None and can_create_section(request.user, course)
    )
    limit_sections_msg = (
        tf(lang, "limit_sections_reached", max=max_sections) if limits else ""
    )
    limit_lessons_msg = (
        tf(lang, "limit_lessons_reached", max=max_lessons) if limits else ""
    )

    reviews_page = page_number(request, "reviews_page")
    reviews_total = int(rating_count or 0)
    reviews_pages = page_count(reviews_total, REVIEW_PAGE_SIZE)
    if reviews_page > reviews_pages:
        reviews_page = reviews_pages
    reviews, _reviews_has_more = paginate_items(
        _reviews_queryset(course), reviews_page, REVIEW_PAGE_SIZE
    )

    can_study = can_manage or enrolled
    if can_study and request.user.is_authenticated:
        _attach_lesson_study_progress(course, request.user)

    return render(
        request,
        "courses/course_detail.html",
        {
            "course": course,
            "can_manage": can_manage,
            "is_enrolled": enrolled,
            "enrollment_status": my_status,
            "can_study": can_study,
            "can_review": _can_review_course(request.user, course),
            "reviews": reviews,
            "reviews_page": reviews_page,
            "reviews_pages": reviews_pages,
            "reviews_has_prev": reviews_page > 1,
            "reviews_has_next": reviews_page < reviews_pages,
            "reviews_page_label": tf(
                lang, "page_of", page=reviews_page, pages=reviews_pages
            ),
            "reviews_url": reverse("course_reviews", kwargs={"pk": course.pk}),
            "user_review": user_review,
            "review_form": review_form,
            "rating_avg": rating_avg,
            "rating_count": rating_count,
            "rating_avg_display": f"{rating_avg:.1f}" if rating_count else "—",
            "section_reorder_url": reverse(
                "section_reorder", kwargs={"course_pk": course.pk}
            ),
            "lesson_reorder_url_template": lesson_reorder_template,
            "pending_enrollments": pending_enrollments,
            "approved_enrollments": approved_enrollments,
            "rejected_enrollments": rejected_enrollments,
            "can_add_section": section_add_allowed,
            "max_sections_per_course": max_sections,
            "max_lessons_per_section": max_lessons,
            "limit_sections_msg": limit_sections_msg,
            "limit_lessons_msg": limit_lessons_msg,
        },
    )


@require_GET
def course_reviews(request, pk):
    course = get_object_or_404(_course_queryset(), pk=pk)
    require_course_view(request.user, course)
    lang = request_app_lang(request)
    total = CourseReview.objects.filter(course=course).count()
    pages = page_count(total, REVIEW_PAGE_SIZE)
    page = page_number(request)
    if page > pages:
        page = pages
    reviews, _ = paginate_items(_reviews_queryset(course), page, REVIEW_PAGE_SIZE)
    html = render_to_string(
        "courses/_review_items.html",
        {"reviews": reviews},
        request=request,
    )
    return JsonResponse(
        {
            "ok": True,
            "html": html,
            "page": page,
            "pages": pages,
            "total": total,
            "has_prev": page > 1,
            "has_next": page < pages,
        }
    )


def _reorder_by_ids(*, queryset, ordered_ids, label: str):
    items = list(queryset)
    item_map = {item.pk: item for item in items}
    if not ordered_ids or set(ordered_ids) != set(item_map.keys()):
        return JsonResponse(
            {"ok": False, "error": f"Order must include every {label} once."},
            status=400,
        )

    model = queryset.model
    updates = []
    for index, item_id in enumerate(ordered_ids):
        item = item_map[item_id]
        if item.position != index:
            item.position = index
            updates.append(item)
    if updates:
        model.objects.bulk_update(updates, ["position", "updated_at"])
    return JsonResponse({"ok": True, "count": len(ordered_ids)})


def _apply_visibility_transition(course: Course, old_visibility: str, new_visibility: str) -> None:
    if old_visibility == new_visibility:
        return
    # Private → Public: auto-approve pending requests
    if (
        old_visibility == Course.Visibility.PRIVATE
        and new_visibility == Course.Visibility.PUBLIC
    ):
        CourseEnrollment.objects.filter(
            course=course, status=CourseEnrollment.Status.PENDING
        ).update(
            status=CourseEnrollment.Status.APPROVED,
            responded_at=timezone.now(),
        )
    # Public → Private: keep existing enrollments approved


@login_required
@require_http_methods(["GET", "POST"])
def course_edit(request, pk):
    course = get_object_or_404(Course, pk=pk)
    require_course_manage(request.user, course)
    lang = request_app_lang(request)
    old_visibility = course.visibility
    form = CourseForm(request.POST or None, request.FILES or None, instance=course, user=request.user, lang=lang)
    _localize_course_form(form, lang)
    if request.method == "POST" and form.is_valid():
        saved = form.save()
        _apply_visibility_transition(saved, old_visibility, saved.visibility)
        messages.success(request, t(request_app_lang(request), "course_updated"))
        return redirect("course_detail", pk=course.pk)
    return render(
        request,
        "courses/course_form.html",
        {
            "form": form,
            "course": course,
            "page_title": t(request_app_lang(request), "page_edit_course"),
            "submit_label": t(request_app_lang(request), "submit_save_changes"),
        },
    )


@login_required
@require_POST
def course_delete(request, pk):
    course = get_object_or_404(Course, pk=pk)
    require_course_manage(request.user, course)
    course.delete()
    messages.success(request, t(request_app_lang(request), "course_deleted"))
    return redirect("course_list")


@login_required
@require_POST
def course_move(request, pk, direction):
    direction = _validate_direction(direction)
    course = get_object_or_404(Course, pk=pk)
    require_course_manage(request.user, course)
    course.move(direction, course.siblings())
    return redirect("course_list")


@login_required
@require_http_methods(["GET", "POST"])
def section_create(request, course_pk):
    from accounts.limits import can_create_section, get_limits_for_user

    course = get_object_or_404(Course, pk=course_pk)
    require_course_manage(request.user, course)
    lang = request_app_lang(request)
    limits = get_limits_for_user(request.user)
    if not can_create_section(request.user, course):
        messages.error(
            request,
            tf(lang, "limit_max_sections", max=limits.max_sections_per_course),
        )
        return redirect("course_detail", pk=course.pk)
    form = SectionForm(request.POST or None, user=request.user, lang=lang)
    _localize_section_form(form, lang)
    if request.method == "POST" and form.is_valid():
        if not can_create_section(request.user, course):
            messages.error(
                request,
                tf(lang, "limit_max_sections", max=limits.max_sections_per_course),
            )
            return redirect("course_detail", pk=course.pk)
        section = form.save(commit=False)
        section.course = course
        section.save()
        messages.success(request, t(request_app_lang(request), "section_created"))
        return redirect("course_detail", pk=course.pk)
    return render(
        request,
        "courses/section_form.html",
        {
            "form": form,
            "course": course,
            "page_title": t(request_app_lang(request), "page_new_section"),
            "submit_label": t(request_app_lang(request), "submit_create_section"),
        },
    )


@login_required
@require_http_methods(["GET", "POST"])
def section_edit(request, pk):
    section = get_object_or_404(Section.objects.select_related("course"), pk=pk)
    require_course_manage(request.user, section.course)
    lang = request_app_lang(request)
    form = SectionForm(request.POST or None, instance=section, user=request.user, lang=lang)
    _localize_section_form(form, lang)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, t(request_app_lang(request), "section_updated"))
        return redirect("course_detail", pk=section.course_id)
    return render(
        request,
        "courses/section_form.html",
        {
            "form": form,
            "course": section.course,
            "section": section,
            "page_title": t(request_app_lang(request), "page_edit_section"),
            "submit_label": t(request_app_lang(request), "submit_save_changes"),
        },
    )


@login_required
@require_POST
def section_delete(request, pk):
    section = get_object_or_404(Section.objects.select_related("course"), pk=pk)
    require_course_manage(request.user, section.course)
    course_pk = section.course_id
    section.delete()
    messages.success(request, t(request_app_lang(request), "section_deleted"))
    return redirect("course_detail", pk=course_pk)


@login_required
@require_POST
def section_move(request, pk, direction):
    direction = _validate_direction(direction)
    section = get_object_or_404(Section.objects.select_related("course"), pk=pk)
    require_course_manage(request.user, section.course)
    section.move(direction, section.siblings())
    return redirect("course_detail", pk=section.course_id)


@login_required
@require_POST
def section_reorder(request, course_pk):
    course = get_object_or_404(Course, pk=course_pk)
    require_course_manage(request.user, course)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"ok": False, "error": "Invalid JSON."}, status=400)

    raw_ids = payload.get("order") or []
    try:
        ordered_ids = [int(value) for value in raw_ids]
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": "Invalid section ids."}, status=400)

    return _reorder_by_ids(
        queryset=course.sections.all(),
        ordered_ids=ordered_ids,
        label="section",
    )


@login_required
@require_POST
def temp_upload(request):
    import tempfile
    from pathlib import Path

    from accounts.limits import get_limits_for_user
    from .services.media import probe_duration_seconds

    kind = request.POST.get("kind", "")
    upload = request.FILES.get("file")
    lang = request_app_lang(request)
    limits = get_limits_for_user(request.user)

    if kind not in {TempUpload.Kind.MEDIA, TempUpload.Kind.DOCUMENT}:
        return JsonResponse({"ok": False, "error": t(lang, "upload_invalid_kind")}, status=400)
    if not upload:
        return JsonResponse({"ok": False, "error": t(lang, "upload_no_file")}, status=400)

    if kind == TempUpload.Kind.MEDIA:
        if upload.size > limits.media_max_bytes:
            return JsonResponse(
                {
                    "ok": False,
                    "error": tf(
                        lang,
                        "upload_media_too_large",
                        max_mb=limits.media_max_mb,
                        got_mb=f"{upload.size / (1024 * 1024):.1f}",
                    ),
                },
                status=400,
            )
    else:
        if upload.size > limits.document_max_bytes:
            return JsonResponse(
                {
                    "ok": False,
                    "error": tf(
                        lang,
                        "upload_doc_too_large",
                        max_mb=limits.document_max_mb,
                        got_mb=f"{upload.size / (1024 * 1024):.1f}",
                    ),
                },
                status=400,
            )

    # Probe media duration before persisting
    if kind == TempUpload.Kind.MEDIA and limits.media_max_seconds:
        suffix = Path(upload.name or "media.bin").suffix or ".bin"
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                for chunk in upload.chunks():
                    tmp.write(chunk)
                tmp_path = Path(tmp.name)
            try:
                duration = probe_duration_seconds(tmp_path)
            finally:
                try:
                    tmp_path.unlink(missing_ok=True)
                except OSError:
                    pass
            if duration > limits.media_max_seconds + 0.5:
                mins = max(1, limits.media_max_seconds // 60)
                return JsonResponse(
                    {
                        "ok": False,
                        "error": tf(
                            lang,
                            "upload_media_too_long",
                            max_min=mins,
                            got_sec=int(duration),
                        ),
                    },
                    status=400,
                )
            # Rewind file pointer for Django storage save
            if hasattr(upload, "seek"):
                upload.seek(0)
        except Exception as exc:
            return JsonResponse(
                {
                    "ok": False,
                    "error": tf(lang, "upload_media_probe_failed", detail=str(exc)[:180]),
                },
                status=400,
            )

    temp = TempUpload.objects.create(
        kind=kind,
        original_name=upload.name,
        file=upload,
    )
    return JsonResponse(
        {
            "ok": True,
            "id": str(temp.id),
            "name": temp.original_name,
            "size": temp.file.size,
            "kind": temp.kind,
        }
    )


@login_required
@require_GET
def lesson_status(request, pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course"),
        pk=pk,
    )
    require_course_view(request.user, lesson.section.course)
    return JsonResponse(
        {
            "ok": True,
            "status": lesson.processing_status,
            "progress": lesson.processing_progress,
            "message": lesson.processing_message or lesson.get_processing_status_display(),
            "error": lesson.processing_error,
            "remaining": max(0, 100 - lesson.processing_progress),
            "redirect": reverse("lesson_detail", kwargs={"pk": lesson.pk}),
        }
    )


@login_required
@require_http_methods(["GET", "POST"])
def lesson_create(request, section_pk):
    from accounts.limits import can_create_lesson, get_limits_for_user

    section = get_object_or_404(Section.objects.select_related("course"), pk=section_pk)
    require_course_manage(request.user, section.course)
    lang = request_app_lang(request)
    limits = get_limits_for_user(request.user)
    if not can_create_lesson(request.user, section):
        msg = tf(lang, "limit_max_lessons", max=limits.max_lessons_per_section)
        if _wants_json(request) and request.method == "POST":
            return JsonResponse({"ok": False, "errors": {"__all__": [msg]}}, status=400)
        messages.error(request, msg)
        return redirect("course_detail", pk=section.course_id)
    form = LessonForm(request.POST or None, user=request.user, lang=lang)
    _localize_lesson_form(form, lang)
    if request.method == "POST":
        if form.is_valid():
            if not can_create_lesson(request.user, section):
                msg = tf(lang, "limit_max_lessons", max=limits.max_lessons_per_section)
                if _wants_json(request):
                    return JsonResponse(
                        {"ok": False, "errors": {"__all__": [msg]}}, status=400
                    )
                messages.error(request, msg)
                return redirect("course_detail", pk=section.course_id)
            lesson = form.save(commit=False)
            lesson.section = section
            lesson.processing_status = Lesson.Status.PROCESSING
            lesson.processing_progress = 2
            lesson.processing_message = "Saving lesson…"
            lesson.save()
            attach_temp_upload(lesson, form.cleaned_data.get("media_temp_id"), "media_file")
            attach_temp_upload(
                lesson, form.cleaned_data.get("document_temp_id"), "document_file"
            )
            lesson.save()
            start_lesson_processing(lesson.pk, align=True)
            if _wants_json(request):
                return JsonResponse(
                    {
                        "ok": True,
                        "lesson_id": lesson.pk,
                        "processing": True,
                        "redirect": reverse("lesson_detail", kwargs={"pk": lesson.pk}),
                        "status_url": reverse("lesson_status", kwargs={"pk": lesson.pk}),
                    }
                )
            messages.success(request, t(lang, "lesson_created_processing"))
            return redirect("lesson_detail", pk=lesson.pk)
        if _wants_json(request):
            return JsonResponse(_form_errors_json(form), status=400)

    limits = get_limits_for_user(request.user)
    return render(
        request,
        "courses/lesson_form.html",
        {
            "form": form,
            "section": section,
            "course": section.course,
            "page_title": t(lang, "page_new_lesson"),
            "submit_label": t(lang, "submit_create_process"),
            "upload_url": reverse("temp_upload"),
            "upload_limits": limits.as_dict(),
            "media_limit_help": tf(
                lang,
                "media_upload_help",
                max_min=max(1, limits.media_max_seconds // 60),
                max_mb=limits.media_max_mb,
            ),
            "doc_limit_help": tf(lang, "doc_size_help", max_mb=limits.document_max_mb),
        },
    )


@login_required
def lesson_detail(request, pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course", "section__course__owner").prefetch_related(
            "chunks__highlights"
        ),
        pk=pk,
    )
    course = lesson.section.course
    require_lesson_open(request.user, course)
    can_manage = can_manage_course(request.user, course)
    chunks = list(lesson.chunks.all())
    user_levels: dict[int, int] = {}
    if request.user.is_authenticated and chunks:
        user_levels = {
            row.chunk_id: row.study_level
            for row in UserChunkStudyProgress.objects.filter(
                user=request.user,
                chunk_id__in=[c.pk for c in chunks],
                study_level__isnull=False,
            )
        }
    for chunk in chunks:
        chunk.user_study_level = user_levels.get(chunk.pk)
    return render(
        request,
        "courses/lesson_detail.html",
        {
            "lesson": lesson,
            "section": lesson.section,
            "course": course,
            "can_manage": can_manage,
            "can_study": can_open_lesson(request.user, course),
            "chunks": chunks,
            "status_url": reverse("lesson_status", kwargs={"pk": lesson.pk}),
            "reorder_url": reverse("chunk_reorder", kwargs={"lesson_pk": lesson.pk}),
        },
    )


@login_required
@require_GET
def lesson_export(request, pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course").prefetch_related(
            "chunks__highlights"
        ),
        pk=pk,
    )
    require_course_manage(request.user, lesson.section.course)
    chunks = lesson.chunks.all()
    content = export_lesson_document(chunks, title=lesson.title)
    filename = slugify(lesson.title) or f"lesson-{lesson.pk}"
    response = HttpResponse(content, content_type="text/plain; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}.txt"'
    return response


@login_required
@require_GET
def lesson_study(request, pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course").prefetch_related(
            "chunks__highlights"
        ),
        pk=pk,
    )
    course = lesson.section.course
    require_course_view(request.user, course)
    if not can_study_course(request.user, course):
        messages.info(request, t(request_app_lang(request), "enroll_to_study_msg"))
        return redirect("course_detail", pk=course.pk)
    chunks = list(lesson.chunks.all())
    if not chunks:
        messages.error(request, t(request_app_lang(request), "lesson_no_items"))
        return redirect("course_detail", pk=course.pk)

    # Template with {id} so the study page can POST levels/records without extra round-trips.
    level_url_template = reverse("chunk_study_level", kwargs={"pk": 999999999}).replace(
        "999999999", "{id}"
    )
    record_url_template = reverse("chunk_study_record", kwargs={"pk": 999999999}).replace(
        "999999999", "{id}"
    )
    speak_url_template = reverse("chunk_speak_transcribe", kwargs={"pk": 999999999}).replace(
        "999999999", "{id}"
    )
    translate_word_url_template = reverse(
        "chunk_translate_word", kwargs={"pk": 999999999}
    ).replace("999999999", "{id}")
    translate_sentence_url_template = reverse(
        "chunk_translate_sentence", kwargs={"pk": 999999999}
    ).replace("999999999", "{id}")
    payload = study_lesson_payload(
        lesson,
        user=request.user,
        exit_url=reverse("course_detail", kwargs={"pk": course.pk}),
        level_url_template=level_url_template,
        record_url_template=record_url_template,
        speak_url_template=speak_url_template,
        translate_word_url_template=translate_word_url_template,
        translate_sentence_url_template=translate_sentence_url_template,
        settings_url=reverse("lesson_study_settings", kwargs={"pk": lesson.pk}),
    )
    return render(
        request,
        "courses/lesson_study.html",
        {
            "lesson": lesson,
            "section": lesson.section,
            "course": course,
            "study_json": payload,
        },
    )


@login_required
@require_POST
def lesson_study_settings(request, pk):
    from accounts.models import ensure_profile

    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course"),
        pk=pk,
    )
    require_course_study(request.user, lesson.section.course)
    updates = {}
    if "playback_rate" in request.POST:
        updates["playback_rate"] = request.POST.get("playback_rate")
    if "autoplay" in request.POST:
        updates["autoplay"] = request.POST.get("autoplay")
    if "speaking_score_threshold" in request.POST:
        updates["speaking_score_threshold"] = request.POST.get("speaking_score_threshold")
    if "video_dock" in request.POST:
        updates["video_dock"] = request.POST.get("video_dock")
    try:
        row = UserLessonStudySettings.for_user_lesson(request.user, lesson)
        settings_data = row.update_settings(**updates) if updates else row.get_settings()
        if "video_dock" in settings_data:
            ensure_profile(request.user).set_video_dock(settings_data["video_dock"])
        else:
            profile_dock = ensure_profile(request.user).get_video_dock()
            if profile_dock is not None:
                settings_data["video_dock"] = profile_dock
    except ValueError as exc:
        if _wants_json(request):
            return JsonResponse({"ok": False, "error": str(exc)}, status=400)
        messages.error(request, str(exc))
        return redirect("lesson_study", pk=lesson.pk)

    if _wants_json(request):
        return JsonResponse({"ok": True, "settings": settings_data})
    messages.success(request, t(request_app_lang(request), "study_settings_saved"))
    return redirect("lesson_study", pk=lesson.pk)


@login_required
@require_POST
def chunk_speak_transcribe(request, pk):
    """Accept a short learner recording and return a transcript for speaking practice."""
    import tempfile
    from pathlib import Path

    from accounts.ui_i18n import request_app_lang, t

    from .services.speak_transcribe import SpeakTranscribeError, transcribe_learner_audio

    chunk = get_object_or_404(
        LessonChunk.objects.select_related("lesson__section__course"),
        pk=pk,
    )
    require_course_study(request.user, chunk.lesson.section.course)
    lang = request_app_lang(request)
    audio_file = request.FILES.get("audio")
    if not audio_file:
        return JsonResponse(
            {
                "ok": False,
                "code": "no_audio",
                "error": t(lang, "speak_no_audio"),
                "detail": "request.FILES had no 'audio' field.",
            },
            status=400,
        )

    suffix = Path(getattr(audio_file, "name", "") or "clip.webm").suffix.lower() or ".webm"
    content_type = (getattr(audio_file, "content_type", "") or "").lower()
    if suffix not in {".webm", ".ogg", ".mp3", ".wav", ".m4a", ".mp4", ".aac", ".mpeg", ".caf"}:
        # Keep a usable extension so ffmpeg can sniff the container.
        if "mp4" in content_type or "aac" in content_type or "m4a" in content_type:
            suffix = ".m4a"
        elif "ogg" in content_type:
            suffix = ".ogg"
        else:
            suffix = ".webm"

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            size = 0
            for chunk_bytes in audio_file.chunks():
                tmp.write(chunk_bytes)
                size += len(chunk_bytes)
            tmp_path = Path(tmp.name)
        if size < 64:
            return JsonResponse(
                {
                    "ok": False,
                    "code": "empty_upload",
                    "error": t(lang, "speak_no_audio"),
                    "detail": f"Uploaded audio was only {size} bytes ({suffix}, {content_type or 'no content-type'}).",
                },
                status=400,
            )
        text = transcribe_learner_audio(tmp_path, language="en")
        if not text:
            return JsonResponse(
                {
                    "ok": False,
                    "code": "empty_transcript",
                    "error": t(lang, "speak_empty_transcript"),
                    "detail": f"Whisper returned empty text for {suffix} upload ({size} bytes).",
                },
                status=400,
            )
        return JsonResponse({"ok": True, "text": text})
    except SpeakTranscribeError as exc:
        code_key = {
            "ffmpeg_missing": "speak_err_ffmpeg",
            "ffmpeg_decode": "speak_err_decode",
            "whisper_import": "speak_err_whisper",
            "whisper_model": "speak_err_whisper",
            "whisper_run": "speak_err_whisper_run",
            "empty_upload": "speak_no_audio",
        }.get(exc.code, "speak_transcribe_failed")
        return JsonResponse(
            {
                "ok": False,
                "code": exc.code,
                "error": t(lang, code_key),
                "detail": exc.detail,
            },
            status=500 if exc.code not in {"empty_upload", "ffmpeg_decode"} else 400,
        )
    except Exception as exc:  # noqa: BLE001 - surface to learner UI
        return JsonResponse(
            {
                "ok": False,
                "code": "unknown",
                "error": t(lang, "speak_transcribe_failed"),
                "detail": str(exc),
            },
            status=500,
        )
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass


@login_required
@require_POST
def chunk_study_level(request, pk):
    chunk = get_object_or_404(
        LessonChunk.objects.select_related("lesson__section__course"),
        pk=pk,
    )
    require_course_study(request.user, chunk.lesson.section.course)
    raw = (request.POST.get("study_level") or "").strip()
    progress = UserChunkStudyProgress.for_user_chunk(request.user, chunk)
    try:
        level = int(raw)
        progress.set_study_level(level)
    except (TypeError, ValueError):
        if _wants_json(request):
            return JsonResponse(
                {"ok": False, "error": t(request_app_lang(request), "level_range_error")},
                status=400,
            )
        messages.error(request, t(request_app_lang(request), "level_range_error"))
        return redirect("lesson_study", pk=chunk.lesson_id)

    if _wants_json(request):
        return JsonResponse(
            {
                "ok": True,
                "message": f"Level set to {progress.study_level}.",
                "study_level": progress.study_level,
                "chunk_id": chunk.pk,
            }
        )
    messages.success(
        request, f'{t(request_app_lang(request), "level_set_to")} {progress.study_level}.'
    )
    return redirect("lesson_study", pk=chunk.lesson_id)


@login_required
@require_POST
def chunk_study_record(request, pk):
    chunk = get_object_or_404(
        LessonChunk.objects.select_related("lesson__section__course"),
        pk=pk,
    )
    require_course_study(request.user, chunk.lesson.section.course)
    raw = (request.POST.get("time_ms") or "").strip()
    mode = (request.POST.get("mode") or "writing").strip().lower()
    if mode not in {"writing", "speaking"}:
        mode = "writing"
    progress = UserChunkStudyProgress.for_user_chunk(request.user, chunk)
    try:
        time_ms = int(float(raw))
        if time_ms <= 0:
            raise ValueError("time must be positive")
        result = progress.record_type_time(
            time_ms, text=chunk.text or "", mode=mode
        )
    except (TypeError, ValueError):
        if _wants_json(request):
            return JsonResponse(
                {"ok": False, "error": "Invalid completion time."},
                status=400,
            )
        messages.error(request, t(request_app_lang(request), "invalid_completion_time"))
        return redirect("lesson_study", pk=chunk.lesson_id)

    if _wants_json(request):
        return JsonResponse({"ok": True, "chunk_id": chunk.pk, **result})
    messages.success(request, t(request_app_lang(request), "typing_time_saved"))
    return redirect("lesson_study", pk=chunk.lesson_id)


def _parse_json_body(request) -> dict:
    if request.content_type and "application/json" in request.content_type:
        try:
            raw = json.loads(request.body.decode("utf-8") or "{}")
        except (TypeError, ValueError, UnicodeDecodeError):
            return {}
        return raw if isinstance(raw, dict) else {}
    return {}


def _profile_translate_langs(user) -> tuple[str, str]:
    from accounts.models import Profile, ensure_profile

    profile = ensure_profile(user)
    source = profile.learning_language or Profile.LearningLanguage.EN
    target = profile.native_language or Profile.NativeLanguage.FA
    if source not in Profile.SUPPORTED_LEARNING_LANGUAGES:
        source = Profile.LearningLanguage.EN
    if target not in Profile.SUPPORTED_NATIVE_LANGUAGES:
        target = Profile.NativeLanguage.FA
    return source, target


def _translate_error_response(request, exc):
    from accounts.ui_i18n import request_app_lang, t

    from .services.translate import (
        TranslateError,
        TranslateInvalidError,
        TranslateNotFoundError,
    )

    lang = request_app_lang(request)
    if isinstance(exc, TranslateInvalidError):
        code = "translate_invalid"
        status = 400
    elif isinstance(exc, TranslateNotFoundError):
        code = "translate_not_found"
        status = 404
    elif isinstance(exc, TranslateError):
        code = getattr(exc, "code", None) or "translate_failed"
        status = 503
    else:
        code = "translate_failed"
        status = 503
    return JsonResponse(
        {"ok": False, "error": t(lang, code), "code": code},
        status=status,
    )


@login_required
@require_POST
def chunk_translate_sentence(request, pk):
    """Fill empty chunk.sentence_meaning via native-language translation."""
    from accounts.limits import get_limits_for_user
    from accounts.ui_i18n import request_app_lang, t

    from .services.translate import TranslateError, translate_text

    chunk = get_object_or_404(
        LessonChunk.objects.select_related("lesson__section__course"),
        pk=pk,
    )
    require_course_study(request.user, chunk.lesson.section.course)

    existing = (chunk.sentence_meaning or "").strip()
    if existing:
        return JsonResponse({"ok": True, "meaning": existing, "cached": True, "chunk_id": chunk.pk})

    source_text = (chunk.text or "").strip()
    if not source_text:
        return JsonResponse(
            {
                "ok": False,
                "error": t(request_app_lang(request), "translate_invalid"),
                "code": "translate_invalid",
            },
            status=400,
        )

    limits = get_limits_for_user(request.user)
    source_lang, target_lang = _profile_translate_langs(request.user)
    try:
        meaning = translate_text(
            source_text,
            source=source_lang,
            target=target_lang,
            max_len=limits.sentence_meaning_max,
        )
    except TranslateError as exc:
        return _translate_error_response(request, exc)

    chunk.sentence_meaning = meaning
    chunk.save(update_fields=["sentence_meaning", "updated_at"])
    return JsonResponse(
        {
            "ok": True,
            "meaning": meaning,
            "cached": False,
            "chunk_id": chunk.pk,
        }
    )


@login_required
@require_POST
def chunk_translate_word(request, pk):
    """Fill empty highlight meaning, or translate a plain word without creating a highlight."""
    from accounts.limits import get_limits_for_user
    from accounts.ui_i18n import request_app_lang, t

    from .services.translate import TranslateError, translate_text

    chunk = get_object_or_404(
        LessonChunk.objects.select_related("lesson__section__course").prefetch_related(
            "highlights"
        ),
        pk=pk,
    )
    require_course_study(request.user, chunk.lesson.section.course)

    payload = _parse_json_body(request)
    highlight_id = payload.get("highlight_id") or request.POST.get("highlight_id")
    highlight = None
    start = None
    end = None
    if highlight_id not in (None, ""):
        try:
            highlight = chunk.highlights.get(pk=int(highlight_id))
        except (TypeError, ValueError, ChunkHighlight.DoesNotExist):
            return JsonResponse(
                {
                    "ok": False,
                    "error": t(request_app_lang(request), "translate_invalid"),
                    "code": "translate_invalid",
                },
                status=400,
            )
        existing = (highlight.meaning or "").strip()
        if existing:
            return JsonResponse(
                {
                    "ok": True,
                    "meaning": existing,
                    "cached": True,
                    "highlight": highlight_payload(highlight),
                    "chunk_id": chunk.pk,
                }
            )
        source_text = (highlight.text or chunk.text[highlight.start_char : highlight.end_char]).strip()
    else:
        try:
            start = int(payload.get("start_char", request.POST.get("start_char")))
            end = int(payload.get("end_char", request.POST.get("end_char")))
        except (TypeError, ValueError):
            return JsonResponse(
                {
                    "ok": False,
                    "error": t(request_app_lang(request), "translate_invalid"),
                    "code": "translate_invalid",
                },
                status=400,
            )
        text_len = len(chunk.text or "")
        if start < 0 or end <= start or end > text_len:
            return JsonResponse(
                {
                    "ok": False,
                    "error": t(request_app_lang(request), "translate_invalid"),
                    "code": "translate_invalid",
                },
                status=400,
            )
        selected = (chunk.text or "")[start:end]
        source_text = selected.strip()
        if not source_text:
            return JsonResponse(
                {
                    "ok": False,
                    "error": t(request_app_lang(request), "translate_invalid"),
                    "code": "translate_invalid",
                },
                status=400,
            )
        # Already saved as a plain-word meaning (not a highlight).
        for row in chunk.word_meanings or []:
            if not isinstance(row, dict):
                continue
            if int(row.get("start_char", -1)) != start or int(row.get("end_char", -1)) != end:
                continue
            existing = (row.get("meaning") or "").strip()
            if existing:
                return JsonResponse(
                    {
                        "ok": True,
                        "meaning": existing,
                        "cached": True,
                        "start_char": start,
                        "end_char": end,
                        "word_meaning": row,
                        "chunk_id": chunk.pk,
                    }
                )
            break
        # If this span already belongs to a highlight, reuse/fill that meaning —
        # but never create a new highlight for a plain-word tap.
        for item in chunk.highlights.all():
            if item.end_char <= start or item.start_char >= end:
                continue
            existing = (item.meaning or "").strip()
            if existing:
                return JsonResponse(
                    {
                        "ok": True,
                        "meaning": existing,
                        "cached": True,
                        "start_char": start,
                        "end_char": end,
                        "chunk_id": chunk.pk,
                    }
                )
            highlight = item
            source_text = (item.text or source_text).strip()
            break

    limits = get_limits_for_user(request.user)
    source_lang, target_lang = _profile_translate_langs(request.user)
    try:
        meaning = translate_text(
            source_text,
            source=source_lang,
            target=target_lang,
            max_len=limits.highlight_meaning_max,
        )
    except TranslateError as exc:
        return _translate_error_response(request, exc)

    if highlight is not None:
        highlight.meaning = meaning
        highlight.save(update_fields=["meaning"])
        return JsonResponse(
            {
                "ok": True,
                "meaning": meaning,
                "cached": False,
                "highlight": highlight_payload(highlight),
                "chunk_id": chunk.pk,
            }
        )

    # Persist plain-word meaning without creating a visual highlight.
    rows = list(chunk.word_meanings or [])
    entry = {
        "text": source_text[:255],
        "meaning": meaning,
        "start_char": int(start),
        "end_char": int(end),
    }
    replaced = False
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        if int(row.get("start_char", -1)) == int(start) and int(row.get("end_char", -1)) == int(end):
            rows[index] = {**row, **entry}
            replaced = True
            break
    if not replaced:
        rows.append(entry)
    chunk.word_meanings = rows
    chunk.save(update_fields=["word_meanings", "updated_at"])

    return JsonResponse(
        {
            "ok": True,
            "meaning": meaning,
            "cached": False,
            "start_char": start,
            "end_char": end,
            "word_meaning": entry,
            "chunk_id": chunk.pk,
        }
    )


@login_required
@require_http_methods(["GET", "POST"])
def lesson_edit(request, pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course"),
        pk=pk,
    )
    require_course_manage(request.user, lesson.section.course)
    form = LessonForm(request.POST or None, instance=lesson, user=request.user, lang=request_app_lang(request))
    _localize_lesson_form(form, request_app_lang(request))
    if request.method == "POST":
        if form.is_valid():
            lesson = form.save()
            media_temp = form.cleaned_data.get("media_temp_id")
            document_temp = form.cleaned_data.get("document_temp_id")
            attach_temp_upload(lesson, media_temp, "media_file")
            attach_temp_upload(lesson, document_temp, "document_file")
            lesson.save()
            should_process = _should_process(form) or bool(media_temp or document_temp)
            if should_process or not lesson.chunks.exists():
                lesson.processing_status = Lesson.Status.PROCESSING
                lesson.processing_progress = 2
                lesson.processing_message = "Saving lesson…"
                lesson.save(
                    update_fields=[
                        "processing_status",
                        "processing_progress",
                        "processing_message",
                        "updated_at",
                    ]
                )
                start_lesson_processing(lesson.pk, align=True)
                processing = True
            else:
                processing = False
            if _wants_json(request):
                return JsonResponse(
                    {
                        "ok": True,
                        "lesson_id": lesson.pk,
                        "processing": processing,
                        "redirect": reverse("lesson_detail", kwargs={"pk": lesson.pk}),
                        "status_url": reverse("lesson_status", kwargs={"pk": lesson.pk}),
                    }
                )
            lang = request_app_lang(request)
            messages.success(
                request,
                t(lang, "lesson_updated_processing")
                if processing
                else t(lang, "lesson_updated"),
            )
            return redirect("lesson_detail", pk=lesson.pk)
        if _wants_json(request):
            return JsonResponse(_form_errors_json(form), status=400)

    from accounts.limits import get_limits_for_user

    lang = request_app_lang(request)
    limits = get_limits_for_user(request.user)
    return render(
        request,
        "courses/lesson_form.html",
        {
            "form": form,
            "lesson": lesson,
            "section": lesson.section,
            "course": lesson.section.course,
            "page_title": t(lang, "page_edit_lesson"),
            "submit_label": t(lang, "submit_save_changes"),
            "upload_url": reverse("temp_upload"),
            "upload_limits": limits.as_dict(),
            "media_limit_help": tf(
                lang,
                "media_upload_help",
                max_min=max(1, limits.media_max_seconds // 60),
                max_mb=limits.media_max_mb,
            ),
            "doc_limit_help": tf(lang, "doc_size_help", max_mb=limits.document_max_mb),
        },
    )


@login_required
@require_POST
def lesson_reprocess(request, pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course"),
        pk=pk,
    )
    require_course_manage(request.user, lesson.section.course)
    lesson.processing_status = Lesson.Status.PROCESSING
    lesson.processing_progress = 2
    lesson.processing_message = "Starting re-process…"
    lesson.processing_error = ""
    lesson.save(
        update_fields=[
            "processing_status",
            "processing_progress",
            "processing_message",
            "processing_error",
            "updated_at",
        ]
    )
    start_lesson_processing(lesson.pk, align=True)
    if _wants_json(request):
        return JsonResponse(
            {
                "ok": True,
                "processing": True,
                "status_url": reverse("lesson_status", kwargs={"pk": lesson.pk}),
                "redirect": reverse("lesson_detail", kwargs={"pk": lesson.pk}),
            }
        )
    messages.success(request, t(request_app_lang(request), "reprocess_started"))
    return redirect("lesson_detail", pk=lesson.pk)


@login_required
@require_POST
def lesson_delete(request, pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course"),
        pk=pk,
    )
    require_course_manage(request.user, lesson.section.course)
    course_pk = lesson.section.course_id
    lesson.delete()
    messages.success(request, t(request_app_lang(request), "lesson_deleted"))
    return redirect("course_detail", pk=course_pk)


@login_required
@require_POST
def lesson_move(request, pk, direction):
    direction = _validate_direction(direction)
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course"),
        pk=pk,
    )
    require_course_manage(request.user, lesson.section.course)
    lesson.move(direction, lesson.siblings())
    return redirect("course_detail", pk=lesson.section.course_id)


@login_required
@require_POST
def lesson_reorder(request, section_pk):
    section = get_object_or_404(Section.objects.select_related("course"), pk=section_pk)
    require_course_manage(request.user, section.course)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"ok": False, "error": "Invalid JSON."}, status=400)

    raw_ids = payload.get("order") or []
    try:
        ordered_ids = [int(value) for value in raw_ids]
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": "Invalid lesson ids."}, status=400)

    return _reorder_by_ids(
        queryset=section.lessons.all(),
        ordered_ids=ordered_ids,
        label="lesson",
    )


def _sync_highlights_after_text_change(chunk: LessonChunk) -> None:
    for highlight in list(chunk.highlights.all()):
        snippet = chunk.text[highlight.start_char : highlight.end_char]
        if snippet != highlight.text:
            highlight.delete()
            continue
        start_sec, end_sec = highlight_audio_span(
            chunk.text,
            chunk.word_timings or [],
            highlight.start_char,
            highlight.end_char,
        )
        if start_sec != highlight.start_sec or end_sec != highlight.end_sec:
            highlight.start_sec = start_sec
            highlight.end_sec = end_sec
            highlight.save(update_fields=["start_sec", "end_sec", "updated_at"])

    text = chunk.text or ""
    kept_colors = []
    for span in chunk.color_spans or []:
        start = span.get("start_char")
        end = span.get("end_char")
        phrase = span.get("text") or ""
        if start is None or end is None or end <= start:
            continue
        if text[start:end] != phrase:
            continue
        kept_colors.append(span)
    if kept_colors != (chunk.color_spans or []):
        chunk.color_spans = kept_colors
        chunk.save(update_fields=["color_spans", "updated_at"])

    kept_breaks = [
        int(pos)
        for pos in (chunk.line_breaks or [])
        if isinstance(pos, (int, float)) and 0 < int(pos) < len(text)
    ]
    if kept_breaks != list(chunk.line_breaks or []):
        chunk.line_breaks = kept_breaks
        chunk.save(update_fields=["line_breaks", "updated_at"])


@login_required
@require_http_methods(["GET", "POST"])
def chunk_edit(request, pk):
    chunk = get_object_or_404(
        LessonChunk.objects.select_related("lesson__section__course").prefetch_related(
            "highlights"
        ),
        pk=pk,
    )
    require_course_manage(request.user, chunk.lesson.section.course)
    form = LessonChunkForm(request.POST or None, instance=chunk, user=request.user, lang=request_app_lang(request))
    highlight_form = ChunkHighlightForm(user=request.user, lang=request_app_lang(request))
    if request.method == "POST":
        if form.is_valid():
            saved = form.save()
            _sync_highlights_after_text_change(saved)
            saved = LessonChunk.objects.prefetch_related("highlights").get(pk=saved.pk)
            if _wants_json(request):
                return JsonResponse(
                    {
                        "ok": True,
                        "message": t(request_app_lang(request), "content_item_saved"),
                        "chunk": chunk_payload(saved),
                    }
                )
            messages.success(request, t(request_app_lang(request), "content_item_updated"))
            return redirect("chunk_edit", pk=chunk.pk)
        if _wants_json(request):
            return JsonResponse(
                {
                    "ok": False,
                    "errors": {
                        field: [str(err) for err in errs]
                        for field, errs in form.errors.items()
                    },
                },
                status=400,
            )
    return render(
        request,
        "courses/chunk_form.html",
        {
            "form": form,
            "highlight_form": highlight_form,
            "chunk": chunk,
            "highlights": chunk.highlights.all(),
            "chunk_json": chunk_payload(chunk),
            "lesson": chunk.lesson,
            "course": chunk.lesson.section.course,
            "page_title": t(request_app_lang(request), "page_edit_content"),
            "submit_label": t(request_app_lang(request), "submit_save_item"),
        },
    )


@login_required
@require_POST
def highlight_add(request, chunk_pk):
    chunk = get_object_or_404(
        LessonChunk.objects.select_related("lesson__section__course").prefetch_related(
            "highlights"
        ),
        pk=chunk_pk,
    )
    require_course_manage(request.user, chunk.lesson.section.course)
    form = ChunkHighlightForm(request.POST, user=request.user, lang=request_app_lang(request))
    if not form.is_valid():
        if _wants_json(request):
            return JsonResponse(
                {
                    "ok": False,
                    "error": next(iter(form.errors.values()))[0]
                    if form.errors
                    else "Invalid highlight.",
                },
                status=400,
            )
        messages.error(request, form.errors.as_text())
        return redirect("chunk_edit", pk=chunk.pk)

    start = form.cleaned_data["start_char"]
    end = form.cleaned_data["end_char"]
    selected = chunk.text[start:end]
    if selected != form.cleaned_data["text"]:
        if _wants_json(request):
            return JsonResponse(
                {"ok": False, "error": "Highlight no longer matches the sentence text."},
                status=400,
            )
        messages.error(request, t(request_app_lang(request), "highlight_mismatch"))
        return redirect("chunk_edit", pk=chunk.pk)

    # Prevent exact duplicate spans
    if chunk.highlights.filter(start_char=start, end_char=end).exists():
        if _wants_json(request):
            return JsonResponse(
                {"ok": False, "error": "This span is already highlighted."},
                status=400,
            )
        messages.error(request, t(request_app_lang(request), "highlight_already"))
        return redirect("chunk_edit", pk=chunk.pk)

    start_sec, end_sec = highlight_audio_span(
        chunk.text,
        chunk.word_timings or [],
        start,
        end,
    )
    highlight = form.save(commit=False)
    highlight.chunk = chunk
    highlight.text = selected
    highlight.start_sec = start_sec
    highlight.end_sec = end_sec
    highlight.save()
    chunk = LessonChunk.objects.prefetch_related("highlights").get(pk=chunk.pk)
    if _wants_json(request):
        return JsonResponse(
            {
                "ok": True,
                "message": "Highlight added.",
                "highlight": highlight_payload(highlight),
                "chunk": chunk_payload(chunk),
            }
        )
    messages.success(request, t(request_app_lang(request), "highlight_added"))
    return redirect("chunk_edit", pk=chunk.pk)


@login_required
@require_POST
def highlight_delete(request, pk):
    highlight = get_object_or_404(
        ChunkHighlight.objects.select_related("chunk__lesson__section__course"),
        pk=pk,
    )
    require_course_manage(request.user, highlight.chunk.lesson.section.course)
    chunk_pk = highlight.chunk_id
    highlight.delete()
    chunk = LessonChunk.objects.prefetch_related("highlights").get(pk=chunk_pk)
    if _wants_json(request):
        return JsonResponse(
            {
                "ok": True,
                "message": "Highlight removed.",
                "chunk": chunk_payload(chunk),
            }
        )
    messages.success(request, t(request_app_lang(request), "highlight_removed"))
    return redirect("chunk_edit", pk=chunk_pk)


@login_required
@require_POST
def highlight_update(request, pk):
    highlight = get_object_or_404(
        ChunkHighlight.objects.select_related("chunk__lesson__section__course"),
        pk=pk,
    )
    require_course_manage(request.user, highlight.chunk.lesson.section.course)
    meaning = (request.POST.get("meaning") or "").strip()
    highlight.meaning = meaning

    start_raw = (request.POST.get("start_sec") or "").strip()
    end_raw = (request.POST.get("end_sec") or "").strip()
    try:
        if start_raw != "":
            highlight.start_sec = float(start_raw)
        if end_raw != "":
            highlight.end_sec = float(end_raw)
    except ValueError:
        if _wants_json(request):
            return JsonResponse(
                {"ok": False, "error": "Start/end times must be numbers (seconds)."},
                status=400,
            )
        messages.error(request, t(request_app_lang(request), "times_must_be_numbers"))
        return redirect("chunk_edit", pk=highlight.chunk_id)

    if (
        highlight.start_sec is not None
        and highlight.end_sec is not None
        and highlight.end_sec < highlight.start_sec
    ):
        if _wants_json(request):
            return JsonResponse(
                {"ok": False, "error": "End time must be greater than or equal to start time."},
                status=400,
            )
        messages.error(request, t(request_app_lang(request), "end_gte_start"))
        return redirect("chunk_edit", pk=highlight.chunk_id)

    highlight.save(
        update_fields=["meaning", "start_sec", "end_sec", "updated_at"]
    )
    chunk = LessonChunk.objects.prefetch_related("highlights").get(pk=highlight.chunk_id)
    if _wants_json(request):
        return JsonResponse(
            {
                "ok": True,
                "message": "Highlight saved.",
                "highlight": highlight_payload(highlight),
                "chunk": chunk_payload(chunk),
            }
        )
    messages.success(request, t(request_app_lang(request), "highlight_saved"))
    return redirect("chunk_edit", pk=highlight.chunk_id)


@login_required
@require_POST
def chunk_delete(request, pk):
    chunk = get_object_or_404(
        LessonChunk.objects.select_related("lesson__section__course"),
        pk=pk,
    )
    require_course_manage(request.user, chunk.lesson.section.course)
    lesson_pk = chunk.lesson_id
    chunk.delete()
    messages.success(request, t(request_app_lang(request), "content_item_deleted"))
    return redirect("lesson_detail", pk=lesson_pk)


@login_required
@require_POST
def chunk_bulk_delete(request, lesson_pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course"),
        pk=lesson_pk,
    )
    require_course_manage(request.user, lesson.section.course)
    ids = request.POST.getlist("chunk_ids")
    deleted, _ = lesson.chunks.filter(pk__in=ids).delete()
    messages.success(request, tf(request_app_lang(request), "deleted_n_items", n=deleted))
    return redirect("lesson_detail", pk=lesson.pk)


@login_required
@require_POST
def chunk_move(request, pk, direction):
    direction = _validate_direction(direction)
    chunk = get_object_or_404(
        LessonChunk.objects.select_related("lesson__section__course"),
        pk=pk,
    )
    require_course_manage(request.user, chunk.lesson.section.course)
    chunk.move(direction, chunk.siblings())
    return redirect("lesson_detail", pk=chunk.lesson_id)


@login_required
@require_POST
def chunk_reorder(request, lesson_pk):
    lesson = get_object_or_404(
        Lesson.objects.select_related("section__course"),
        pk=lesson_pk,
    )
    require_course_manage(request.user, lesson.section.course)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"ok": False, "error": "Invalid JSON."}, status=400)

    raw_ids = payload.get("order") or []
    try:
        ordered_ids = [int(value) for value in raw_ids]
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": "Invalid chunk ids."}, status=400)

    chunks = list(lesson.chunks.all())
    chunk_map = {chunk.pk: chunk for chunk in chunks}
    if not ordered_ids or set(ordered_ids) != set(chunk_map.keys()):
        return JsonResponse(
            {"ok": False, "error": "Order must include every content item once."},
            status=400,
        )

    updates = []
    for index, chunk_id in enumerate(ordered_ids):
        chunk = chunk_map[chunk_id]
        if chunk.position != index:
            chunk.position = index
            updates.append(chunk)
    if updates:
        LessonChunk.objects.bulk_update(updates, ["position", "updated_at"])

    return JsonResponse({"ok": True, "count": len(ordered_ids)})
