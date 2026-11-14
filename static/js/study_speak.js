(function (global) {
  "use strict";

  function createStudySpeak(api) {
    const t = api.t;
    const els = {
      overlay: document.getElementById("study-speak-overlay"),
      countdown: document.getElementById("study-speak-countdown"),
      endBtn: document.getElementById("study-speak-end"),
      startBtn: document.getElementById("study-speech-btn"),
      startLabel: document.getElementById("study-speech-label"),
      result: document.getElementById("study-speak-result"),
      score: document.getElementById("study-speak-score"),
      playMine: document.getElementById("study-speak-play-mine"),
      playModel: document.getElementById("study-speak-play-model"),
      playSlow: document.getElementById("study-speak-play-slow"),
      markRight: document.getElementById("study-speak-mark-right"),
      thresholdInput: document.getElementById("setting-speak-threshold"),
      thresholdLabel: document.getElementById("setting-speak-threshold-label"),
      errorBox: document.getElementById("study-speak-error"),
      helpBtn: document.getElementById("study-speak-help-btn"),
      helpModal: document.getElementById("study-speak-help-modal"),
    };

    let phaseTimer = 0;
    let mediaStream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordedBlob = null;
    let recordedUrl = "";
    let mineAudio = null;
    let alignments = [];
    let selectedIndex = -1;
    let busy = false;

    function speakUrl(chunk) {
      if (!chunk || !api.speakUrlTemplate) return "";
      return String(api.speakUrlTemplate).split("{id}").join(String(chunk.id));
    }

    function threshold() {
      const settings = api.getSettings ? api.getSettings() : {};
      const value = Number(settings.speaking_score_threshold);
      return Number.isFinite(value) ? value : 90;
    }

    function setPhase(name) {
      if (!els.overlay) return;
      els.overlay.querySelectorAll("[data-speak-phase]").forEach((node) => {
        node.classList.toggle("is-active", node.getAttribute("data-speak-phase") === name);
      });
    }

    function openOverlay() {
      if (!els.overlay) return;
      els.overlay.classList.remove("hidden");
      els.overlay.removeAttribute("hidden");
      els.overlay.classList.add("is-open");
      document.body.classList.add("mv-modal-open");
    }

    function closeOverlay() {
      if (!els.overlay) return;
      els.overlay.classList.add("hidden");
      els.overlay.setAttribute("hidden", "");
      els.overlay.classList.remove("is-open");
      if (!document.querySelector(".mv-modal:not([hidden])")) {
        document.body.classList.remove("mv-modal-open");
      }
    }

    function showError(message) {
      if (els.errorBox) {
        els.errorBox.textContent = message || "";
        els.errorBox.classList.remove("hidden");
        els.errorBox.removeAttribute("hidden");
      }
      if (api.onError) api.onError(message);
    }

    function clearError() {
      if (!els.errorBox) return;
      els.errorBox.textContent = "";
      els.errorBox.classList.add("hidden");
      els.errorBox.setAttribute("hidden", "");
    }

    function setStartLabel(again) {
      const label = again
        ? t("speak_start_again", "Start again")
        : t("speak_start_recording", "Start");
      if (els.startLabel) els.startLabel.textContent = label;
      if (els.startBtn) {
        els.startBtn.title = label;
        els.startBtn.setAttribute("aria-label", label);
        els.startBtn.classList.toggle("is-again", Boolean(again));
        els.startBtn.classList.toggle("is-start", !again);
      }
    }

    function hideResult() {
      if (!els.result) return;
      els.result.classList.add("hidden");
      els.result.setAttribute("hidden", "");
      if (els.markRight) els.markRight.disabled = true;
      selectedIndex = -1;
      alignments = [];
      if (api.onReviewClear) api.onReviewClear();
    }

    function showResult() {
      if (!els.result) return;
      els.result.classList.remove("hidden");
      els.result.removeAttribute("hidden");
      setStartLabel(true);
    }

    function clearPhaseTimer() {
      if (phaseTimer) {
        window.clearTimeout(phaseTimer);
        phaseTimer = 0;
      }
    }

    function stopTracks() {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (_) {}
        });
        mediaStream = null;
      }
    }

    function revokeMineUrl() {
      if (recordedUrl) {
        try {
          URL.revokeObjectURL(recordedUrl);
        } catch (_) {}
        recordedUrl = "";
      }
      if (mineAudio) {
        try {
          mineAudio.pause();
        } catch (_) {}
        mineAudio = null;
      }
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

    function wordSpans(text) {
      const spans = [];
      const source = String(text || "");
      const re = /\S+/g;
      let match;
      while ((match = re.exec(source))) {
        spans.push({
          text: match[0],
          start: match.index,
          end: match.index + match[0].length,
          norm: normalizeWord(match[0]),
        });
      }
      return spans;
    }

    function classifyPair(expectedNorm, heardNorm) {
      if (!expectedNorm) return "ok";
      if (!heardNorm) return "missing";
      if (expectedNorm === heardNorm) return "ok";
      const dist = levenshtein(expectedNorm, heardNorm);
      const maxLen = Math.max(expectedNorm.length, heardNorm.length);
      if (dist <= Math.max(1, Math.floor(maxLen * 0.28))) return "near";
      return "bad";
    }

    function alignWords(expectedText, heardText) {
      const expected = wordSpans(expectedText).filter((item) => item.norm);
      const heard = String(heardText || "")
        .trim()
        .split(/\s+/)
        .map((text) => ({ text, norm: normalizeWord(text) }))
        .filter((item) => item.norm);

      const out = [];
      let i = 0;
      let j = 0;
      while (i < expected.length && j < heard.length) {
        const status = classifyPair(expected[i].norm, heard[j].norm);
        if (status === "ok" || status === "near") {
          out.push({
            expected: expected[i].text,
            heard: heard[j].text,
            status,
            start: expected[i].start,
            end: expected[i].end,
          });
          i += 1;
          j += 1;
          continue;
        }

        const nextExp = expected[i + 1] ? classifyPair(expected[i + 1].norm, heard[j].norm) : "bad";
        const nextHeard = heard[j + 1] ? classifyPair(expected[i].norm, heard[j + 1].norm) : "bad";
        if (nextExp === "ok" || nextExp === "near") {
          out.push({
            expected: expected[i].text,
            heard: "",
            status: "missing",
            start: expected[i].start,
            end: expected[i].end,
          });
          i += 1;
          continue;
        }
        if (nextHeard === "ok" || nextHeard === "near") {
          j += 1;
          continue;
        }
        out.push({
          expected: expected[i].text,
          heard: heard[j].text,
          status: "bad",
          start: expected[i].start,
          end: expected[i].end,
        });
        i += 1;
        j += 1;
      }
      while (i < expected.length) {
        out.push({
          expected: expected[i].text,
          heard: "",
          status: "missing",
          start: expected[i].start,
          end: expected[i].end,
        });
        i += 1;
      }
      return out;
    }

    function scoreAlignments(items) {
      if (!items.length) return 0;
      let points = 0;
      items.forEach((item) => {
        if (item.status === "ok" || item.forcedOk) points += 1;
        else if (item.status === "near") points += 0.5;
      });
      return Math.round((points / items.length) * 100);
    }

    function renderFeedback() {
      const score = scoreAlignments(alignments);
      if (els.score) {
        els.score.textContent = t("speak_score_label", "Score {score}%", { score });
      }
      if (api.onReviewReady) {
        api.onReviewReady(alignments, score, selectedIndex);
      }
    }

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function selectToken(index) {
      const item = alignments[index];
      if (!item) return;
      selectedIndex = index;
      if (els.markRight) {
        // Perfect matches cannot be "marked right" again.
        els.markRight.disabled = item.forcedOk || item.status === "ok";
      }
      renderFeedback();
    }

    async function ensureMic() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(t("speak_record_unsupported", "Recording is not supported in this browser."));
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      return mediaStream;
    }

    function isAppleTouch() {
      return (
        /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
        (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1)
      );
    }

    function pickRecorderMime() {
      // Safari iOS prefers mp4/aac; Chromium prefers webm/opus.
      const candidates = isAppleTouch()
        ? ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
        : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      if (!window.MediaRecorder) return "";
      if (typeof MediaRecorder.isTypeSupported === "function") {
        const hit = candidates.find((type) => MediaRecorder.isTypeSupported(type));
        if (hit) return hit;
      }
      return "";
    }

    function extensionForMime(mime) {
      const type = String(mime || "").toLowerCase();
      if (type.includes("mp4") || type.includes("aac") || type.includes("m4a")) return "m4a";
      if (type.includes("ogg")) return "ogg";
      if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
      if (type.includes("wav")) return "wav";
      return "webm";
    }

    function startRecorder() {
      recordedChunks = [];
      const mime = pickRecorderMime();
      mediaRecorder = mime
        ? new MediaRecorder(mediaStream, { mimeType: mime })
        : new MediaRecorder(mediaStream);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordedChunks.push(event.data);
      };
      // Avoid short timeslices on iOS Safari; one blob on stop is more reliable.
      try {
        if (isAppleTouch()) mediaRecorder.start();
        else mediaRecorder.start(200);
      } catch (_) {
        mediaRecorder.start();
      }
    }

    function stopRecorder() {
      return new Promise((resolve) => {
        if (!mediaRecorder || mediaRecorder.state === "inactive") {
          resolve(null);
          return;
        }
        mediaRecorder.onstop = () => {
          const type = mediaRecorder.mimeType || recordedChunks[0]?.type || "audio/webm";
          recordedBlob = recordedChunks.length
            ? new Blob(recordedChunks, { type })
            : null;
          resolve(recordedBlob);
        };
        try {
          if (mediaRecorder.state === "recording") {
            try {
              mediaRecorder.requestData();
            } catch (_) {}
          }
          mediaRecorder.stop();
        } catch (_) {
          resolve(null);
        }
      });
    }

    function formatSpeakError(payload, status) {
      const code = payload && payload.code ? String(payload.code) : "";
      const main =
        (payload && payload.error) ||
        t("speak_transcribe_failed", "Could not convert voice to text.");
      // Learner-facing codes: show only the friendly message (no Whisper/HTTP dump).
      const friendlyCodes = {
        empty_transcript: true,
        empty_upload: true,
        no_audio: true,
        ffmpeg_decode: true,
        ffmpeg_missing: true,
        whisper_import: true,
        whisper_model: true,
        whisper_run: true,
      };
      if (code && friendlyCodes[code]) {
        return main;
      }
      // Unknown failures: keep a short message without raw server detail.
      if (status && status >= 500) {
        return t("speak_err_http", "Server error while converting voice (HTTP {status}).", {
          status: status,
        });
      }
      return main;
    }

    async function transcribeBlob(blob, chunk) {
      const url = speakUrl(chunk);
      if (!url) {
        throw new Error(
          t("speak_err_no_url", "Speaking upload URL is missing. Reload the page.")
        );
      }
      if (!blob) {
        throw new Error(t("speak_no_audio", "No recording received."));
      }
      const mime = blob.type || "audio/webm";
      const filename = `speak.${extensionForMime(mime)}`;
      const formData = new FormData();
      formData.append("audio", blob, filename);
      formData.append("csrfmiddlewaretoken", api.csrf || "");
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          body: formData,
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRFToken": api.csrf || "",
          },
          credentials: "same-origin",
        });
      } catch (err) {
        throw new Error(
          t("speak_err_network", "Network error while uploading your recording.") +
            (err && err.message ? ` — ${err.message}` : "")
        );
      }

      let payload = {};
      try {
        payload = await response.json();
      } catch (_) {
        throw new Error(
          t("speak_err_http", "Server error while converting voice (HTTP {status}).", {
            status: response.status || "?",
          }) + ` — non-JSON response`
        );
      }

      if (!response.ok || !payload.ok || !payload.text) {
        if (payload.error || payload.detail || payload.code) {
          throw new Error(formatSpeakError(payload, response.status));
        }
        throw new Error(
          t("speak_err_http", "Server error while converting voice (HTTP {status}).", {
            status: response.status || "?",
          })
        );
      }
      return String(payload.text || "").trim();
    }

    function openHelpModal() {
      if (!els.helpModal) return;
      els.helpModal.classList.remove("hidden");
      els.helpModal.removeAttribute("hidden");
      document.body.classList.add("mv-modal-open");
    }

    function closeHelpModal() {
      if (!els.helpModal) return;
      els.helpModal.classList.add("hidden");
      els.helpModal.setAttribute("hidden", "");
      if (!document.querySelector(".mv-modal:not([hidden])") && !(els.overlay && els.overlay.classList.contains("is-open"))) {
        document.body.classList.remove("mv-modal-open");
      }
    }

    async function finishSession() {
      clearPhaseTimer();
      setPhase("loading");
      // Freeze the practice timer before STT so processing time is not counted.
      if (typeof api.onProcessingStart === "function") {
        try {
          api.onProcessingStart();
        } catch (_) {}
      }
      if (els.endBtn && window.MvBusy) {
        window.MvBusy.lock(els.endBtn, {
          label: t("working", "Working…"),
        });
      }
      const chunk = api.getChunk ? api.getChunk() : null;
      let blob = null;
      try {
        blob = await stopRecorder();
      } catch (_) {
        blob = null;
      }
      stopTracks();

      if (!blob) {
        closeOverlay();
        busy = false;
        if (els.endBtn && window.MvBusy) window.MvBusy.unlock(els.endBtn);
        showError(t("speak_no_audio", "No recording received."));
        return;
      }

      revokeMineUrl();
      recordedBlob = blob;
      recordedUrl = URL.createObjectURL(blob);

      try {
        const transcript = await transcribeBlob(blob, chunk);
        clearError();
        alignments = alignWords((chunk && chunk.text) || "", transcript).map((item) => ({
          ...item,
          forcedOk: false,
        }));
        closeOverlay();
        showResult();
        renderFeedback();
        if (api.onComplete) {
          api.onComplete(transcript, alignments, scoreAlignments(alignments));
        }
      } catch (err) {
        closeOverlay();
        showError(
          err && err.message
            ? err.message
            : t("speak_transcribe_failed", "Could not convert voice to text.")
        );
      } finally {
        busy = false;
        if (els.endBtn && window.MvBusy) window.MvBusy.unlock(els.endBtn);
      }
    }

    async function beginRecordingPhase() {
      setPhase("recording");
      try {
        startRecorder();
      } catch (err) {
        stopTracks();
        closeOverlay();
        busy = false;
        if (api.onError) {
          api.onError(err.message || t("speak_record_unsupported", "Recording is not supported in this browser."));
        }
      }
    }

    function runCountdown() {
      let left = 3;
      setPhase("countdown");
      if (els.countdown) els.countdown.textContent = String(left);
      const tick = () => {
        left -= 1;
        if (left > 0) {
          if (els.countdown) els.countdown.textContent = String(left);
          phaseTimer = window.setTimeout(tick, 1000);
          return;
        }
        setPhase("go");
        phaseTimer = window.setTimeout(() => {
          beginRecordingPhase();
        }, 650);
      };
      phaseTimer = window.setTimeout(tick, 1000);
    }

    async function startSession(triggerBtn) {
      if (busy) return;
      const chunk = api.getChunk ? api.getChunk() : null;
      if (!chunk) return;
      const run = async () => {
        busy = true;
        hideResult();
        clearError();
        clearPhaseTimer();
        revokeMineUrl();
        recordedBlob = null;
        recordedChunks = [];
        try {
          await ensureMic();
          openOverlay();
          if (typeof api.onStart === "function") {
            try {
              api.onStart();
            } catch (_) {}
          }
          runCountdown();
        } catch (err) {
          busy = false;
          stopTracks();
          showError(
            err.message ||
              t("speak_no_mic", "Microphone permission is required for speaking practice.")
          );
          throw err;
        }
      };
      try {
        if (window.MvBusy && triggerBtn) {
          await window.MvBusy.run(triggerBtn, run, {
            label: t("loading", "Loading…"),
          });
        } else {
          await run();
        }
      } catch (_) {
        /* error already shown */
      }
    }

    function playMine() {
      if (!recordedUrl) return;
      if (!mineAudio) mineAudio = new Audio();
      mineAudio.src = recordedUrl;
      mineAudio.play().catch(() => {});
    }

    function syncThresholdUi() {
      if (!els.thresholdInput) return;
      const value = threshold();
      els.thresholdInput.value = String(value);
      if (els.thresholdLabel) els.thresholdLabel.textContent = `${Math.round(value)}%`;
    }

    function reset() {
      clearPhaseTimer();
      try {
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
      } catch (_) {}
      stopTracks();
      closeOverlay();
      hideResult();
      clearError();
      revokeMineUrl();
      recordedBlob = null;
      busy = false;
      setStartLabel(false);
    }

    if (els.startBtn) {
      els.startBtn.addEventListener("click", (event) => {
        event.preventDefault();
        startSession(els.startBtn);
      });
    }
    if (els.endBtn) {
      els.endBtn.addEventListener("click", (event) => {
        event.preventDefault();
        if (!busy) return;
        if (window.MvBusy && window.MvBusy.isBusy(els.endBtn)) return;
        finishSession();
      });
    }
    if (els.playMine) {
      els.playMine.addEventListener("click", (event) => {
        event.preventDefault();
        playMine();
      });
    }
    if (els.playModel) {
      els.playModel.addEventListener("click", (event) => {
        event.preventDefault();
        if (api.playModel) api.playModel({ slow: false });
      });
    }
    if (els.playSlow) {
      els.playSlow.addEventListener("click", (event) => {
        event.preventDefault();
        if (api.playModel) api.playModel({ slow: true });
      });
    }
    if (els.markRight) {
      els.markRight.addEventListener("click", (event) => {
        event.preventDefault();
        if (selectedIndex < 0 || !alignments[selectedIndex]) return;
        alignments[selectedIndex].forcedOk = true;
        els.markRight.disabled = true;
        renderFeedback();
      });
    }
    if (els.helpBtn) {
      els.helpBtn.addEventListener("click", (event) => {
        event.preventDefault();
        openHelpModal();
      });
    }
    if (els.helpModal) {
      els.helpModal.querySelectorAll("[data-speak-help-close]").forEach((el) => {
        el.addEventListener("click", (event) => {
          event.preventDefault();
          closeHelpModal();
        });
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!els.helpModal || els.helpModal.hasAttribute("hidden")) return;
      closeHelpModal();
    });
    if (els.thresholdInput) {
      els.thresholdInput.addEventListener("input", () => {
        const value = Number(els.thresholdInput.value);
        if (els.thresholdLabel) {
          els.thresholdLabel.textContent = `${Math.round(value)}%`;
        }
        if (api.setThreshold) api.setThreshold(value);
      });
    }

    syncThresholdUi();

    return {
      start: startSession,
      reset,
      hideResult,
      syncThresholdUi,
      selectIndex: selectToken,
      isBusy: () => busy,
    };
  }

  global.MimivoStudySpeak = createStudySpeak;
})(window);
