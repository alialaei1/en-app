(function () {
  const uiNode = document.getElementById("ui-i18n");
  const UI = uiNode ? JSON.parse(uiNode.textContent || "{}") : {};

  function t(key, fallback) {
    return UI[key] || fallback || key;
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const total = Math.floor(sec + 0.0001);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function safeDuration(audio) {
    const d = audio.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  const players = [];

  function pauseOthers(except) {
    players.forEach(function (p) {
      if (p !== except && p.audio && !p.audio.paused) {
        p.audio.pause();
        if (typeof p.syncUi === "function") p.syncUi();
      }
    });
  }

  function hardenAudio(audio) {
    audio.controls = false;
    audio.setAttribute("controlsList", "nodownload noplaybackrate noremoteplayback");
    audio.setAttribute("disablePictureInPicture", "true");
    audio.addEventListener("contextmenu", function (event) {
      event.preventDefault();
    });
  }

  function seekTo(audio, time, onDone) {
    const duration = safeDuration(audio);
    let target = Math.max(0, Number(time) || 0);
    if (duration > 0) target = Math.min(duration, target);

    const apply = function () {
      try {
        if (typeof audio.fastSeek === "function") {
          audio.fastSeek(target);
        } else {
          audio.currentTime = target;
        }
      } catch (_) {
        try {
          audio.currentTime = target;
        } catch (__) {
          /* ignore transient seek errors */
        }
      }
      if (typeof onDone === "function") onDone(target);
    };

    if (audio.readyState >= 1) {
      apply();
    } else {
      const once = function () {
        audio.removeEventListener("loadedmetadata", once);
        apply();
      };
      audio.addEventListener("loadedmetadata", once);
      try {
        audio.load();
      } catch (_) {
        /* ignore */
      }
    }
    return target;
  }

  function initFullPlayer(root) {
    const src = root.dataset.src;
    if (!src) return;

    // Seek bars break under RTL; force LTR for the transport UI.
    root.setAttribute("dir", "ltr");

    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.src = src;
    hardenAudio(audio);
    root.insertBefore(audio, root.firstChild);

    const seek = root.querySelector("[data-audio-seek]");
    const fill = root.querySelector("[data-audio-fill]");
    const currentEl = root.querySelector("[data-audio-current]");
    const durationEl = root.querySelector("[data-audio-duration]");
    const startBtn = root.querySelector("[data-audio-start]");
    const pauseBtn = root.querySelector("[data-audio-pause]");
    const stopBtn = root.querySelector("[data-audio-stop]");
    const backBtn = root.querySelector("[data-audio-back]");
    const fwdBtn = root.querySelector("[data-audio-fwd]");

    let dragging = false;
    let rafId = 0;

    function setProgressVisual(time, duration) {
      const dur = duration > 0 ? duration : 0;
      const ratio = dur > 0 ? Math.min(1, Math.max(0, time / dur)) : 0;
      if (fill) fill.style.width = (ratio * 100).toFixed(2) + "%";
      if (seek) {
        if (dur > 0) {
          seek.max = String(dur);
          seek.disabled = false;
        } else {
          seek.max = "1";
          seek.disabled = true;
        }
        if (!dragging) seek.value = String(Math.min(dur || 1, Math.max(0, time)));
      }
      if (currentEl) currentEl.textContent = formatTime(time);
      if (durationEl) durationEl.textContent = formatTime(dur);
    }

    function syncUi() {
      const playing = !audio.paused && !audio.ended;
      const duration = safeDuration(audio);
      const time = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      if (startBtn) startBtn.disabled = playing;
      if (pauseBtn) pauseBtn.disabled = !playing;
      if (stopBtn) stopBtn.disabled = time <= 0.05 && !playing;
      if (backBtn) backBtn.disabled = duration <= 0 && audio.readyState < 1;
      if (fwdBtn) fwdBtn.disabled = duration <= 0 && audio.readyState < 1;
      if (!dragging) setProgressVisual(time, duration);
    }

    function tick() {
      if (!audio.paused && !audio.ended) {
        syncUi();
        rafId = window.requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    }

    function startTick() {
      if (!rafId) rafId = window.requestAnimationFrame(tick);
    }

    function stopTick() {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    const api = { audio: audio, syncUi: syncUi };
    players.push(api);

    if (startBtn) {
      startBtn.addEventListener("click", function () {
        pauseOthers(api);
        // Resume from current position — never force restart.
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === "function") {
          playPromise.then(startTick).catch(function () {
            syncUi();
          });
        } else {
          startTick();
        }
        syncUi();
      });
    }
    if (pauseBtn) {
      pauseBtn.addEventListener("click", function () {
        audio.pause();
        stopTick();
        syncUi();
      });
    }
    if (stopBtn) {
      stopBtn.addEventListener("click", function () {
        audio.pause();
        stopTick();
        seekTo(audio, 0, syncUi);
      });
    }
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        seekTo(audio, (audio.currentTime || 0) - 5, syncUi);
      });
    }
    if (fwdBtn) {
      fwdBtn.addEventListener("click", function () {
        seekTo(audio, (audio.currentTime || 0) + 5, syncUi);
      });
    }

    if (seek) {
      const endDrag = function () {
        if (!dragging) return;
        dragging = false;
        seekTo(audio, Number(seek.value) || 0, syncUi);
      };

      seek.addEventListener("pointerdown", function () {
        dragging = true;
      });
      seek.addEventListener("input", function () {
        dragging = true;
        const duration = safeDuration(audio) || Number(seek.max) || 0;
        const value = Number(seek.value) || 0;
        setProgressVisual(value, duration);
      });
      seek.addEventListener("change", endDrag);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    }

    const track = root.querySelector("[data-audio-track]");
    if (track) {
      track.addEventListener("click", function (event) {
        if (event.target === seek) return;
        const duration = safeDuration(audio);
        if (duration <= 0) return;
        const rect = track.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        seekTo(audio, ratio * duration, syncUi);
      });
    }

    audio.addEventListener("loadedmetadata", syncUi);
    audio.addEventListener("durationchange", syncUi);
    audio.addEventListener("canplay", syncUi);
    audio.addEventListener("timeupdate", function () {
      if (!dragging) syncUi();
    });
    audio.addEventListener("seeked", syncUi);
    audio.addEventListener("play", function () {
      startTick();
      syncUi();
    });
    audio.addEventListener("pause", function () {
      stopTick();
      syncUi();
    });
    audio.addEventListener("ended", function () {
      stopTick();
      seekTo(audio, 0, syncUi);
    });

    syncUi();
  }

  function initSimplePlayer(root) {
    const src = root.dataset.src;
    if (!src) return;

    root.setAttribute("dir", "ltr");

    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = src;
    hardenAudio(audio);
    root.appendChild(audio);

    const startBtn = root.querySelector("[data-audio-start]");
    if (!startBtn) return;

    function syncUi() {
      const playing = !audio.paused && !audio.ended;
      startBtn.textContent = playing
        ? t("audio_pause", "Pause")
        : t("audio_start", "Start");
      startBtn.classList.toggle("is-playing", playing);
    }

    const api = { audio: audio, syncUi: syncUi };
    players.push(api);

    startBtn.addEventListener("click", function () {
      if (!audio.paused && !audio.ended) {
        audio.pause();
        syncUi();
        return;
      }
      pauseOthers(api);
      if (audio.ended || (audio.currentTime > 0 && audio.paused && audio.currentTime >= safeDuration(audio) - 0.25)) {
        seekTo(audio, 0);
      }
      audio.play().catch(function () {});
      syncUi();
    });

    audio.addEventListener("play", syncUi);
    audio.addEventListener("pause", syncUi);
    audio.addEventListener("ended", function () {
      seekTo(audio, 0, syncUi);
    });
    syncUi();
  }

  function init() {
    document.querySelectorAll('[data-audio-player="full"]').forEach(initFullPlayer);
    document.querySelectorAll('[data-audio-player="simple"]').forEach(initSimplePlayer);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
