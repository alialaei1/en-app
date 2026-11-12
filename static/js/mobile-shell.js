(function () {
  "use strict";

  var rotateGate = document.getElementById("mv-rotate-gate");
  var isTouchLike =
    window.matchMedia("(hover: none), (pointer: coarse)").matches ||
    Math.min(window.screen.width || 0, window.screen.height || 0) <= 920;

  function isLandscape() {
    try {
      if (window.matchMedia("(orientation: landscape)").matches) return true;
    } catch (_) {}
    return window.innerWidth > window.innerHeight;
  }

  function shouldGateLandscape() {
    return isTouchLike && isLandscape();
  }

  function syncRotateGate() {
    if (!rotateGate) return;
    var show = shouldGateLandscape();
    rotateGate.hidden = !show;
    rotateGate.classList.toggle("is-visible", show);
    rotateGate.setAttribute("aria-hidden", show ? "false" : "true");
    document.documentElement.classList.toggle("mv-landscape-blocked", show);
  }

  function lockPortrait() {
    var orientation = screen.orientation || screen.mozOrientation || screen.msOrientation;
    if (!orientation || typeof orientation.lock !== "function") return;
    try {
      var result = orientation.lock("portrait");
      if (result && typeof result.catch === "function") {
        result.catch(function () {});
      }
    } catch (_) {}
  }

  function preventZoomGesture(event) {
    if (event.touches && event.touches.length > 1) {
      event.preventDefault();
    }
  }

  ["gesturestart", "gesturechange", "gestureend"].forEach(function (type) {
    document.addEventListener(type, function (event) {
      event.preventDefault();
    });
  });

  document.addEventListener("touchmove", preventZoomGesture, { passive: false });

  document.addEventListener(
    "dblclick",
    function (event) {
      if (!isTouchLike) return;
      event.preventDefault();
    },
    { capture: true }
  );

  // Keep iOS from rubber-banding the whole page while fixed UI is open.
  document.addEventListener(
    "touchmove",
    function (event) {
      if (!document.documentElement.classList.contains("mv-landscape-blocked")) return;
      event.preventDefault();
    },
    { passive: false }
  );

  lockPortrait();
  syncRotateGate();

  window.addEventListener("orientationchange", function () {
    lockPortrait();
    window.setTimeout(syncRotateGate, 50);
    window.setTimeout(syncRotateGate, 300);
  });
  window.addEventListener("resize", syncRotateGate);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncRotateGate);
  }

  try {
    var landscapeMq = window.matchMedia("(orientation: landscape)");
    var onMq = function () {
      syncRotateGate();
      lockPortrait();
    };
    if (typeof landscapeMq.addEventListener === "function") {
      landscapeMq.addEventListener("change", onMq);
    } else if (typeof landscapeMq.addListener === "function") {
      landscapeMq.addListener(onMq);
    }
  } catch (_) {}

  document.addEventListener(
    "visibilitychange",
    function () {
      if (!document.hidden) lockPortrait();
    },
    false
  );
})();
