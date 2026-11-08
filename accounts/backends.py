from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailBackend(ModelBackend):
    """Authenticate with email + password (case-insensitive email)."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        User = get_user_model()
        email = kwargs.get("email") or username
        if email is None or password is None:
            return None

        email = str(email).strip().lower()
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            User().set_password(password)  # mitigate timing attacks
            return None
        except User.MultipleObjectsReturned:
            user = User.objects.filter(email__iexact=email).order_by("id").first()

        if user and user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
