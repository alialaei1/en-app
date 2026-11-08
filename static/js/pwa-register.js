(function () {
  if (!("serviceWorker" in navigator)) return;

  var swUrl = "/sw.js";

  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register(swUrl, { scope: "/" })
      .catch(function (err) {
        if (typeof console !== "undefined" && console.warn) {
          console.warn("LinguaLab PWA registration failed:", err);
        }
      });
  });
})();
