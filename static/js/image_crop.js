(function () {
  const UI_NODE = document.getElementById("ui-i18n");
  const UI = UI_NODE ? JSON.parse(UI_NODE.textContent || "{}") : {};

  function t(key, fallback) {
    return UI[key] || fallback || key;
  }

  let activeSession = null;

  function ensureModal() {
    let modal = document.getElementById("ll-crop-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "ll-crop-modal";
    modal.className = "ll-crop-modal hidden";
    modal.setAttribute("hidden", "");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <button type="button" class="ll-crop-backdrop" data-crop-cancel aria-label="${t("cancel", "Cancel")}"></button>
      <div class="ll-crop-panel">
        <div class="ll-crop-head">
          <div>
            <h2 class="ll-crop-title">${t("crop_title", "Crop image")}</h2>
            <p class="ll-crop-hint">${t("crop_hint", "Drag to frame the area you want.")}</p>
          </div>
          <button type="button" class="ll-btn ll-btn-ghost" data-crop-cancel style="min-height:2.35rem">${t("cancel", "Cancel")}</button>
        </div>
        <div class="ll-crop-stage">
          <img id="ll-crop-image" alt="" />
        </div>
        <div class="ll-crop-actions">
          <button type="button" class="ll-btn ll-btn-ghost" data-crop-cancel>${t("cancel", "Cancel")}</button>
          <button type="button" class="ll-btn ll-btn-primary" id="ll-crop-apply">${t("crop_apply", "Use photo")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll("[data-crop-cancel]").forEach(function (el) {
      el.addEventListener("click", function () {
        if (activeSession && typeof activeSession.cancel === "function") activeSession.cancel();
      });
    });
    const applyBtn = modal.querySelector("#ll-crop-apply");
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        if (activeSession && typeof activeSession.apply === "function") activeSession.apply();
      });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (!activeSession) return;
      event.preventDefault();
      activeSession.cancel();
    });
    return modal;
  }

  function openModal(modal) {
    modal.classList.remove("hidden");
    modal.removeAttribute("hidden");
    document.body.classList.add("ll-modal-open");
  }

  function closeModal(modal) {
    modal.classList.add("hidden");
    modal.setAttribute("hidden", "");
    document.body.classList.remove("ll-modal-open");
  }

  function setPreview(wrap, url, round) {
    if (!wrap) return;
    let preview = wrap.querySelector("[data-crop-preview]");
    if (!preview) {
      preview = document.createElement("div");
      preview.className = "ll-crop-preview" + (round ? " is-round" : "");
      preview.setAttribute("data-crop-preview", "");
      wrap.insertBefore(preview, wrap.firstChild);
    }
    preview.classList.toggle("is-round", Boolean(round));
    preview.innerHTML = url
      ? `<img src="${url}" alt="" />`
      : `<span class="ll-crop-preview-empty">${t("crop_choose", "Choose photo")}</span>`;
  }

  function bindInput(input) {
    if (!input || input.dataset.cropBound === "1") return;
    if (typeof window.Cropper === "undefined") return;
    input.dataset.cropBound = "1";

    const aspect = parseFloat(input.dataset.cropAspect || "1") || 1;
    const maxEdge = parseInt(input.dataset.cropMax || "1200", 10) || 1200;
    const quality = parseFloat(input.dataset.cropQuality || "0.85") || 0.85;
    const round = input.dataset.cropRound === "1";

    const wrap = document.createElement("div");
    wrap.className = "ll-crop-field";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const holder = input.closest("form") || document;
    const current = holder.querySelector("[data-current-image]");
    const currentUrl = current ? current.getAttribute("data-current-image") : "";
    setPreview(wrap, currentUrl || "", round);

    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "ll-btn ll-btn-ghost ll-crop-pick";
    pickBtn.textContent = currentUrl
      ? t("crop_change", "Change photo")
      : t("crop_choose", "Choose photo");
    wrap.appendChild(pickBtn);
    input.classList.add("ll-crop-file-input");

    let cropper = null;
    let objectUrl = null;
    const modal = ensureModal();
    const img = modal.querySelector("#ll-crop-image");

    function destroyCropper() {
      if (cropper) {
        cropper.destroy();
        cropper = null;
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
      if (img) img.removeAttribute("src");
    }

    function cancelCrop() {
      destroyCropper();
      activeSession = null;
      closeModal(modal);
      input.value = "";
    }

    function applyCrop() {
      if (!cropper) return;
      const canvas = cropper.getCroppedCanvas({
        maxWidth: maxEdge,
        maxHeight: maxEdge,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
      });
      if (!canvas) return;
      canvas.toBlob(
        function (blob) {
          if (!blob) return;
          const fileName = (input.files && input.files[0] && input.files[0].name) || "image.jpg";
          const base = fileName.replace(/\.[^.]+$/, "") || "image";
          const file = new File([blob], base + ".jpg", { type: "image/jpeg" });
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          setPreview(wrap, URL.createObjectURL(blob), round);
          pickBtn.textContent = t("crop_change", "Change photo");
          destroyCropper();
          activeSession = null;
          closeModal(modal);
        },
        "image/jpeg",
        quality
      );
    }

    function startCrop(file) {
      if (!file || !String(file.type || "").startsWith("image/")) return;
      destroyCropper();
      objectUrl = URL.createObjectURL(file);
      activeSession = { apply: applyCrop, cancel: cancelCrop };
      img.onload = function () {
        cropper = new window.Cropper(img, {
          aspectRatio: aspect,
          viewMode: 1,
          dragMode: "move",
          autoCropArea: 1,
          responsive: true,
          background: false,
          guides: true,
          center: true,
          highlight: false,
          cropBoxMovable: true,
          cropBoxResizable: true,
          toggleDragModeOnDblclick: false,
        });
        openModal(modal);
      };
      img.src = objectUrl;
    }

    pickBtn.addEventListener("click", function () {
      input.click();
    });

    input.addEventListener("change", function () {
      const file = input.files && input.files[0];
      if (!file) return;
      startCrop(file);
    });
  }

  function init() {
    document.querySelectorAll('input[type="file"][data-image-crop="1"]').forEach(bindInput);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
