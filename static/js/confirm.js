(function () {
  const modal = document.getElementById("mv-confirm-modal");
  if (!modal) return;

  const titleEl = document.getElementById("mv-confirm-title");
  const messageEl = document.getElementById("mv-confirm-message");
  const yesBtn = document.getElementById("mv-confirm-yes");
  const noBtn = document.getElementById("mv-confirm-no");
  const uiNode = document.getElementById("ui-i18n");
  const UI = uiNode ? JSON.parse(uiNode.textContent || "{}") : {};

  let pending = null;
  let lastFocus = null;

  function openModal(message, action) {
    pending = action;
    lastFocus = document.activeElement;
    if (window.MvBusy && yesBtn) window.MvBusy.unlock(yesBtn);
    if (messageEl) messageEl.textContent = message || "";
    if (titleEl) {
      titleEl.textContent = UI.confirm_title || "Please confirm";
    }
    if (yesBtn) yesBtn.textContent = UI.confirm_yes || "Confirm";
    if (noBtn) noBtn.textContent = UI.cancel || "Cancel";
    modal.classList.remove("hidden");
    modal.removeAttribute("hidden");
    document.body.classList.add("mv-modal-open");
    if (yesBtn) yesBtn.focus();
  }

  function closeModal() {
    pending = null;
    modal.classList.add("hidden");
    modal.setAttribute("hidden", "");
    document.body.classList.remove("mv-modal-open");
    if (lastFocus && typeof lastFocus.focus === "function") {
      try {
        lastFocus.focus();
      } catch (_) {
        /* ignore */
      }
    }
  }

  function proceed() {
    const action = pending;
    if (yesBtn && window.MvBusy) {
      window.MvBusy.lock(yesBtn, { label: UI.working || "Working…" });
    }
    closeModal();
    if (!action) return;
    if (action.kind === "form" && action.form) {
      action.form.dataset.llConfirmed = "1";
      if (window.MvBusy) {
        window.MvBusy.lockForm(action.form, action.submitter || null, {
          label: UI.working || "Working…",
        });
      }
      if (typeof action.form.requestSubmit === "function") {
        action.form.requestSubmit(action.submitter || undefined);
      } else if (action.submitter) {
        action.submitter.click();
      } else {
        action.form.submit();
      }
      return;
    }
    if (action.kind === "promise" && typeof action.resolve === "function") {
      action.resolve(true);
      if (yesBtn && window.MvBusy) window.MvBusy.unlock(yesBtn);
    }
  }

  function cancel() {
    const action = pending;
    closeModal();
    if (action && action.kind === "promise" && typeof action.resolve === "function") {
      action.resolve(false);
    }
  }

  document.addEventListener(
    "submit",
    function (event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.llConfirmed === "1") {
        delete form.dataset.llConfirmed;
        return;
      }
      const submitter = event.submitter || null;
      const message =
        (submitter && submitter.getAttribute("data-confirm")) ||
        form.getAttribute("data-confirm");
      if (!message) return;
      event.preventDefault();
      event.stopPropagation();
      openModal(message, { kind: "form", form: form, submitter: submitter });
    },
    true
  );

  yesBtn && yesBtn.addEventListener("click", proceed);
  noBtn && noBtn.addEventListener("click", cancel);
  modal.querySelectorAll("[data-mv-confirm-close]").forEach(function (el) {
    el.addEventListener("click", cancel);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (modal.hasAttribute("hidden")) return;
    event.preventDefault();
    cancel();
  });

  window.llConfirm = function (message) {
    return new Promise(function (resolve) {
      openModal(message, { kind: "promise", resolve: resolve });
    });
  };
})();
