import { LOCATIONS, LANGUAGES } from "./lib/serp.js";
import { initTheme, setTheme } from "./lib/theme.js";
import { getSecrets, setSecrets, getPrefs, SECRET_KEYS, PREF_KEYS, withoutSiteChoices } from "./lib/settings.js";
import { hasOrigins, requestOrigins, removeOrigins, ALL_SITES, DATAFORSEO } from "./lib/permissions.js";
import { TTL, isExpired, clearCache } from "./lib/cache.js";
import { withStoreLock } from "./lib/store-lock.js";
import { confirmClick } from "./lib/confirm-button.js";
import { BING_ORIGINS } from "./lib/bing.js";
import { storeUrl } from "./lib/links.js";
import { CHANGELOG_URL } from "./lib/whats-new.js";
import { readableError } from "./lib/errors.js";
import { fetchWithTimeout } from "./lib/fetch-helper.js";
import { FETCH_TIMEOUT_MS, PSI_TIMEOUT_MS } from "./lib/constants.js";

const $ = (id) => document.getElementById(id);
await initTheme();

$("version").textContent = chrome.runtime.getManifest().version;
$("changelog-link").href = CHANGELOG_URL;
storeUrl().then((url) => {
  if (!url) return;
  $("store-link").href = url;
  $("store-link-item").hidden = false;
});

/**
 * A test runs once at a time: while it runs, its button stays focusable but ignores clicks
 * (aria-disabled, styled as busy in base.css), so a second click doesn't start it again.
 */
function whileBusy(btn, run) {
  return async (...args) => {
    if (btn.getAttribute("aria-disabled") === "true") return;
    btn.setAttribute("aria-disabled", "true");
    try { await run(...args); } finally { btn.removeAttribute("aria-disabled"); }
  };
}

/** Show a short status message next to a section. */
function say(id, text, kind = "good") {
  const el = $(id);
  el.textContent = text;
  el.className = kind === "bad" ? "status-bad" : kind === "good" ? "status-good" : "";
  clearTimeout(el._t);
  // Only a success fades out; progress ("Testing…") stays until the result replaces it.
  if (kind === "good") el._t = setTimeout(() => { el.textContent = ""; }, 4000);
}

function fill(sel, items) {
  sel.innerHTML = "";
  items.forEach((item) => {
    const o = document.createElement("option");
    o.value = item.code;
    o.textContent = item.name;
    sel.appendChild(o);
  });
}

// ---------------------------------------------------------------------------
// Site access
// ---------------------------------------------------------------------------

async function refreshAccess() {
  const on = await hasOrigins(ALL_SITES);
  $("access-status").textContent = on ? "Site access is on." : "Site access is off.";
  $("grant-all").hidden = on;
  $("revoke-all").hidden = !on;
}

$("grant-all").addEventListener("click", async () => {
  await requestOrigins(ALL_SITES);
  refreshAccess();
});
$("revoke-all").addEventListener("click", async () => {
  await removeOrigins(ALL_SITES);
  refreshAccess();
});
chrome.permissions.onAdded?.addListener(refreshAccess);
chrome.permissions.onRemoved?.addListener(refreshAccess);

// ---------------------------------------------------------------------------
// Credentials (chrome.storage.local only)
// ---------------------------------------------------------------------------

async function loadSecrets() {
  const s = await getSecrets();
  $("dfsLogin").value = s.dfsLogin || "";
  $("dfsPassword").value = s.dfsPassword || "";
  $("psiKey").value = s.psiKey || "";
  $("bingKey").value = s.bingKey || "";
}

$("save-dfs").addEventListener("click", async () => {
  const login = $("dfsLogin").value.trim();
  const password = $("dfsPassword").value.trim();
  if (!login || !password) { say("dfs-status", "Fill in both the API login and the API password.", "bad"); return; }
  // Ask for access to api.dataforseo.com now, while we have a click to ask from.
  const allowed = await requestOrigins(DATAFORSEO);
  await setSecrets({ dfsLogin: login, dfsPassword: password });
  say("dfs-status", allowed ? "Saved." : "Saved. Chrome did not allow access to DataForSEO yet; lookups will ask again.", allowed ? "good" : "bad");
});

confirmClick($("clear-dfs"), async () => {
  await setSecrets({ dfsLogin: "", dfsPassword: "" });
  await removeOrigins(DATAFORSEO);
  $("dfsLogin").value = "";
  $("dfsPassword").value = "";
  say("dfs-status", "Login removed from this device.");
});

