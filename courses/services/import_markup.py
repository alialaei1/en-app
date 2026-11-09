from __future__ import annotations

import re
from dataclasses import dataclass, field


# [[word]] or [[phrase|optional meaning]]
_HIGHLIGHT_RE = re.compile(r"\[\[(.+?)\]\]")
# {{red|phrase}} or {{#22c55e|phrase}}
_COLOR_RE = re.compile(r"\{\{([^|{}]+?)\|(.+?)\}\}")
# Sentence meaning for the current piece (not spoken / not aligned)
_SENTENCE_MEANING_RE = re.compile(r"^@=\s*(.*)$")
# Display line count for the current piece
_LINES_RE = re.compile(r"^@lines\s*=?\s*(\d+)\s*$", re.IGNORECASE)

NAMED_COLORS = {
    "red",
    "rose",
    "orange",
    "amber",
    "yellow",
    "lime",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "pink",
    "slate",
    "gray",
    "grey",
    "white",
}


@dataclass
class ParsedHighlight:
    text: str
    meaning: str
    start_char: int
    end_char: int


@dataclass
class ParsedColorSpan:
    text: str
    color: str
    start_char: int
    end_char: int


@dataclass
class ParsedChunk:
    text: str
    sentence_meaning: str = ""
    display_lines: int | None = None
    line_breaks: list[int] = field(default_factory=list)
    highlights: list[ParsedHighlight] = field(default_factory=list)
    color_spans: list[ParsedColorSpan] = field(default_factory=list)


def normalize_color(raw: str) -> str | None:
    value = (raw or "").strip().lower()
    if not value:
        return None
    if value in NAMED_COLORS:
        return "gray" if value == "grey" else value
    if re.fullmatch(r"#[0-9a-f]{3}([0-9a-f]{3})?", value):
        return value
    return None


def _remap_spans(items, index_map: list[int], n: int, collapsed: str, kind: str):
    remapped = []
    for item in items:
        start = index_map[min(max(item.start_char, 0), n)]
        end = index_map[min(max(item.end_char, 0), n)]
        if end <= start:
            continue
        snippet = collapsed[start:end]
        if kind == "highlight":
            remapped.append(
                ParsedHighlight(
                    text=snippet,
                    meaning=item.meaning,
                    start_char=start,
                    end_char=end,
                )
            )
        else:
            remapped.append(
                ParsedColorSpan(
                    text=snippet,
                    color=item.color,
                    start_char=start,
                    end_char=end,
                )
            )
    return remapped


def _collapse_whitespace(
    text: str,
    highlights: list[ParsedHighlight],
    color_spans: list[ParsedColorSpan],
    line_breaks: list[int],
) -> tuple[str, list[ParsedHighlight], list[ParsedColorSpan], list[int]]:
    if not text:
        return "", [], [], []

    out: list[str] = []
    index_map = [0] * (len(text) + 1)
    new_i = 0
    i = 0
    n = len(text)
    while i < n:
        index_map[i] = new_i
        if text[i].isspace():
            while i < n and text[i].isspace():
                index_map[i] = new_i
                i += 1
            if out and i < n:
                out.append(" ")
                new_i += 1
            continue
        out.append(text[i])
        new_i += 1
        i += 1
    index_map[n] = new_i
    collapsed = "".join(out)

    remapped_breaks = sorted(
        {
            index_map[min(max(pos, 0), n)]
            for pos in line_breaks
            if 0 < index_map[min(max(pos, 0), n)] < len(collapsed)
        }
    )
    return (
        collapsed,
        _remap_spans(highlights, index_map, n, collapsed, "highlight"),
        _remap_spans(color_spans, index_map, n, collapsed, "color"),
        remapped_breaks,
    )


