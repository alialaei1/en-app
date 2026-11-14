"""Translate study text from learning language to the user's native language."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request

from deep_translator import MyMemoryTranslator
from deep_translator.exceptions import (
    NotValidLength,
    NotValidPayload,
    TooManyRequests,
    TranslationNotFound,
)


class TranslateError(Exception):
    """Base translation failure with a stable error code for the API."""

    code = "translate_failed"

    def __init__(self, message: str = "", *, code: str | None = None):
        super().__init__(message or self.code)
        if code:
            self.code = code


class TranslateInvalidError(TranslateError):
    code = "translate_invalid"


class TranslateNotFoundError(TranslateError):
    code = "translate_not_found"


class TranslateUnavailableError(TranslateError):
    code = "translate_failed"


_WS_RE = re.compile(r"\s+")

# MyMemory expects locale-style codes for some pairs (e.g. en-GB / fa-IR).
_MYMEMORY_LANG = {
    "en": "en-GB",
    "fa": "fa-IR",
}


def normalize_translate_text(text: str) -> str:
    return _WS_RE.sub(" ", (text or "").strip())


def _translate_google_gtx(text: str, source: str, target: str) -> str:
    """
    Use Google's public gtx client endpoint (no API key).
    More reliable than HTML scraping used by deep-translator's GoogleTranslator.
    """
    query = urllib.parse.urlencode(
        {
            "client": "gtx",
            "sl": source,
            "tl": target,
            "dt": "t",
            "q": text,
        }
    )
    url = f"https://translate.googleapis.com/translate_a/single?{query}"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; Mimivo/1.0)",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        if exc.code in {429, 503}:
            raise TooManyRequests(str(exc)) from exc
        raise TranslateUnavailableError(f"Google translate HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise TranslateUnavailableError(str(exc.reason) or "Network error") from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise TranslateUnavailableError("Invalid translation response.") from exc

    parts: list[str] = []
    rows = data[0] if isinstance(data, list) and data else None
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, list) and row and isinstance(row[0], str):
                parts.append(row[0])
    return "".join(parts)


def _translate_mymemory(text: str, source: str, target: str) -> str:
    src = _MYMEMORY_LANG.get(source, source)
    tgt = _MYMEMORY_LANG.get(target, target)
    return MyMemoryTranslator(source=src, target=tgt).translate(text) or ""


def translate_text(
    text: str,
    *,
    source: str = "en",
    target: str = "fa",
    max_len: int | None = None,
) -> str:
    """
    Translate `text` from `source` to `target`.
    Prefers Google gtx, falls back to MyMemory.
    Raises TranslateError subclasses on failure.
    """
    cleaned = normalize_translate_text(text)
    if not cleaned:
        raise TranslateInvalidError("Empty text.")
    if max_len is not None and len(cleaned) > max_len:
        raise TranslateInvalidError("Text is too long to translate.")
    if source == target:
        return cleaned

    errors: list[Exception] = []
    result = ""
    for runner in (_translate_google_gtx, _translate_mymemory):
        try:
            result = runner(cleaned, source, target)
            if normalize_translate_text(result):
                break
            errors.append(TranslationNotFound("Empty translation result."))
        except TranslationNotFound as exc:
            errors.append(exc)
        except TooManyRequests as exc:
            errors.append(exc)
            continue
        except TranslateError:
            raise
        except (NotValidPayload, NotValidLength, ValueError) as exc:
            raise TranslateInvalidError(str(exc) or "Invalid text.") from exc
        except Exception as exc:
            errors.append(exc)
            continue
    else:
        if errors and all(isinstance(e, TranslationNotFound) for e in errors):
            raise TranslateNotFoundError("No translation found.") from errors[-1]
        detail = str(errors[-1]) if errors else "Translation service unavailable."
        raise TranslateUnavailableError(detail) from (errors[-1] if errors else None)

    out = normalize_translate_text(result or "")
    if not out:
        raise TranslateNotFoundError("No translation found.")
    if max_len is not None and len(out) > max_len:
        out = out[:max_len].rstrip()
    return out
