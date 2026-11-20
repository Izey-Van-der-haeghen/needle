// Runs before the stylesheet paints: applies the last known theme so dark-mode
// users don't see a light flash. lib/theme.js confirms it from chrome.storage.
(() => {
  let saved = "auto";
  try { saved = localStorage.getItem("needle-theme") || "auto"; } catch {}
  const dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
