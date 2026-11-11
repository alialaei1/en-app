(function () {
  const DISMISS_MS = 3500;
  const FADE_MS = 320;
  const root = document.querySelector(".mv-messages");
  if (!root) return;

  const toasts = Array.from(root.querySelectorAll(".mv-toast"));
  if (!toasts.length) return;

  function dismissToast(toast) {
    if (!toast || toast.classList.contains("is-leaving")) return;
    toast.classList.add("is-leaving");
    window.setTimeout(() => {
      toast.remove();
      if (!root.querySelector(".mv-toast")) root.remove();
    }, FADE_MS);
  }

  toasts.forEach((toast, index) => {
    // Slight stagger when several messages show together.
    const delay = DISMISS_MS + index * 250;
    window.setTimeout(() => dismissToast(toast), delay);
    toast.addEventListener("click", () => dismissToast(toast));
    toast.setAttribute("title", toast.getAttribute("title") || "Click to dismiss");
    toast.style.cursor = "pointer";
  });
})();
