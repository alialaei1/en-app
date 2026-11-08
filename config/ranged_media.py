"""Serve MEDIA files with HTTP Range support (needed for audio/video seeking)."""

from __future__ import annotations

import mimetypes
import os
import re

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse, StreamingHttpResponse
from django.utils._os import safe_join
from django.utils.http import http_date

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)", re.IGNORECASE)


class _RangeFileReader:
    def __init__(self, path: str, start: int, length: int, blksize: int = 64 * 1024):
        self.file = open(path, "rb")
        self.file.seek(start)
        self.remaining = length
        self.blksize = blksize

    def __iter__(self):
        return self

    def __next__(self):
        if self.remaining <= 0:
            self.close()
            raise StopIteration
        chunk = self.file.read(min(self.blksize, self.remaining))
        if not chunk:
            self.close()
            raise StopIteration
        self.remaining -= len(chunk)
        return chunk

    def close(self):
        if self.file and not self.file.closed:
            self.file.close()


def _base_headers(response, *, content_type: str, encoding: str | None, last_modified: str):
    response["Accept-Ranges"] = "bytes"
    response["Last-Modified"] = last_modified
    # Avoid sticky browser caches from the old non-Range media responses.
    response["Cache-Control"] = "private, max-age=0, must-revalidate"
    if encoding:
        response["Content-Encoding"] = encoding
    # FileResponse may set attachment disposition; keep inline for media playback.
    if content_type.startswith(("audio/", "video/")):
        response["Content-Disposition"] = "inline"


def ranged_media_serve(request, path: str):
    """Drop-in replacement for django.views.static.serve with byte-range support."""
    try:
        fullpath = safe_join(str(settings.MEDIA_ROOT), path)
    except ValueError as exc:
        raise Http404("Invalid path") from exc

    if not os.path.exists(fullpath) or not os.path.isfile(fullpath):
        raise Http404(f'"{path}" does not exist')

    statobj = os.stat(fullpath)
    content_type, encoding = mimetypes.guess_type(fullpath)
    content_type = content_type or "application/octet-stream"
    file_size = statobj.st_size
    last_modified = http_date(statobj.st_mtime)

    range_header = (request.META.get("HTTP_RANGE") or "").strip()
    if range_header:
        match = RANGE_RE.fullmatch(range_header)
        if not match:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{file_size}"
            return response

        start_s, end_s = match.groups()
        if start_s == "" and end_s == "":
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{file_size}"
            return response

        if start_s == "":
            suffix = int(end_s)
            start = max(0, file_size - suffix)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else file_size - 1

        if start >= file_size or start < 0 or end < start:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{file_size}"
            return response

        end = min(end, file_size - 1)
        length = end - start + 1
        reader = _RangeFileReader(fullpath, start, length)
        response = StreamingHttpResponse(reader, status=206, content_type=content_type)
        response["Content-Length"] = str(length)
        response["Content-Range"] = f"bytes {start}-{end}/{file_size}"
        _base_headers(response, content_type=content_type, encoding=encoding, last_modified=last_modified)
        return response

    # Full file — still advertise Accept-Ranges so browsers enable seeking.
    response = FileResponse(open(fullpath, "rb"), content_type=content_type, as_attachment=False)
    response["Content-Length"] = str(file_size)
    _base_headers(response, content_type=content_type, encoding=encoding, last_modified=last_modified)
    return response
