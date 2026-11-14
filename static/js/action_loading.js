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

  function prefersOverlayOnly(el) {
    if (!el) return false;
    return (
      el.classList.contains("mv-nav-item") ||
      el.classList.contains("mv-desk-link") ||
      el.classList.contains("mv-icon-btn") ||
      el.classList.contains("mv-course-cover") ||
      el.classList.contains("mv-course-cover-square") ||
      el.classList.contains("mv-course-thumb") ||
      el.closest(".mv-course-tile, .mv-course-row, .mv-explore-row") != null
    );
  }

  function freezeSize(el) {
    if (!el || !el.getBoundingClientRect) return;
    var rect = el.getBoundingClientRect();
    if (rect.width > 0) {
      el.style.minWidth = Math.ceil(rect.width) + "px";
      el.dataset.mvBusyMinWidth = "1";
    }
    if (rect.height > 0) {
      el.style.minHeight = Math.ceil(rect.height) + "px";
      el.dataset.mvBusyMinHeight = "1";
    }
  }

  function unfreezeSize(el) {
    if (!el) return;
    if (el.dataset.mvBusyMinWidth) {
      el.style.minWidth = "";
      delete el.dataset.mvBusyMinWidth;
    }
    if (el.dataset.mvBusyMinHeight) {
      el.style.minHeight = "";
      delete el.dataset.mvBusyMinHeight;
    }
  }

  function lock(el, opts) {
    opts = opts || {};
    if (!el) return el;
    if (el.dataset && el.dataset.mvBusySkip === "1") return el;
    if (isBusy(el) && !opts.force) return el;

    freezeSize(el);
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

    var overlayOnly =
      opts.overlayOnly === true ||
      el.getAttribute("data-mv-busy-overlay") === "1" ||
      prefersOverlayOnly(el);
    if (overlayOnly) {
      el.classList.add("is-busy-overlay");
      return el;
    }

    // Keep the original label/content so layout width/height stay stable.
    // CSS fades the text and shows a spinner on top.
    if (el.tagName === "INPUT") {
      // Keep the same value — do not swap to a longer "Working…" string.
      return el;
    }
    el.classList.add("is-busy-keep");
    return el;
  }

  function unlock(el) {
    if (!el || !isBusy(el)) return el;
    unfreezeSize(el);
    if ("disabled" in el) {
      el.disabled = el.dataset.mvBusyWasDisabled === "1";
    }
    if (el.tagName === "A") {
      el.removeAttribute("aria-disabled");
      el.classList.remove("is-busy-link");
    }
    el.removeAttribute("aria-busy");
    el.classList.remove("is-busy");
    el.classList.remove("is-busy-overlay");
    el.classList.remove("is-busy-keep");
    delete el.dataset.mvBusy;
    delete el.dataset.mvBusyWasDisabled;
    delete el.dataset.mvBusyHref;
    delete el.dataset.mvBusyHtml;
    delete el.dataset.mvBusyValue;
    return el;
  }

  function unlockAll(root) {
    (root || document)
      .querySelectorAll('[data-mv-busy="1"]')
      .forEach(function (el) {
        unlock(el);
      });
    hidePageBusy();
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

  function ensurePageBusyEl() {
    var el = document.getElementById("mv-page-busy");
    if (el) return el;
    el = document.createElement("div");
    el.id = "mv-page-busy";
    el.className = "mv-page-busy";
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML =
      '<div class="mv-page-busy__bar" aria-hidden="true"></div>' +
      '<div class="mv-page-busy__card" role="status" aria-live="polite">' +
      '<span class="mv-busy-spin" aria-hidden="true"></span>' +
      '<span class="mv-page-busy__text">' +
      escapeHtml(t("loading", "Loading…")) +
      "</span>" +
      "</div>";
    document.body.appendChild(el);
    return el;
  }

  function showPageBusy() {
    var el = ensurePageBusyEl();
    var text = el.querySelector(".mv-page-busy__text");
    if (text) text.textContent = t("loading", "Loading…");
    el.hidden = false;
    el.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("is-page-busy");
    document.body.classList.add("is-page-busy");
  }

  function hidePageBusy() {
    var el = document.getElementById("mv-page-busy");
    if (el) {
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
    }
    document.documentElement.classList.remove("is-page-busy");
    document.body.classList.remove("is-page-busy");
  }

  function isIgnoredNavLink(link) {
    if (!link) return true;
    if (link.hasAttribute("data-mv-busy-skip")) return true;
    if (link.hasAttribute("data-course-feed-filter")) return true;
    if (link.hasAttribute("data-course-feed-clear")) return true;
    if (link.closest("[data-chip-scroller]")) return true;
    if (link.getAttribute("target") === "_blank") return true;
    if (link.hasAttribute("download")) return true;
    var href = link.getAttribute("href") || "";
    if (!href || href === "#" || href.indexOf("javascript:") === 0) return true;
    return false;
  }

  function isSamePageNavigation(link) {
    try {
      var url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return true;
      return (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        (!url.hash || url.hash === window.location.hash)
      );
    } catch (_) {
      return false;
    }
  }

  function isAppNavigationLink(link) {
    if (!link || link.tagName !== "A") return false;
    if (isIgnoredNavLink(link)) return false;
    return Boolean(
      link.classList.contains("mv-nav-item") ||
        link.classList.contains("mv-desk-link") ||
        link.classList.contains("mv-icon-btn") ||
        link.classList.contains("mv-btn") ||
        link.classList.contains("mv-course-cover") ||
        link.classList.contains("mv-course-cover-square") ||
        link.classList.contains("mv-course-thumb") ||
        link.hasAttribute("data-mv-busy") ||
        link.hasAttribute("data-mv-nav") ||
        link.closest(".mv-course-tile, .mv-course-row, .mv-explore-row, .mv-card-interactive")
    );
  }

  function beginNavigation(link) {
    if (!link || isSamePageNavigation(link)) return;
    // Page-level loading only — do not put spinners on nav/page buttons.
    showPageBusy();
  }

  window.MvBusy = {
    lock: lock,
    unlock: unlock,
    unlockAll: unlockAll,
    lockForm: lockForm,
    run: run,
    isBusy: isBusy,
    showPageBusy: showPageBusy,
    hidePageBusy: hidePageBusy,
    beginNavigation: beginNavigation,
  };

  // Native form posts (login, enroll, delete, …): lock submit controls.
  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.hasAttribute("data-mv-busy-skip")) return;
      if (event.defaultPrevented) return;
      var submitter = event.submitter || null;
      showPageBusy();
      lockForm(form, submitter, {
        label:
          (submitter && submitter.getAttribute("data-mv-busy-label")) ||
          form.getAttribute("data-mv-busy-label") ||
          t("working", "Working…"),
      });
    },
    false
  );

  // App navigation + course cards + primary action links.
  document.addEventListener(
    "click",
    function (event) {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.button != null && event.button !== 0) return;
      var link = event.target.closest("a[href]");
      if (!isAppNavigationLink(link)) return;
      beginNavigation(link);
    },
    true
  );

  // Explicit buttons marked for one-shot busy (until unlock/run).
  document.addEventListener(
    "click",
    function (event) {
      var btn = event.target.closest(
        "button[data-mv-busy='click'], [role='button'][data-mv-busy='click']"
      );
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

  window.addEventListener("pagehide", function () {
    // Keep overlay visible while leaving; pageshow clears it if user returns via bfcache.
  });

  document.addEventListener("DOMContentLoaded", function () {
    ensurePageBusyEl();
    hidePageBusy();
  });
})();