$("test-dfs").addEventListener("click", whileBusy($("test-dfs"), async () => {
  const login = $("dfsLogin").value.trim();
  const password = $("dfsPassword").value.trim();
  if (!login || !password) { say("dfs-status", "Fill in both fields first.", "bad"); return; }
  if (!(await requestOrigins(DATAFORSEO))) { say("dfs-status", "Chrome needs your permission to contact DataForSEO.", "bad"); return; }
  say("dfs-status", "Testing…", "neutral");
  try {
    // A deadline, so a request that never answers can't keep the button busy.
    const r = await fetchWithTimeout("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: "Basic " + btoa(`${login}:${password}`) }
    }, FETCH_TIMEOUT_MS);
    if (r.status === 401) throw new Error("DataForSEO rejected this login or password.");
    if (!r.ok) throw new Error(`DataForSEO answered HTTP ${r.status}.`);
    const user = (await r.json()).tasks?.[0]?.result?.[0];
    if (!user) throw new Error("Unexpected answer from DataForSEO.");
    const balance = user.money?.balance != null ? `$${Number(user.money.balance).toFixed(2)}` : "unknown";
    say("dfs-status", `Connected. Balance: ${balance}.`);
  } catch (e) {
    say("dfs-status", readableError(e), "bad");
  }
}));

$("save-bing").addEventListener("click", async () => {
  const key = $("bingKey").value.trim();
  if (!key) { say("bing-status", "Paste a key first.", "bad"); return; }
  const allowed = await requestOrigins(BING_ORIGINS);
  await setSecrets({ bingKey: key });
  say("bing-status", allowed ? "Saved." : "Saved. Chrome did not allow access to Bing yet; Needle will ask again.", allowed ? "good" : "bad");
});

confirmClick($("clear-bing"), async () => {
  await setSecrets({ bingKey: "" });
  await removeOrigins(BING_ORIGINS);
  $("bingKey").value = "";
  say("bing-status", "Key removed from this device.");
});

$("save-psi").addEventListener("click", async () => {
  await setSecrets({ psiKey: $("psiKey").value.trim() });
  say("psi-status", "Saved.");
});

confirmClick($("clear-psi"), async () => {
  await setSecrets({ psiKey: "" });
  $("psiKey").value = "";
  say("psi-status", "Key removed from this device.");
});

$("test-psi").addEventListener("click", whileBusy($("test-psi"), async () => {
  const key = $("psiKey").value.trim();
  if (!key) { say("psi-status", "Paste a key first.", "bad"); return; }
  say("psi-status", "Testing on example.com, this takes about 20 seconds…", "neutral");
  try {
    const params = new URLSearchParams({ url: "https://example.com/", strategy: "mobile", category: "performance", key });
    // PageSpeed takes about 20 seconds; give it a minute.
    const r = await fetchWithTimeout(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {}, PSI_TIMEOUT_MS);
    if (r.status === 400 || r.status === 403) throw new Error("Google rejected this key. Check that the PageSpeed Insights API is enabled for it.");
    if (r.status === 429) throw new Error("This key has reached its quota. Try again later.");
    if (!r.ok) throw new Error(`Google answered HTTP ${r.status}.`);
    say("psi-status", "The key works.");
  } catch (e) {
    say("psi-status", readableError(e), "bad");
  }
}));

// ---------------------------------------------------------------------------
// Preferences (chrome.storage.sync)
// ---------------------------------------------------------------------------

fill($("defaultLocation"), LOCATIONS);
fill($("defaultLanguage"), LANGUAGES);

async function loadImageRules() {
  const r = await chrome.storage.sync.get(["imgMaxKB", "imgWidth", "imgHeight", "imgMode"]);
  $("imgMaxKB").value = r.imgMaxKB || "";
  $("imgWidth").value = r.imgWidth || "";
  $("imgHeight").value = r.imgHeight || "";
  $("imgMode").value = r.imgMode === "exact" ? "exact" : "ratio";
}

$("save-images").addEventListener("click", async () => {
  const n = (id) => $(id).value.trim();
  const bad = ["imgMaxKB", "imgWidth", "imgHeight"].find((id) => n(id) && !/^\d{1,5}$/.test(n(id)));
  if (bad) { say("images-status", "Use whole numbers only.", "bad"); return; }
  if (!!n("imgWidth") !== !!n("imgHeight")) { say("images-status", "Fill in both width and height, or neither.", "bad"); return; }
  await chrome.storage.sync.set({ imgMaxKB: n("imgMaxKB"), imgWidth: n("imgWidth"), imgHeight: n("imgHeight"), imgMode: $("imgMode").value });
  say("images-status", "Saved. Reopen Needle on a page to apply.");
});

async function loadPrefs() {
  const p = await getPrefs();
  $("defaultLocation").value = String(p.defaultLocation);
  $("defaultLanguage").value = p.defaultLanguage;
  const s = await chrome.storage.sync.get(["theme", "csvSeparator", "popupShortcuts", "openInSidePanel"]);
  $("openInSidePanel").checked = s.openInSidePanel === true;
  $("theme").value = s.theme || "auto";
  $("csvSeparator").value = s.csvSeparator === ";" ? ";" : ",";
  $("popupShortcuts").checked = s.popupShortcuts !== false;
}

