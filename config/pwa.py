from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404
from django.views.decorators.cache import cache_control
from django.views.decorators.http import require_http_methods


def _pwa_file(relative: str) -> Path:
    path = Path(settings.BASE_DIR) / "static" / "pwa" / relative
    if not path.is_file():
        raise Http404("PWA asset not found")
    return path


@require_http_methods(["GET", "HEAD"])
@cache_control(max_age=0, no_cache=True, no_store=True, must_revalidate=True)
def service_worker(request):
    path = _pwa_file("sw.js")
    response = FileResponse(path.open("rb"), content_type="application/javascript")
    response["Service-Worker-Allowed"] = "/"
    return response


@require_http_methods(["GET", "HEAD"])
@cache_control(max_age=3600, public=True)
def web_manifest(request):
    path = _pwa_file("manifest.webmanifest")
    return FileResponse(path.open("rb"), content_type="application/manifest+json")
