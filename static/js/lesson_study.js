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
  const typeBlock = document.getElementById("study-type-block");
  const typeInput = document.getElementById("study-type-input");
  const typeLabel = document.getElementById("study-type-label");
  const typeHint = document.getElementById("study-type-hint");
  const speechBtn = document.getElementById("study-speech-btn");
  const speechLabel = document.getElementById("study-speech-label");
  const modeTabs = Array.from(document.querySelectorAll("[data-study-mode-tab]"));
  const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const speechLang = root.dataset.speechLang || "en-US";
  let studyAnswerMode = "writing";
  let speechRecognition = null;
  let speechWanted = false;
  let speechUpdating = false;
  let speechBase = "";
  let speechSessionPrefix = "";
  let speechRestartTimer = null;
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
  const pauseBtn = document.getElementById("study-pause");
  const stopBtn = document.getElementById("study-stop");
  const meaningBtn = document.getElementById("study-toggle-meaning");
  const revealAllBtn = document.getElementById("study-reveal-all");
  const repeatCardBtn = document.getElementById("study-repeat-card");
  const settingsModal = document.getElementById("study-settings-modal");
  let mediaSessionState = "stopped";
  const levelsEl = document.getElementById("study-levels");
  const levelStatus = document.getElementById("study-level-status");
  const prevBtn = document.getElementById("study-prev");
  const nextBtn = document.getElementById("study-next");
  const exitLink = document.getElementById("study-exit");
  const audio = document.getElementById("study-audio");
  const video = document.getElementById("study-video");
  const videoDock = document.getElementById("study-video-dock");
  const videoDockChrome = videoDock ? videoDock.querySelector("[data-dock-drag]") : null;
  const videoDockBody = videoDock ? videoDock.querySelector(".study-video-dock__body") : null;
  const videoDockResize = videoDock ? videoDock.querySelector("[data-dock-resize]") : null;
  const videoMinimizeBtn = document.getElementById("study-video-minimize");
  const videoSizeSmBtn = document.getElementById("study-video-size-sm");
  const videoSizeMdBtn = document.getElementById("study-video-size-md");

  const studyUserId = lesson.user_id != null ? String(lesson.user_id) : "anon";
  const VIDEO_DOCK_KEY = `mimivo.studyVideoDock.v3.u${studyUserId}`;
  let videoDockState = {
    x: null,
    y: null,
    w: null,
    h: null,
    minimized: false,
  };
  let videoDockVisible = false;
  let videoDockSaveTimer = 0;

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
  let writingCompleted = false;
  let speakingCompleted = false;
  let cardElapsedMs = 0;
  let studySettings = {
    playback_rate: 1,
    autoplay: false,
    speaking_score_threshold: 90,
    ...(lesson.settings && typeof lesson.settings === "object" ? lesson.settings : {}),
  };
  let studySpeakApi = null;
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

  function modeBestMs(chunk, mode) {
    if (!chunk) return null;
    return mode === "speaking" ? chunk.best_speak_ms : chunk.best_type_ms;
  }

  function isModeCompleted(mode) {
    return mode === "speaking" ? speakingCompleted : writingCompleted;
  }

  function setModeCompleted(mode, value) {
    if (mode === "speaking") speakingCompleted = Boolean(value);
    else writingCompleted = Boolean(value);
  }

  function updateBestRecordLabel(chunk) {
    if (!bestRecordEl) return;
    const label =
      studyAnswerMode === "speaking"
        ? t("best_label_speaking", "Best (Speaking)")
        : t("best_label_writing", "Best (Writing)");
    bestRecordEl.textContent = `${label}: ${formatMs(modeBestMs(chunk, studyAnswerMode))}`;
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

  function resetCardTimerIdle({ resetModeFlags = true } = {}) {
    stopCardTimerLoop();
    cardTimerStart = 0;
    cardElapsedMs = 0;
    cardTimerRunning = false;
    cardTimerStopped = false;
    if (resetModeFlags) {
      writingCompleted = false;
      speakingCompleted = false;
    }
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
    if (isModeCompleted(studyAnswerMode) || cardTimerRunning || cardTimerStopped) return;
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

  function chunkMediaUrl(chunk) {
    if (!chunk) return "";
    return chunk.video_url || chunk.media_url || chunk.audio_url || "";
  }

  function chunkIsVideo(chunk) {
    if (!chunk) return false;
    if (chunk.media_kind === "video" || chunk.has_video) return true;
    return Boolean(chunk.video_url);
  }

  function activeMediaEl(chunk) {
    return chunkIsVideo(chunk) ? video : audio;
  }

  function applyAudioRate() {
    const rate = getPlaybackRate();
    if (audio) {
      try {
        audio.playbackRate = rate;
      } catch (_) {}
    }
    if (video) {
      try {
        video.playbackRate = rate;
      } catch (_) {}
    }
  }

  let mediaGestureUnlocked = false;

  function hardenStudyMediaEl(el) {
    if (!el) return;
    try {
      el.playsInline = true;
    } catch (_) {}
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");
    el.setAttribute("preload", el.getAttribute("preload") || "metadata");
    el.setAttribute("controlslist", "nodownload noplaybackrate noremoteplayback");
    try {
      el.disableRemotePlayback = true;
    } catch (_) {}
    if (el.tagName === "VIDEO") {
      try {
        el.disablePictureInPicture = true;
      } catch (_) {}
    }
  }

  function waitForMediaEvent(el, eventName, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        el.removeEventListener(eventName, onEvent);
        resolve();
      };
      const onEvent = () => finish();
      el.addEventListener(eventName, onEvent);
      window.setTimeout(finish, timeoutMs || 2500);
    });
  }

  async function ensureMediaMetadata(el) {
    if (!el) return false;
    if (el.readyState >= 1) return true;
    try {
      el.load();
    } catch (_) {}
    await waitForMediaEvent(el, "loadedmetadata", 3500);
    return el.readyState >= 1;
  }

  async function safeSeekMedia(el, timeSec) {
    if (!el) return;
    const target = Math.max(0, Number(timeSec) || 0);
    if (!Number.isFinite(target)) return;
    await ensureMediaMetadata(el);
    const current = Number(el.currentTime) || 0;
    if (Math.abs(current - target) < 0.04) return;
    try {
      if (typeof el.fastSeek === "function") el.fastSeek(target);
      else el.currentTime = target;
    } catch (_) {
      try {
        el.currentTime = target;
      } catch (_) {}
    }
    await waitForMediaEvent(el, "seeked", 1800);
  }

  async function safePlayMedia(el) {
    if (!el) return false;
    applyAudioRate();
    try {
      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === "function") await playPromise;
      mediaGestureUnlocked = true;
      return true;
    } catch (_) {
      try {
        if (el.readyState < 2) {
          await waitForMediaEvent(el, "canplay", 3500);
        }
        applyAudioRate();
        const retry = el.play();
        if (retry && typeof retry.then === "function") await retry;
        mediaGestureUnlocked = true;
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  hardenStudyMediaEl(audio);
  hardenStudyMediaEl(video);

  function defaultDockSize() {
    const vw = window.innerWidth || 360;
    const isNarrow = vw < 640;
    return {
      w: Math.round(Math.min(vw * (isNarrow ? 0.88 : 0.34), isNarrow ? 288 : 352)),
      h: Math.round(isNarrow ? 168 : 200),
    };
  }

  function defaultDockPosition(w, h) {
    // Physical bottom-right corner (same in LTR/RTL layouts).
    const margin = 12;
    const safeBottom = 18;
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    const x = Math.max(margin, vw - w - margin);
    const y = Math.max(margin, vh - h - safeBottom);
    return { x, y };
  }

  function normalizeDockState(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    return {
      x: Number.isFinite(Number(parsed.x)) ? Number(parsed.x) : null,
      y: Number.isFinite(Number(parsed.y)) ? Number(parsed.y) : null,
      w: Number.isFinite(Number(parsed.w)) ? Number(parsed.w) : null,
      h: Number.isFinite(Number(parsed.h)) ? Number(parsed.h) : null,
      minimized: Boolean(parsed.minimized),
    };
  }

  function loadVideoDockState() {
    // Prefer per-user server prefs, then per-user local cache.
    const fromSettings = normalizeDockState(
      (studySettings && studySettings.video_dock) ||
        (lesson.settings && lesson.settings.video_dock) ||
        null
    );
    if (fromSettings) {
      videoDockState = fromSettings;
      try {
        localStorage.setItem(VIDEO_DOCK_KEY, JSON.stringify(videoDockState));
      } catch (_) {}
      return;
    }
    try {
      const raw = localStorage.getItem(VIDEO_DOCK_KEY);
      if (!raw) return;
      const parsed = normalizeDockState(JSON.parse(raw));
      if (!parsed) return;
      videoDockState = parsed;
    } catch (_) {
      /* ignore */
    }
  }

  function saveVideoDockState() {
    try {
      localStorage.setItem(VIDEO_DOCK_KEY, JSON.stringify(videoDockState));
    } catch (_) {
      /* ignore */
    }
    if (studySettings) {
      studySettings.video_dock = { ...videoDockState };
      lesson.settings = studySettings;
    }
    scheduleVideoDockServerSave();
  }

  function scheduleVideoDockServerSave() {
    if (!lesson.settings_url || !csrf) return;
    if (videoDockSaveTimer) window.clearTimeout(videoDockSaveTimer);
    videoDockSaveTimer = window.setTimeout(() => {
      videoDockSaveTimer = 0;
      persistVideoDockToServer();
    }, 450);
  }

  async function persistVideoDockToServer() {
    if (!lesson.settings_url || !csrf) return;
    const formData = new FormData();
    formData.append("video_dock", JSON.stringify(videoDockState));
    formData.append("csrfmiddlewaretoken", csrf);
    try {
      const response = await fetch(lesson.settings_url, {
        method: "POST",
        body: formData,
        headers: { "X-Requested-With": "XMLHttpRequest", "X-CSRFToken": csrf },
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) return;
      if (payload.settings && payload.settings.video_dock) {
        studySettings = { ...studySettings, ...payload.settings };
        lesson.settings = studySettings;
      }
    } catch (_) {
      /* ignore offline / transient errors; local cache still keeps it */
    }
  }

  function clampVideoDock() {
    if (!videoDock) return;
    const rect = videoDock.getBoundingClientRect();
    const w = rect.width;
    const h = videoDock.classList.contains("is-minimized")
      ? rect.height
      : Number(videoDockState.h) || rect.height;
    const maxX = Math.max(8, (window.innerWidth || w) - w - 8);
    const maxY = Math.max(8, (window.innerHeight || h) - h - 8);
    let x = Number.isFinite(videoDockState.x) ? videoDockState.x : rect.left;
    let y = Number.isFinite(videoDockState.y) ? videoDockState.y : rect.top;
    x = Math.min(maxX, Math.max(8, x));
    y = Math.min(maxY, Math.max(8, y));
    videoDockState.x = x;
    videoDockState.y = y;
    videoDock.style.left = `${x}px`;
    videoDock.style.top = `${y}px`;
    videoDock.style.right = "auto";
    videoDock.style.bottom = "auto";
  }

  function applyVideoDockGeometry() {
    if (!videoDock) return;
    const fallback = defaultDockSize();
    const w = Number.isFinite(videoDockState.w) ? videoDockState.w : fallback.w;
    const h = Number.isFinite(videoDockState.h) ? videoDockState.h : fallback.h;
    videoDockState.w = w;
    videoDockState.h = h;
    videoDock.style.width = `${w}px`;
    if (!videoDockState.minimized) {
      videoDock.style.height = `${h}px`;
    } else {
      videoDock.style.height = "auto";
    }
    videoDock.classList.toggle("is-minimized", Boolean(videoDockState.minimized));
    if (videoMinimizeBtn) {
      videoMinimizeBtn.textContent = videoDockState.minimized ? "+" : "–";
      videoMinimizeBtn.title = videoDockState.minimized
        ? t("expand_video", "Expand")
        : t("minimize_video", "Minimize");
      videoMinimizeBtn.setAttribute("aria-label", videoMinimizeBtn.title);
    }
    if (videoSizeSmBtn) {
      videoSizeSmBtn.classList.toggle("is-active", !videoDockState.minimized && w <= 260);
    }
    if (videoSizeMdBtn) {
      videoSizeMdBtn.classList.toggle(
        "is-active",
        !videoDockState.minimized && w > 260 && w <= 380
      );
    }
    if (!Number.isFinite(videoDockState.x) || !Number.isFinite(videoDockState.y)) {
      const pos = defaultDockPosition(w, videoDockState.minimized ? 40 : h);
      videoDockState.x = pos.x;
      videoDockState.y = pos.y;
    }
    clampVideoDock();
  }

  function setVideoDockVisible(show) {
    if (!videoDock) return;
    videoDockVisible = Boolean(show);
    videoDock.classList.toggle("is-hidden", !videoDockVisible);
    videoDock.hidden = !videoDockVisible;
    videoDock.setAttribute("aria-hidden", videoDockVisible ? "false" : "true");
    if (videoDockVisible) {
      applyVideoDockGeometry();
    }
  }

  function setVideoDockSizePreset(kind) {
    const vw = window.innerWidth || 360;
    if (kind === "sm") {
      videoDockState.w = Math.round(Math.min(vw * 0.72, 220));
      videoDockState.h = Math.round(videoDockState.w * 0.62);
    } else {
      videoDockState.w = Math.round(Math.min(vw * 0.9, 340));
      videoDockState.h = Math.round(videoDockState.w * 0.6);
    }
    videoDockState.minimized = false;
    applyVideoDockGeometry();
    saveVideoDockState();
  }

  function bindVideoDockInteractions() {
    if (!videoDock) return;
    loadVideoDockState();
    applyVideoDockGeometry();

    const onPointerMove = (event, mode, start) => {
      if (mode === "drag") {
        videoDockState.x = start.x + (event.clientX - start.px);
        videoDockState.y = start.y + (event.clientY - start.py);
        clampVideoDock();
      } else if (mode === "resize") {
        const nextW = Math.min(
          Math.max(150, start.w + (event.clientX - start.px) * start.sx),
          Math.min((window.innerWidth || 400) - 16, 640)
        );
        const nextH = Math.min(
          Math.max(100, start.h + (event.clientY - start.py)),
          Math.min((window.innerHeight || 400) - 16, 480)
        );
        videoDockState.w = Math.round(nextW);
        videoDockState.h = Math.round(nextH);
        videoDockState.minimized = false;
        applyVideoDockGeometry();
      }
    };

    const startGesture = (event, mode) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      const isRtl = Boolean(document.documentElement.dir === "rtl" || root.getAttribute("dir") === "rtl");
      const start = {
        px: event.clientX,
        py: event.clientY,
        x: Number(videoDockState.x) || 0,
        y: Number(videoDockState.y) || 0,
        w: Number(videoDockState.w) || videoDock.offsetWidth,
        h: Number(videoDockState.h) || videoDock.offsetHeight,
        sx: mode === "resize" && isRtl ? -1 : 1,
      };
      videoDock.classList.add("is-dragging");
      const move = (ev) => onPointerMove(ev, mode, start);
      const up = () => {
        videoDock.classList.remove("is-dragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        clampVideoDock();
        saveVideoDockState();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };

    if (videoDockChrome) {
      videoDockChrome.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) return;
        startGesture(event, "drag");
      });
    }
    if (videoDockResize) {
      videoDockResize.addEventListener("pointerdown", (event) => {
        startGesture(event, "resize");
      });
    }
    if (videoMinimizeBtn) {
      videoMinimizeBtn.addEventListener("click", () => {
        videoDockState.minimized = !videoDockState.minimized;
        applyVideoDockGeometry();
        saveVideoDockState();
      });
    }
    if (videoSizeSmBtn) {
      videoSizeSmBtn.addEventListener("click", () => setVideoDockSizePreset("sm"));
    }
    if (videoSizeMdBtn) {
      videoSizeMdBtn.addEventListener("click", () => setVideoDockSizePreset("md"));
    }
    if (videoDockBody) {
      videoDockBody.addEventListener("click", (event) => {
        if (event.target.closest("[data-dock-resize]")) return;
        event.preventDefault();
        toggleCardMediaPlayback();
      });
    }
    window.addEventListener("resize", () => {
      if (!videoDockVisible) return;
      clampVideoDock();
      saveVideoDockState();
    });
  }

  const settingSpeakThreshold = document.getElementById("setting-speak-threshold");
  const settingSpeakThresholdLabel = document.getElementById("setting-speak-threshold-label");

  function getSpeakThreshold() {
    const value = Number(studySettings.speaking_score_threshold);
    return Number.isFinite(value) ? Math.max(50, Math.min(100, value)) : 90;
  }

  function syncSettingsForm() {
    const rate = getPlaybackRate();
    studySettings.playback_rate = rate;
    studySettings.autoplay = Boolean(studySettings.autoplay);
    studySettings.speaking_score_threshold = getSpeakThreshold();
    if (settingPlaybackRate) settingPlaybackRate.value = String(rate);
    if (settingPlaybackRateLabel) {
      settingPlaybackRateLabel.textContent = `${rate.toFixed(2)}×`;
    }
    if (settingAutoplay) settingAutoplay.checked = Boolean(studySettings.autoplay);
    if (settingSpeakThreshold) settingSpeakThreshold.value = String(getSpeakThreshold());
    if (settingSpeakThresholdLabel) {
      settingSpeakThresholdLabel.textContent = `${Math.round(getSpeakThreshold())}%`;
    }
    if (studySpeakApi && studySpeakApi.syncThresholdUi) studySpeakApi.syncThresholdUi();
  }

  async function saveStudySettings() {
    if (!lesson.settings_url) {
      if (settingsStatus) settingsStatus.textContent = t("settings_url_missing", "Settings URL missing.");
      return;
    }
    const run = async () => {
      const formData = new FormData();
      formData.append("playback_rate", String(getPlaybackRate()));
      formData.append("autoplay", studySettings.autoplay ? "1" : "0");
      formData.append("speaking_score_threshold", String(getSpeakThreshold()));
      formData.append("csrfmiddlewaretoken", csrf);
      if (settingsStatus) settingsStatus.textContent = t("saving", "Saving…");
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
    };
    try {
      if (window.MvBusy && settingsSaveBtn) {
        await window.MvBusy.run(settingsSaveBtn, run, {
          label: t("saving", "Saving…"),
        });
      } else {
        await run();
      }
    } catch (err) {
      if (settingsStatus) {
        settingsStatus.textContent = err.message || t("could_not_save_settings", "Could not save settings.");
      }
    }
  }

  async function saveStudyRecord(timeMs, mode) {
    const chunk = currentChunk();
    if (!chunk) return;
    const recordMode = mode === "speaking" ? "speaking" : "writing";
    const previousBest = modeBestMs(chunk, recordMode);
    const formData = new FormData();
    formData.append("time_ms", String(timeMs));
    formData.append("mode", recordMode);
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
      if (payload.best_type_ms != null) chunk.best_type_ms = payload.best_type_ms;
      if (payload.best_speak_ms != null) chunk.best_speak_ms = payload.best_speak_ms;
      const original = allChunks.find((item) => item.id === chunk.id);
      if (original) {
        if (payload.best_type_ms != null) original.best_type_ms = payload.best_type_ms;
        if (payload.best_speak_ms != null) original.best_speak_ms = payload.best_speak_ms;
      }
      updateBestRecordLabel(chunk);
      const bestMs =
        payload.best_ms != null
          ? payload.best_ms
          : modeBestMs(chunk, recordMode);
      showCompletionResult({
        timeMs: payload.time_ms,
        previousBestMs: payload.previous_best_ms ?? previousBest,
        bestMs,
        isNewBest: payload.is_new_best,
        suggestedLevel: payload.suggested_level,
      });
      if (payload.suggested_level && recordMode === "writing") {
        if (levelStatus) {
          levelStatus.textContent = `${t("suggested_level", "Suggested level")}: ${payload.suggested_level}/7`;
        }
      }
    } catch (err) {
      const suggested = suggestLevelLocal(chunk.text || "", timeMs);
      const localBest =
        previousBest != null ? Math.min(previousBest, timeMs) : timeMs;
      if (recordMode === "speaking") chunk.best_speak_ms = localBest;
      else chunk.best_type_ms = localBest;
      updateBestRecordLabel(chunk);
      showCompletionResult({
        timeMs,
        previousBestMs: previousBest,
        bestMs: localBest,
        isNewBest: previousBest == null || timeMs < previousBest,
        suggestedLevel: suggested,
      });
      if (levelStatus) {
        levelStatus.textContent = err.message || t("record_saved_local", "Record saved locally only.");
      }
    }
  }

  function finishModeAttempt(mode) {
    const recordMode = mode === "speaking" ? "speaking" : "writing";
    if (isModeCompleted(recordMode)) return null;
    let timeMs = 0;
    if (cardTimerRunning) {
      timeMs = freezeCardTimer();
    } else if (cardTimerStopped) {
      timeMs = Math.max(1, Math.round(cardElapsedMs || 0));
    }
    if (!timeMs) return null;
    setModeCompleted(recordMode, true);
    saveStudyRecord(timeMs, recordMode);
    return timeMs;
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
          Boolean(chunkMediaUrl(currentChunk())) &&
          Number.isFinite(Number(ev.start_sec)) &&
          Number.isFinite(Number(ev.end_sec)) &&
          Number(ev.end_sec) >= Number(ev.start_sec);
        const revealLabel = revealed ? t("hide", "Hide") : t("show", "Show");
        const playLabel = canPlay
          ? t("play_word", "Play word")
          : t("no_synced_audio", "No synced audio");
        const leitnerLabel = t("leitner", "Leitner");
        const revealIcon = revealed
          ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6"/></svg>`
          : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M3 3l18 18" stroke-linecap="round"/><path d="M10.6 10.7a2.6 2.6 0 0 0 3.7 3.7" stroke-linecap="round"/><path d="M9.9 5.6A10.4 10.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 0 1-3.3 3.8M6.1 6.2C3.9 7.8 2.5 12 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const playIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8.2 5.8v12.4c0 .7.8 1.1 1.4.7l9.2-5.7c.6-.4.6-1.2 0-1.5L9.6 5.1c-.6-.4-1.4 0-1.4.7Z"/></svg>`;
        const leitnerIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="4.5" y="5.5" width="12.5" height="9.5" rx="1.4"/><path d="M7 17.5h10.2a1.8 1.8 0 0 0 1.8-1.8V8" stroke-linecap="round"/><path d="M8.2 19.5h9.2" stroke-linecap="round"/></svg>`;
        html +=
          `<span class="study-hl-wrap${open ? " is-open" : ""}" data-id="${ev.id}">` +
          `<mark class="study-mark${stateClass}" data-id="${ev.id}" title="${
            typedOk
              ? t("matched_by_typing", "Matched by typing")
              : revealed
                ? t("highlighted_word", "Highlighted word")
                : t("hidden_word_tap", "Hidden word — tap for options")
          }"><span class="study-word-text">${snippet}</span></mark>` +
          `<span class="study-hl-pop" role="dialog" aria-label="${t("highlight_tools", "Highlight tools")}">` +
          `<span class="study-hl-actions">` +
          `<button type="button" class="hl-reveal" data-id="${ev.id}" title="${revealLabel}" aria-label="${revealLabel}" aria-pressed="${revealed ? "true" : "false"}">${revealIcon}</button>` +
          `<button type="button" class="hl-play" data-id="${ev.id}" ${
            canPlay ? "" : "disabled"
          } title="${playLabel}" aria-label="${playLabel}">${playIcon}</button>` +
          `<button type="button" class="hl-leitner" data-id="${ev.id}" title="${leitnerLabel}" aria-label="${leitnerLabel}">${leitnerIcon}</button>` +
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

    if (fullyGreen && studyAnswerMode === "writing" && !isModeCompleted("writing")) {
      stopSpeechRecognition({ keepHint: true });
      if (typeInput) typeInput.blur();
      finishModeAttempt("writing");
    }
  }

  function studyModeCopy(mode, kind) {
    const fromDom = typeBlock && typeBlock.dataset
      ? typeBlock.dataset[
          kind === "label"
            ? mode === "speaking"
              ? "labelSpeaking"
              : "labelWriting"
            : kind === "placeholder"
              ? mode === "speaking"
                ? "placeholderSpeaking"
                : "placeholderWriting"
              : mode === "speaking"
                ? "hintSpeaking"
                : "hintWriting"
        ]
      : "";
    if (fromDom) return fromDom;
    if (kind === "label") {
      return mode === "speaking"
        ? t("speak_what_you_hear", "Speak what you hear / read")
        : t("type_what_you_hear", "Type what you hear / read");
    }
    if (kind === "placeholder") {
      return mode === "speaking"
        ? t("speak_placeholder", "Tap Speak and say the card text…")
        : t("type_placeholder", "Start typing the card text…");
    }
    return mode === "speaking"
      ? t("speak_hint", "Spoken words turn green. Minor mistakes are OK. Highlights unlock as you go.")
      : t(
          "type_hint",
          "Matching words turn green. Minor typos are OK. Highlights unlock when you reach them."
        );
  }

  function syncStudyAnswerModeUi() {
    if (typeBlock) typeBlock.dataset.studyMode = studyAnswerMode;
    modeTabs.forEach((tab) => {
      const active = tab.getAttribute("data-study-mode-tab") === studyAnswerMode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (typeLabel) typeLabel.textContent = studyModeCopy(studyAnswerMode, "label");
    if (typeInput) typeInput.placeholder = studyModeCopy(studyAnswerMode, "placeholder");
    if (typeHint && !speechWanted) {
      typeHint.textContent = studyModeCopy(studyAnswerMode, "hint");
    }
    if (speechBtn) {
      speechBtn.hidden = studyAnswerMode !== "speaking";
      speechBtn.tabIndex = studyAnswerMode === "speaking" ? 0 : -1;
      const startLabel = t("speak_start_recording", "Start");
      speechBtn.title = startLabel;
      if (speechLabel) speechLabel.textContent = startLabel;
    }
  }

  function setStudyAnswerMode(mode) {
    const next = mode === "speaking" ? "speaking" : "writing";
    if (next === studyAnswerMode) {
      syncStudyAnswerModeUi();
      updateBestRecordLabel(currentChunk());
      return;
    }
    if (studyAnswerMode === "speaking" && next === "writing") {
      stopSpeechRecognition({ keepHint: true });
      if (studySpeakApi) studySpeakApi.reset();
    }
    // Each mode keeps its own saved record; live timer restarts for the other mode.
    resetCardTimerIdle({ resetModeFlags: false });
    studyAnswerMode = next;
    syncStudyAnswerModeUi();
    updateBestRecordLabel(currentChunk());
    if (studyAnswerMode === "writing" && typeInput) {
      window.setTimeout(() => typeInput.focus(), 20);
    }
  }

  function revealAllHighlightsForSpeakReview() {
    const chunk = currentChunk();
    ((chunk && chunk.highlights) || []).forEach((item) => {
      revealedHighlightIds.add(Number(item.id));
    });
    renderCardText();
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

  function normalizeSpeechText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Merge addition into base without duplicating Android cumulative/repeated finals.
   * Examples:
   *   "hi" + "hi" -> "hi"
   *   "my" + "my name is" -> "my name is"
   *   "hello" + "world" -> "hello world"
   */
  function mergeSpeechFinal(base, addition) {
    const b = String(base || "").trim();
    const a = String(addition || "").trim();
    if (!a) return b ? `${b} ` : "";
    if (!b) return `${a} `;

    const bNorm = normalizeSpeechText(b);
    const aNorm = normalizeSpeechText(a);
    if (!aNorm) return `${b} `;
    if (bNorm === aNorm || bNorm.endsWith(` ${aNorm}`) || bNorm.endsWith(aNorm)) {
      return `${b} `;
    }
    if (aNorm.startsWith(bNorm)) return `${a} `;

    const bWords = bNorm.split(" ").filter(Boolean);
    const aWords = aNorm.split(" ").filter(Boolean);
    let overlap = 0;
    const max = Math.min(bWords.length, aWords.length);
    for (let n = max; n > 0; n -= 1) {
      if (bWords.slice(-n).join(" ") === aWords.slice(0, n).join(" ")) {
        overlap = n;
        break;
      }
    }
    if (overlap === aWords.length) return `${b} `;

    const bRawWords = b.split(/\s+/).filter(Boolean);
    const aRawWords = a.split(/\s+/).filter(Boolean);
    return `${[...bRawWords, ...aRawWords.slice(overlap)].join(" ")} `;
  }

  /** Rebuild one recognition-session transcript with dedupe of repeated finals. */
  function buildSessionTranscript(results) {
    let committed = "";
    let interim = "";
    let lastFinalNorm = "";
    for (let i = 0; i < results.length; i += 1) {
      const piece = (results[i][0].transcript || "").trim();
      if (!piece) continue;
      if (results[i].isFinal) {
        const norm = normalizeSpeechText(piece);
        if (!norm || norm === lastFinalNorm) continue;
        // Skip if this final is already fully contained at the end.
        if (
          normalizeSpeechText(committed) === norm ||
          normalizeSpeechText(committed).endsWith(` ${norm}`) ||
          normalizeSpeechText(committed).endsWith(norm)
        ) {
          lastFinalNorm = norm;
          continue;
        }
        committed = mergeSpeechFinal(committed, piece).trim();
        lastFinalNorm = norm;
      } else {
        interim = interim ? `${interim} ${piece}` : piece;
      }
    }
    return { committed, interim };
  }

  function stopSpeechRecognition(opts) {
    const keepHint = Boolean(opts && opts.keepHint);
    speechWanted = false;
    if (speechRestartTimer) {
      window.clearTimeout(speechRestartTimer);
      speechRestartTimer = null;
    }
    if (speechRecognition) {
      try {
        speechRecognition.stop();
      } catch (_) {
        /* ignore */
      }
    }
    setSpeechUi(false);
    if (!keepHint && typeHint && !isModeCompleted(studyAnswerMode)) {
      typeHint.textContent = studyModeCopy(studyAnswerMode, "hint");
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
      // Snapshot text committed before this browser speech session.
      speechSessionPrefix = speechBase;
      setSpeechUi(true);
      if (typeHint) {
        typeHint.textContent = t("speech_listening", "Listening… speak the card text");
      }
    };

    recognition.onresult = (event) => {
      // Rebuild from the whole current session (not append-only from resultIndex).
      // This is much more stable on Android Chrome.
      const { committed, interim } = buildSessionTranscript(event.results);
      speechBase = mergeSpeechFinal(speechSessionPrefix, committed);
      if (interim) {
        const live = mergeSpeechFinal(speechBase, interim).trimEnd();
        setTypeInputFromSpeech(live);
      } else {
        setTypeInputFromSpeech(speechBase);
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
      // Browser speech sessions end periodically (especially Android).
      // Restart quietly so listening feels continuous; keep UI as "listening".
      if (speechRestartTimer) window.clearTimeout(speechRestartTimer);
      speechRestartTimer = window.setTimeout(() => {
        speechRestartTimer = null;
        if (!speechWanted || !speechRecognition) return;
        speechSessionPrefix = speechBase;
        try {
          speechRecognition.start();
        } catch (_) {
          /* already started */
        }
      }, 50);
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
    speechSessionPrefix = speechBase;
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

  function setPlayingUI(state) {
    const next =
      state === true ? "playing" : state === false ? "stopped" : state || "stopped";
    mediaSessionState = next;
    const hasMedia = Boolean(chunkMediaUrl(currentChunk()));
    if (playBtn) {
      playBtn.disabled = !hasMedia;
      if (next === "paused") {
        playBtn.textContent = t("resume", "▶ Resume");
      } else if (next === "playing") {
        playBtn.textContent = t("playing", "▶ Playing…");
      } else {
        playBtn.textContent = t("play_card", "▶ Play");
      }
    }
    if (pauseBtn) pauseBtn.disabled = !hasMedia || next !== "playing";
    if (stopBtn) stopBtn.disabled = !hasMedia || next === "stopped";
  }

  function pauseMedia() {
    const chunk = currentChunk();
    const media = activeMediaEl(chunk);
    if (!media || mediaSessionState !== "playing") return;
    media.pause();
    if (stopTimer) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
    setPlayingUI("paused");
  }

  function toggleCardMediaPlayback() {
    const chunk = currentChunk();
    if (!chunkMediaUrl(chunk)) return;
    if (mediaSessionState === "playing") {
      pauseMedia();
      return;
    }
    playFullCard({ startTimer: true });
  }

  function studyToolIcon(kind) {
    if (kind === "meaning-on") {
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M4 6.5h11a3 3 0 0 1 3 3V18l-4.2-2.4H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" stroke-linejoin="round"/><path d="M7 10.2h7M7 13h4.5" stroke-linecap="round"/><path d="M3.2 3.2l17.6 17.6" stroke-linecap="round"/></svg>`;
    }
    if (kind === "meaning-off") {
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M4 6.5h11a3 3 0 0 1 3 3V18l-4.2-2.4H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" stroke-linejoin="round"/><path d="M7 10.2h7M7 13h4.5" stroke-linecap="round"/></svg>`;
    }
    if (kind === "eye-off") {
      return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M3 3l18 18" stroke-linecap="round"/><path d="M10.6 10.7a2.6 2.6 0 0 0 3.7 3.7" stroke-linecap="round"/><path d="M9.9 5.6A10.4 10.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 0 1-3.3 3.8M6.1 6.2C3.9 7.8 2.5 12 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6"/></svg>`;
  }

  function updateMeaningBtnUI() {
    if (!meaningBtn) return;
    const chunk = currentChunk();
    const hasMeaning = Boolean(chunk && (chunk.sentence_meaning || "").trim());
    meaningBtn.disabled = !hasMeaning;
    const label = meaningOpen
      ? t("hide_meaning", "Hide meaning")
      : hasMeaning
        ? t("show_meaning", "Show meaning")
        : t("no_sentence_meaning", "No sentence meaning");
    meaningBtn.title = label;
    meaningBtn.setAttribute("aria-label", label);
    meaningBtn.setAttribute("aria-pressed", meaningOpen && hasMeaning ? "true" : "false");
    meaningBtn.innerHTML = studyToolIcon(meaningOpen && hasMeaning ? "meaning-off" : "meaning-on");
  }

  function updateRepeatCardBtnUI() {
    if (!repeatCardBtn) return;
    const hasMedia = Boolean(chunkMediaUrl(currentChunk()));
    const label = t("repeat_card", "Repeat card");
    repeatCardBtn.disabled = !hasMedia;
    repeatCardBtn.title = label;
    repeatCardBtn.setAttribute("aria-label", label);
  }

  function resetCardProgressState(chunk) {
    meaningOpen = false;
    stopSpeechRecognition({ keepHint: true });
    if (studySpeakApi) studySpeakApi.reset();
    revealedHighlightIds = new Set();
    typedMatchedEnd = -1;
    typedMatchedHighlightIds = new Set();
    typedCompleteHighlightIds = new Set();
    activeHighlight = null;
    activeHighlightId = null;
    speechBase = "";
    speechSessionPrefix = "";
    if (typeInput) typeInput.value = "";
    if (typeHint) {
      typeHint.textContent = studyModeCopy(studyAnswerMode, "hint");
    }
    hideSentenceMeaningToast({
      resetText: true,
      text: (chunk && chunk.sentence_meaning) || "",
    });
    resetCardTimerIdle();
    updateMeaningBtnUI();
    updateRevealAllBtnUI();
    renderCardText();
  }

  async function repeatCurrentCard() {
    const chunk = currentChunk();
    if (!chunk) return;
    // Full card reset — same as if the card just loaded.
    stopAudio();
    resetCardProgressState(chunk);
    if (typeInput) {
      window.setTimeout(() => typeInput.focus(), 30);
    }
    if (chunkMediaUrl(chunk)) {
      await playFullCard({ startTimer: true });
    }
  }

  function areAllHighlightsRevealed() {
    const chunk = currentChunk();
    const highlights = (chunk && chunk.highlights) || [];
    if (!highlights.length) return false;
    return highlights.every((item) => {
      const id = Number(item.id);
      return (
        typedCompleteHighlightIds.has(id) ||
        typedMatchedHighlightIds.has(id) ||
        revealedHighlightIds.has(id)
      );
    });
  }

  function updateRevealAllBtnUI() {
    if (!revealAllBtn) return;
    const chunk = currentChunk();
    const highlights = (chunk && chunk.highlights) || [];
    const allRevealed = areAllHighlightsRevealed();
    revealAllBtn.disabled = !highlights.length;
    const label = allRevealed
      ? t("hide_all_words", "Hide all words")
      : t("reveal_all_words", "Reveal all words");
    revealAllBtn.title = label;
    revealAllBtn.setAttribute("aria-label", label);
    revealAllBtn.setAttribute("aria-pressed", allRevealed ? "true" : "false");
    revealAllBtn.innerHTML = studyToolIcon(allRevealed ? "eye" : "eye-off");
  }

  function toggleRevealAllHiddenWords() {
    const chunk = currentChunk();
    const highlights = (chunk && chunk.highlights) || [];
    if (!highlights.length) return;
    if (areAllHighlightsRevealed()) {
      highlights.forEach((item) => {
        const id = Number(item.id);
        if (typedCompleteHighlightIds.has(id) || typedMatchedHighlightIds.has(id)) return;
        revealedHighlightIds.delete(id);
      });
    } else {
      highlights.forEach((item) => {
        revealedHighlightIds.add(Number(item.id));
      });
    }
    setActiveHighlight(null, { rerender: true });
    updateRevealAllBtnUI();
  }

  function openStudySettingsModal() {
    if (!settingsModal) return;
    syncSettingsForm();
    settingsModal.classList.remove("hidden");
    settingsModal.removeAttribute("hidden");
    document.body.classList.add("mv-modal-open");
    const closeBtn = settingsModal.querySelector("[data-study-settings-close].mv-btn");
    if (closeBtn) closeBtn.focus();
  }

  function closeStudySettingsModal() {
    if (!settingsModal || settingsModal.hasAttribute("hidden")) return;
    settingsModal.classList.add("hidden");
    settingsModal.setAttribute("hidden", "");
    if (!document.querySelector(".mv-modal:not([hidden])")) {
      document.body.classList.remove("mv-modal-open");
    }
  }

  async function resumeMedia({ startTimer = true } = {}) {
    const chunk = currentChunk();
    const media = ensureCardMedia(chunk);
    if (!media) return;
    if (startTimer) ensureCardTimerStarted();
    if (!endedListener) {
      endedListener = () => {
        endedListener = null;
        setPlayingUI("stopped");
      };
      media.addEventListener("ended", endedListener);
    }
    setPlayingUI("playing");
    const ok = await safePlayMedia(media);
    if (!ok) {
      setPlayingUI("paused");
      if (levelStatus) {
        levelStatus.textContent = chunkIsVideo(chunk)
          ? t("could_not_play_video", "Could not play video.")
          : t("could_not_play_audio", "Could not play audio.");
      }
    }
  }

  function stopAudio() {
    if (stopTimer) {
      window.clearTimeout(stopTimer);
      stopTimer = null;
    }
    [audio, video].forEach((el) => {
      if (!el) return;
      if (stopListener) el.removeEventListener("timeupdate", stopListener);
      if (endedListener) el.removeEventListener("ended", endedListener);
      try {
        el.pause();
      } catch (_) {}
      // Avoid forced seek-to-0 when metadata is missing (common iOS race).
      if (el.readyState >= 1) {
        try {
          el.currentTime = 0;
        } catch (_) {}
      }
    });
    stopListener = null;
    endedListener = null;
    setPlayingUI("stopped");
  }

  function ensureCardMedia(chunk) {
    const url = chunkMediaUrl(chunk);
    const el = activeMediaEl(chunk);
    if (!el || !url) return null;
    hardenStudyMediaEl(el);
    if (el.getAttribute("src") !== url) {
      el.src = url;
      try {
        el.load();
      } catch (_) {}
    }
    if (chunkIsVideo(chunk)) {
      setVideoDockVisible(true);
      if (audio) {
        audio.removeAttribute("src");
        try {
          audio.load();
        } catch (_) {}
      }
    } else {
      setVideoDockVisible(false);
      if (video && video.getAttribute("src")) {
        video.pause();
      }
    }
    return el;
  }

  async function playFullCard({ startTimer = true } = {}) {
    const chunk = currentChunk();
    if (mediaSessionState === "paused") {
      await resumeMedia({ startTimer });
      return;
    }
    const media = ensureCardMedia(chunk);
    if (!media) return;
    if (startTimer) ensureCardTimerStarted();
    stopAudio();
    ensureCardMedia(chunk);
    await ensureMediaMetadata(media);
    await safeSeekMedia(media, 0);
    endedListener = () => {
      endedListener = null;
      setPlayingUI("stopped");
    };
    media.addEventListener("ended", endedListener);
    setPlayingUI("playing");
    const ok = await safePlayMedia(media);
    if (!ok) {
      stopAudio();
      if (levelStatus) {
        levelStatus.textContent = chunkIsVideo(chunk)
          ? t("could_not_play_video", "Could not play video.")
          : t("could_not_play_audio", "Could not play audio.");
      }
    }
  }

  async function playHighlightClip(highlight) {
    const chunk = currentChunk();
    const media = ensureCardMedia(chunk);
    if (!highlight || !media) {
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
    ensureCardMedia(chunk);
    const playFrom = Math.max(0, start);
    const finishAt = end;
    await safeSeekMedia(media, playFrom);
    stopListener = () => {
      if (media.currentTime >= finishAt) stopAudio();
    };
    media.addEventListener("timeupdate", stopListener);
    const durationMs = Math.max(
      50,
      ((finishAt - playFrom) * 1000) / getPlaybackRate() + 40
    );
    stopTimer = window.setTimeout(stopAudio, durationMs);
    setPlayingUI("playing");
    const ok = await safePlayMedia(media);
    if (!ok) {
      stopAudio();
      if (levelStatus) levelStatus.textContent = t("could_not_play_hl", "Could not play highlight audio.");
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
    updateRevealAllBtnUI();
    window.requestAnimationFrame(positionActiveHighlightPop);
  }

  function findHighlight(id) {
    const chunk = currentChunk();
    if (!chunk) return null;
    return (chunk.highlights || []).find((item) => item.id === Number(id)) || null;
  }

  function positionActiveHighlightPop() {
    if (!textEl || activeHighlightId == null) return;
    const wrap = textEl.querySelector(
      `.study-hl-wrap[data-id="${activeHighlightId}"]`
    );
    if (!wrap) return;
    const mark = wrap.querySelector("mark.study-mark");
    const pop = wrap.querySelector(".study-hl-pop");
    if (!mark || !pop) return;

    pop.classList.remove("is-above");
    pop.style.left = "0px";
    pop.style.top = "0px";

    const markRect = mark.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;

    let top = markRect.bottom + gap;
    let placeAbove = false;
    if (top + popRect.height > vh - margin) {
      const above = markRect.top - gap - popRect.height;
      if (above >= margin) {
        top = above;
        placeAbove = true;
      } else {
        top = Math.max(margin, vh - popRect.height - margin);
      }
    }

    let left = markRect.left + markRect.width / 2 - popRect.width / 2;
    left = Math.max(margin, Math.min(left, vw - popRect.width - margin));

    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.classList.toggle("is-above", placeAbove);
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
      window.requestAnimationFrame(positionActiveHighlightPop);
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
        const shortLabel = row.key === "unrated" ? "—" : row.key;
        const titleParts = [row.label];
        if (row.hint) titleParts.push(row.hint);
        titleParts.push(
          row.count === 1
            ? t("card_count", "{n} card", { n: row.count })
            : t("cards_count", "{n} cards", { n: row.count })
        );
        return `
          <label
            class="setup-level-chip${disabled ? " is-disabled" : ""}${checked ? " is-checked" : ""}"
            title="${escapeHtml(titleParts.join(" · "))}"
          >
            <input
              type="checkbox"
              class="setup-level-check"
              data-key="${row.key}"
              ${checked ? "checked" : ""}
              ${disabled ? "disabled" : ""}
            />
            <span class="setup-level-chip-label">${escapeHtml(shortLabel)}</span>
            <span class="setup-level-chip-count">${row.count}</span>
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
    root.classList.add("is-studying");
    document.body.classList.add("mv-studying");
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

    stopAudio();
    updateBestRecordLabel(chunk);
    resetCardProgressState(chunk);

    if (progressEl) {
      progressEl.textContent = t("card_of", "Card {current} of {total}", { current: index + 1, total: queue.length });
    }
    if (progressBar) {
      progressBar.style.width = `${((index + 1) / Math.max(queue.length, 1)) * 100}%`;
    }

    const mediaUrl = chunkMediaUrl(chunk);
    if (playBtn) {
      playBtn.disabled = !mediaUrl;
      playBtn.textContent = mediaUrl
        ? t("play_card", "▶ Play")
        : t("no_audio", "No audio");
    }
    if (pauseBtn) pauseBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    mediaSessionState = "stopped";
    updateMeaningBtnUI();
    updateRevealAllBtnUI();
    updateRepeatCardBtnUI();
    if (prevBtn) prevBtn.disabled = index <= 0;
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.textContent = index >= queue.length - 1 ? t("finish", "Finish") : t("next", "Next →");
    }

    stopAudio();
    if (chunkIsVideo(chunk) && video && mediaUrl) {
      if (video.getAttribute("src") !== mediaUrl) {
        video.src = mediaUrl;
      }
      setVideoDockVisible(true);
      if (audio) {
        audio.removeAttribute("src");
        try {
          audio.load();
        } catch (_) {
          /* ignore */
        }
      }
    } else {
      setVideoDockVisible(false);
      if (video) {
        video.removeAttribute("src");
        try {
          video.load();
        } catch (_) {
          /* ignore */
        }
      }
      if (audio) {
        if (mediaUrl) {
          audio.src = mediaUrl;
        } else {
          audio.removeAttribute("src");
          audio.load();
        }
      }
    }
    applyAudioRate();

    renderLevels(chunk);
    if (typeInput) {
      window.setTimeout(() => typeInput.focus(), 30);
    }

    // iOS blocks autoplay until a user gesture has unlocked media playback.
    if (studySettings.autoplay && mediaUrl && mediaGestureUnlocked) {
      window.setTimeout(() => playFullCard({ startTimer: false }), 40);
    }
  }

  async function saveLevel(level, triggerBtn) {
    const chunk = currentChunk();
    if (!chunk) return;
    const run = async () => {
      const formData = new FormData();
      formData.append("study_level", String(level));
      formData.append("csrfmiddlewaretoken", csrf);
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
    };
    try {
      if (window.MvBusy && triggerBtn) {
        await window.MvBusy.run(triggerBtn, run, { label: t("saving", "Saving…") });
      } else {
        await run();
      }
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
      const chip = input.closest(".setup-level-chip");
      if (chip) chip.classList.toggle("is-checked", input.checked);
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

  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => pauseMedia());
  }

  if (stopBtn) {
    stopBtn.addEventListener("click", () => stopAudio());
  }

  function hideSentenceMeaningToast({ resetText = false, text = "" } = {}) {
    meaningOpen = false;
    if (sentenceMeaningEl) {
      sentenceMeaningEl.classList.remove("is-visible");
      sentenceMeaningEl.classList.add("hidden");
      if (resetText) sentenceMeaningEl.textContent = text;
    }
    updateMeaningBtnUI();
  }

  function showSentenceMeaningToast(text) {
    if (!sentenceMeaningEl) return;
    meaningOpen = true;
    sentenceMeaningEl.textContent = text;
    sentenceMeaningEl.classList.remove("hidden");
    window.requestAnimationFrame(function () {
      sentenceMeaningEl.classList.add("is-visible");
    });
    updateMeaningBtnUI();
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

  if (revealAllBtn) {
    revealAllBtn.addEventListener("click", () => toggleRevealAllHiddenWords());
  }

  if (repeatCardBtn) {
    repeatCardBtn.addEventListener("click", () => {
      repeatCurrentCard();
    });
  }

  document.querySelectorAll("[data-study-settings-open]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      openStudySettingsModal();
    });
  });
  if (settingsModal) {
    settingsModal.querySelectorAll("[data-study-settings-close]").forEach((el) => {
      el.addEventListener("click", () => closeStudySettingsModal());
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (settingsModal && !settingsModal.hasAttribute("hidden")) {
      closeStudySettingsModal();
    }
  });

  if (sentenceMeaningEl) {
    sentenceMeaningEl.addEventListener("click", () => hideSentenceMeaningToast());
  }

  syncSettingsForm();
  applyAudioRate();
  updateMeaningBtnUI();
  updateRevealAllBtnUI();
  updateRepeatCardBtnUI();

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

  modeTabs.forEach((tab) => {
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      setStudyAnswerMode(tab.getAttribute("data-study-mode-tab") || "writing");
    });
  });
  syncStudyAnswerModeUi();

  if (settingSpeakThreshold) {
    settingSpeakThreshold.addEventListener("input", () => {
      const value = Number(settingSpeakThreshold.value);
      studySettings.speaking_score_threshold = Number.isFinite(value) ? value : 90;
      if (settingSpeakThresholdLabel) {
        settingSpeakThresholdLabel.textContent = `${Math.round(getSpeakThreshold())}%`;
      }
    });
  }

  if (typeof window.MimivoStudySpeak === "function") {
    studySpeakApi = window.MimivoStudySpeak({
      t,
      csrf,
      speakUrlTemplate: lesson.speak_url_template || "",
      getChunk: () => currentChunk(),
      getSettings: () => studySettings,
      setThreshold: (value) => {
        studySettings.speaking_score_threshold = Number(value) || 90;
      },
      onError: (message) => {
        if (typeHint) typeHint.textContent = message;
        if (levelStatus) levelStatus.textContent = message;
      },
      onStart: () => {
        // If Play was not pressed yet, start the speak timer after the 3s countdown.
        if (studyAnswerMode !== "speaking") return;
        if (cardTimerRunning || cardTimerStopped || isModeCompleted("speaking")) return;
        window.setTimeout(() => {
          if (studyAnswerMode !== "speaking") return;
          if (cardTimerRunning || cardTimerStopped || isModeCompleted("speaking")) return;
          ensureCardTimerStarted();
        }, 3000);
      },
      onProcessingStart: () => {
        // Stop the speak timer as soon as End is pressed (exclude STT wait).
        if (studyAnswerMode !== "speaking") return;
        if (cardTimerRunning) freezeCardTimer();
      },
      onComplete: () => {
        revealAllHighlightsForSpeakReview();
        // Speaking has its own best-time record, separate from writing.
        if (studyAnswerMode === "speaking") {
          finishModeAttempt("speaking");
        }
      },
      onReviewReady: () => {
        revealAllHighlightsForSpeakReview();
      },
      onReviewClear: () => {},
      playModel: async ({ slow } = {}) => {
        const chunk = currentChunk();
        const media = ensureCardMedia(chunk);
        if (!media) return;
        stopAudio();
        ensureCardMedia(chunk);
        const rate = slow ? 0.75 : getPlaybackRate();
        try {
          media.playbackRate = rate;
        } catch (_) {}
        endedListener = () => {
          endedListener = null;
          setPlayingUI("stopped");
          applyAudioRate();
        };
        media.addEventListener("ended", endedListener);
        setPlayingUI("playing");
        try {
          await media.play();
        } catch (_) {
          stopAudio();
        }
      },
      playExpectedWord: (item) => {
        const chunk = currentChunk();
        if (!chunk || !item) return;
        const highlight = (chunk.highlights || []).find((h) => {
          return item.start >= h.start_char && item.start < h.end_char;
        });
        if (highlight) playHighlightClip(highlight);
        else playFullCard({ startTimer: false });
      },
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

      const leitnerBtnEl = event.target.closest(".hl-leitner");
      if (leitnerBtnEl) {
        event.preventDefault();
        event.stopPropagation();
        // Placeholder — Leitner behavior comes later.
        const highlight = findHighlight(leitnerBtnEl.dataset.id);
        if (highlight) setActiveHighlight(highlight, { rerender: false });
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
      (node) =>
        node &&
        node.classList &&
        (node.classList.contains("study-hl-wrap") || node.classList.contains("study-hl-pop"))
    );
    if (inside) return;
    if (
      event.target &&
      event.target.closest &&
      (event.target.closest(".study-hl-wrap") || event.target.closest(".study-hl-pop"))
    ) {
      return;
    }
    setActiveHighlight(null, { rerender: true });
  });

  if (textEl) {
    textEl.addEventListener(
      "scroll",
      () => {
        if (activeHighlightId != null) positionActiveHighlightPop();
      },
      { passive: true }
    );
  }

  window.addEventListener(
    "resize",
    () => {
      if (activeHighlightId != null) positionActiveHighlightPop();
    },
    { passive: true }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (activeHighlightId != null) positionActiveHighlightPop();
    },
    { passive: true, capture: true }
  );

  if (resultPanel) {
    resultPanel.addEventListener("click", hideCompletionResult);
  }

  if (levelsEl) {
    levelsEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".level-btn");
      if (!btn) return;
      if (window.MvBusy && window.MvBusy.isBusy(btn)) return;
      saveLevel(Number(btn.dataset.level), btn);
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

  bindVideoDockInteractions();
})();