["defaultLocation", "defaultLanguage"].forEach((id) => {
  $(id).addEventListener("change", async () => {
    await chrome.storage.sync.set({ [id]: $(id).value });
    say("market-status", "Saved.");
  });
});
$("theme").addEventListener("change", async () => { await setTheme($("theme").value); say("display-status", "Saved."); });
$("csvSeparator").addEventListener("change", async () => { await chrome.storage.sync.set({ csvSeparator: $("csvSeparator").value }); say("display-status", "Saved."); });
$("openInSidePanel").addEventListener("change", async () => { await chrome.storage.sync.set({ openInSidePanel: $("openInSidePanel").checked }); say("display-status", $("openInSidePanel").checked ? "Saved. Click the Needle button to open the side panel." : "Saved."); });
$("popupShortcuts").addEventListener("change", async () => { await chrome.storage.sync.set({ popupShortcuts: $("popupShortcuts").checked }); say("display-status", "Saved."); });

async function showShortcut() {
  try {
    const cmds = await chrome.commands.getAll();
    const open = cmds.find((c) => c.name === "_execute_action");
    $("open-shortcut").textContent = open?.shortcut || "not set";
  } catch {}
}
$("change-shortcut").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

// ---------------------------------------------------------------------------
// Data on this device
// ---------------------------------------------------------------------------

async function refreshCacheStats() {
  const { _cache = {}, history = [] } = await chrome.storage.local.get(["_cache", "history"]);
  const entries = Object.entries(_cache);
  const fresh = entries.filter(([k, v]) => !isExpired(k, v.ts)).length;
  const kb = (new Blob([JSON.stringify(_cache)]).size / 1024).toFixed(0);
  $("cache-stats").textContent = `${fresh} saved result${fresh === 1 ? "" : "s"} (${kb} KB) and ${history.length} page${history.length === 1 ? "" : "s"} in history. Saved results expire after ${span(Math.min(...Object.values(TTL)))} to ${span(Math.max(...Object.values(TTL)))}.`;
}

/** 300000 → "5 minutes", 43200000 → "12 hours". */
function span(ms) {
  return ms >= 3600000 ? `${ms / 3600000} hour${ms === 3600000 ? "" : "s"}` : `${ms / 60000} minute${ms === 60000 ? "" : "s"}`;
}

confirmClick($("clear-cache"), async () => {
  await clearCache();
  say("maint-status", "Saved results cleared.");
  refreshCacheStats();
});
confirmClick($("clear-history"), async () => {
  await withStoreLock("history", () => withStoreLock("snapshots", () => chrome.storage.local.set({ history: [], snapshots: {} })));
  // The country and language picked per website name those sites too.
  const { popupState } = await chrome.storage.local.get("popupState");
  if (popupState) await chrome.storage.local.set({ popupState: withoutSiteChoices(popupState) });
  say("maint-status", "History and change snapshots cleared.");
  refreshCacheStats();
});

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

$("export-settings").addEventListener("click", async () => {
  const prefs = await chrome.storage.sync.get([...PREF_KEYS, "theme", "csvSeparator", "popupShortcuts", "openInSidePanel"]);
  const settings = { ...prefs };
  if ($("export-secrets").checked) Object.assign(settings, await getSecrets());
  const blob = new Blob([JSON.stringify({ app: "Needle", exportedAt: new Date().toISOString(), version: chrome.runtime.getManifest().version, settings }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `needle-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say("sync-status", "Settings downloaded.");
});

$("import-settings-btn").addEventListener("click", () => $("import-settings").click());
$("import-settings").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const payload = data.settings || data;
    const prefs = {};
    const secrets = {};
    for (const k of [...PREF_KEYS, "theme", "csvSeparator"]) if (typeof payload[k] === "string") prefs[k] = payload[k];
    if (typeof payload.popupShortcuts === "boolean") prefs.popupShortcuts = payload.popupShortcuts;
    if (typeof payload.openInSidePanel === "boolean") prefs.openInSidePanel = payload.openInSidePanel;
    for (const k of SECRET_KEYS) if (typeof payload[k] === "string") secrets[k] = payload[k];
    const n = Object.keys(prefs).length + Object.keys(secrets).length;
    if (!n) { say("sync-status", "No Needle settings found in this file.", "bad"); return; }
    if (Object.keys(prefs).length) await chrome.storage.sync.set(prefs);
    if (Object.keys(secrets).length) await setSecrets(secrets);
    if (prefs.theme) await setTheme(prefs.theme);
    await Promise.all([loadSecrets(), loadPrefs(), loadImageRules()]);
    say("sync-status", `Loaded ${n} setting${n === 1 ? "" : "s"}.`);
  } catch (err) {
    say("sync-status", `Could not read this file: ${err.message}`, "bad");
  } finally {
    e.target.value = "";
  }
});

await Promise.all([loadSecrets(), loadPrefs(), loadImageRules(), refreshAccess(), refreshCacheStats(), showShortcut()]);
