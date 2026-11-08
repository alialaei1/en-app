from django.conf import settings
from django.contrib import admin
from django.urls import include, path

from config.pwa import service_worker, web_manifest
from config.ranged_media import ranged_media_serve

urlpatterns = [
    path("admin/", admin.site.urls),
    path("sw.js", service_worker, name="pwa_service_worker"),
    path("manifest.webmanifest", web_manifest, name="pwa_manifest"),
    path("", include("accounts.urls")),
    path("", include("courses.urls")),
]

if settings.DEBUG:
    urlpatterns += [
        path("media/<path:path>", ranged_media_serve, name="ranged_media"),
    ]
