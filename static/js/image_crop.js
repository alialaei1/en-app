(function () {
  const UI_NODE = document.getElementById("ui-i18n");
  const UI = UI_NODE ? JSON.parse(UI_NODE.textContent || "{}") : {};

  function t(key, fallback) {
    return UI[key] || fallback || key;
  }

  let activeSession = null;

  function ensureModal() {
    let modal = document.getElementById("mv-crop-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "mv-crop-modal";
    modal.className = "mv-crop-modal hidden";
    modal.setAttribute("hidden", "");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <button type="button" class="mv-crop-backdrop" data-crop-cancel aria-label="${t("cancel", "Cancel")}"></button>
      <div class="mv-crop-panel">
        <div class="mv-crop-head">
          <div>
            <h2 class="mv-crop-title">${t("crop_title", "Crop image")}</h2>
            <p class="mv-crop-hint">${t("crop_hint", "Drag to frame the area you want.")}</p>
          </div>
          <button type="button" class="mv-btn mv-btn-ghost" data-crop-cancel style="min-height:2.35rem">${t("cancel", "Cancel")}</button>
        </div>
        <div class="mv-crop-stage">
          <img id="mv-crop-image" alt="" />
        </div>
        <div class="mv-crop-actions">
          <button type="button" class="mv-btn mv-btn-ghost" data-crop-cancel>${t("cancel", "Cancel")}</button>
          <button type="button" class="mv-btn mv-btn-primary" id="mv-crop-apply">${t("crop_apply", "Use photo")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll("[data-crop-cancel]").forEach(function (el) {
      el.addEventListener("click", function () {
        if (activeSession && typeof activeSession.cancel === "function") activeSession.cancel();
      });
    });
    const applyBtn = modal.querySelector("#mv-crop-apply");
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
    document.body.classList.add("mv-modal-open");
  }

  function closeModal(modal) {
    modal.classList.add("hidden");
    modal.setAttribute("hidden", "");
    document.body.classList.remove("mv-modal-open");
  }

  function setPreview(wrap, url, round) {
    if (!wrap) return;
    let preview = wrap.querySelector("[data-crop-preview]");
    if (!preview) {
      preview = document.createElement("div");
      preview.className = "mv-crop-preview" + (round ? " is-round" : "");
      preview.setAttribute("data-crop-preview", "");
      wrap.insertBefore(preview, wrap.firstChild);
    }
    preview.classList.toggle("is-round", Boolean(round));
    preview.innerHTML = url
      ? `<img src="${url}" alt="" />`
      : `<span class="mv-crop-preview-empty">${t("crop_choose", "Choose photo")}</span>`;
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
    wrap.className = "mv-crop-field";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const holder = input.closest("form") || document;
    const current = holder.querySelector("[data-current-image]");
    const currentUrl = current ? current.getAttribute("data-current-image") : "";
    setPreview(wrap, currentUrl || "", round);

    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "mv-btn mv-btn-ghost mv-crop-pick";
    pickBtn.textContent = currentUrl
      ? t("crop_change", "Change photo")
      : t("crop_choose", "Choose photo");
    wrap.appendChild(pickBtn);
    input.classList.add("mv-crop-file-input");

    let cropper = null;
    let objectUrl = null;
    const modal = ensureModal();
    const img = modal.querySelector("#mv-crop-image");

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
      const applyBtn = modal.querySelector("#mv-crop-apply");
      if (applyBtn && window.MvBusy && window.MvBusy.isBusy(applyBtn)) return;
      if (applyBtn && window.MvBusy) {
        window.MvBusy.lock(applyBtn, { label: t("working", "Working…") });
      }
      const canvas = cropper.getCroppedCanvas({
        maxWidth: maxEdge,
        maxHeight: maxEdge,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
      });
      if (!canvas) {
        if (applyBtn && window.MvBusy) window.MvBusy.unlock(applyBtn);
        return;
      }
      canvas.toBlob(
        function (blob) {
          if (!blob) {
            if (applyBtn && window.MvBusy) window.MvBusy.unlock(applyBtn);
            return;
          }
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
          if (applyBtn && window.MvBusy) window.MvBusy.unlock(applyBtn);
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