def strip_inline_markup(
    annotated: str,
    *,
    initial_breaks: list[int] | None = None,
) -> tuple[str, list[ParsedHighlight], list[ParsedColorSpan], list[int]]:
    """
    Strip {{color|text}} and [[highlight|meaning]] into clean text + spans.
    """
    source = annotated or ""
    events: list[tuple[int, int, str, tuple]] = []

    for match in _COLOR_RE.finditer(source):
        color = normalize_color(match.group(1))
        phrase = " ".join(match.group(2).split())
        if not color or not phrase:
            continue
        events.append((match.start(), match.end(), "color", (phrase, color)))

    for match in _HIGHLIGHT_RE.finditer(source):
        inner = match.group(1)
        if "|" in inner:
            phrase, meaning = inner.split("|", 1)
        else:
            phrase, meaning = inner, ""
        phrase = " ".join(phrase.split())
        meaning = meaning.strip()
        if not phrase:
            continue
        events.append((match.start(), match.end(), "highlight", (phrase, meaning)))

    events.sort(key=lambda item: item[0])

    clean_parts: list[str] = []
    highlights: list[ParsedHighlight] = []
    color_spans: list[ParsedColorSpan] = []
    cursor = 0
    clean_len = 0
    occupied_until = -1

    for start, end, kind, payload in events:
        if start < occupied_until:
            continue
        before = source[cursor:start]
        clean_parts.append(before)
        clean_len += len(before)

        phrase = payload[0]
        span_start = clean_len
        clean_parts.append(phrase)
        clean_len += len(phrase)
        if kind == "color":
            color_spans.append(
                ParsedColorSpan(
                    text=phrase,
                    color=payload[1],
                    start_char=span_start,
                    end_char=span_start + len(phrase),
                )
            )
        else:
            highlights.append(
                ParsedHighlight(
                    text=phrase,
                    meaning=payload[1],
                    start_char=span_start,
                    end_char=span_start + len(phrase),
                )
            )
        cursor = end
        occupied_until = end

    clean_parts.append(source[cursor:])
    clean = "".join(clean_parts)
    return _collapse_whitespace(
        clean,
        highlights,
        color_spans,
        list(initial_breaks or []),
    )


def strip_highlight_markup(annotated: str) -> tuple[str, list[ParsedHighlight]]:
    """Backward-compatible helper used by older call sites."""
    clean, highlights, _colors, _breaks = strip_inline_markup(annotated)
    return clean, highlights


def _join_content_lines(content_lines: list[str]) -> tuple[str, list[int]]:
    """
    Join soft-wrapped lines. A trailing `|` marks an explicit display break.
    """
    segments: list[str] = []
    break_after_segment: list[bool] = []

    for raw_line in content_lines:
        line = raw_line.strip()
        if not line:
            continue
        explicit_break = line.endswith("|")
        if explicit_break:
            line = line[:-1].rstrip()
        if not line:
            continue
        segments.append(line)
        break_after_segment.append(explicit_break)

    if not segments:
        return "", []

    parts: list[str] = []
    breaks: list[int] = []
    length = 0
    for index, segment in enumerate(segments):
        if parts:
            parts.append(" ")
            length += 1
        parts.append(segment)
        length += len(segment)
        if break_after_segment[index]:
            breaks.append(length)
    return "".join(parts), breaks


def parse_lesson_document(text: str) -> list[ParsedChunk]:
    """
    Split import text into pieces and extract optional annotations.

    Rules:
      - One blank line starts a new piece.
      - Soft wraps stay in the same piece.
      - Trailing | on a line = display line break inside the piece.
      - Lines starting with # are comments and also separate pieces.
      - [[word]] / [[phrase|meaning]] = highlight (meaning optional).
      - {{color|text}} = colored span (named color or #hex).
      - @= … = meaning of the whole piece.
      - @lines N = show the piece across N visual lines.
    """
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not raw.strip():
        return []

    chunks: list[ParsedChunk] = []
    content_lines: list[str] = []
    sentence_meaning = ""
    display_lines: int | None = None

    def flush() -> None:
        nonlocal content_lines, sentence_meaning, display_lines
        if not content_lines:
            sentence_meaning = ""
            display_lines = None
            return

        annotated, explicit_breaks = _join_content_lines(content_lines)
        clean, highlights, color_spans, line_breaks = strip_inline_markup(
            annotated,
            initial_breaks=explicit_breaks,
        )
        if clean:
            chunks.append(
                ParsedChunk(
                    text=clean,
                    sentence_meaning=sentence_meaning.strip(),
                    display_lines=display_lines,
                    line_breaks=line_breaks,
                    highlights=highlights,
                    color_spans=color_spans,
                )
            )
        content_lines = []
        sentence_meaning = ""
        display_lines = None

    for line in raw.split("\n"):
        stripped = line.strip()
        if not stripped:
            flush()
            continue
        if stripped.startswith("#"):
            flush()
            continue
        meaning_match = _SENTENCE_MEANING_RE.match(stripped)
        if meaning_match:
            sentence_meaning = meaning_match.group(1).strip()
            continue
        lines_match = _LINES_RE.match(stripped)
        if lines_match:
            value = int(lines_match.group(1))
            display_lines = value if value > 0 else None
            continue
        content_lines.append(stripped)

    flush()
    return chunks


