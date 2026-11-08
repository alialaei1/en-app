from __future__ import annotations

import re


_TOKEN_RE = re.compile(r"\S+")


def tokenize_with_spans(text: str) -> list[dict]:
    """Return whitespace tokens with character spans in `text`."""
    return [
        {"word": match.group(0), "start_char": match.start(), "end_char": match.end()}
        for match in _TOKEN_RE.finditer(text or "")
    ]


def relative_word_timings(words, chunk_start: float) -> list[dict]:
    """Convert absolute Whisper word times to times relative to a chunk clip."""
    timings = []
    for word in words:
        raw = getattr(word, "word", None) or getattr(word, "text", None) or str(word)
        raw = str(raw).strip()
        if not raw:
            continue
        start = float(getattr(word, "start", 0.0)) - chunk_start
        end = float(getattr(word, "end", 0.0)) - chunk_start
        timings.append(
            {
                "word": raw,
                "start": round(max(0.0, start), 3),
                "end": round(max(0.0, end), 3),
            }
        )
    return timings


def highlight_audio_span(
    text: str,
    word_timings: list[dict],
    start_char: int,
    end_char: int,
) -> tuple[float | None, float | None]:
    """
    Map a character highlight range onto word_timings and return (start_sec, end_sec).
    """
    if not word_timings or start_char is None or end_char is None:
        return None, None
    if end_char <= start_char:
        return None, None

    tokens = tokenize_with_spans(text)
    if not tokens:
        return None, None

    matched_indexes: list[int] = []
    for index, token in enumerate(tokens):
        # Overlap between token span and highlight span
        if token["end_char"] <= start_char or token["start_char"] >= end_char:
            continue
        matched_indexes.append(index)

    if not matched_indexes:
        return None, None

    # Prefer aligning token index to timing index by order.
    usable = [
        word_timings[i]
        for i in matched_indexes
        if i < len(word_timings) and word_timings[i].get("start") is not None
    ]
    if not usable:
        return None, None
    return usable[0]["start"], usable[-1]["end"]
