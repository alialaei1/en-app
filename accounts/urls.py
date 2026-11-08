from django.urls import path

from . import views

urlpatterns = [
    path("signup/", views.signup, name="signup"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("account/", views.account_home, name="account"),
    path("settings/", views.settings_view, name="settings"),
    path("u/<int:user_id>/", views.public_profile, name="public_profile"),
]
