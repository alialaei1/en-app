from __future__ import annotations

import re


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def suggest_study_level(text: str, time_ms: int) -> int:
    """
    Suggest study level 1–7 from sentence length and completion time.

    Uses words-per-minute style speed, adjusted slightly for very short cards.
    1 = slow / just starting, 7 = very fast / knows it well.
    """
    words = max(1, _word_count(text))
    seconds = max(0.2, float(time_ms) / 1000.0)
    wpm = (words / seconds) * 60.0

    # Short cards are noisy; dampen extreme WPM a bit.
    if words <= 4:
        wpm *= 0.85
    elif words <= 8:
        wpm *= 0.92

    if wpm >= 90:
        return 7
    if wpm >= 75:
        return 6
    if wpm >= 60:
        return 5
    if wpm >= 45:
        return 4
    if wpm >= 30:
        return 3
    if wpm >= 18:
        return 2
    return 1