def split_into_chunks(text: str) -> list[str]:
    """Backward-compatible helper: clean piece texts only."""
    return [chunk.text for chunk in parse_lesson_document(text)]


def _format_highlight_markup(text: str, meaning: str = "") -> str:
    phrase = (text or "").strip()
    if not phrase:
        return ""
    meaning = (meaning or "").strip().replace("]]", "］］")
    if meaning:
        return f"[[{phrase}|{meaning}]]"
    return f"[[{phrase}]]"


def _format_color_markup(text: str, color: str = "") -> str:
    phrase = (text or "").strip()
    color = normalize_color(color) or ""
    if not phrase or not color:
        return phrase
    phrase = phrase.replace("}}", "｝｝")
    return f"{{{{{color}|{phrase}}}}}"


def annotate_chunk_text(text: str, highlights, color_spans=None) -> str:
    """
    Rebuild import markup for one piece from clean text + spans.
    """
    text = text or ""
    if not text:
        return ""

    events: list[tuple[int, int, str, str, str]] = []

    for item in highlights or []:
        start = getattr(item, "start_char", None)
        end = getattr(item, "end_char", None)
        phrase = getattr(item, "text", "") or ""
        meaning = getattr(item, "meaning", "") or ""
        if isinstance(item, dict):
            start = item.get("start_char")
            end = item.get("end_char")
            phrase = item.get("text") or ""
            meaning = item.get("meaning") or ""
        if start is None or end is None or end <= start:
            continue
        if text[start:end] != phrase:
            found = text.find(phrase)
            if found < 0:
                continue
            start, end = found, found + len(phrase)
        events.append((start, end, "highlight", phrase, meaning))

    for item in color_spans or []:
        if isinstance(item, dict):
            start = item.get("start_char")
            end = item.get("end_char")
            phrase = item.get("text") or ""
            color = item.get("color") or ""
        else:
            start = getattr(item, "start_char", None)
            end = getattr(item, "end_char", None)
            phrase = getattr(item, "text", "") or ""
            color = getattr(item, "color", "") or ""
        if start is None or end is None or end <= start:
            continue
        if not normalize_color(color):
            continue
        if text[start:end] != phrase:
            found = text.find(phrase)
            if found < 0:
                continue
            start, end = found, found + len(phrase)
        events.append((start, end, "color", phrase, color))

    events.sort(key=lambda item: (item[0], -(item[1] - item[0])))
    chosen: list[tuple[int, int, str, str, str]] = []
    occupied_until = -1
    for start, end, kind, phrase, extra in events:
        if start < occupied_until:
            continue
        chosen.append((start, end, kind, phrase, extra))
        occupied_until = end

    parts: list[str] = []
    cursor = 0
    for start, end, kind, phrase, extra in chosen:
        parts.append(text[cursor:start])
        if kind == "color":
            parts.append(_format_color_markup(phrase, extra))
        else:
            parts.append(_format_highlight_markup(phrase, extra))
        cursor = end
    parts.append(text[cursor:])
    return "".join(parts)


