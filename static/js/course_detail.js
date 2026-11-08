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

  const root = document.getElementById("course-detail-root");
  if (!root) return;

  const csrfToken = root.dataset.csrf || "";
  const sectionReorderUrl = root.dataset.sectionReorderUrl || "";
  const lessonReorderTemplate = root.dataset.lessonReorderUrlTemplate || "";
  const statusEl = document.getElementById("course-reorder-status");

  function showStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.remove("hidden", "text-emerald-300", "text-rose-300");
    statusEl.classList.add(isError ? "text-rose-300" : "text-emerald-300");
    window.clearTimeout(showStatus._timer);
    showStatus._timer = window.setTimeout(() => {
      statusEl.classList.add("hidden");
    }, 1800);
  }

  async function persistOrder(url, order) {
    if (!url) return;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRFToken": csrfToken,
        },
        body: JSON.stringify({ order }),
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || t("could_not_save_order", "Could not save order."));
      }
      showStatus(t("order_saved", "Order saved"));
    } catch (err) {
      showStatus(err.message || t("could_not_save_order", "Could not save order."), true);
    }
  }

  function setupSortableList({
    list,
    itemSelector,
    handleSelector,
    idAttr,
    draggingClass,
    placeholderClass,
    getPersistUrl,
  }) {
    if (!list) return;

    let dragging = null;
    let placeholder = null;
    let startOrder = [];
    let pointerId = null;
    let offsetY = 0;

    function items() {
      return [...list.querySelectorAll(`${itemSelector}:not(.is-placeholder)`)];
    }

    function currentOrder() {
      return items().map((item) => item.getAttribute(idAttr));
    }

    function createPlaceholder(height) {
      const el = document.createElement(list.tagName === "UL" ? "li" : "div");
      el.className = `is-placeholder ${placeholderClass}`;
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
          list.insertBefore(placeholder, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) list.appendChild(placeholder);
    }

    function onPointerMove(event) {
      if (!dragging || event.pointerId !== pointerId) return;
      event.preventDefault();
      dragging.style.top = `${event.clientY - offsetY}px`;
      movePlaceholder(event.clientY);
    }

    function cleanupDrag(save) {
      if (!dragging) return;
      dragging.classList.remove(draggingClass);
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

      const handle = dragging.querySelector(handleSelector);
      if (handle && pointerId != null) {
        try {
          handle.releasePointerCapture(pointerId);
        } catch (_) {
          /* ignore */
        }
      }

      dragging = null;
      pointerId = null;

      if (save) {
        const next = currentOrder();
        if (next.join(",") !== startOrder.join(",")) {
          persistOrder(getPersistUrl(), next);
        }
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

    list.querySelectorAll(handleSelector).forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        if (event.button != null && event.button !== 0) return;
        const item = handle.closest(itemSelector);
        if (!item || !list.contains(item)) return;

        event.preventDefault();
        event.stopPropagation();

        dragging = item;
        pointerId = event.pointerId;
        startOrder = currentOrder();

        const rect = item.getBoundingClientRect();
        offsetY = event.clientY - rect.top;
        placeholder = createPlaceholder(rect.height);

        item.classList.add(draggingClass);
        item.style.position = "fixed";
        item.style.left = `${rect.left}px`;
        item.style.width = `${rect.width}px`;
        item.style.top = `${rect.top}px`;
        item.style.zIndex = "1000";
        item.style.pointerEvents = "none";
        item.style.boxShadow = "0 12px 40px rgba(0,0,0,0.45)";

        list.insertBefore(placeholder, item);
        handle.setPointerCapture(event.pointerId);

        window.addEventListener("pointermove", onPointerMove, { passive: false });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerCancel);
      });
    });
  }

  setupSortableList({
    list: document.getElementById("section-list"),
    itemSelector: ".section-item",
    handleSelector: ".section-handle",
    idAttr: "data-section-id",
    draggingClass: "section-dragging",
    placeholderClass:
      "rounded-2xl border border-dashed border-emerald-500/50 bg-emerald-500/10",
    getPersistUrl: () => sectionReorderUrl,
  });

  document.querySelectorAll(".lesson-list").forEach((list) => {
    const sectionId = list.dataset.sectionId;
    setupSortableList({
      list,
      itemSelector: ".lesson-item",
      handleSelector: ".lesson-handle",
      idAttr: "data-lesson-id",
      draggingClass: "lesson-dragging",
      placeholderClass:
        "rounded-xl border border-dashed border-emerald-500/50 bg-emerald-500/10",
      getPersistUrl: () =>
        lessonReorderTemplate.replace("{id}", String(sectionId || "")),
    });
  });
})();
