from django.contrib import messages
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.db.models import Avg, Count
from django.shortcuts import get_object_or_404, redirect, render
from django.template.loader import render_to_string
from django.views.decorators.http import require_http_methods

from courses.feed import COURSE_FEED_PAGE_SIZE, feed_json, page_number, paginate_items, wants_feed_json
from courses.models import Course

from .context_processors import APP_LANG_COOKIE, LEARN_LANG_COOKIE, THEME_COOKIE
from .forms import LoginForm, ProfileForm, SignUpForm
from .models import Profile, ensure_profile
from .ui_i18n import localize_form_labels, request_app_lang, t


def _auth_redirect(request):
    next_url = request.GET.get("next") or request.POST.get("next") or ""
    if next_url.startswith("/") and not next_url.startswith("//"):
        return next_url
    return "explore"


@require_http_methods(["GET", "POST"])
def signup(request):
    if request.user.is_authenticated:
        return redirect("explore")

    lang = request_app_lang(request)
    form = SignUpForm(request.POST or None)
    localize_form_labels(
        form,
        lang,
        {
            "display_name": "display_name",
            "email": "email",
            "password1": "password",
            "password2": "confirm_password",
        },
    )
    if request.method == "POST" and form.is_valid():
        user = form.save()
        login(request, user, backend="accounts.backends.EmailBackend")
        messages.success(request, t(request_app_lang(request), "welcome_created"))
        return redirect(_auth_redirect(request))

    return render(
        request,
        "accounts/signup.html",
        {
            "form": form,
            "next": request.GET.get("next", ""),
        },
    )


@require_http_methods(["GET", "POST"])
def login_view(request):
    if request.user.is_authenticated:
        return redirect("explore")

    lang = request_app_lang(request)
    form = LoginForm(request, data=request.POST or None)
    localize_form_labels(form, lang, {"email": "email", "password": "password"})
    if request.method == "POST" and form.is_valid():
        login(request, form.get_user())
        messages.success(request, t(request_app_lang(request), "logged_in"))
        return redirect(_auth_redirect(request))

    return render(
        request,
        "accounts/login.html",
        {
            "form": form,
            "next": request.GET.get("next", ""),
        },
    )


@require_http_methods(["GET", "POST"])
def logout_view(request):
    lang = request_app_lang(request)
    if request.user.is_authenticated:
        logout(request)
        messages.success(request, t(lang, "logged_out"))
    return redirect("explore")


def _set_pref_cookies(response, *, theme: str, app_language: str, learning_language: str):
    max_age = 60 * 60 * 24 * 365
    response.set_cookie(THEME_COOKIE, theme, max_age=max_age, samesite="Lax")
    response.set_cookie(APP_LANG_COOKIE, app_language, max_age=max_age, samesite="Lax")
    response.set_cookie(LEARN_LANG_COOKIE, learning_language, max_age=max_age, samesite="Lax")
    return response


@login_required
@require_http_methods(["GET", "POST"])
def account_home(request):
    profile = ensure_profile(request.user)
    lang = profile.app_language or "en"
    form = ProfileForm(
        request.POST or None,
        request.FILES or None,
        instance=profile,
        user=request.user,
        lang=lang,
    )
    localize_form_labels(
        form,
        lang,
        {
            "display_name": "display_name",
            "bio": "bio",
            "avatar": "avatar",
            "theme": "theme",
            "app_language": "app_language",
            "learning_language": "learning_language",
        },
    )
    form.fields["theme"].help_text = t(lang, "theme_help")
    form.fields["app_language"].help_text = t(lang, "app_language_help")
    form.fields["learning_language"].help_text = t(lang, "learning_language_help")

    if request.method == "POST" and form.is_valid():
        form.save()
        new_lang = form.cleaned_data["app_language"]
        messages.success(request, t(new_lang, "account_saved"))
        response = redirect("account")
        return _set_pref_cookies(
            response,
            theme=form.cleaned_data["theme"],
            app_language=form.cleaned_data["app_language"],
            learning_language=form.cleaned_data["learning_language"],
        )

    return render(
        request,
        "accounts/account.html",
        {
            "form": form,
            "profile": profile,
            "supported_note": t(lang, "supported_note"),
        },
    )


def public_profile(request, user_id: int):
    profile = get_object_or_404(
        Profile.objects.select_related("user"),
        user_id=user_id,
    )
    qs = (
        Course.objects.filter(owner_id=user_id, visibility=Course.Visibility.PUBLIC)
        .annotate(
            section_count=Count("sections", distinct=True),
            lesson_count=Count("sections__lessons", distinct=True),
            rating_avg=Avg("reviews__rating"),
            rating_count=Count("reviews", distinct=True),
        )
        .order_by("-updated_at", "id")
    )
    course_count = qs.count()
    # Rating summary uses all public courses, not just the current page.
    rated_rows = qs.exclude(rating_avg__isnull=True).exclude(rating_count=0)
    rated_avgs = list(rated_rows.values_list("rating_avg", flat=True))
    if rated_avgs:
        creator_rating_avg = sum(float(v) for v in rated_avgs) / len(rated_avgs)
        creator_rating_display = f"{creator_rating_avg:.1f}"
    else:
        creator_rating_display = "—"

    page = page_number(request)
    courses, has_more = paginate_items(qs, page, COURSE_FEED_PAGE_SIZE)
    ctx = {
        "profile": profile,
        "courses": courses,
        "course_count": course_count,
        "creator_rating_display": creator_rating_display,
        "is_own": request.user.is_authenticated and request.user.id == user_id,
        "feed_page": page,
        "feed_has_more": has_more,
        "result_count": course_count,
    }

    if wants_feed_json(request):
        html = render_to_string(
            "courses/_feed_profile_items.html",
            {"courses": courses},
            request=request,
        )
        return feed_json(html=html, page=page, has_more=has_more, total=course_count)

    return render(request, "accounts/public_profile.html", ctx)


@login_required
@require_http_methods(["GET", "POST"])
def settings_view(request):
    """Legacy URL — preferences now live on the account page."""
    return redirect("account")
