(function () {

  const uiNode = document.getElementById("ui-i18n");
  const UI = uiNode ? JSON.parse(uiNode.textContent || "{}") : {};
  function t(key, fallback, vars) {
    let text = UI[key] || fallback || key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        text = text.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return text;
  }

  const root = document.getElementById("chunk-edit-root");
  if (!root) return;

  const dataNode = document.getElementById("chunk-data");
  let state = dataNode ? JSON.parse(dataNode.textContent) : { text: "", highlights: [] };

  const saveForm = document.getElementById("chunk-save-form");
  const textField = document.getElementById("id_chunk_text");
  const meaningField = document.getElementById("id_sentence_meaning");
  const displayLinesField = document.getElementById("id_display_lines");
  const meaningWrap = document.getElementById("sentence-meaning-wrap");
  const toggleMeaningBtn = document.getElementById("toggle-sentence-meaning");

  const COLOR_CLASS = {
    red: "ll-c-red",
    rose: "ll-c-rose",
    orange: "ll-c-orange",
    amber: "ll-c-amber",
    yellow: "ll-c-yellow",
    lime: "ll-c-lime",
    emerald: "ll-c-emerald",
    teal: "ll-c-teal",
    cyan: "ll-c-cyan",
    sky: "ll-c-sky",
    blue: "ll-c-blue",
    indigo: "ll-c-indigo",
    violet: "ll-c-violet",
    purple: "ll-c-purple",
    pink: "ll-c-pink",
    slate: "ll-c-slate",
    gray: "ll-c-gray",
    white: "ll-c-white",
  };
  const highlightMeaningField = document.getElementById("id_highlight_meaning");
  const highlightMeaningWrap = document.getElementById("highlight-meaning-wrap");
  const toggleHighlightMeaningBtn = document.getElementById("toggle-highlight-meaning");
  const source = document.getElementById("highlight-source");
  const highlightForm = document.getElementById("highlight-form");
  const preview = document.getElementById("selected-preview");
  const highlightsList = document.getElementById("highlights-list");
  const highlightsEmpty = document.getElementById("highlights-empty");
  const highlightCount = document.getElementById("highlight-count");
  const toast = document.getElementById("toast");
  const audio = document.getElementById("chunk-audio");
  const csrf =
    saveForm?.querySelector("[name=csrfmiddlewaretoken]")?.value ||
    highlightForm?.querySelector("[name=csrfmiddlewaretoken]")?.value ||
    "";

  let stopTimer = null;
  let stopListener = null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showToast(message, isError) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove(
      "hidden",
      "border-emerald-500/40",
      "bg-emerald-500/15",
      "text-emerald-100",
      "border-rose-500/40",
      "bg-rose-500/15",
      "text-rose-100"
    );
    if (isError) {
      toast.classList.add("border-rose-500/40", "bg-rose-500/15", "text-rose-100");
    } else {
      toast.classList.add("border-emerald-500/40", "bg-emerald-500/15", "text-emerald-100");
    }
    toast.classList.remove("hidden");
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(() => toast.classList.add("hidden"), 2200);
  }

  function stopPreview() {
    if (stopTimer) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
    if (audio && stopListener) {
      audio.removeEventListener("timeupdate", stopListener);
      stopListener = null;
    }
    if (audio) {
      audio.pause();
    }
  }

  function playHighlightClip(startSec, endSec) {
    if (!audio || !audio.src) {
      showToast(t("no_audio_available_piece", "No audio available for this piece."), true);
      return;
    }
    const start = Number(startSec);
    const end = Number(endSec);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      showToast(t("set_start_end_first", "Set start and end times first."), true);
      return;
    }
    if (end < start) {
      showToast(t("end_gte_start", "End time must be >= start time."), true);
      return;
    }

    stopPreview();
    const playFrom = Math.max(0, start);
    audio.currentTime = playFrom;

    stopListener = () => {
      if (audio.currentTime >= end) {
        stopPreview();
      }
    };
    audio.addEventListener("timeupdate", stopListener);

    const durationMs = Math.max(50, (end - playFrom) * 1000 + 40);
    stopTimer = window.setTimeout(stopPreview, durationMs);

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        showToast(t("could_not_play_audio", "Could not play audio."), true);
        stopPreview();
      });
    }
  }

  function splitDisplayLines(text, displayLines, lineBreaks) {
    const breaks = [...(lineBreaks || [])]
      .map(Number)
      .filter((pos) => pos > 0 && pos < text.length)
      .sort((a, b) => a - b);
    if (breaks.length) {
      const lines = [];
      let prev = 0;
      breaks.forEach((br) => {
        const part = text.slice(prev, br).trim();
        if (part) lines.push({ text: part, offset: text.indexOf(part, prev) });
        prev = br;
      });
      const tail = text.slice(prev).trim();
      if (tail) lines.push({ text: tail, offset: text.indexOf(tail, prev) });
      return lines;
    }

    const count = Number(displayLines || 0);
    if (!count || count <= 1) {
      return [{ text, offset: 0 }];
    }
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [{ text, offset: 0 }];
    const n = Math.min(count, words.length);
    const lines = [];
    let index = 0;
    let remainingWords = words.length;
    let remainingLines = n;
    let searchFrom = 0;
    while (remainingLines > 0) {
      let take = Math.max(1, Math.round(remainingWords / remainingLines));
      take = Math.min(take, remainingWords - (remainingLines - 1));
      const lineText = words.slice(index, index + take).join(" ");
      const offset = text.indexOf(lineText, searchFrom);
      lines.push({ text: lineText, offset: offset < 0 ? searchFrom : offset });
      searchFrom = (offset < 0 ? searchFrom : offset) + lineText.length;
      index += take;
      remainingWords -= take;
      remainingLines -= 1;
    }
    return lines;
  }

  function paintSegment(text, absoluteOffset, highlights, colors) {
    const events = [];
    (highlights || []).forEach((h) => {
      if (h.end_char <= absoluteOffset || h.start_char >= absoluteOffset + text.length) return;
      events.push({
        start: Math.max(h.start_char, absoluteOffset) - absoluteOffset,
        end: Math.min(h.end_char, absoluteOffset + text.length) - absoluteOffset,
        kind: "highlight",
        id: h.id,
        meaning: h.meaning || "",
      });
    });
    (colors || []).forEach((c) => {
      if (c.end_char <= absoluteOffset || c.start_char >= absoluteOffset + text.length) return;
      events.push({
        start: Math.max(c.start_char, absoluteOffset) - absoluteOffset,
        end: Math.min(c.end_char, absoluteOffset + text.length) - absoluteOffset,
        kind: "color",
        color: (c.color || "").toLowerCase(),
      });
    });
    events.sort((a, b) => a.start - b.start || b.end - a.end);

    let html = "";
    let cursor = 0;
    events.forEach((ev) => {
      if (ev.start < cursor) return;
      html += escapeHtml(text.slice(cursor, ev.start));
      const snippet = escapeHtml(text.slice(ev.start, ev.end));
      if (ev.kind === "highlight") {
        const title = ev.meaning ? escapeHtml(ev.meaning) : t("highlighted", "Highlighted");
        html += `<mark class="chunk-mark" data-id="${ev.id}" title="${title}">${snippet}</mark>`;
      } else {
        const cls = COLOR_CLASS[ev.color];
        if (cls) html += `<span class="${cls}">${snippet}</span>`;
        else if (ev.color.startsWith("#")) html += `<span style="color:${escapeHtml(ev.color)}">${snippet}</span>`;
        else html += snippet;
      }
      cursor = ev.end;
    });
    html += escapeHtml(text.slice(cursor));
    return html;
  }

  function renderHighlightedText() {
    if (!source) return;
    const text = state.text || "";
    const lines = splitDisplayLines(text, state.display_lines, state.line_breaks);
    source.innerHTML =
      lines
        .map((line) => paintSegment(line.text, line.offset, state.highlights, state.color_spans))
        .join("<br>") || "&nbsp;";
  }

  function renderHighlightCards() {
    if (!highlightsList || !highlightsEmpty || !highlightCount) return;
    const items = state.highlights || [];
    highlightCount.textContent = t("n_highlights", "{n} highlights", { n: items.length });
    highlightsEmpty.classList.toggle("hidden", items.length > 0);
    const hasAudio = Boolean(state.audio_url || audio?.src);

    highlightsList.innerHTML = items
      .map((h) => {
        const startVal = h.start_sec != null ? h.start_sec : "";
        const endVal = h.end_sec != null ? h.end_sec : "";
        const canPlay = hasAudio && startVal !== "" && endVal !== "";
        return `
          <article class="rounded-xl border border-slate-800 bg-slate-950/50 p-4" data-highlight-id="${h.id}">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="font-medium text-amber-200">“${escapeHtml(h.text)}”</p>
                <p class="mt-1 text-xs text-slate-500">${t("check_sync", "Check sync with Play, then edit start/end if needed.")}</p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="play-highlight rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                  data-id="${h.id}"
                  ${canPlay ? "" : "disabled"}
                  title="${canPlay ? t("play_this_highlight", "Play this highlight clip") : t("set_times_to_play", "Set start/end times to play")}"
                >
                  ${t("play", "▶ Play")}
                </button>
                <button type="button" class="remove-highlight rounded-lg bg-rose-500/15 px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/25" data-id="${h.id}">
                  ${t("remove", "Remove")}
                </button>
              </div>
            </div>

            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">${t("start_sec", "Start (sec)")}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  class="start-input w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                  data-id="${h.id}"
                  value="${escapeHtml(String(startVal))}"
                />
              </div>
              <div>
                <label class="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">${t("end_sec", "End (sec)")}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  class="end-input w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                  data-id="${h.id}"
                  value="${escapeHtml(String(endVal))}"
                />
              </div>
            </div>

            <div class="mt-3 space-y-2">
              <label class="block text-xs font-medium uppercase tracking-wide text-slate-500">${t("meaning_optional", "Meaning (optional)")}</label>
              <textarea rows="2" class="meaning-input w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30" data-id="${h.id}" placeholder="${t("leave_empty_none", "Leave empty if none")}">${escapeHtml(h.meaning || "")}</textarea>
              <button type="button" class="save-highlight rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700" data-id="${h.id}">
                ${t("save_highlight", "Save highlight")}
              </button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function refreshUI() {
    if (textField && document.activeElement !== textField) {
      textField.value = state.text || "";
    }
    if (meaningField && document.activeElement !== meaningField) {
      meaningField.value = state.sentence_meaning || "";
    }
    if (displayLinesField && document.activeElement !== displayLinesField) {
      displayLinesField.value = state.display_lines != null ? state.display_lines : "";
    }
    if (audio && state.audio_url && audio.getAttribute("src") !== state.audio_url) {
      audio.src = state.audio_url;
    }
    renderHighlightedText();
    renderHighlightCards();
  }

  async function postForm(url, formData) {
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
    });
    let payload = {};
    try {
      payload = await response.json();
    } catch (_) {
      throw new Error("Server error. Please try again.");
    }
    if (!response.ok || !payload.ok) {
      throw new Error(
        payload.error || Object.values(payload.errors || {}).flat()[0] || "Request failed."
      );
    }
    return payload;
  }

  function selectionOffsets() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!source.contains(range.commonAncestorContainer)) return null;

    const preRange = range.cloneRange();
    preRange.selectNodeContents(source);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const selected = selection.toString();
    const end = start + selected.length;
    if (!selected.trim()) return null;
    return { start, end, selected };
  }

  function setSelectionFields(data) {
    document.getElementById("highlight-text").value = data?.selected || "";
    document.getElementById("highlight-start").value = data ? data.start : "";
    document.getElementById("highlight-end").value = data ? data.end : "";
    if (!preview) return;
    if (!data) {
      preview.textContent = t("select_word_phrase", "Select a word or phrase above");
      preview.className = "text-sm text-slate-400";
      return;
    }
    preview.textContent = `${t("selected_prefix", "Selected")}: “${data.selected.trim()}”`;
    preview.className = "text-sm text-amber-200";
  }

  if (toggleMeaningBtn && meaningWrap) {
    toggleMeaningBtn.addEventListener("click", () => {
      meaningWrap.classList.toggle("hidden");
      toggleMeaningBtn.textContent = meaningWrap.classList.contains("hidden")
        ? t("add_sentence_meaning", "Add sentence meaning")
        : t("hide", "Hide");
      if (!meaningWrap.classList.contains("hidden")) meaningField?.focus();
    });
  }

  function resetHighlightMeaningUI() {
    if (highlightMeaningField) highlightMeaningField.value = "";
    if (highlightMeaningWrap) highlightMeaningWrap.classList.add("hidden");
    if (toggleHighlightMeaningBtn) {
      toggleHighlightMeaningBtn.textContent = t("add_meaning_optional", "Add meaning (optional)");
    }
  }

  if (toggleHighlightMeaningBtn && highlightMeaningWrap) {
    toggleHighlightMeaningBtn.addEventListener("click", () => {
      highlightMeaningWrap.classList.toggle("hidden");
      const open = !highlightMeaningWrap.classList.contains("hidden");
      toggleHighlightMeaningBtn.textContent = open
        ? t("hide_meaning", "Hide meaning")
        : t("add_meaning_optional", "Add meaning (optional)");
      if (open) highlightMeaningField?.focus();
    });
  }

  if (source) {
    const autoCapture = () => {
      const data = selectionOffsets();
      if (data) setSelectionFields(data);
    };
    source.addEventListener("mouseup", autoCapture);
    source.addEventListener("keyup", autoCapture);
    source.addEventListener("touchend", () => setTimeout(autoCapture, 0));
  }

  if (textField) {
    textField.addEventListener("input", () => {
      state.text = textField.value;
      state.highlights = (state.highlights || []).filter(
        (h) => state.text.slice(h.start_char, h.end_char) === h.text
      );
      state.color_spans = (state.color_spans || []).filter(
        (c) => state.text.slice(c.start_char, c.end_char) === c.text
      );
      state.line_breaks = (state.line_breaks || []).filter(
        (pos) => pos > 0 && pos < state.text.length
      );
      renderHighlightedText();
      setSelectionFields(null);
    });
  }

  if (displayLinesField) {
    displayLinesField.addEventListener("input", () => {
      const raw = displayLinesField.value.trim();
      state.display_lines = raw ? Number(raw) : null;
      renderHighlightedText();
    });
  }

  if (saveForm) {
    saveForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const scrollY = window.scrollY;
      const data = new FormData(saveForm);
      try {
        const payload = await postForm(root.dataset.saveUrl, data);
        state = payload.chunk;
        refreshUI();
        showToast(payload.message || "Saved.");
      } catch (err) {
        showToast(err.message || "Could not save.", true);
      } finally {
        window.scrollTo({ top: scrollY });
      }
    });
  }

  if (highlightForm) {
    highlightForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const scrollY = window.scrollY;
      const data = selectionOffsets();
      if (data) setSelectionFields(data);
      if (!document.getElementById("highlight-text").value) {
        showToast("Select a word or phrase first.", true);
        return;
      }
      const formData = new FormData(highlightForm);
      try {
        const payload = await postForm(root.dataset.highlightAddUrl, formData);
        state = payload.chunk;
        highlightForm.reset();
        const csrfInput = highlightForm.querySelector("[name=csrfmiddlewaretoken]");
        if (csrfInput) csrfInput.value = csrf;
        resetHighlightMeaningUI();
        setSelectionFields(null);
        refreshUI();
        showToast(payload.message || "Highlight saved.");
      } catch (err) {
        showToast(err.message || "Could not save highlight.", true);
      } finally {
        window.scrollTo({ top: scrollY });
      }
    });
  }

  if (highlightsList) {
    highlightsList.addEventListener("click", async (event) => {
      const playBtn = event.target.closest(".play-highlight");
      const removeBtn = event.target.closest(".remove-highlight");
      const saveBtn = event.target.closest(".save-highlight");
      const scrollY = window.scrollY;

      if (playBtn) {
        const card = playBtn.closest("[data-highlight-id]");
        const start = card?.querySelector(".start-input")?.value;
        const end = card?.querySelector(".end-input")?.value;
        playHighlightClip(start, end);
        return;
      }

      if (removeBtn) {
        const id = removeBtn.dataset.id;
        const formData = new FormData();
        formData.append("csrfmiddlewaretoken", csrf);
        try {
          const payload = await postForm(`/highlights/${id}/delete/`, formData);
          state = payload.chunk;
          refreshUI();
          showToast(payload.message || "Highlight removed.");
        } catch (err) {
          showToast(err.message || "Could not remove highlight.", true);
        } finally {
          window.scrollTo({ top: scrollY });
        }
        return;
      }

      if (saveBtn) {
        const id = saveBtn.dataset.id;
        const card = saveBtn.closest("[data-highlight-id]");
        const meaning = card?.querySelector(".meaning-input")?.value || "";
        const start = card?.querySelector(".start-input")?.value || "";
        const end = card?.querySelector(".end-input")?.value || "";
        const formData = new FormData();
        formData.append("csrfmiddlewaretoken", csrf);
        formData.append("meaning", meaning);
        formData.append("start_sec", start);
        formData.append("end_sec", end);
        try {
          const payload = await postForm(`/highlights/${id}/update/`, formData);
          state = payload.chunk;
          refreshUI();
          showToast(payload.message || "Highlight saved.");
        } catch (err) {
          showToast(err.message || "Could not save highlight.", true);
        } finally {
          window.scrollTo({ top: scrollY });
        }
      }
    });

    // Live-enable Play when times are typed
    highlightsList.addEventListener("input", (event) => {
      const input = event.target.closest(".start-input, .end-input");
      if (!input) return;
      const card = input.closest("[data-highlight-id]");
      const playBtn = card?.querySelector(".play-highlight");
      if (!playBtn) return;
      const start = card.querySelector(".start-input")?.value;
      const end = card.querySelector(".end-input")?.value;
      const canPlay =
        Boolean(state.audio_url || audio?.src) &&
        start !== "" &&
        end !== "" &&
        Number(end) >= Number(start);
      playBtn.disabled = !canPlay;
    });
  }

  refreshUI();
})();
