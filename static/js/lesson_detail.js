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

  const root = document.getElementById("lesson-detail-root");
  if (!root) return;

  const statusUrl = root.dataset.statusUrl;
  const initialStatus = root.dataset.status;
  const reorderUrl = root.dataset.reorderUrl;
  const overlay = document.getElementById("process-overlay");
  const overlayTitle = document.getElementById("process-title");
  const overlayMessage = document.getElementById("process-message");
  const overlayPercent = document.getElementById("process-percent");
  const overlayRemaining = document.getElementById("process-remaining");
  const overlayBar = document.getElementById("process-bar");
  const reprocessForm = document.getElementById("reprocess-form");
  const chunkList = document.getElementById("chunk-list");
  const reorderStatus = document.getElementById("reorder-status");
  const csrfToken =
    document.querySelector("#chunks-form [name=csrfmiddlewaretoken]")?.value ||
    document.querySelector("[name=csrfmiddlewaretoken]")?.value;

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

  function showOverlay() {
    if (!overlay) return;
    overlay.classList.remove("hidden");
    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.style.display = "none";
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function pollUntilDone() {
    showOverlay();
    const tick = () => {
      fetch(statusUrl, { headers: { "X-Requested-With": "XMLHttpRequest" } })
        .then((res) => res.json())
        .then((data) => {
          updateOverlay(
            "Please wait — do not click anything",
            data.message || "Processing lesson…",
            data.progress || 0
          );
          if (data.status === "ready" || data.status === "failed") {
            window.location.reload();
            return;
          }
          setTimeout(tick, 700);
        })
        .catch(() => setTimeout(tick, 1200));
    };
    tick();
  }

  if (initialStatus === "processing") {
    pollUntilDone();
  }

  if (reprocessForm) {
    reprocessForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const csrf = reprocessForm.querySelector("[name=csrfmiddlewaretoken]")?.value;
      const submitter =
        event.submitter ||
        reprocessForm.querySelector('button[type="submit"], input[type="submit"]');
      const run = async () => {
        showOverlay();
        updateOverlay("Please wait — do not click anything", "Starting re-process…", 2);
        const response = await fetch(reprocessForm.action, {
          method: "POST",
          headers: { "X-Requested-With": "XMLHttpRequest" },
          body: new URLSearchParams({ csrfmiddlewaretoken: csrf }),
        });
        const payload = await response.json();
        if (!payload.ok) throw new Error("Could not start re-process.");
        pollUntilDone();
      };
      try {
        if (window.MvBusy && submitter) {
          await window.MvBusy.run(submitter, run, {
            label: t("working", "Working…"),
            keepLocked: true,
          });
        } else {
          await run();
        }
      } catch (err) {
        hideOverlay();
        if (window.MvBusy && submitter) window.MvBusy.unlock(submitter);
        alert(err.message || "Re-process failed to start.");
      }
    });
  }

  function renumberItems() {
    if (!chunkList) return;
    chunkList.querySelectorAll(".chunk-item").forEach((item, index) => {
      const label = item.querySelector(".chunk-index");
      if (label) label.textContent = `Item ${index + 1}`;
    });
  }

  function currentOrder() {
    return [...chunkList.querySelectorAll(".chunk-item")].map(
      (item) => item.dataset.chunkId
    );
  }

  function showReorderMessage(text, isError) {
    if (!reorderStatus) return;
    reorderStatus.textContent = text;
    reorderStatus.classList.remove("hidden", "text-emerald-300", "text-rose-300");
    reorderStatus.classList.add(isError ? "text-rose-300" : "text-emerald-300");
    window.clearTimeout(showReorderMessage._timer);
    showReorderMessage._timer = window.setTimeout(() => {
      reorderStatus.classList.add("hidden");
    }, 1800);
  }

  async function persistOrder() {
    if (!chunkList || !reorderUrl) return;
    const order = currentOrder();
    try {
      const response = await fetch(reorderUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": csrfToken || "",
        },
        body: JSON.stringify({ order }),
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || t("could_not_save_order", "Could not save order."));
      }
      showReorderMessage("Order saved");
    } catch (err) {
      showReorderMessage(err.message || t("could_not_save_order", "Could not save order."), true);
    }
  }

  function setupDragAndDrop() {
    if (!chunkList) return;

    let dragging = null;
    let placeholder = null;
    let startOrder = [];
    let pointerId = null;
    let offsetY = 0;

    function items() {
      return [...chunkList.querySelectorAll(".chunk-item:not(.chunk-placeholder)")];
    }

    function createPlaceholder(height) {
      const el = document.createElement("div");
      el.className =
        "chunk-placeholder rounded-2xl border border-dashed border-emerald-500/50 bg-emerald-500/10";
      el.style.height = `${height}px`;
      return el;
    }

    function movePlaceholder(clientY) {
      const others = items().filter((item) => item !== dragging);
      let inserted = false;
      for (const item of others) {
        const rect = item.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        if (clientY < middle) {
          chunkList.insertBefore(placeholder, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) chunkList.appendChild(placeholder);
    }

    function onPointerMove(event) {
      if (!dragging || event.pointerId !== pointerId) return;
      event.preventDefault();
      const y = event.clientY - offsetY;
      dragging.style.top = `${y}px`;
      movePlaceholder(event.clientY);
      renumberItems();
    }

    function cleanupDrag(save) {
      if (!dragging) return;
      dragging.classList.remove("chunk-dragging");
      dragging.style.position = "";
      dragging.style.top = "";
      dragging.style.left = "";
      dragging.style.width = "";
      dragging.style.zIndex = "";
      dragging.style.pointerEvents = "";
      dragging.style.boxShadow = "";

      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.insertBefore(dragging, placeholder);
        placeholder.remove();
      }
      placeholder = null;

      const handle = dragging.querySelector(".chunk-handle");
      if (handle && pointerId != null) {
        try {
          handle.releasePointerCapture(pointerId);
        } catch (_) {}
      }

      dragging = null;
      pointerId = null;
      renumberItems();

      if (save) {
        const next = currentOrder().join(",");
        if (next !== startOrder.join(",")) persistOrder();
      }
    }

    function onPointerUp(event) {
      if (!dragging || event.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      cleanupDrag(true);
    }

    function onPointerCancel(event) {
      if (!dragging || event.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      cleanupDrag(false);
    }

    chunkList.querySelectorAll(".chunk-handle").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        const item = handle.closest(".chunk-item");
        if (!item) return;

        event.preventDefault();
        event.stopPropagation();

        dragging = item;
        pointerId = event.pointerId;
        startOrder = currentOrder();

        const rect = item.getBoundingClientRect();
        offsetY = event.clientY - rect.top;
        placeholder = createPlaceholder(rect.height);

        item.classList.add("chunk-dragging");
        item.style.position = "fixed";
        item.style.left = `${rect.left}px`;
        item.style.width = `${rect.width}px`;
        item.style.top = `${rect.top}px`;
        item.style.zIndex = "1000";
        item.style.pointerEvents = "none";
        item.style.boxShadow = "0 12px 40px rgba(0,0,0,0.45)";

        chunkList.insertBefore(placeholder, item);
        handle.setPointerCapture(event.pointerId);

        window.addEventListener("pointermove", onPointerMove, { passive: false });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerCancel);
      });
    });
  }

  setupDragAndDrop();
})();
