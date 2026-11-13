(function () {
  "use strict";

  var uiNode = document.getElementById("ui-i18n");
  var UI = {};
  try {
    UI = uiNode ? JSON.parse(uiNode.textContent || "{}") : {};
  } catch (_) {
    UI = {};
  }

  function t(key, fallback) {
    return UI[key] || fallback || key;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function defaultLabel(el) {
    if (!el) return t("working", "Working…");
    return (
      el.getAttribute("data-mv-busy-label") ||
      t("working", "Working…")
    );
  }

  function isBusy(el) {
    return Boolean(el && el.dataset && el.dataset.mvBusy === "1");
  }

  function lock(el, opts) {
    opts = opts || {};
    if (!el) return el;
    if (el.dataset && el.dataset.mvBusySkip === "1") return el;
    if (isBusy(el) && !opts.force) return el;

    el.dataset.mvBusy = "1";
    if ("disabled" in el) {
      el.dataset.mvBusyWasDisabled = el.disabled ? "1" : "0";
      el.disabled = true;
    }
    if (el.tagName === "A") {
      el.dataset.mvBusyHref = el.getAttribute("href") || "";
      el.setAttribute("aria-disabled", "true");
      el.classList.add("is-busy-link");
    }
    el.setAttribute("aria-busy", "true");
    el.classList.add("is-busy");

    var label = opts.label != null ? opts.label : defaultLabel(el);
    var keepLabel = opts.keepLabel === true || el.getAttribute("data-mv-busy-keep-label") === "1";

    // <input type="submit|button"> cannot host HTML spinner.
    if (el.tagName === "INPUT") {
      el.dataset.mvBusyValue = el.value || "";
      el.value = keepLabel ? el.value || label : label;
      return el;
    }

    el.dataset.mvBusyHtml = el.innerHTML;
    var showLabel = keepLabel
      ? (el.textContent || "").trim() || label
      : label;
    // Icon-only / compact controls: spinner only.
    if (
      el.classList.contains("study-icon-btn") ||
      el.classList.contains("mv-icon-btn") ||
      el.classList.contains("mv-search-submit")
    ) {
      showLabel = "";
    }
    el.innerHTML =
      '<span class="mv-busy-spin" aria-hidden="true"></span>' +
      (showLabel
        ? '<span class="mv-busy-text">' + escapeHtml(showLabel) + "</span>"
        : "");
    return el;
  }

  function unlock(el) {
    if (!el || !isBusy(el)) return el;
    if (el.tagName === "INPUT") {
      if (el.dataset.mvBusyValue != null) el.value = el.dataset.mvBusyValue;
      delete el.dataset.mvBusyValue;
    } else {
      var html = el.dataset.mvBusyHtml;
      if (html != null) el.innerHTML = html;
      delete el.dataset.mvBusyHtml;
    }
    if ("disabled" in el) {
      el.disabled = el.dataset.mvBusyWasDisabled === "1";
    }
    if (el.tagName === "A") {
      el.removeAttribute("aria-disabled");
      el.classList.remove("is-busy-link");
    }
    el.removeAttribute("aria-busy");
    el.classList.remove("is-busy");
    delete el.dataset.mvBusy;
    delete el.dataset.mvBusyWasDisabled;
    delete el.dataset.mvBusyHref;
    return el;
  }

  function unlockAll(root) {
    (root || document)
      .querySelectorAll('[data-mv-busy="1"]')
      .forEach(function (el) {
        unlock(el);
      });
  }

  function lockForm(form, submitter, opts) {
    if (!form) return;
    form.setAttribute("aria-busy", "true");
    form.classList.add("is-busy-form");
    var buttons = form.querySelectorAll(
      'button[type="submit"], input[type="submit"], button:not([type]), button[type="button"][data-mv-busy]'
    );
    buttons.forEach(function (btn) {
      if (btn.hasAttribute("data-mv-busy-skip")) return;
      lock(btn, opts);
    });
    if (submitter) lock(submitter, opts);
  }

  function run(el, task, opts) {
    opts = opts || {};
    if (!el) {
      return Promise.resolve().then(task);
    }
    if (isBusy(el) && !opts.force) {
      return Promise.resolve();
    }
    lock(el, opts);
    return Promise.resolve()
      .then(task)
      .then(
        function (value) {
          if (!opts.keepLocked) unlock(el);
          return value;
        },
        function (err) {
          unlock(el);
          throw err;
        }
      );
  }

  window.MvBusy = {
    lock: lock,
    unlock: unlock,
    unlockAll: unlockAll,
    lockForm: lockForm,
    run: run,
    isBusy: isBusy,
  };

  // Native form posts (login, enroll, delete, …): lock submit controls.
  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.hasAttribute("data-mv-busy-skip")) return;
      // Confirm modal may cancel in capture; if we are here, submit proceeds.
      if (event.defaultPrevented) return;
      var submitter = event.submitter || null;
      lockForm(form, submitter, {
        label:
          (submitter && submitter.getAttribute("data-mv-busy-label")) ||
          form.getAttribute("data-mv-busy-label") ||
          t("working", "Working…"),
      });
    },
    false
  );

  // Primary action links (Study, Open, …): show busy until navigation.
  document.addEventListener(
    "click",
    function (event) {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button != null && event.button !== 0) return;
      var link = event.target.closest(
        "a.mv-btn[href], a[data-mv-busy][href]"
      );
      if (!link) return;
      if (link.hasAttribute("data-mv-busy-skip")) return;
      if (link.getAttribute("target") === "_blank") return;
      if (link.hasAttribute("download")) return;
      if (link.getAttribute("href") === "#" || link.getAttribute("href") === "") return;
      lock(link, {
        label: link.getAttribute("data-mv-busy-label") || t("loading", "Loading…"),
      });
    },
    true
  );

  // Explicit buttons marked for one-shot busy (until unlock/run).
  document.addEventListener(
    "click",
    function (event) {
      var btn = event.target.closest("button[data-mv-busy='click'], [role='button'][data-mv-busy='click']");
      if (!btn) return;
      if (event.defaultPrevented) return;
      lock(btn);
    },
    true
  );

  window.addEventListener("pageshow", function () {
    unlockAll(document);
    document.querySelectorAll("form.is-busy-form").forEach(function (form) {
      form.classList.remove("is-busy-form");
      form.removeAttribute("aria-busy");
    });
  });
})();
