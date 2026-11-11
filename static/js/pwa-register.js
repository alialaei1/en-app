(function () {
  if (!("serviceWorker" in navigator)) return;

  var swUrl = "/sw.js";
  var refreshing = false;

  function reloadWhenControllerChanges() {
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  function watchForUpdates(registration) {
    if (!registration) return;

    // Ask the browser to re-check the SW periodically while the tab is open.
    var hourMs = 60 * 60 * 1000;
    window.setInterval(function () {
      registration.update().catch(function () {});
    }, hourMs);

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        registration.update().catch(function () {});
      }
    });

    registration.addEventListener("updatefound", function () {
      var worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", function () {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          // New version ready — activate immediately on next opportunity.
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
  }

  reloadWhenControllerChanges();

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register(swUrl, { scope: "/" })
      .then(watchForUpdates)
      .catch(function (err) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("Mimivo PWA registration failed:", err);
        }
      });
  });
})();
