(function () {
  function initScroller(root) {
    const track = root.querySelector("[data-chip-track]");
    const prevBtn = root.querySelector("[data-chip-prev]");
    const nextBtn = root.querySelector("[data-chip-next]");
    if (!track || !prevBtn || !nextBtn) return;

    const rtl = getComputedStyle(track).direction === "rtl";
    let drag = null;

    function maxScroll() {
      return Math.max(0, track.scrollWidth - track.clientWidth);
    }

    function currentScroll() {
      // In RTL, browsers differ; normalize to 0..max from the visual start.
      const max = maxScroll();
      if (!max) return 0;
      if (!rtl) return track.scrollLeft;
      const left = track.scrollLeft;
      // Chromium RTL often uses negative scrollLeft.
      if (left < 0) return Math.min(max, -left);
      // Firefox RTL uses 0 at the end; convert to distance from start.
      return Math.min(max, Math.max(0, max - left));
    }

    function setScroll(fromStart) {
      const max = maxScroll();
      const target = Math.max(0, Math.min(max, fromStart));
      if (!rtl) {
        track.scrollLeft = target;
        return;
      }
      // Prefer negative scrollLeft path used by Chromium.
      track.scrollLeft = -target;
      if (Math.abs(track.scrollLeft) < 1 && target > 1) {
        track.scrollLeft = max - target;
      }
    }

    function updateArrows() {
      const max = maxScroll();
      const pos = currentScroll();
      const canScroll = max > 4;
      const atStart = pos <= 2;
      const atEnd = pos >= max - 2;

      const showArrows = canScroll;
      prevBtn.hidden = !showArrows;
      nextBtn.hidden = !showArrows;
      prevBtn.disabled = !showArrows || atStart;
      nextBtn.disabled = !showArrows || atEnd;
      root.classList.toggle("has-scroll", canScroll);
      root.classList.toggle("at-start", atStart || !canScroll);
      root.classList.toggle("at-end", atEnd || !canScroll);
    }

    function step(dir) {
      const amount = Math.max(160, Math.round(track.clientWidth * 0.7));
      setScroll(currentScroll() + dir * amount);
      window.requestAnimationFrame(updateArrows);
    }

    prevBtn.addEventListener("click", function () {
      step(-1);
    });
    nextBtn.addEventListener("click", function () {
      step(1);
    });

    track.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);

    // Desktop drag-to-scroll
    track.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "touch") return;
      if (event.button != null && event.button !== 0) return;
      if (event.target.closest("a, button")) return;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScroll: currentScroll(),
        moved: false,
      };
      track.classList.add("is-dragging");
      try {
        track.setPointerCapture(event.pointerId);
      } catch (_) {
        /* ignore */
      }
    });

    track.addEventListener("pointermove", function (event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      if (Math.abs(dx) > 3) drag.moved = true;
      // Dragging right should reveal content on the left (scroll toward start in LTR).
      setScroll(drag.startScroll - dx);
    });

    function endDrag(event) {
      if (!drag || (event && drag.pointerId !== event.pointerId)) return;
      const moved = drag.moved;
      drag = null;
      track.classList.remove("is-dragging");
      updateArrows();
      if (moved) {
        // Suppress the click that follows a drag on a chip link.
        const suppress = function (clickEvent) {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          track.removeEventListener("click", suppress, true);
        };
        track.addEventListener("click", suppress, true);
      }
    }

    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);

    // Shift+wheel → horizontal scroll on desktop
    track.addEventListener(
      "wheel",
      function (event) {
        if (maxScroll() <= 4) return;
        const mostlyVertical = Math.abs(event.deltaY) > Math.abs(event.deltaX);
        if (!mostlyVertical && event.deltaX) return;
        if (!event.shiftKey && mostlyVertical) {
          // Convert vertical wheel to horizontal when hovering the filter row.
          event.preventDefault();
          setScroll(currentScroll() + event.deltaY);
          updateArrows();
        }
      },
      { passive: false }
    );

    updateArrows();
    window.requestAnimationFrame(updateArrows);
  }

  function init() {
    document.querySelectorAll("[data-chip-scroller]").forEach(initScroller);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
