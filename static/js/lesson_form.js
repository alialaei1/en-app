(function () {
  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
  
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

  const form = document.getElementById("lesson-form");
    if (!form) return;

    const uploadUrl = form.dataset.uploadUrl;
    const mediaMaxBytes = Number(form.dataset.mediaMaxBytes || 0);
    const documentMaxBytes = Number(form.dataset.documentMaxBytes || 0);
    const csrfToken = form.querySelector("[name=csrfmiddlewaretoken]")?.value;
    const overlay = document.getElementById("process-overlay");
    const overlayTitle = document.getElementById("process-title");
    const overlayMessage = document.getElementById("process-message");
    const overlayPercent = document.getElementById("process-percent");
    const overlayRemaining = document.getElementById("process-remaining");
    const overlayBar = document.getElementById("process-bar");
    const formError = document.getElementById("form-ajax-error");
    const submitBtn = form.querySelector('[type="submit"]');

    function formatBytes(bytes) {
      if (!bytes && bytes !== 0) return "";
      const units = ["B", "KB", "MB", "GB"];
      let size = bytes;
      let i = 0;
      while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i += 1;
      }
      return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function setUploadUI(kind, { percent = 0, label = "", done = false, error = "" } = {}) {
      const bar = document.getElementById(`${kind}-upload-bar`);
      const text = document.getElementById(`${kind}-upload-text`);
      const meta = document.getElementById(`${kind}-upload-meta`);
      const wrap = document.getElementById(`${kind}-upload-progress`);
      if (!bar || !text || !wrap) return;
      wrap.classList.remove("hidden");
      wrap.style.display = "block";
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      text.textContent = error || label;
      text.className = error
        ? "text-sm text-rose-300"
        : done
          ? "text-sm text-emerald-300"
          : "text-sm text-slate-300";
      if (meta) meta.textContent = error ? "" : `${Math.round(percent)}%`;
    }

    function uploadFile(kind, file) {
      return new Promise((resolve, reject) => {
        const maxBytes = kind === "media" ? mediaMaxBytes : documentMaxBytes;
        if (maxBytes && file.size > maxBytes) {
          const maxMb = Math.max(1, Math.round(maxBytes / (1024 * 1024)));
          const gotMb = (file.size / (1024 * 1024)).toFixed(1);
          const message =
            kind === "media"
              ? t("upload_media_too_large", `Audio/video max ${maxMb} MB (got ${gotMb} MB).`, {
                  max_mb: maxMb,
                  got_mb: gotMb,
                })
              : t("upload_doc_too_large", `Document max ${maxMb} MB (got ${gotMb} MB).`, {
                  max_mb: maxMb,
                  got_mb: gotMb,
                });
          setUploadUI(kind, { percent: 0, error: message });
          reject(new Error(message));
          return;
        }

        const data = new FormData();
        data.append("kind", kind);
        data.append("file", file);
        data.append("csrfmiddlewaretoken", csrfToken);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl);
        xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = (event.loaded / event.total) * 100;
          setUploadUI(kind, {
            percent,
            label: `${t("uploading", "Uploading")} ${file.name}…`,
          });
        };

        xhr.onload = () => {
          let payload = {};
          try {
            payload = JSON.parse(xhr.responseText || "{}");
          } catch (_) {
            payload = {};
          }
          if (xhr.status >= 200 && xhr.status < 300 && payload.ok) {
            setUploadUI(kind, {
              percent: 100,
              done: true,
              label: `Uploaded: ${payload.name} (${formatBytes(payload.size)})`,
            });
            resolve(payload);
            return;
          }
          const message = payload.error || "Upload failed.";
          setUploadUI(kind, { percent: 0, error: message });
          reject(new Error(message));
        };

        xhr.onerror = () => {
          setUploadUI(kind, { percent: 0, error: "Network error while uploading." });
          reject(new Error("Network error while uploading."));
        };

        setUploadUI(kind, { percent: 1, label: `Starting upload: ${file.name}` });
        xhr.send(data);
      });
    }

    function bindImmediateUpload(inputId, kind, hiddenId) {
      const input = document.getElementById(inputId);
      const hidden = document.getElementById(hiddenId);
      if (!input || !hidden) return;
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        hidden.value = "";
        try {
          const result = await uploadFile(kind, file);
          hidden.value = result.id;
          input.value = "";
        } catch (_) {
          hidden.value = "";
        }
      });
    }

    bindImmediateUpload("media-file-input", "media", "id_media_temp_id");
    bindImmediateUpload("document-file-input", "document", "id_document_temp_id");

    function updateOverlay(title, message, percent) {
      const value = Math.max(0, Math.min(100, Number(percent) || 0));
      if (overlayTitle) overlayTitle.textContent = title;
      if (overlayMessage) overlayMessage.textContent = message;
      if (overlayPercent) overlayPercent.textContent = `${Math.round(value)}%`;
      if (overlayRemaining) {
        overlayRemaining.textContent = `${Math.max(0, 100 - Math.round(value))}% remaining`;
      }
      if (overlayBar) overlayBar.style.width = `${value}%`;
    }

    function showOverlay(title, message, percent) {
      if (!overlay) return;
      overlay.classList.remove("hidden");
      overlay.style.display = "flex";
      overlay.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      updateOverlay(title, message, percent);
    }

    function hideOverlay() {
      if (!overlay) return;
      overlay.style.display = "none";
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }

    async function parseJsonResponse(response) {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error(
          response.status === 403
            ? "CSRF/session error. Refresh the page and try again."
            : `Server error (${response.status}). Refresh and try again.`
        );
      }
    }

    function pollStatus(statusUrl, redirectUrl) {
      return new Promise((resolve, reject) => {
        const tick = () => {
          fetch(statusUrl, { headers: { "X-Requested-With": "XMLHttpRequest" } })
            .then((res) => parseJsonResponse(res))
            .then((data) => {
              updateOverlay(
                "Please wait — do not click anything",
                data.message || "Processing lesson…",
                data.progress || 0
              );
              if (data.status === "ready") {
                resolve(data.redirect || redirectUrl);
                return;
              }
              if (data.status === "failed") {
                reject(new Error(data.error || "Processing failed."));
                return;
              }
              setTimeout(tick, 700);
            })
            .catch((err) => reject(err));
        };
        tick();
      });
    }

    function buildFormData() {
      const data = new FormData(form);
      ["media_temp_id", "document_temp_id"].forEach((key) => {
        const value = (data.get(key) || "").toString().trim();
        if (!value) data.delete(key);
      });
      return data;
    }

    async function handleSubmit(event) {
      event.preventDefault();
      event.stopPropagation();

      if (formError) {
        formError.classList.add("hidden");
        formError.textContent = "";
      }

      const mediaReady = document.getElementById("id_media_temp_id")?.value;
      const documentReady = document.getElementById("id_document_temp_id")?.value;
      const mediaInput = document.getElementById("media-file-input");
      const documentInput = document.getElementById("document-file-input");
      if (
        (mediaInput?.files?.length && !mediaReady) ||
        (documentInput?.files?.length && !documentReady)
      ) {
        if (formError) {
          formError.textContent = "Wait for file uploads to finish before creating the lesson.";
          formError.classList.remove("hidden");
        }
        return false;
      }

      if (submitBtn) submitBtn.disabled = true;
      showOverlay("Please wait — do not click anything", "Saving lesson…", 3);

      try {
        const response = await fetch(form.getAttribute("action") || window.location.href, {
          method: "POST",
          body: buildFormData(),
          headers: { "X-Requested-With": "XMLHttpRequest" },
          credentials: "same-origin",
        });
        const payload = await parseJsonResponse(response);
        if (!response.ok || !payload.ok) {
          const firstError =
            payload.errors?.__all__?.[0] ||
            Object.values(payload.errors || {}).flat()[0] ||
            "Could not save the lesson.";
          throw new Error(firstError);
        }

        if (payload.processing && payload.status_url) {
          updateOverlay("Please wait — do not click anything", "Processing started…", 8);
          const redirectTo = await pollStatus(payload.status_url, payload.redirect);
          updateOverlay("Please wait — do not click anything", "Finishing up…", 100);
          window.location.href = redirectTo;
          return false;
        }

        window.location.href = payload.redirect;
      } catch (err) {
        hideOverlay();
        if (submitBtn) submitBtn.disabled = false;
        if (formError) {
          formError.textContent = err.message || "Something went wrong.";
          formError.classList.remove("hidden");
        }
      }
      return false;
    }

    form.addEventListener("submit", handleSubmit);
  });
})();