def apply_line_breaks_to_markup(body: str, text: str, line_breaks: list[int]) -> str:
    """
    Insert trailing | breaks into exported body using clean-text offsets.
    Falls back to @lines when breaks are absent.
    """
    if not body or not line_breaks:
        return body

    # Map clean offsets -> positions in annotated body by walking both.
    clean_to_body = {}
    bi = 0
    ci = 0
    while ci <= len(text) and bi <= len(body):
        clean_to_body[ci] = bi
        if ci == len(text) or bi == len(body):
            break
        # Skip markup wrappers in body
        if body.startswith("[[", bi):
            close = body.find("]]", bi)
            if close < 0:
                break
            inner = body[bi + 2 : close]
            phrase = inner.split("|", 1)[0]
            bi = close + 2
            ci += len(phrase)
            continue
        if body.startswith("{{", bi):
            close = body.find("}}", bi)
            if close < 0:
                break
            inner = body[bi + 2 : close]
            phrase = inner.split("|", 1)[-1] if "|" in inner else ""
            bi = close + 2
            ci += len(phrase)
            continue
        if body[bi] == text[ci]:
            bi += 1
            ci += 1
            continue
        # Mismatch — abort to simple body
        return body

    # Rebuild with newlines + | at break points for readability
    breaks = sorted({b for b in line_breaks if 0 < b < len(text)})
    if not breaks:
        return body

    pieces = []
    prev = 0
    for br in breaks:
        body_at = clean_to_body.get(br)
        prev_body = clean_to_body.get(prev, 0)
        if body_at is None:
            return body
        segment = body[prev_body:body_at].rstrip()
        pieces.append(f"{segment} |")
        prev = br
    tail_start = clean_to_body.get(prev, 0)
    tail = body[tail_start:].strip()
    if tail:
        pieces.append(tail)
    return "\n".join(pieces)


def export_lesson_document(chunks, *, title: str = "") -> str:
    """Serialize lesson pieces back to the annotated import .txt format."""
    lines: list[str] = []
    if title:
        lines.append(f"# {title}")
        lines.append("# Exported from mimivo — re-importable markup")
        lines.append("")

    pieces: list[str] = []
    for chunk in chunks:
        highlights = (
            list(getattr(chunk, "highlights", []).all())
            if hasattr(getattr(chunk, "highlights", None), "all")
            else list(getattr(chunk, "highlights", []) or [])
        )
        color_spans = list(getattr(chunk, "color_spans", None) or [])
        text = getattr(chunk, "text", "") or ""
        body = annotate_chunk_text(text, highlights, color_spans)
        if not body:
            continue

        line_breaks = list(getattr(chunk, "line_breaks", None) or [])
        if line_breaks:
            body = apply_line_breaks_to_markup(body, text, line_breaks)

        block_lines = [body]
        sentence_meaning = (getattr(chunk, "sentence_meaning", "") or "").strip()
        if sentence_meaning:
            block_lines.append(f"@= {sentence_meaning}")
        display_lines = getattr(chunk, "display_lines", None)
        if display_lines and int(display_lines) > 0 and not line_breaks:
            block_lines.append(f"@lines {int(display_lines)}")
        pieces.append("\n".join(block_lines))

    lines.append("\n\n".join(pieces))
    if lines[-1] and not lines[-1].endswith("\n"):
        lines[-1] = lines[-1] + "\n"
    return "\n".join(lines)


def split_text_for_display(
    text: str,
    *,
    display_lines: int | None = None,
    line_breaks: list[int] | None = None,
) -> list[str]:
    """
    Return visual lines for a piece.
    Explicit line_breaks win; otherwise split evenly by @lines / display_lines.
    """
    text = text or ""
    if not text:
        return []

    breaks = sorted({int(b) for b in (line_breaks or []) if 0 < int(b) < len(text)})
    if breaks:
        lines = []
        prev = 0
        for br in breaks:
            lines.append(text[prev:br].strip())
            prev = br
        tail = text[prev:].strip()
        if tail:
            lines.append(tail)
        return [line for line in lines if line]

    count = int(display_lines or 0)
    if count <= 1:
        return [text]

    words = text.split()
    if len(words) <= 1:
        return [text]

    count = min(count, len(words))
    # Distribute words as evenly as possible across N lines
    lines: list[str] = []
    index = 0
    remaining_words = len(words)
    remaining_lines = count
    while remaining_lines > 0:
        take = max(1, round(remaining_words / remaining_lines))
        take = min(take, remaining_words - (remaining_lines - 1))
        lines.append(" ".join(words[index : index + take]))
        index += take
        remaining_words -= take
        remaining_lines -= 1
    return [line for line in lines if line]
