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

  const root = document.getElementById("study-root");
  if (!root) return;

  const dataNode = document.getElementById("study-data");
  const lesson = dataNode ? JSON.parse(dataNode.textContent) : { chunks: [] };
  const allChunks = lesson.chunks || [];
  const csrf = root.dataset.csrf || "";

  const setupEl = document.getElementById("study-setup");
  const sessionEl = document.getElementById("study-session");
  const setupTotal = document.getElementById("setup-total");
  const setupTotalBig = document.getElementById("setup-total-big");
  const setupSelected = document.getElementById("setup-selected");
  const setupLevelStats = document.getElementById("setup-level-stats");
  const setupSelectAll = document.getElementById("setup-select-all");
  const setupClear = document.getElementById("setup-clear");
  const setupStartAll = document.getElementById("setup-start-all");
  const setupStartSelected = document.getElementById("setup-start-selected");
  const settingPlaybackRate = document.getElementById("setting-playback-rate");
  const settingPlaybackRateLabel = document.getElementById("setting-playback-rate-label");
  const settingAutoplay = document.getElementById("setting-autoplay");
  const settingsSaveBtn = document.getElementById("settings-save");
  const settingsStatus = document.getElementById("settings-status");

  const progressEl = document.getElementById("study-progress");
  const progressBar = document.getElementById("study-progress-bar");
  const textEl = document.getElementById("study-card-text");
  const sentenceMeaningEl = document.getElementById("study-sentence-meaning");
  const typeInput = document.getElementById("study-type-input");
  const typeHint = document.getElementById("study-type-hint");
  const speechBtn = document.getElementById("study-speech-btn");
  const speechLabel = document.getElementById("study-speech-label");
  const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const speechLang = root.dataset.speechLang || "en-US";
  let speechRecognition = null;
  let speechWanted = false;
  let speechUpdating = false;
  let speechBase = "";
  let speechUnsupportedNotified = false;
  const timerEl = document.getElementById("study-timer");
  const bestRecordEl = document.getElementById("study-best-record");
  const timerStatusEl = document.getElementById("study-timer-status");
  const resultPanel = document.getElementById("study-result-panel");
  const resultMain = document.getElementById("study-result-main");
  const resultCompare = document.getElementById("study-result-compare");
  const resultSuggest = document.getElementById("study-result-suggest");
  let resultToastTimer = 0;
  const playBtn = document.getElementById("study-play");
  const stopBtn = document.getElementById("study-stop");
  const meaningBtn = document.getElementById("study-toggle-meaning");
  const levelsEl = document.getElementById("study-levels");
  const levelStatus = document.getElementById("study-level-status");
  const prevBtn = document.getElementById("study-prev");
  const nextBtn = document.getElementById("study-next");
  const exitLink = document.getElementById("study-exit");
  const audio = document.getElementById("study-audio");

  let queue = [];
  let index = 0;
  let meaningOpen = false;
  let activeHighlightId = null;
  let activeHighlight = null;
  let revealedHighlightIds = new Set();
  let typedMatchedEnd = -1; // exclusive char offset covered by typed matches
  let typedMatchedHighlightIds = new Set(); // entered by typing (reveal)
  let typedCompleteHighlightIds = new Set(); // fully matched by typing (green)
  let stopTimer = null;
  let stopListener = null;
  let endedListener = null;

  let cardTimerStart = 0;
  let cardTimerRaf = null;
  let cardTimerRunning = false;
  let cardTimerStopped = false;
  let cardCompleted = false;
  let cardElapsedMs = 0;
  let studySettings = {
    playback_rate: 1,
    autoplay: false,
    ...(lesson.settings && typeof lesson.settings === "object" ? lesson.settings : {}),
  };
  // Selected filters: "unrated" + "1".."7"
  const selectedKeys = new Set();

  const COLOR_CLASS = {
    red: "mv-c-red",
    rose: "mv-c-rose",
    orange: "mv-c-orange",
    amber: "mv-c-amber",
    yellow: "mv-c-yellow",
    lime: "mv-c-lime",
    emerald: "mv-c-emerald",
    teal: "mv-c-teal",
    cyan: "mv-c-cyan",
    sky: "mv-c-sky",
    blue: "mv-c-blue",
    indigo: "mv-c-indigo",
    violet: "mv-c-violet",
    purple: "mv-c-purple",
    pink: "mv-c-pink",
    slate: "mv-c-slate",
    gray: "mv-c-gray",
    white: "mv-c-white",
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function chunkKey(chunk) {
    return chunk.study_level == null ? "unrated" : String(chunk.study_level);
  }

  function levelCounts() {
    const counts = { unrated: 0 };
    for (let level = 1; level <= 7; level += 1) counts[String(level)] = 0;
    allChunks.forEach((chunk) => {
      counts[chunkKey(chunk)] += 1;
    });
    return counts;
  }

  function countSelected() {
    return allChunks.filter((chunk) => selectedKeys.has(chunkKey(chunk))).length;
  }

  function currentChunk() {
    return queue[index] || null;
  }

  function levelUrl(chunkId) {
    const template = lesson.level_url_template || "";
    return template.replace("{id}", String(chunkId));
  }

  function recordUrl(chunkId) {
    const template = lesson.record_url_template || "";
    return template.replace("{id}", String(chunkId));
  }

  function formatMs(ms) {
    if (ms == null || !Number.isFinite(Number(ms))) return "—";
    return `${(Number(ms) / 1000).toFixed(2)}s`;
  }

  function suggestLevelLocal(text, timeMs) {
    const words = Math.max(1, String(text || "").trim().split(/\s+/).filter(Boolean).length);
    const seconds = Math.max(0.2, Number(timeMs) / 1000);
    let wpm = (words / seconds) * 60;
    if (words <= 4) wpm *= 0.85;
    else if (words <= 8) wpm *= 0.92;
    if (wpm >= 90) return 7;
    if (wpm >= 75) return 6;
    if (wpm >= 60) return 5;
    if (wpm >= 45) return 4;
    if (wpm >= 30) return 3;
    if (wpm >= 18) return 2;
    return 1;
  }

  function updateBestRecordLabel(chunk) {
    if (!bestRecordEl) return;
    bestRecordEl.textContent = `${t("best_label", "Best")}: ${formatMs(chunk?.best_type_ms)}`;
  }

  function setTimerDisplay(ms) {
    if (timerEl) timerEl.textContent = formatMs(ms);
  }

  function stopCardTimerLoop() {
    if (cardTimerRaf) {
      window.cancelAnimationFrame(cardTimerRaf);
      cardTimerRaf = null;
    }
  }

  function tickCardTimer() {
    if (!cardTimerRunning || cardTimerStopped) return;
    cardElapsedMs = Math.max(0, performance.now() - cardTimerStart);
    setTimerDisplay(cardElapsedMs);
    cardTimerRaf = window.requestAnimationFrame(tickCardTimer);
  }

  function resetCardTimerIdle() {
    stopCardTimerLoop();
    cardTimerStart = 0;
    cardElapsedMs = 0;
    cardTimerRunning = false;
    cardTimerStopped = false;
    cardCompleted = false;
    setTimerDisplay(0);
    if (timerStatusEl) {
      timerStatusEl.textContent = t("waiting_play_meaning", "Waiting for Play or Show meaning…");
    }
    hideCompletionResult();
  }

  function hideCompletionResult() {
    if (resultToastTimer) {
      window.clearTimeout(resultToastTimer);
      resultToastTimer = 0;
    }
    if (!resultPanel) return;
    resultPanel.classList.remove("is-visible");
    resultPanel.classList.add("hidden");
  }

  function ensureCardTimerStarted() {
    if (cardCompleted || cardTimerRunning || cardTimerStopped) return;
    stopCardTimerLoop();
    cardTimerStart = performance.now();
    cardElapsedMs = 0;
    cardTimerRunning = true;
    cardTimerStopped = false;
    setTimerDisplay(0);
    if (timerStatusEl) timerStatusEl.textContent = t("running", "Running…");
    tickCardTimer();
  }

  function freezeCardTimer() {
    if (!cardTimerRunning || cardTimerStopped) return cardElapsedMs;
    stopCardTimerLoop();
    cardElapsedMs = Math.max(1, Math.round(performance.now() - cardTimerStart));
    cardTimerRunning = false;
    cardTimerStopped = true;
    setTimerDisplay(cardElapsedMs);
    if (timerStatusEl) timerStatusEl.textContent = t("stopped", "Stopped");
    return cardElapsedMs;
  }

  function getPlaybackRate() {
    const rate = Number(studySettings.playback_rate);
    if (!Number.isFinite(rate)) return 1;
    return Math.max(0.5, Math.min(2, rate));
  }

  function applyAudioRate() {
    if (audio) audio.playbackRate = getPlaybackRate();
  }

  function syncSettingsForm() {
    const rate = getPlaybackRate();
    studySettings.playback_rate = rate;
    studySettings.autoplay = Boolean(studySettings.autoplay);
    if (settingPlaybackRate) settingPlaybackRate.value = String(rate);
    if (settingPlaybackRateLabel) {
      settingPlaybackRateLabel.textContent = `${rate.toFixed(2)}×`;
    }
    if (settingAutoplay) settingAutoplay.checked = Boolean(studySettings.autoplay);
  }

  async function saveStudySettings() {
    if (!lesson.settings_url) {
      if (settingsStatus) settingsStatus.textContent = t("settings_url_missing", "Settings URL missing.");
      return;
    }
    const formData = new FormData();
    formData.append("playback_rate", String(getPlaybackRate()));
    formData.append("autoplay", studySettings.autoplay ? "1" : "0");
    formData.append("csrfmiddlewaretoken", csrf);
    if (settingsStatus) settingsStatus.textContent = t("saving", "Saving…");
    try {
      const response = await fetch(lesson.settings_url, {
        method: "POST",
        body: formData,
        headers: { "X-Requested-With": "XMLHttpRequest", "X-CSRFToken": csrf },
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || t("could_not_save_settings", "Could not save settings."));
      }
      studySettings = { ...studySettings, ...(payload.settings || {}) };
      lesson.settings = studySettings;
      syncSettingsForm();
      applyAudioRate();
      if (settingsStatus) settingsStatus.textContent = t("settings_saved_for_lesson", "Settings saved for this lesson.");
    } catch (err) {
      if (settingsStatus) {
        settingsStatus.textContent = err.message || t("could_not_save_settings", "Could not save settings.");
      }
    }
  }

  async function saveTypingRecord(timeMs) {
    const chunk = currentChunk();
    if (!chunk) return;
    const previousBest = chunk.best_type_ms;
    const formData = new FormData();
    formData.append("time_ms", String(timeMs));
    formData.append("csrfmiddlewaretoken", csrf);
    try {
      const response = await fetch(recordUrl(chunk.id), {
        method: "POST",
        body: formData,
        headers: { "X-Requested-With": "XMLHttpRequest", "X-CSRFToken": csrf },
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || t("could_not_save_record", "Could not save record."));
      }
      chunk.best_type_ms = payload.best_type_ms;
      const original = allChunks.find((item) => item.id === chunk.id);
      if (original) original.best_type_ms = payload.best_type_ms;
      updateBestRecordLabel(chunk);
      showCompletionResult({
        timeMs: payload.time_ms,
        previousBestMs: payload.previous_best_ms ?? previousBest,
        bestMs: payload.best_type_ms,
        isNewBest: payload.is_new_best,
        suggestedLevel: payload.suggested_level,
      });
      if (payload.suggested_level) {
        if (levelStatus) {
          levelStatus.textContent = `${t("suggested_level", "Suggested level")}: ${payload.suggested_level}/7`;
        }
      }
    } catch (err) {
      const suggested = suggestLevelLocal(chunk.text || "", timeMs);
      showCompletionResult({
        timeMs,
        previousBestMs: previousBest,
        bestMs: previousBest != null ? Math.min(previousBest, timeMs) : timeMs,
        isNewBest: previousBest == null || timeMs < previousBest,
        suggestedLevel: suggested,
      });
      if (levelStatus) {
        levelStatus.textContent = err.message || t("record_saved_local", "Record saved locally only.");
      }
    }
  }

  function showCompletionResult({ timeMs, previousBestMs, bestMs, isNewBest, suggestedLevel }) {
    if (!resultPanel) return;
    if (resultToastTimer) {
      window.clearTimeout(resultToastTimer);
      resultToastTimer = 0;
    }
    if (resultMain) {
      resultMain.textContent = `${t("completed_in", "Completed in")} ${formatMs(timeMs)}`;
    }
    if (resultCompare) {
      if (previousBestMs == null) {
        resultCompare.textContent = `${t("first_record_saved", "First record saved · Best")}: ${formatMs(bestMs)}`;
      } else if (isNewBest) {
        const gained = previousBestMs - timeMs;
        resultCompare.textContent = `${t("new_best", "New best!")} ${formatMs(gained)} ${t("faster_than", "faster than")} ${formatMs(previousBestMs)}`;
      } else {
        const slower = timeMs - previousBestMs;
        resultCompare.textContent = `${t("best_stays", "Best stays")} ${formatMs(bestMs)} · ${t("this_run_slower", "this run was")} ${formatMs(slower)} ${t("slower", "slower")}`;
      }
    }
    if (resultSuggest) {
      resultSuggest.textContent = t("suggested_tap", "Suggested level: {n}/7 · tap it below to save", { n: suggestedLevel });
    }
    resultPanel.classList.remove("hidden");
    // Next frame so the enter transition runs after display flips on.
    window.requestAnimationFrame(function () {
      resultPanel.classList.add("is-visible");
    });
    resultToastTimer = window.setTimeout(hideCompletionResult, 5200);
    const chunk = currentChunk();
    if (chunk) renderLevels(chunk, suggestedLevel);
  }

  function normalizeWord(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const rows = a.length + 1;
    const cols = b.length + 1;
    const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
    for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[a.length][b.length];
  }

  function fuzzyTolerance(len) {
    if (len <= 2) return 0;
    if (len <= 6) return 1;
    if (len <= 14) return 2;
    return Math.min(3, Math.max(2, Math.floor(len * 0.12)));
  }

  function wordSpans(text) {
    const out = [];
    const re = /\S+/g;
    let match;
    while ((match = re.exec(text || ""))) {
      out.push({
        index: out.length,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
    }
    return out;
  }

  // Hard gate: first 1–2 letters of this word must be exact, then fuzzy is allowed.
  function headLettersOk(typedNorm, expectedNorm) {
    if (!typedNorm || !expectedNorm) return false;
    if (typedNorm[0] !== expectedNorm[0]) return false;
    if (typedNorm.length === 1) return true;
    if (expectedNorm.length === 1) return typedNorm[0] === expectedNorm[0];
    return typedNorm[1] === expectedNorm[1];
  }

  function wordFullyMatches(typedNorm, expectedNorm) {
    if (!headLettersOk(typedNorm, expectedNorm)) return false;
    if (typedNorm === expectedNorm) return true;
    const dist = levenshtein(typedNorm, expectedNorm);
    return dist <= fuzzyTolerance(Math.max(typedNorm.length, expectedNorm.length));
  }

  function wordPartialMatches(typedNorm, expectedNorm) {
    if (!headLettersOk(typedNorm, expectedNorm)) return false;
    if (expectedNorm.startsWith(typedNorm)) return true;
    // Allow tiny typos while still typing the same word (never another word)
    const limit = Math.min(expectedNorm.length, typedNorm.length + 1);
    for (let len = Math.min(expectedNorm.length, Math.max(typedNorm.length - 1, 2)); len <= limit; len += 1) {
      const prefix = expectedNorm.slice(0, len);
      if (!headLettersOk(typedNorm.slice(0, Math.min(2, typedNorm.length)), prefix)) continue;
      const dist = levenshtein(typedNorm, prefix);
      if (dist <= fuzzyTolerance(Math.max(typedNorm.length, len))) return true;
    }
    return false;
  }

  // Try to consume expected word using one or more typed tokens ("a"+"j" → "AJ").
  function matchExpectedWithTypedTokens(expectedNorm, typedNorms, startIndex, allowPartial) {
    if (startIndex >= typedNorms.length) return null;

    let merged = "";
    const maxParts = Math.min(typedNorms.length - startIndex, Math.max(expectedNorm.length, 3));
    for (let parts = 1; parts <= maxParts; parts += 1) {
      merged += typedNorms[startIndex + parts - 1] || "";
      if (!merged) continue;

      if (wordFullyMatches(merged, expectedNorm)) {
        return { typedConsumed: parts, partial: false, matchedNormLen: expectedNorm.length };
      }

      const usedAllRemaining = startIndex + parts >= typedNorms.length;
      if (allowPartial && usedAllRemaining && wordPartialMatches(merged, expectedNorm)) {
        let covered = Math.min(merged.length, expectedNorm.length);
        if (!expectedNorm.startsWith(merged)) {
          covered = Math.min(expectedNorm.length, Math.max(2, merged.length));
          while (
            covered > 2 &&
            levenshtein(merged, expectedNorm.slice(0, covered)) >
              fuzzyTolerance(Math.max(merged.length, covered))
          ) {
            covered -= 1;
          }
        }
        return { typedConsumed: parts, partial: true, matchedNormLen: covered };
      }

      // If merged already diverges on the required head, stop growing
      if (merged.length >= 2 && !headLettersOk(merged, expectedNorm)) return null;
    }
    return null;
  }

  function computeTypingProgress(typed, cardText) {
    const expectedWords = wordSpans(cardText);
    const typedRaw = String(typed || "");
    const typedParts = typedRaw.trim() ? typedRaw.trim().split(/\s+/) : [];
    const typedNorms = typedParts.map(normalizeWord).filter(Boolean);
    const endsWithSpace = /\s$/.test(typedRaw);

    let expIndex = 0;
    let typedIndex = 0;
    let matchedEnd = -1;
    let matchedWords = 0;

    while (expIndex < expectedWords.length && typedIndex < typedNorms.length) {
      const expectedNorm = normalizeWord(expectedWords[expIndex].text);
      if (!expectedNorm) {
        expIndex += 1;
        continue;
      }

      // Partial only for the unfinished last typed token — never skip ahead to later words
      const allowPartial = !endsWithSpace && typedIndex === typedNorms.length - 1;
      const result = matchExpectedWithTypedTokens(
        expectedNorm,
        typedNorms,
        typedIndex,
        allowPartial
      );

      if (!result) break;

      if (result.partial) {
        let seen = 0;
        let cutAt = expectedWords[expIndex].start;
        const wordText = expectedWords[expIndex].text;
        for (let i = 0; i < wordText.length; i += 1) {
          const piece = normalizeWord(wordText[i]);
          if (!piece) continue;
          seen += piece.length;
          cutAt = expectedWords[expIndex].start + i + 1;
          if (seen >= result.matchedNormLen) break;
        }
        matchedEnd = cutAt;
        break;
      }

      matchedEnd = expectedWords[expIndex].end;
      matchedWords = expIndex + 1;
      typedIndex += result.typedConsumed;
      expIndex += 1;
    }

    // Only unlock a highlight when the whole phrase is matched (fully green).
    const highlightIds = new Set();
    const typedCompleteHighlightIds = new Set();
    const chunk = currentChunk();
    (chunk?.highlights || []).forEach((h) => {
      if (matchedEnd >= 0 && matchedEnd >= h.end_char) {
        highlightIds.add(h.id);
        typedCompleteHighlightIds.add(h.id);
      }
    });

    return {
      matched: matchedWords,
      matchedEnd,
      highlightIds,
      typedCompleteHighlightIds,
      expectedCount: expectedWords.length,
      matchedNormLen: matchedWords,
      expectedNormLen: expectedWords.length,
    };
  }

  // Character-level green progress (updates on every keystroke, including mid-word)
  function paintPlainMatched(text, absoluteOffset) {
    if (!text) return "";
    if (typedMatchedEnd < 0) return escapeHtml(text);

    const absStart = absoluteOffset;
    const absEnd = absoluteOffset + text.length;
    if (typedMatchedEnd <= absStart) return escapeHtml(text);
    if (typedMatchedEnd >= absEnd) {
      return `<span class="study-typed-ok">${escapeHtml(text)}</span>`;
    }
    const cut = typedMatchedEnd - absStart;
    return (
      `<span class="study-typed-ok">${escapeHtml(text.slice(0, cut))}</span>` +
      escapeHtml(text.slice(cut))
    );
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
    if (!count || count <= 1) return [{ text, offset: 0 }];
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return [{ text, offset: 0 }];
    const n = Math.min(count, words.length);
    const lines = [];
    let wordIndex = 0;
    let remainingWords = words.length;
    let remainingLines = n;
    let searchFrom = 0;
    while (remainingLines > 0) {
      let take = Math.max(1, Math.round(remainingWords / remainingLines));
      take = Math.min(take, remainingWords - (remainingLines - 1));
      const lineText = words.slice(wordIndex, wordIndex + take).join(" ");
      const offset = text.indexOf(lineText, searchFrom);
      lines.push({ text: lineText, offset: offset < 0 ? searchFrom : offset });
      searchFrom = (offset < 0 ? searchFrom : offset) + lineText.length;
      wordIndex += take;
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
        start_sec: h.start_sec,
        end_sec: h.end_sec,
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
    let occupied = -1;
    events.forEach((ev) => {
      if (ev.start < occupied) return;
      html += paintPlainMatched(text.slice(cursor, ev.start), absoluteOffset + cursor);
      const snippet = escapeHtml(text.slice(ev.start, ev.end));
      if (ev.kind === "highlight") {
        const typedOk = typedCompleteHighlightIds.has(ev.id);
        const revealed =
          typedOk ||
          typedMatchedHighlightIds.has(ev.id) ||
          revealedHighlightIds.has(ev.id);
        const open = activeHighlightId === ev.id;
        const stateClass = typedOk
          ? " is-revealed is-typed"
          : revealed
            ? " is-revealed"
            : " is-hidden";
        // Keep the real word in the DOM so Show/Hide never changes layout width.
        const meaning = (ev.meaning || "").trim();
        const canPlay =
          Boolean(currentChunk()?.audio_url) &&
          Number.isFinite(Number(ev.start_sec)) &&
          Number.isFinite(Number(ev.end_sec)) &&
          Number(ev.end_sec) >= Number(ev.start_sec);
        html +=
          `<span class="study-hl-wrap${open ? " is-open" : ""}" data-id="${ev.id}">` +
          `<mark class="study-mark${stateClass}" data-id="${ev.id}" title="${
            typedOk
              ? t("matched_by_typing", "Matched by typing")
              : revealed
                ? t("highlighted_word", "Highlighted word")
                : t("hidden_word_tap", "Hidden word — tap for options")
          }"><span class="study-word-text">${snippet}</span></mark>` +
          `<span class="study-hl-pop" role="dialog" aria-label="Highlight tools">` +
          `<span class="study-hl-actions">` +
          `<button type="button" class="hl-reveal" data-id="${ev.id}">${
            revealed ? t("hide", "Hide") : t("show", "Show")
          }</button>` +
          `<button type="button" class="hl-play" data-id="${ev.id}" ${
            canPlay ? "" : "disabled"
          } title="${canPlay ? t("play_word", "Play word") : t("no_synced_audio", "No synced audio")}">${t("play", "▶ Play")}</button>` +
          `</span>` +
          `<span class="study-hl-meaning${meaning ? "" : " is-empty"}" dir="auto">${
            meaning ? escapeHtml(meaning) : t("no_meaning", "No meaning")
          }</span>` +
          `</span></span>`;
      } else {
        const cls = COLOR_CLASS[ev.color];
        const painted = paintPlainMatched(
          text.slice(ev.start, ev.end),
          absoluteOffset + ev.start
        );
        if (cls) html += `<span class="${cls}">${painted}</span>`;
        else if (ev.color.startsWith("#")) {
          html += `<span style="color:${escapeHtml(ev.color)}">${painted}</span>`;
        } else html += painted;
      }
      cursor = ev.end;
      occupied = ev.end;
    });
    html += paintPlainMatched(text.slice(cursor), absoluteOffset + cursor);
    return html;
  }

  function applyTypingFromInput() {
    const chunk = currentChunk();
    if (!chunk) return;
    const typed = typeInput ? typeInput.value : "";
    const progress = computeTypingProgress(typed, chunk.text || "");
    typedMatchedEnd = progress.matchedEnd;
    typedMatchedHighlightIds = progress.highlightIds;
    typedCompleteHighlightIds = progress.typedCompleteHighlightIds;
    progress.highlightIds.forEach((id) => revealedHighlightIds.add(id));

    const fullyGreen =
      progress.expectedNormLen > 0 &&
      progress.matchedNormLen >= progress.expectedNormLen;

    if (typeHint) {
      if (fullyGreen) {
        typeHint.textContent = t("nice_match", "Nice — this card matches.");
      } else {
        typeHint.textContent = t("live_match", "Live match {matched} / {expected} words · updates as you type", { matched: progress.matched, expected: progress.expectedCount });
      }
    }
    renderCardText();

    if (fullyGreen && !cardCompleted) {
      cardCompleted = true;
      const timeMs = freezeCardTimer();
      stopSpeechRecognition({ keepHint: true });
      if (typeInput) typeInput.blur();
      saveTypingRecord(timeMs);
    }
  }

  function setSpeechUi(listening) {
    if (!speechBtn) return;
    speechBtn.classList.toggle("is-listening", listening);
    speechBtn.setAttribute("aria-pressed", listening ? "true" : "false");
    speechBtn.title = listening
      ? t("speech_stop", "Stop mic")
      : t("speech_start", "Speak");
    if (speechLabel) {
      speechLabel.textContent = listening
        ? t("speech_stop", "Stop mic")
        : t("speech_start", "Speak");
    }
  }

  function setTypeInputFromSpeech(value) {
    if (!typeInput) return;
    speechUpdating = true;
    typeInput.value = value;
    applyTypingFromInput();
    speechUpdating = false;
  }

  function stopSpeechRecognition(opts) {
    const keepHint = Boolean(opts && opts.keepHint);
    speechWanted = false;
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch (_) {
        /* ignore */
      }
    }
    setSpeechUi(false);
    if (!keepHint && typeHint && !cardCompleted) {
      typeHint.textContent = t(
        "type_hint",
        "Matching words turn green. Minor typos are OK. Highlights unlock when you reach them."
      );
    }
  }

  function ensureSpeechRecognition() {
    if (!SpeechRecognitionCtor) return null;
    if (speechRecognition) return speechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = speechLang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setSpeechUi(true);
      if (typeHint) {
        typeHint.textContent = t("speech_listening", "Listening… speak the card text");
      }
    };

    recognition.onresult = (event) => {
      let finals = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript || "";
        if (event.results[i].isFinal) finals += piece;
        else interim += piece;
      }
      if (finals) {
        const joined = [speechBase.trim(), finals.trim()].filter(Boolean).join(" ");
        speechBase = joined ? `${joined} ` : "";
        setTypeInputFromSpeech(speechBase);
        return;
      }
      if (interim) {
        const joined = [speechBase.trim(), interim.trim()].filter(Boolean).join(" ");
        setTypeInputFromSpeech(joined);
      }
    };

    recognition.onerror = (event) => {
      const err = (event && event.error) || "";
      if (err === "aborted" || err === "no-speech") return;
      if (err === "not-allowed" || err === "service-not-allowed") {
        speechWanted = false;
        setSpeechUi(false);
        if (typeHint) {
          typeHint.textContent = t(
            "speech_denied",
            "Microphone permission denied. Allow mic access and try again."
          );
        }
        return;
      }
      if (typeHint) {
        typeHint.textContent = t(
          "speech_error",
          "Could not hear clearly. Tap Speak and try again."
        );
      }
    };

    recognition.onend = () => {
      if (!speechWanted) {
        setSpeechUi(false);
        return;
      }
      // Chrome ends sessions after pauses — keep listening for shadowing.
      window.setTimeout(() => {
        if (!speechWanted || !speechRecognition) return;
        try {
          speechRecognition.start();
        } catch (_) {
          /* already started */
        }
      }, 120);
    };

    speechRecognition = recognition;
    return recognition;
  }

  function startSpeechRecognition() {
    if (!SpeechRecognitionCtor) {
      if (typeHint) {
        typeHint.textContent = t(
          "speech_unsupported",
          "Speech-to-text needs Chrome or Edge (with microphone permission)."
        );
      }
      if (speechBtn && !speechUnsupportedNotified) {
        speechBtn.disabled = true;
        speechUnsupportedNotified = true;
      }
      return;
    }
    const recognition = ensureSpeechRecognition();
    if (!recognition || !typeInput) return;
    const current = typeInput.value || "";
    speechBase = current && !/\s$/.test(current) ? `${current} ` : current;
    speechWanted = true;
    setSpeechUi(true);
    try {
      recognition.start();
    } catch (_) {
      /* already started */
    }
  }

  function toggleSpeechRecognition() {
    if (speechWanted) stopSpeechRecognition();
    else startSpeechRecognition();
  }

  function setPlayingUI(isPlaying) {
    if (stopBtn) stopBtn.disabled = !isPlaying;
    if (playBtn && currentChunk()?.audio_url) {
      playBtn.textContent = isPlaying ? t("playing", "▶ Playing…") : t("play_card", "▶ Play card");
    }
  }

  function stopAudio() {
    if (stopTimer) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
    if (audio && stopListener) {
      audio.removeEventListener("timeupdate", stopListener);
      stopListener = null;
    }
    if (audio && endedListener) {
      audio.removeEventListener("ended", endedListener);
      endedListener = null;
    }
    if (!audio) {
      setPlayingUI(false);
      return;
    }
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch (_) {
      /* ignore */
    }
    setPlayingUI(false);
  }

  function ensureCardAudio(chunk) {
    if (!audio || !chunk?.audio_url) return false;
    if (audio.getAttribute("src") !== chunk.audio_url) {
      audio.src = chunk.audio_url;
    }
    return true;
  }

  function playFullCard({ startTimer = true } = {}) {
    const chunk = currentChunk();
    if (!ensureCardAudio(chunk)) return;
    if (startTimer) ensureCardTimerStarted();
    stopAudio();
    applyAudioRate();
    endedListener = () => {
      endedListener = null;
      setPlayingUI(false);
    };
    audio.addEventListener("ended", endedListener);
    const playPromise = audio.play();
    setPlayingUI(true);
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        stopAudio();
        if (levelStatus) levelStatus.textContent = t("could_not_play_audio", "Could not play audio.");
      });
    }
  }

  function playHighlightClip(highlight) {
    const chunk = currentChunk();
    if (!highlight || !ensureCardAudio(chunk)) {
      if (levelStatus) levelStatus.textContent = t("no_audio_card", "No audio available for this card.");
      return;
    }
    const start = Number(highlight.start_sec);
    const end = Number(highlight.end_sec);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      if (levelStatus) {
        levelStatus.textContent = t("no_highlight_times", "This highlight has no synced audio times yet.");
      }
      return;
    }

    stopAudio();
    applyAudioRate();
    const playFrom = Math.max(0, start);
    const finishAt = end;
    const seekAndPlay = () => {
      try {
        audio.currentTime = playFrom;
      } catch (_) {
        /* ignore */
      }
      stopListener = () => {
        if (audio.currentTime >= finishAt) stopAudio();
      };
      audio.addEventListener("timeupdate", stopListener);
      const durationMs = Math.max(
        50,
        ((finishAt - playFrom) * 1000) / getPlaybackRate() + 40
      );
      stopTimer = window.setTimeout(stopAudio, durationMs);
      const playPromise = audio.play();
      setPlayingUI(true);
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          stopAudio();
          if (levelStatus) levelStatus.textContent = t("could_not_play_hl", "Could not play highlight audio.");
        });
      }
    };

    if (audio.readyState >= 1) seekAndPlay();
    else {
      const onReady = () => {
        audio.removeEventListener("loadedmetadata", onReady);
        seekAndPlay();
      };
      audio.addEventListener("loadedmetadata", onReady);
      audio.load();
    }
  }

  function renderCardText() {
    const chunk = currentChunk();
    if (!chunk || !textEl) return;
    const lines = splitDisplayLines(chunk.text || "", chunk.display_lines, chunk.line_breaks);
    textEl.innerHTML =
      lines
        .map((line) => {
          const painted = paintSegment(
            line.text,
            line.offset,
            chunk.highlights,
            chunk.color_spans
          );
          return `<div class="study-line">${painted || "&nbsp;"}</div>`;
        })
        .join("") || '<div class="study-line">&nbsp;</div>';
  }

  function findHighlight(id) {
    const chunk = currentChunk();
    if (!chunk) return null;
    return (chunk.highlights || []).find((item) => item.id === Number(id)) || null;
  }

  function setActiveHighlight(highlight, { rerender = true } = {}) {
    activeHighlight = highlight || null;
    activeHighlightId = highlight ? highlight.id : null;
    if (rerender) renderCardText();
    else if (textEl) {
      textEl.querySelectorAll(".study-hl-wrap").forEach((node) => {
        node.classList.toggle(
          "is-open",
          activeHighlightId != null && Number(node.dataset.id) === activeHighlightId
        );
      });
    }
  }

  function updateSetupSelected() {
    const selected = countSelected();
    if (setupSelected) setupSelected.textContent = String(selected);
    if (setupStartSelected) setupStartSelected.disabled = selected === 0;
  }

  function renderSetup() {
    const total = allChunks.length;
    const counts = levelCounts();
    if (setupTotal) setupTotal.textContent = String(total);
    if (setupTotalBig) setupTotalBig.textContent = String(total);
    const lead = document.getElementById("study-setup-lead");
    if (lead && lead.dataset.template) {
      lead.innerHTML = lead.dataset.template.split("{n}").join(
        `<span id="setup-total" class="font-medium text-emerald-300">${total}</span>`
      );
    }

    if (!setupLevelStats) return;
    const rows = [];

    const unrated = counts.unrated || 0;
    rows.push({
      key: "unrated",
      label: t("no_level_yet", "No level yet"),
      hint: t("not_rated", "Not rated"),
      count: unrated,
    });
    for (let level = 1; level <= 7; level += 1) {
      rows.push({
        key: String(level),
        label: t("level_label", "Level {n}", { n: level }),
        hint: level === 1 ? t("just_starting", "Just starting") : level === 7 ? t("knows_very_well", "Knows very well") : "",
        count: counts[String(level)] || 0,
      });
    }

    setupLevelStats.innerHTML = rows
      .map((row) => {
        const disabled = row.count === 0;
        const checked = !disabled && selectedKeys.has(row.key);
        return `
          <label class="setup-level-row flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 ${
            disabled ? "is-disabled" : ""
          }">
            <span class="flex min-w-0 items-center gap-3">
              <input
                type="checkbox"
                class="setup-level-check h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
                data-key="${row.key}"
                ${checked ? "checked" : ""}
                ${disabled ? "disabled" : ""}
              />
              <span>
                <span class="block text-sm font-medium text-slate-100">${escapeHtml(row.label)}</span>
                ${
                  row.hint
                    ? `<span class="block text-xs text-slate-500">${escapeHtml(row.hint)}</span>`
                    : ""
                }
              </span>
            </span>
            <span class="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">${
              row.count === 1
                ? t("card_count", "{n} card", { n: row.count })
                : t("cards_count", "{n} cards", { n: row.count })
            }</span>
          </label>
        `;
      })
      .join("");

    updateSetupSelected();
  }

  function startSession(filterKeys) {
    if (filterKeys === "all") {
      queue = [...allChunks];
    } else {
      const keys = new Set(filterKeys);
      queue = allChunks.filter((chunk) => keys.has(chunkKey(chunk)));
    }
    if (!queue.length) return;

    index = 0;
    meaningOpen = false;
    activeHighlightId = null;
    activeHighlight = null;
    revealedHighlightIds = new Set();
    if (setupEl) setupEl.classList.add("hidden");
    if (sessionEl) sessionEl.classList.remove("hidden");
    renderCard();
  }

  function renderLevels(chunk, suggestedLevel) {
    if (!levelsEl) return;
    const current = chunk.study_level != null ? Number(chunk.study_level) : null;
    const suggested = suggestedLevel != null ? Number(suggestedLevel) : null;
    levelsEl.innerHTML = Array.from({ length: 7 }, (_, i) => {
      const level = i + 1;
      const active = current === level ? " is-active" : "";
      const suggest =
        suggested === level && current !== level ? " is-suggested" : "";
      return `<button type="button" class="level-btn${active}${suggest}" data-level="${level}" aria-pressed="${current === level ? "true" : "false"}">${level}</button>`;
    }).join("");
    if (levelStatus) {
      if (suggested != null && current !== suggested) {
        levelStatus.textContent =
          current != null
            ? t("saved_level", "Saved: {n}", { n: current }) + ` · ${t("suggested_level", "Suggested")}: ${suggested}`
            : t("suggested_tap_short", "Suggested {n} · tap to save", { n: suggested });
      } else if (current != null) {
        levelStatus.textContent = t("saved_level", "Saved: {n}", { n: current });
      } else {
        levelStatus.textContent = t("no_level_saved_short", "Not set yet");
      }
    }
  }

  function renderCard() {
    const chunk = currentChunk();
    if (!chunk) {
      if (textEl) textEl.innerHTML = `<span class='text-slate-500'>${t("no_cards_session", "No cards in this session.")}</span>`;
      stopCardTimerLoop();
      return;
    }

    meaningOpen = false;
    stopAudio();
    stopSpeechRecognition({ keepHint: true });
    revealedHighlightIds = new Set();
    typedMatchedEnd = -1;
    typedMatchedHighlightIds = new Set();
    typedCompleteHighlightIds = new Set();
    activeHighlight = null;
    activeHighlightId = null;
    speechBase = "";
    if (typeInput) typeInput.value = "";
    if (typeHint) {
      typeHint.textContent =
        t("type_hint", "Matching words turn green. Minor typos are OK. Highlights unlock when you reach them.");
    }
    hideSentenceMeaningToast({ resetText: true, text: chunk.sentence_meaning || "" });

    updateBestRecordLabel(chunk);
    resetCardTimerIdle();
    renderCardText();

    if (progressEl) {
      progressEl.textContent = t("card_of", "Card {current} of {total}", { current: index + 1, total: queue.length });
    }
    if (progressBar) {
      progressBar.style.width = `${((index + 1) / Math.max(queue.length, 1)) * 100}%`;
    }

    if (playBtn) {
      playBtn.disabled = !chunk.audio_url;
      playBtn.textContent = chunk.audio_url ? t("play_card", "▶ Play card") : t("no_audio", "No audio");
    }
    if (meaningBtn) {
      const hasMeaning = Boolean((chunk.sentence_meaning || "").trim());
      meaningBtn.disabled = !hasMeaning;
      meaningBtn.textContent = hasMeaning ? t("show_meaning", "Show meaning") : t("no_sentence_meaning", "No sentence meaning");
    }
    if (prevBtn) prevBtn.disabled = index <= 0;
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.textContent = index >= queue.length - 1 ? t("finish", "Finish") : t("next", "Next →");
    }

    if (audio) {
      stopAudio();
      if (chunk.audio_url) {
        audio.src = chunk.audio_url;
      } else {
        audio.removeAttribute("src");
        audio.load();
      }
      applyAudioRate();
    }

    renderLevels(chunk);
    if (typeInput) {
      window.setTimeout(() => typeInput.focus(), 30);
    }

    if (studySettings.autoplay && chunk.audio_url) {
      window.setTimeout(() => playFullCard({ startTimer: false }), 40);
    }
  }

  async function saveLevel(level) {
    const chunk = currentChunk();
    if (!chunk) return;
    const formData = new FormData();
    formData.append("study_level", String(level));
    formData.append("csrfmiddlewaretoken", csrf);
    try {
      const response = await fetch(levelUrl(chunk.id), {
        method: "POST",
        body: formData,
        headers: { "X-Requested-With": "XMLHttpRequest", "X-CSRFToken": csrf },
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || t("could_not_save_level", "Could not save level."));
      }
      chunk.study_level = payload.study_level;
      // Keep the same object in allChunks in sync
      const original = allChunks.find((item) => item.id === chunk.id);
      if (original) original.study_level = payload.study_level;
      renderLevels(chunk);
    } catch (err) {
      if (levelStatus) levelStatus.textContent = err.message || t("could_not_save_level", "Could not save level.");
    }
  }

  if (exitLink && lesson.exit_url) {
    exitLink.setAttribute("href", lesson.exit_url);
  }

  // Default: select every level that has cards
  const initialCounts = levelCounts();
  Object.keys(initialCounts).forEach((key) => {
    if (initialCounts[key] > 0) selectedKeys.add(key);
  });
  renderSetup();

  if (setupLevelStats) {
    setupLevelStats.addEventListener("change", (event) => {
      const input = event.target.closest(".setup-level-check");
      if (!input || input.disabled) return;
      if (input.checked) selectedKeys.add(input.dataset.key);
      else selectedKeys.delete(input.dataset.key);
      updateSetupSelected();
    });
  }

  if (setupSelectAll) {
    setupSelectAll.addEventListener("click", () => {
      const counts = levelCounts();
      selectedKeys.clear();
      Object.keys(counts).forEach((key) => {
        if (counts[key] > 0) selectedKeys.add(key);
      });
      renderSetup();
    });
  }

  if (setupClear) {
    setupClear.addEventListener("click", () => {
      selectedKeys.clear();
      renderSetup();
    });
  }

  if (setupStartAll) {
    setupStartAll.addEventListener("click", () => startSession("all"));
  }

  if (setupStartSelected) {
    setupStartSelected.addEventListener("click", () => {
      if (!selectedKeys.size) return;
      startSession([...selectedKeys]);
    });
  }

  if (settingPlaybackRate) {
    settingPlaybackRate.addEventListener("input", () => {
      const rate = Number(settingPlaybackRate.value);
      studySettings.playback_rate = Number.isFinite(rate) ? rate : 1;
      if (settingPlaybackRateLabel) {
        settingPlaybackRateLabel.textContent = `${getPlaybackRate().toFixed(2)}×`;
      }
      applyAudioRate();
    });
  }

  if (settingAutoplay) {
    settingAutoplay.addEventListener("change", () => {
      studySettings.autoplay = Boolean(settingAutoplay.checked);
    });
  }

  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener("click", () => saveStudySettings());
  }

  if (playBtn) {
    playBtn.addEventListener("click", () => playFullCard({ startTimer: true }));
  }

  if (stopBtn) {
    stopBtn.addEventListener("click", () => stopAudio());
  }

  function hideSentenceMeaningToast({ resetText = false, text = "" } = {}) {
    meaningOpen = false;
    if (!sentenceMeaningEl) return;
    sentenceMeaningEl.classList.remove("is-visible");
    sentenceMeaningEl.classList.add("hidden");
    if (resetText) sentenceMeaningEl.textContent = text;
    if (meaningBtn) {
      const chunk = currentChunk();
      const hasMeaning = Boolean(chunk && (chunk.sentence_meaning || "").trim());
      meaningBtn.textContent = hasMeaning
        ? t("show_meaning", "Show meaning")
        : t("no_sentence_meaning", "No sentence meaning");
    }
  }

  function showSentenceMeaningToast(text) {
    if (!sentenceMeaningEl) return;
    meaningOpen = true;
    sentenceMeaningEl.textContent = text;
    sentenceMeaningEl.classList.remove("hidden");
    window.requestAnimationFrame(function () {
      sentenceMeaningEl.classList.add("is-visible");
    });
    if (meaningBtn) meaningBtn.textContent = t("hide_meaning", "Hide meaning");
  }

  if (meaningBtn) {
    meaningBtn.addEventListener("click", () => {
      const chunk = currentChunk();
      if (!chunk || !(chunk.sentence_meaning || "").trim() || !sentenceMeaningEl) return;
      if (meaningOpen) {
        hideSentenceMeaningToast();
        return;
      }
      showSentenceMeaningToast(chunk.sentence_meaning || "");
      ensureCardTimerStarted();
    });
  }

  if (sentenceMeaningEl) {
    sentenceMeaningEl.addEventListener("click", () => hideSentenceMeaningToast());
  }

  syncSettingsForm();
  applyAudioRate();

  if (typeInput) {
    const onType = () => {
      if (speechWanted && !speechUpdating) {
        const current = typeInput.value || "";
        speechBase = current && !/\s$/.test(current) ? `${current} ` : current;
      }
      applyTypingFromInput();
    };
    typeInput.addEventListener("input", onType);
    typeInput.addEventListener("keyup", onType);
    typeInput.addEventListener("paste", () => setTimeout(onType, 0));
    typeInput.addEventListener("compositionend", onType);
    typeInput.addEventListener("focus", () => {
      window.setTimeout(() => {
        try {
          typeInput.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (_) {
          /* ignore */
        }
      }, 280);
    });
  }

  if (speechBtn) {
    if (!SpeechRecognitionCtor) {
      speechBtn.disabled = true;
      speechBtn.title = t(
        "speech_unsupported",
        "Speech-to-text needs Chrome or Edge (with microphone permission)."
      );
    }
    speechBtn.addEventListener("click", (event) => {
      event.preventDefault();
      toggleSpeechRecognition();
    });
  }

  if (textEl) {
    textEl.addEventListener("click", (event) => {
      const playBtnEl = event.target.closest(".hl-play");
      if (playBtnEl) {
        event.preventDefault();
        event.stopPropagation();
        const highlight = findHighlight(playBtnEl.dataset.id);
        if (highlight) {
          setActiveHighlight(highlight, { rerender: false });
          playHighlightClip(highlight);
        }
        return;
      }

      const revealBtnEl = event.target.closest(".hl-reveal");
      if (revealBtnEl) {
        event.preventDefault();
        event.stopPropagation();
        const id = Number(revealBtnEl.dataset.id);
        const highlight = findHighlight(id);
        if (!highlight) return;
        if (typedMatchedHighlightIds.has(id) || typedCompleteHighlightIds.has(id)) {
          // Unlocked by typing — keep visible
          setActiveHighlight(highlight, { rerender: true });
          return;
        }
        if (revealedHighlightIds.has(id)) revealedHighlightIds.delete(id);
        else revealedHighlightIds.add(id);
        setActiveHighlight(highlight, { rerender: true });
        return;
      }

      const wrap = event.target.closest(".study-hl-wrap");
      const mark = event.target.closest("mark.study-mark");
      if (!wrap || !mark) return;
      event.preventDefault();
      event.stopPropagation();
      const id = Number(mark.dataset.id);
      const highlight = findHighlight(id);
      if (!highlight) return;

      // Toggle compact popup on the blank itself — no auto-play
      if (activeHighlightId === id) setActiveHighlight(null, { rerender: true });
      else setActiveHighlight(highlight, { rerender: true });
    });
  }

  // Close popup on outside click (ignore the same click that opened it)
  document.addEventListener("click", (event) => {
    if (!activeHighlightId) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const inside = path.some(
      (node) => node && node.classList && node.classList.contains("study-hl-wrap")
    );
    if (inside) return;
    if (event.target && event.target.closest && event.target.closest(".study-hl-wrap")) {
      return;
    }
    setActiveHighlight(null, { rerender: true });
  });

  if (resultPanel) {
    resultPanel.addEventListener("click", hideCompletionResult);
  }

  if (levelsEl) {
    levelsEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".level-btn");
      if (!btn) return;
      saveLevel(Number(btn.dataset.level));
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (index <= 0) return;
      stopAudio();
      index -= 1;
      renderCard();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (index >= queue.length - 1) {
        if (lesson.exit_url) window.location.href = lesson.exit_url;
        return;
      }
      stopAudio();
      index += 1;
      renderCard();
    });
  }
})();
