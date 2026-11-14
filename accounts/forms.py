from django import forms
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError

from .limits import (
    DEFAULTS,
    apply_char_limit,
    get_limits_for_user,
    validate_file_size,
    validate_text_length,
)
from .models import Profile, ensure_profile

User = get_user_model()

INPUT_CLASS = (
    "w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm "
    "text-slate-100 outline-none focus:border-emerald-500 focus:ring-2 "
    "focus:ring-emerald-500/30"
)
TEXTAREA_CLASS = INPUT_CLASS + " min-h-28 resize-y"
FILE_CLASS = (
    "block w-full text-sm text-slate-300 file:mr-4 file:rounded-lg "
    "file:border-0 file:bg-emerald-500 file:px-4 file:py-2 file:font-semibold "
    "file:text-slate-950 hover:file:bg-emerald-400"
)


class SignUpForm(forms.Form):
    display_name = forms.CharField(
        label="Display name",
        max_length=DEFAULTS["display_name_max"],
        required=False,
        widget=forms.TextInput(
            attrs={
                "class": INPUT_CLASS,
                "autocomplete": "nickname",
                "placeholder": "How you appear on Explore",
                "maxlength": str(DEFAULTS["display_name_max"]),
            }
        ),
    )
    email = forms.EmailField(
        label="Email",
        widget=forms.EmailInput(
            attrs={
                "class": INPUT_CLASS,
                "autocomplete": "email",
                "placeholder": "you@example.com",
            }
        ),
    )
    password1 = forms.CharField(
        label="Password",
        strip=False,
        widget=forms.PasswordInput(
            attrs={
                "class": INPUT_CLASS,
                "autocomplete": "new-password",
                "placeholder": "Create a password",
            }
        ),
    )
    password2 = forms.CharField(
        label="Confirm password",
        strip=False,
        widget=forms.PasswordInput(
            attrs={
                "class": INPUT_CLASS,
                "autocomplete": "new-password",
                "placeholder": "Repeat password",
            }
        ),
    )

    def clean_display_name(self):
        return validate_text_length(
            (self.cleaned_data.get("display_name") or "").strip(),
            DEFAULTS["display_name_max"],
            "Display name",
        )

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("An account with this email already exists.")
        if User.objects.filter(username__iexact=email).exists():
            raise forms.ValidationError("An account with this email already exists.")
        return email

    def clean(self):
        cleaned = super().clean()
        password1 = cleaned.get("password1")
        password2 = cleaned.get("password2")
        if password1 and password2 and password1 != password2:
            self.add_error("password2", "Passwords do not match.")
        if password1:
            try:
                validate_password(password1)
            except DjangoValidationError as exc:
                self.add_error("password1", exc)
        return cleaned

    def save(self):
        email = self.cleaned_data["email"]
        password = self.cleaned_data["password1"]
        display_name = (self.cleaned_data.get("display_name") or "").strip()
        user = User.objects.create_user(
            username=email,
            email=email,
            password=password,
        )
        profile = ensure_profile(user)
        if display_name:
            profile.display_name = display_name
            profile.save(update_fields=["display_name", "updated_at"])
        return user


class LoginForm(forms.Form):
    email = forms.EmailField(
        label="Email",
        widget=forms.EmailInput(
            attrs={
                "class": INPUT_CLASS,
                "autocomplete": "email",
                "placeholder": "you@example.com",
            }
        ),
    )
    password = forms.CharField(
        label="Password",
        strip=False,
        widget=forms.PasswordInput(
            attrs={
                "class": INPUT_CLASS,
                "autocomplete": "current-password",
                "placeholder": "Your password",
            }
        ),
    )

    def __init__(self, request=None, *args, **kwargs):
        self.request = request
        self.user_cache = None
        super().__init__(*args, **kwargs)

    def clean(self):
        cleaned = super().clean()
        email = cleaned.get("email")
        password = cleaned.get("password")
        if email and password:
            user = authenticate(
                self.request,
                username=email.strip().lower(),
                password=password,
            )
            if user is None:
                raise forms.ValidationError("Invalid email or password.")
            self.user_cache = user
        return cleaned

    def get_user(self):
        return self.user_cache


