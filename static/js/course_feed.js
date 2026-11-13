(function () {
  const uiNode = document.getElementById("ui-i18n");
  const UI = uiNode ? JSON.parse(uiNode.textContent || "{}") : {};

  function t(key, fallback) {
    return UI[key] || fallback || key;
  }

  function initFeed(root) {
    const endpoint = root.dataset.endpoint || window.location.pathname;
    const listEl = root.querySelector("[data-course-feed-list]");
    const emptyEl = root.querySelector("[data-course-feed-empty]");
    const sentinel = root.querySelector("[data-course-feed-sentinel]");
    const loadingEl = root.querySelector("[data-course-feed-loading]");
    const titleEl = root.querySelector("[data-course-feed-title]");
    const metaEl = root.querySelector("[data-course-feed-meta]");
    const searchForm = root.querySelector("[data-course-feed-search]");
    const clearLink = root.querySelector("[data-course-feed-clear]");
    const filterInput = searchForm
      ? searchForm.querySelector('input[name="f"]')
      : null;

    const defaultFilter = root.dataset.defaultFilter || "suggested";
    let page = Number(root.dataset.page || 1) || 1;
    let hasMore = root.dataset.hasMore === "1";
    let loading = false;
    let activeFilter = root.dataset.activeFilter || defaultFilter;
    let query = root.dataset.query || "";
    let abortController = null;
    let observer = null;
    let scrollFallbackBound = false;

    function ensureLoadingMarkup() {
      if (!loadingEl) return;
      if (loadingEl.querySelector(".mv-busy-spin")) return;
      const label = loadingEl.textContent || t("loading_more", "Loading more…");
      loadingEl.innerHTML =
        '<span class="mv-busy-spin" aria-hidden="true"></span>' +
        '<span class="mv-feed-loading-text">' +
        label +
        "</span>";
    }

    function setLoading(on) {
      loading = on;
      ensureLoadingMarkup();
      if (loadingEl) {
        if (on) {
          delete loadingEl.dataset.error;
          const text = loadingEl.querySelector(".mv-feed-loading-text");
          if (text) text.textContent = t("loading_more", "Loading more…");
          loadingEl.hidden = false;
        } else if (loadingEl.dataset.error !== "1") {
          loadingEl.hidden = true;
        }
        loadingEl.setAttribute("aria-busy", on ? "true" : "false");
      }
      root.classList.toggle("is-loading", on);
    }

    function syncFilterChips() {
      root.querySelectorAll("[data-course-feed-filter]").forEach(function (chip) {
        const key = chip.getAttribute("data-course-feed-filter") || "";
        chip.classList.toggle("is-active", key === activeFilter);
      });
      if (filterInput) {
        if (activeFilter && activeFilter !== defaultFilter) {
          filterInput.value = activeFilter;
          filterInput.disabled = false;
        } else {
          filterInput.value = "";
          filterInput.disabled = true;
        }
      }
    }

    function syncClearLink() {
      if (!clearLink) return;
      if (!query) {
        clearLink.hidden = true;
        return;
      }
      clearLink.hidden = false;
      const params = new URLSearchParams();
      if (activeFilter && activeFilter !== defaultFilter) params.set("f", activeFilter);
      const qs = params.toString();
      clearLink.href = endpoint + (qs ? "?" + qs : "");
    }

    function updateMeta(data) {
      if (titleEl) {
        const label = data.filter_label || root.dataset.filterLabel || "";
        if (data.query) {
          titleEl.textContent =
            (t("search_results", "Search results") + (label ? " · " + label : "")).trim();
        } else if (label) {
          titleEl.textContent = label;
        }
      }
      if (metaEl) {
        if (data.query) {
          metaEl.hidden = false;
          metaEl.textContent =
            String(data.total || 0) +
            " " +
            t("results_for", "results for") +
            ' “' +
            data.query +
            "”";
        } else {
          metaEl.hidden = true;
          metaEl.textContent = "";
        }
      }
      if (typeof data.filter_label === "string") {
        root.dataset.filterLabel = data.filter_label;
      }
    }

    function applyList(html, append, isEmpty) {
      if (!listEl) return;
      if (append) {
        listEl.insertAdjacentHTML("beforeend", html || "");
      } else {
        listEl.innerHTML = html || "";
      }
      if (emptyEl) emptyEl.hidden = !isEmpty;
      if (listEl) listEl.hidden = !!isEmpty;
      if (isEmpty && emptyEl) {
        const qNode = emptyEl.querySelector("[data-empty-query]");
        const noQuery = emptyEl.querySelector("[data-empty-no-query]");
        const withQuery = emptyEl.querySelector("[data-empty-with-query]");
        if (query) {
          if (withQuery) withQuery.hidden = false;
          if (noQuery) noQuery.hidden = true;
          if (qNode) qNode.textContent = query;
        } else {
          if (withQuery) withQuery.hidden = true;
          if (noQuery) noQuery.hidden = false;
        }
      }
    }

    function buildUrl(nextPage, opts) {
      const params = new URLSearchParams();
      const f = opts && opts.filter != null ? opts.filter : activeFilter;
      const q = opts && opts.query != null ? opts.query : query;
      if (f && f !== defaultFilter) params.set("f", f);
      if (q) params.set("q", q);
      if (nextPage > 1) params.set("page", String(nextPage));
      const qs = params.toString();
      return endpoint + (qs ? "?" + qs : "");
    }

    function updateHistory(url) {
      if (!root.dataset.history || root.dataset.history === "0") return;
      try {
        window.history.pushState({ courseFeed: true }, "", url);
      } catch (_) {
        /* ignore */
      }
    }

    function setSentinel(on) {
      if (!sentinel) return;
      sentinel.hidden = !on;
      if (observer) {
        observer.disconnect();
        if (on) observer.observe(sentinel);
      }
    }

    function sentinelInView() {
      if (!sentinel || sentinel.hidden) return false;
      const rect = sentinel.getBoundingClientRect();
      const viewH =
        (window.visualViewport && window.visualViewport.height) ||
        window.innerHeight ||
        document.documentElement.clientHeight ||
        0;
      return rect.top < viewH + 420;
    }

    function maybeLoadMore() {
      if (loading || !hasMore) return;
      if (!sentinelInView()) return;
      loadMore();
    }

    function fetchPage(nextPage, opts) {
      const replace = !opts || opts.replace !== false;
      const push = opts && opts.push;
      const url = buildUrl(nextPage, opts);

      if (abortController) abortController.abort();
      abortController = new AbortController();
      setLoading(true);

      return fetch(url, {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json",
        },
        credentials: "same-origin",
        signal: abortController.signal,
      })
        .then(function (res) {
          if (!res.ok) throw new Error("feed_http_" + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.ok) throw new Error("feed_bad_payload");
          page = Number(data.page) || nextPage;
          hasMore = !!data.has_more;
          if (typeof data.active_filter === "string") activeFilter = data.active_filter;
          if (typeof data.query === "string") query = data.query;
          if (opts && opts.filter != null) activeFilter = opts.filter;
          if (opts && opts.query != null) query = opts.query;

          root.dataset.page = String(page);
          root.dataset.hasMore = hasMore ? "1" : "0";
          root.dataset.activeFilter = activeFilter || "";
          root.dataset.query = query || "";

          applyList(data.html || "", !replace && !!data.append, !!data.is_empty);
          updateMeta(data);
          syncFilterChips();
          syncClearLink();
          setSentinel(hasMore);

          if (push) updateHistory(buildUrl(1, { filter: activeFilter, query: query }));
          if (searchForm) {
            const qInput = searchForm.querySelector('input[name="q"]');
            if (qInput && document.activeElement !== qInput) qInput.value = query;
          }
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          ensureLoadingMarkup();
          if (loadingEl) {
            const text = loadingEl.querySelector(".mv-feed-loading-text");
            if (text) {
              text.textContent = t(
                "feed_load_failed",
                "Could not load courses. Try again."
              );
            }
            loadingEl.dataset.error = "1";
            loadingEl.hidden = false;
          }
        })
        .finally(function () {
          setLoading(false);
          // If the first page is short (iOS tall screens), keep filling until sentinel leaves view.
          if (hasMore && !(loadingEl && loadingEl.dataset.error === "1")) {
            window.requestAnimationFrame(function () {
              window.setTimeout(maybeLoadMore, 50);
            });
          }
        });
    }

    function loadMore() {
      if (loading || !hasMore) return;
      fetchPage(page + 1, { replace: false, push: false });
    }

    function resetAndLoad(opts) {
      page = 1;
      hasMore = true;
      setSentinel(false);
      return fetchPage(1, {
        replace: true,
        push: true,
        filter: opts.filter,
        query: opts.query,
      });
    }

    root.querySelectorAll("[data-course-feed-filter]").forEach(function (chip) {
      chip.addEventListener("click", function (event) {
        event.preventDefault();
        const key = chip.getAttribute("data-course-feed-filter") || defaultFilter;
        if (key === activeFilter && !loading) return;
        const run = function () {
          return resetAndLoad({ filter: key, query: query });
        };
        if (window.MvBusy) {
          window.MvBusy.run(chip, run, { label: t("loading", "Loading…") });
        } else {
          run();
        }
      });
    });

    if (searchForm) {
      searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const qInput = searchForm.querySelector('input[name="q"]');
        const nextQuery = qInput ? String(qInput.value || "").trim() : "";
        const submitter =
          event.submitter ||
          searchForm.querySelector('button[type="submit"], input[type="submit"]');
        const run = function () {
          return resetAndLoad({ filter: activeFilter, query: nextQuery });
        };
        if (window.MvBusy && submitter) {
          window.MvBusy.run(submitter, run, { label: t("loading", "Loading…") });
        } else {
          run();
        }
      });
    }

    if (clearLink) {
      clearLink.addEventListener("click", function (event) {
        event.preventDefault();
        const qInput = searchForm ? searchForm.querySelector('input[name="q"]') : null;
        if (qInput) qInput.value = "";
        const run = function () {
          return resetAndLoad({ filter: activeFilter, query: "" });
        };
        if (window.MvBusy) {
          window.MvBusy.run(clearLink, run, { label: t("loading", "Loading…") });
        } else {
          run();
        }
      });
    }

    if (sentinel && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) loadMore();
          });
        },
        {
          // Large preload margin helps iOS/Android momentum scrolling.
          root: null,
          rootMargin: "480px 0px 480px 0px",
          threshold: 0,
        }
      );
      if (hasMore) observer.observe(sentinel);
    }

    // Fallback / supplement for older WebViews and iOS rubber-band scroll quirks.
    if (sentinel && !scrollFallbackBound) {
      scrollFallbackBound = true;
      const onScrollCheck = function () {
        maybeLoadMore();
      };
      window.addEventListener("scroll", onScrollCheck, { passive: true });
      window.addEventListener("touchend", onScrollCheck, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", onScrollCheck);
        window.visualViewport.addEventListener("scroll", onScrollCheck);
      }
    }

    window.addEventListener("popstate", function () {
      if (!root.dataset.history || root.dataset.history === "0") return;
      const params = new URLSearchParams(window.location.search);
      activeFilter = (params.get("f") || defaultFilter).toLowerCase();
      query = (params.get("q") || "").trim();
      const qInput = searchForm ? searchForm.querySelector('input[name="q"]') : null;
      if (qInput) qInput.value = query;
      fetchPage(1, {
        replace: true,
        push: false,
        filter: activeFilter,
        query: query,
      });
    });

    ensureLoadingMarkup();
    syncFilterChips();
    syncClearLink();
    setSentinel(hasMore);
    maybeLoadMore();
  }

  function init() {
    document.querySelectorAll("[data-course-feed]").forEach(initFeed);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
