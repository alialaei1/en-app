"""Shared helpers for paginated course feeds (explore / library / enrolled / profile)."""

from __future__ import annotations

from django.http import JsonResponse

COURSE_FEED_PAGE_SIZE = 12
REVIEW_PAGE_SIZE = 10


def page_number(request, key: str = "page") -> int:
    try:
        page = int(request.GET.get(key) or 1)
    except (TypeError, ValueError):
        page = 1
    return max(1, page)


def paginate_items(sequence, page: int, size: int = COURSE_FEED_PAGE_SIZE):
    """Return (page_items, has_more) without loading the full sequence when possible."""
    start = (page - 1) * size
    chunk = list(sequence[start : start + size + 1])
    has_more = len(chunk) > size
    return chunk[:size], has_more


def page_count(total: int, size: int) -> int:
    if total <= 0:
        return 1
    return max(1, (int(total) + int(size) - 1) // int(size))


def wants_feed_json(request) -> bool:
    return request.headers.get("X-Requested-With") == "XMLHttpRequest"


def feed_json(
    *,
    html: str,
    page: int,
    has_more: bool,
    total: int,
    meta: dict | None = None,
):
    payload = {
        "ok": True,
        "html": html,
        "page": page,
        "has_more": has_more,
        "total": total,
        "append": page > 1,
        "is_empty": total == 0,
    }
    if meta:
        payload.update(meta)
    return JsonResponse(payload)
