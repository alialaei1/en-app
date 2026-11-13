from django.conf import settings

from .limits import can_create_course, get_limits_for_user
from .models import Profile, ensure_profile
from .ui_i18n import tf, ui_bundle

THEME_COOKIE = "mv_theme"
APP_LANG_COOKIE = "mv_app_lang"
LEARN_LANG_COOKIE = "mv_learn_lang"


def user_preferences(request):
    theme = Profile.Theme.DARK
    app_language = Profile.AppLanguage.EN
    learning_language = Profile.LearningLanguage.EN

    if request.user.is_authenticated:
        profile = ensure_profile(request.user)
        theme = profile.theme or theme
        app_language = profile.app_language or app_language
        learning_language = profile.learning_language or learning_language
    else:
        theme = request.COOKIES.get(THEME_COOKIE, theme)
        app_language = request.COOKIES.get(APP_LANG_COOKIE, app_language)
        learning_language = request.COOKIES.get(LEARN_LANG_COOKIE, learning_language)

    if theme not in Profile.Theme.values:
        theme = Profile.Theme.DARK
    if app_language not in Profile.SUPPORTED_APP_LANGUAGES:
        app_language = Profile.AppLanguage.EN
    if learning_language not in Profile.SUPPORTED_LEARNING_LANGUAGES:
        learning_language = Profile.LearningLanguage.EN

    resolved = theme
    if theme == Profile.Theme.SYSTEM:
        resolved = Profile.Theme.DARK

    create_course_ok = False
    max_courses = 0
    limit_courses_msg = ""
    if request.user.is_authenticated:
        limits = get_limits_for_user(request.user)
        max_courses = limits.max_courses
        create_course_ok = can_create_course(request.user)
        limit_courses_msg = tf(app_language, "limit_courses_reached", max=max_courses)

    return {
        "ui_theme": theme,
        "ui_theme_resolved": resolved,
        "ui_app_language": app_language,
        "ui_learning_language": learning_language,
        "ui_rtl": app_language == Profile.AppLanguage.FA,
        "ui": ui_bundle(app_language),
        "app_version": getattr(settings, "APP_VERSION", "1.0.0"),
        "can_create_course": create_course_ok,
        "max_courses": max_courses,
        "limit_courses_msg": limit_courses_msg,
    }
