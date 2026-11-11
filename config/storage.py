from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from django.contrib.staticfiles.storage import StaticFilesStorage

from .static_version import static_file_version


class CacheBustingStaticFilesStorage(StaticFilesStorage):
    """
    Appends ?v=<file-token> to static URLs based on file mtime/size.
    Changing a CSS/JS file automatically busts browser/PWA caches.
    """

    def url(self, name):
        url = super().url(name)
        version = static_file_version(name)
        if not version:
            return url

        parts = urlsplit(url)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        query["v"] = version
        return urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
        )
