from django import template
from django.utils.html import escape
from django.utils.safestring import mark_safe

from courses.services.import_markup import split_text_for_display

register = template.Library()

COLOR_CLASS = {
    "red": "mv-c-red",
    "rose": "mv-c-rose",
    "orange": "mv-c-orange",
    "amber": "mv-c-amber",
    "yellow": "mv-c-yellow",
    "lime": "mv-c-lime",
    "emerald": "mv-c-emerald",
    "teal": "mv-c-teal",
    "cyan": "mv-c-cyan",
    "sky": "mv-c-sky",
    "blue": "mv-c-blue",
    "indigo": "mv-c-indigo",
    "violet": "mv-c-violet",
    "purple": "mv-c-purple",
    "pink": "mv-c-pink",
    "slate": "mv-c-slate",
    "gray": "mv-c-gray",
    "white": "mv-c-white",
}


def _paint_segment(text: str, color_spans: list[dict], offset: int) -> str:
    if not text:
        return ""
    local_spans = []
    end_limit = offset + len(text)
    for span in color_spans or []:
        start = int(span.get("start_char", -1))
        end = int(span.get("end_char", -1))
        if end <= offset or start >= end_limit:
            continue
        local_spans.append(
            {
                "start": max(start, offset) - offset,
                "end": min(end, end_limit) - offset,
                "color": (span.get("color") or "").strip().lower(),
            }
        )
    local_spans.sort(key=lambda item: item["start"])

    parts: list[str] = []
    cursor = 0
    for span in local_spans:
        if span["start"] < cursor:
            continue
        parts.append(escape(text[cursor : span["start"]]))
        snippet = escape(text[span["start"] : span["end"]])
        color = span["color"]
        css = COLOR_CLASS.get(color)
        if css:
            parts.append(f'<span class="{css}">{snippet}</span>')
        elif color.startswith("#"):
            parts.append(
                f'<span style="color:{escape(color)}">{snippet}</span>'
            )
        else:
            parts.append(snippet)
        cursor = span["end"]
    parts.append(escape(text[cursor:]))
    return "".join(parts)


@register.simple_tag
def render_chunk_text(chunk) -> str:
    text = chunk.text or ""
    lines = split_text_for_display(
        text,
        display_lines=chunk.display_lines,
        line_breaks=chunk.line_breaks or [],
    )
    color_spans = chunk.color_spans or []
    if not lines:
        return mark_safe("&nbsp;")

    # Map each display line back to offsets in the original text
    html_lines: list[str] = []
    search_from = 0
    for line in lines:
        idx = text.find(line, search_from)
        if idx < 0:
            idx = search_from
        html_lines.append(_paint_segment(line, color_spans, idx))
        search_from = idx + len(line)
    return mark_safe("<br>".join(html_lines))
