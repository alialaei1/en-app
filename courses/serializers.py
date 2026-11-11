def highlight_payload(highlight) -> dict:
    return {
        "id": highlight.pk,
        "text": highlight.text,
        "meaning": highlight.meaning or "",
        "start_char": highlight.start_char,
        "end_char": highlight.end_char,
        "start_sec": highlight.start_sec,
        "end_sec": highlight.end_sec,
    }


def chunk_payload(chunk) -> dict:
    highlights = [highlight_payload(item) for item in chunk.highlights.all()]
    video_url = chunk.video.url if getattr(chunk, "video", None) and chunk.video else ""
    audio_url = chunk.audio.url if chunk.audio else ""
    media_kind = "video" if video_url else ("audio" if audio_url else "")
    return {
        "id": chunk.pk,
        "text": chunk.text,
        "sentence_meaning": chunk.sentence_meaning or "",
        "display_lines": chunk.display_lines,
        "line_breaks": list(chunk.line_breaks or []),
        "color_spans": list(chunk.color_spans or []),
        "study_level": chunk.study_level,
        "best_type_ms": chunk.best_type_ms,
        "word_timing_count": len(chunk.word_timings or []),
        "video_url": video_url,
        "audio_url": audio_url or video_url,
        "media_url": video_url or audio_url,
        "media_kind": media_kind,
        "highlights": highlights,
    }


def study_chunk_payload(chunk) -> dict:
    data = chunk_payload(chunk)
    data["has_sentence_meaning"] = bool((chunk.sentence_meaning or "").strip())
    data["has_audio"] = bool(data.get("media_url"))
    data["has_video"] = data.get("media_kind") == "video"
    data["word_count"] = len((chunk.text or "").split())
    return data


def study_lesson_payload(
    lesson,
    *,
    exit_url: str = "",
    level_url_template: str = "",
    record_url_template: str = "",
    settings_url: str = "",
) -> dict:
    chunks = [
        study_chunk_payload(chunk)
        for chunk in lesson.chunks.prefetch_related("highlights").all()
    ]
    level_counts = {str(level): 0 for level in range(1, 8)}
    unrated = 0
    for chunk in chunks:
        if chunk.get("study_level") is None:
            unrated += 1
        else:
            key = str(int(chunk["study_level"]))
            if key in level_counts:
                level_counts[key] += 1
    return {
        "id": lesson.pk,
        "title": lesson.title,
        "exit_url": exit_url,
        "level_url_template": level_url_template,
        "record_url_template": record_url_template,
        "settings_url": settings_url,
        "settings": lesson.get_study_settings(),
        "total_cards": len(chunks),
        "level_counts": level_counts,
        "unrated_count": unrated,
        "chunks": chunks,
    }
