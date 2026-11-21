// Runs before the stylesheet paints: applies the last known theme so dark-mode
// users don't see a light flash. lib/theme.js confirms it from chrome.storage.
(() => {
  let saved = "auto";
  try { saved = localStorage.getItem("needle-theme") || "auto"; } catch {}
  const dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  // The side panel shows popup.html too. Mark it ("side-panel", not "panel": that is the class of
  // the tab panels) before the first paint, so it never shows the
  // popup's fixed 560 px layout for a frame. In a real popup, getViews already lists this window
  // while this <head> script runs (checked in a real popup and side panel); popup.js confirms it.
  if (/\/popup\.html$/.test(location.pathname)) {
    try {
      if (!(chrome.extension?.getViews?.({ type: "popup" }) || []).includes(window)) document.documentElement.classList.add("side-panel");
    } catch {}
  }
})();
