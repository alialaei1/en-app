"""Automatic cache-busting helpers for static assets."""

from __future__ import annotations

import hashlib
from pathlib import Path

from django.conf import settings
from django.contrib.staticfiles.finders import find


def _file_token(path: Path) -> str:
    try:
        st = path.stat()
    except OSError:
        return ""
    raw = f"{st.st_mtime_ns}:{st.st_size}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:10]


def resolve_static_path(name: str) -> Path | None:
    name = (name or "").lstrip("/")
    if not name:
        return None

    # Prefer collected files in production.
    static_root = Path(getattr(settings, "STATIC_ROOT", "") or "")
    if static_root:
        candidate = static_root / name
        if candidate.is_file():
            return candidate

    for root in getattr(settings, "STATICFILES_DIRS", []) or []:
        candidate = Path(root) / name
        if candidate.is_file():
            return candidate

    found = find(name)
    if found:
        return Path(found)
    return None


def static_file_version(name: str) -> str:
    """Return a short version token for a static file (mtime + size)."""
    path = resolve_static_path(name)
    if not path:
        return ""
    return _file_token(path)


def asset_bundle_version() -> str:
    """
    Fingerprint of key frontend assets so the service worker cache rotates
    whenever CSS/JS/PWA shell files change.
    """
    watched = (
        "css/output.css",
        "css/theme.css",
        "js/pwa-register.js",
        "js/confirm.js",
        "js/mobile-shell.js",
        "js/lesson_study.js",
        "pwa/sw.js",
        "pwa/offline.html",
        "pwa/manifest.webmanifest",
    )
    parts: list[str] = []
    for name in watched:
        token = static_file_version(name)
        if token:
            parts.append(f"{name}:{token}")
    if not parts:
        return "dev"
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]