class ProfileForm(forms.ModelForm):
    """Unified account form: profile + preferences."""

    class Meta:
        model = Profile
        fields = [
            "display_name",
            "bio",
            "avatar",
            "theme",
            "app_language",
            "learning_language",
            "native_language",
        ]
        labels = {
            "display_name": "Display name",
            "bio": "Bio",
            "avatar": "Avatar",
            "theme": "Theme",
            "app_language": "App language",
            "learning_language": "Learning language",
            "native_language": "Native language",
        }
        help_texts = {
            "theme": "Dark, light, or follow your device.",
            "app_language": "Interface language: English or Persian.",
            "learning_language": "Language you study. Only English is available for now.",
            "native_language": "Language for word and sentence meanings. Only Persian for now.",
        }
        widgets = {
            "display_name": forms.TextInput(
                attrs={
                    "class": INPUT_CLASS,
                    "placeholder": "Name shown on Explore",
                }
            ),
            "bio": forms.Textarea(
                attrs={
                    "class": TEXTAREA_CLASS,
                    "rows": 4,
                    "placeholder": "Short bio (optional)",
                }
            ),
            "avatar": forms.FileInput(
                attrs={
                    "class": FILE_CLASS,
                    "accept": "image/*",
                    "data-image-crop": "1",
                    "data-crop-aspect": "1",
                    "data-crop-max": "1024",
                    "data-crop-quality": "0.85",
                    "data-crop-round": "1",
                }
            ),
            "theme": forms.Select(attrs={"class": INPUT_CLASS}),
            "app_language": forms.Select(attrs={"class": INPUT_CLASS}),
            "learning_language": forms.Select(attrs={"class": INPUT_CLASS}),
            "native_language": forms.Select(attrs={"class": INPUT_CLASS}),
        }

    def __init__(self, *args, user=None, limits=None, lang=None, **kwargs):
        super().__init__(*args, **kwargs)
        owner = user or getattr(self.instance, "user", None)
        self.limits = limits or get_limits_for_user(owner)
        self.lang = lang
        apply_char_limit(self.fields["display_name"], self.limits.display_name_max, model_cap=80)
        apply_char_limit(self.fields["bio"], self.limits.bio_max)

    def clean_display_name(self):
        return validate_text_length(
            self.cleaned_data.get("display_name") or "",
            self.limits.display_name_max,
            "Display name",
            lang=self.lang,
        )

    def clean_bio(self):
        return validate_text_length(
            self.cleaned_data.get("bio") or "",
            self.limits.bio_max,
            "Bio",
            lang=self.lang,
        )

    def clean_avatar(self):
        avatar = self.cleaned_data.get("avatar")
        if avatar and hasattr(avatar, "size"):
            validate_file_size(
                avatar, self.limits.image_max_bytes, "Avatar", lang=self.lang
            )
        return avatar

    def clean_app_language(self):
        value = self.cleaned_data["app_language"]
        if value not in Profile.SUPPORTED_APP_LANGUAGES:
            raise forms.ValidationError("This app language is not supported yet.")
        return value

    def clean_learning_language(self):
        value = self.cleaned_data["learning_language"]
        if value not in Profile.SUPPORTED_LEARNING_LANGUAGES:
            raise forms.ValidationError("This learning language is not supported yet.")
        return value

    def clean_native_language(self):
        value = self.cleaned_data["native_language"]
        if value not in Profile.SUPPORTED_NATIVE_LANGUAGES:
            raise forms.ValidationError("This native language is not supported yet.")
        return value


# Backward-compatible alias
SettingsForm = ProfileForm
