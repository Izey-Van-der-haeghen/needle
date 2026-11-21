import { validateSchema, detectFaqDuplicates, collectAllSchemaTypes, suggestMissingSchemas } from './lib/schema-validator.js';
import { getCache, setCache, cacheKey, cachedCall, pageId, formatAge } from './lib/cache.js';
import { LOCATIONS, LANGUAGES, FEATURE_LABELS } from './lib/serp.js';
import { analyzeAIAccess, analyzeEEAT, analyzeCitability, aiReadinessScore, fetchLlmsTxt, AI_SCORE_NOTE } from './lib/geo.js';
import { buildHtmlReport } from './lib/export.js';
import { buildCompareCsv, buildCompareMd, compareExportFilename } from './lib/compare-export.js';
import { classifyIntent } from './lib/intent.js';
import { escapeHtml, tag, row, pixelWidth, pixelTag, charTag, fmtKB, cachedBanner, cwvTag, timeAgo, fmtNum, SNIPPET, sheetCell, tsv, hasUncleanFilename, popupSizeForZoom, isHtmlDocument, notHtmlNotice } from './lib/popup-helpers.js';
import { computeHealthScore, computeIndexability, detectMarketFromUrl, withoutTracking } from './lib/popup-compute.js';
import { sendWithRetry, safeSendTabMessage } from './lib/popup-messaging.js';
import { initTheme, setTheme } from './lib/theme.js';
import { validateHreflang } from './lib/hreflang.js';
import { analyzeTechnical } from './lib/technical.js';
import { pageFetcher, fetchInPage } from './lib/page-fetch.js';
import { fetchCompetitor } from './lib/compare.js';
import { parseCompetitorHtml } from './lib/parse-competitor.js';
import { getSecrets, getPrefs, getImageRules } from './lib/settings.js';
import { imageSizeIssues, leadImageCheck, applyImageRules, isContentImage, DEFAULT_IMAGE_RULES, LEAD_IMAGE_MIN_WIDTH } from './lib/image-rules.js';
import { hasOrigins, requestOrigins, ALL_SITES, DATAFORSEO, NEEDS_PERMISSION } from './lib/permissions.js';
import { DFS_COST } from './lib/offpage.js';
import { CWV_GOOD, CWV_POOR } from './lib/crux.js';
import { BING_ORIGINS } from './lib/bing.js';
import { storeUrl } from './lib/links.js';
import { buildIssuesMarkdown } from './lib/handoff.js';
import { collectFindings, snippetDirectives, SEVERITY_LABEL } from './lib/findings.js';
import { buildAiPrompt } from './lib/ai-prompt.js';
import { snapshotOf, recordSnapshot } from './lib/changes.js';
import { termFrequency, keywordPlacement } from './lib/terms.js';
import { readability } from './lib/readability.js';
import { findInSitemaps } from './lib/sitemap-check.js';
import { checkHostVariants } from './lib/variants.js';
import { checkHreflangCluster, alternatesOf, CLUSTER_MAX } from './lib/hreflang-cluster.js';
import { urlKey } from './lib/urls.js';
import { fetchWithTimeout, readTextCapped } from './lib/fetch-helper.js';
import { isLocalUrl, isSafeHttpUrl } from './lib/url-safety.js';
import { withStoreLock } from './lib/store-lock.js';
import { confirmClick } from './lib/confirm-button.js';

// ---------------------------------------------------------------------------
// Icons (inline SVG, no emoji)
// ---------------------------------------------------------------------------

const ICON = {
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="9" rx="1"/><path d="M3.5 10.5V3.4A1.4 1.4 0 0 1 4.9 2H10"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><polyline points="3 8.5 7 12 13 4.5"/></svg>',
  external: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5"/></svg>',
  locate: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5"/><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15"/></svg>'
};

const DFS_LOOKUP_COST = DFS_COST.rankedKeywords + DFS_COST.domainOverview;
/** "1 link", "1,280 links". */
const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;
/** Dollar amount with at most 3 decimals and no trailing zeros, e.g. $0.025. */
const usd = (n) => `$${Number(n).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const tabs = [...document.querySelectorAll('.tab')];
const panels = [...document.querySelectorAll('.panel')];

let currentTab = null;
let pageUrl = '';
let onpageData = null;
let onpageAge = 0;
let technicalData = null;
let technicalAge = 0;
let renderedData = null;
// Result of "Check the alternates" for Fix this first: {rows, total}; null until it has run on this page.
let hreflangCluster = null;
let geoData = null;
let mainText = null;
let currentFindings = [];
let techPending = false; // the server check is still running for this audit
let imageMeasureNote = ''; // the last "Measure them" result, kept when the images card redraws
// Every audit gets a number. An answer that arrives after the side panel moved to
// another tab, or after Refresh, carries an older number and is dropped.
let tabGen = 0; // bumped when the view switches to a tab
let auditGen = 0; // bumped on every on-page and technical run, Refresh included

// Requests that should stop when this view closes (link check, image sizes, speed
// test) carry this id; the worker aborts them when this view's port disconnects.
const VIEW_ID = crypto.randomUUID();
let viewPort = null;
function viewId() {
  if (!viewPort) {
    try {
      viewPort = chrome.runtime.connect({ name: `view:${VIEW_ID}` });
      viewPort.onDisconnect.addListener(() => { void chrome.runtime.lastError; viewPort = null; });
    } catch { viewPort = null; }
  }
  return VIEW_ID;
}
/** What the export includes: {psi, psiError, dfs, dfsError}. */
const offpageData = { psi: null, psiError: null, dfs: null, dfsError: null };
let popupState = {};
let saveStateTimer = null;
let prefs = { defaultLocation: 2840, defaultLanguage: 'en' };
let shortcutsOn = true;
let csvSeparator = ',';
let imageRules = { ...DEFAULT_IMAGE_RULES };

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

/** Announce a status message to screen readers. */
function announce(msg) {
  const el = $('sr-status');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 30);
}

/** Replace an element's HTML and put keyboard focus back where it was (by id). */
function rerender(el, html) {
  if (!el) return;
  const activeId = document.activeElement?.id;
  const inside = activeId && el.contains(document.activeElement);
  el.innerHTML = html;
  if (inside) ($(activeId) || el.querySelector('[data-focus-fallback]'))?.focus();
}

/** Mark a run button busy without disabling it, so keyboard focus stays on it. */
function setBusy(btn, busy) {
  if (!btn) return;
  btn.setAttribute('aria-disabled', String(!!busy));
}
// A busy button ignores clicks (unlike a disabled button, it keeps focus).
document.addEventListener('click', (e) => {
  if (e.target.closest?.('button[aria-disabled="true"]')) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

function errorBox(title, detail, actionsHtml = '') {
  announce(title);
  return `<div class="notice notice-bad" role="alert">
    <strong>${escapeHtml(title)}</strong>
    ${detail ? `<div>${escapeHtml(detail)}</div>` : ''}
    ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ''}
  </div>`;
}

function loading(text) {
  return `<div class="loading" role="status">${escapeHtml(text)}</div>`;
}

let toastTimer = null;
function showToast(msg) {
  let el = $('copy-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'copy-toast';
    el.className = 'copy-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `${ICON.check}<span></span>`;
  el.querySelector('span').textContent = msg;
  void el.offsetWidth;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 1800);
}

/** Copy text and show it on the button without losing its original label. */
async function copyWithFeedback(btn, text, toast) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showToast('Could not copy');
    return;
  }
  if (!btn.dataset.label) btn.dataset.label = btn.innerHTML;
  // Keep the width, so the next button doesn't move under the pointer.
  if (!btn.classList.contains('icon-only')) btn.style.minWidth = `${btn.offsetWidth}px`;
  btn.classList.add('copied');
  if (btn.classList.contains('icon-only')) btn.innerHTML = ICON.check;
  else btn.textContent = 'Copied';
  showToast(toast || 'Copied');
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => {
    btn.classList.remove('copied');
    btn.innerHTML = btn.dataset.label;
    btn.style.minWidth = '';
  }, 1500);
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const bareHost = (u) => hostOf(u).replace(/^www\./, '');

/** Button that asks Chrome for access to other sites (must run from a click). */
function permissionNotice(why) {
  return `<div class="notice">
    <strong>Needle needs your permission for this</strong>
    <div>${escapeHtml(why)} Chrome will ask once; you can take it back in Settings any time.</div>
    <div class="actions"><button type="button" class="primary-btn" data-grant="all-sites">Allow access to websites</button></div>
  </div>`;
}

function dfsPermissionNotice() {
  return `<div class="notice">
    <strong>Allow Needle to contact DataForSEO</strong>
    <div>Keyword and SERP lookups go to api.dataforseo.com with your own login.</div>
    <div class="actions"><button type="button" class="primary-btn" data-grant="dataforseo">Allow DataForSEO</button></div>
  </div>`;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-grant]');
  if (!btn) return;
  const origins = btn.dataset.grant === 'dataforseo' ? DATAFORSEO : ALL_SITES;
  const granted = await requestOrigins(origins);
  if (granted) {
    showToast('Access granted');
    btn.closest('.notice')?.remove();
    const retry = btn.dataset.retry;
    if (retry === 'measure-images') measureImages();
    else if (retry === 'panel-retry') chrome.tabs.get(currentTab.id).then(startForTab).catch(() => {});
    else if (retry && $(retry)) $(retry).click();
  }
});

// ---------------------------------------------------------------------------
// Popup state (inputs, last tab) survives closing the popup
// ---------------------------------------------------------------------------

async function loadPopupState() {
  const r = await chrome.storage.local.get('popupState');
  popupState = r.popupState || {};
}

function flushState() {
  clearTimeout(saveStateTimer);
  chrome.storage.local.set({ popupState });
}

function queueSaveState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(flushState, 150);
}

/** path: "a.b" or ["marketByHost", "www.example.com"] (host names contain dots). */
function setStatePath(path, value) {
  const parts = Array.isArray(path) ? path : path.split('.');
  let obj = popupState;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  queueSaveState();
}

// Save typed input even when the popup closes within the debounce window.
window.addEventListener('pagehide', () => {
  flushState();
});

// ---------------------------------------------------------------------------
// Tabs (ARIA tablist with arrow-key navigation)
// ---------------------------------------------------------------------------

const tabScroll = {};
function selectTab(name, { focus = false } = {}) {
  // Each tab keeps its own scroll position (they share one scrolling <main>).
  const main = document.querySelector('main');
  const current = tabs.find((t) => t.classList.contains('active'))?.dataset.tab;
  if (main && current && current !== name) tabScroll[current] = main.scrollTop;
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
  });
  panels.forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle('active', on);
    p.hidden = !on;
  });
  if (main && current !== name) main.scrollTop = tabScroll[name] || 0;
  setStatePath('activeTab', name);
}

tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t.dataset.tab));
  t.addEventListener('keydown', (e) => {
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (next) {
      e.preventDefault();
      selectTab(next.dataset.tab, { focus: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Dropdowns and market
// ---------------------------------------------------------------------------

function populateSelect(sel, items) {
  sel.innerHTML = items.map((l) => `<option value="${escapeHtml(l.code)}">${escapeHtml(l.name)}</option>`).join('');
}

/** The market for a site: the one chosen for it, else detected from the domain and page language, else the default. */
function marketFor(url, lang = '') {
  const saved = popupState.marketByHost?.[hostOf(url)];
  if (saved?.locationCode && saved?.languageCode) return { code: saved.locationCode, lang: saved.languageCode };
  return detectMarketFromUrl(url, lang) || { code: prefs.defaultLocation, lang: prefs.defaultLanguage };
}

function marketForPage() {
  return marketFor(pageUrl, onpageData?.lang || '');
}

/** Put this site's market in the keyword and Google-results pickers. */
function applyMarket() {
  const market = marketForPage();
  setSelectValue($('offpage-location'), market.code);
  setSelectValue($('offpage-language'), market.lang);
  const serp = popupState.serpMarketByHost?.[hostOf(pageUrl)];
  setSelectValue($('serp-location'), serp?.locationCode ?? market.code);
  setSelectValue($('serp-language'), serp?.languageCode ?? market.lang);
}

function getOffpageSelection() {
  return {
    locationCode: parseInt($('offpage-location')?.value, 10) || prefs.defaultLocation,
    languageCode: $('offpage-language')?.value || prefs.defaultLanguage
  };
}

function setSelectValue(sel, value) {
  if (!sel) return;
  if (![...sel.options].some((o) => o.value === String(value))) return;
  sel.value = String(value);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/** True when this page runs in Chrome's side panel instead of the toolbar popup. */
const IS_PANEL = !(chrome.extension?.getViews?.({ type: 'popup' }) || []).includes(window);
// theme-boot.js already set this before the first paint; this keeps the two in step.
document.documentElement.classList.toggle('panel', IS_PANEL);

/**
 * Browser zoom (also Chrome's default page zoom) applies to the popup, but Chrome caps a
 * popup at 800 × 600 screen pixels, so from about 110 % the 560 × 600 layout is cut off.
 * Fit the layout to the cap instead. outerWidth is in screen pixels, innerWidth in CSS pixels.
 */
function fitPopupToZoom() {
  // In an iframe (the store-image frame) outerWidth belongs to the outer window.
  if (IS_PANEL || window.top !== window || !window.outerWidth || !window.innerWidth) return;
  const size = popupSizeForZoom(window.outerWidth / window.innerWidth);
  const root = document.documentElement.style;
  if (size) {
    root.setProperty('--popup-w', `${size.width}px`);
    root.setProperty('--popup-h', `${size.height}px`);
  } else {
    root.removeProperty('--popup-w');
    root.removeProperty('--popup-h');
  }
}
fitPopupToZoom();
window.addEventListener('resize', fitPopupToZoom);

async function init() {
  await initTheme();
  labelThemeToggle();
  await loadPopupState();
  prefs = await getPrefs();
  imageRules = await getImageRules();
  const sync = await chrome.storage.sync.get(['popupShortcuts', 'csvSeparator']);
  shortcutsOn = sync.popupShortcuts !== false;
  csvSeparator = sync.csvSeparator === ';' ? ';' : ',';

  populateSelect($('serp-location'), LOCATIONS);
  populateSelect($('serp-language'), LANGUAGES);
  populateSelect($('offpage-location'), LOCATIONS);
  populateSelect($('offpage-language'), LANGUAGES);
  $('dfs-cost').textContent = `≈ ${usd(DFS_LOOKUP_COST)} per lookup`;
  document.querySelectorAll('[data-serp-cost]').forEach((el) => { el.textContent = `≈ ${usd(DFS_COST.serp)}`; });

  restoreInputs();
  attachStatePersistence();
  delete popupState.pendingCompare; // older versions kept it here
  if (popupState.activeTab) selectTab(popupState.activeTab);
  // "Compare this link's page" from the right-click menu: now, or while this view is open.
  const { pendingCompare } = await chrome.storage.local.get('pendingCompare');
  applyPendingCompare(pendingCompare);
  chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.pendingCompare?.newValue) applyPendingCompare(changes.pendingCompare.newValue);
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (IS_PANEL) {
    followTabs();
    // The toolbar button and the right-click menu ask an open panel to audit their tab.
    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (msg?.type !== 'AUDIT_TAB' || sender.tab) return;
      chrome.windows.getCurrent().then(async (win) => {
        if (win.id === msg.windowId) startForTab(await chrome.tabs.get(msg.tabId));
      }).catch(() => {});
    });
  }
  await startForTab(tab);
}

/** Put the link from the right-click menu in the first competitor field and show Compare. */
function applyPendingCompare(p) {
  if (!p?.url || Date.now() - (p.ts || 0) > 60 * 1000) return;
  chrome.storage.local.remove('pendingCompare').catch(() => {});
  const inp = document.querySelector('.competitor-url[data-idx="0"]');
  if (inp) inp.value = p.url;
  setStatePath('compare.competitorUrls', [...document.querySelectorAll('.competitor-url')].map((i) => i.value));
  selectTab('compare');
}

/** Audit one tab. In the side panel this runs again whenever the active tab changes. */
async function startForTab(tab) {
  const tg = ++tabGen;
  ++auditGen;
  psiRunning = false;
  dfsRunning = false;
  currentTab = tab;
  pageUrl = tab?.url || '';
  onpageData = null;
  technicalData = null;
  renderedData = null;
  hreflangCluster = null;
  geoData = null;
  mainText = null;
  Object.assign(offpageData, { psi: null, psiError: null, dfs: null, dfsError: null });
  rerender($('psi-result'), '');
  rerender($('dfs-result'), '');
  rerender($('crux-result'), '');
  rerender($('bing-result'), '');
  $('run-psi').textContent = 'Run speed test';
  $('export-audit-header').hidden = true;
  $('current-url').textContent = pageUrl || '—';
  $('current-url').title = pageUrl;

  const webPage = !!tab && /^https?:/.test(pageUrl);
  $('run-psi').disabled = !webPage;
  $('run-crux').disabled = !webPage;
  $('run-bing').disabled = !webPage;
  $('run-dfs').disabled = !webPage;
  ['run-psi', 'run-crux', 'run-bing', 'run-dfs'].forEach((id) => setBusy($(id), false));
  // Chrome hides a tab's address from the side panel until Needle may read that tab.
  if (IS_PANEL && tab && !tab.url && !(await hasOrigins(ALL_SITES))) {
    if (tg !== tabGen) return;
    $('panel-onpage').innerHTML = panelAccessNotice();
    $('panel-technical').innerHTML = '';
    $('panel-ai').innerHTML = '';
    return;
  }
  if (tg !== tabGen) return;
  if (!webPage) {
    const msg = `<div class="empty-state">
      <h2>Open a web page to audit it</h2>
      <p>Needle works on regular http and https pages. Chrome doesn't let extensions read its own pages (like this new tab), the Chrome Web Store or local files.</p>
    </div>`;
    $('panel-onpage').innerHTML = msg;
    $('panel-technical').innerHTML = msg;
    $('panel-ai').innerHTML = msg;
    renderExternalTools();
    autoRestoreSerpResult();
    return;
  }

  applyMarket();
  renderExternalTools();
  // Before the audit: added later, the note would push the results down.
  showOnboardingIfNeeded();
  await loadOnpageAndTechnical();
  if (tg !== tabGen) return;
  restoreOffpageFromCache();
  autoRestoreSerpResult();
  autoRestoreCompareResult();
}

/** Side panel: follow the active tab of this window. */
function followTabs() {
  let timer = null;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && (tab.id !== currentTab?.id || (tab.url || '') !== pageUrl)) startForTab(tab);
    }, 400);
  };
  chrome.tabs.onActivated.addListener(later);
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId === currentTab?.id && (info.status === 'complete' || info.url)) later();
  });
}

function panelAccessNotice() {
  return `<div class="notice"><strong>Click the Needle button to audit this tab</strong>
    <div>The side panel can read a tab after you click Needle's toolbar button on it, or after you allow access to websites.</div>
    <div class="actions"><button type="button" class="primary-btn" data-grant="all-sites" data-retry="panel-retry">Allow access to websites</button></div></div>`;
}

async function showOnboardingIfNeeded() {
  if (popupState.onboardingDismissed || document.querySelector('.onboarding')) return;
  const banner = document.createElement('div');
  banner.className = 'notice onboarding';
  banner.innerHTML = `
    <strong>Welcome to Needle</strong>
    <div>Needle reads only the page you open it on, and only when you open it. Nothing leaves your browser unless you start a check that says it does, like the speed test or a keyword lookup.</div>
    <div class="actions">
      <button type="button" class="primary-btn" data-onb-dismiss>Got it</button>
      <button type="button" class="link-btn" data-action="open-options">Settings and API keys</button>
    </div>`;
  document.querySelector('main').prepend(banner);
  banner.querySelector('[data-onb-dismiss]').addEventListener('click', () => {
    banner.remove();
    setStatePath('onboardingDismissed', true);
  });
}

function restoreInputs() {
  const s = popupState.serp || {};
  ['serp-keyword', 'serp-device', 'serp-mydomain'].forEach((id) => {
    if (s[id] != null && $(id)) $(id).value = s[id];
  });
  const c = popupState.compare || {};
  if (c.selfUrl != null) $('compare-self').value = c.selfUrl;
  if (c.keyword != null) $('compare-keyword').value = c.keyword;
  if (Array.isArray(c.competitorUrls)) {
    c.competitorUrls.forEach((url, i) => {
      const inp = document.querySelector(`.competitor-url[data-idx="${i}"]`);
      if (inp) inp.value = url || '';
    });
    visibleComps = Math.max(1, Math.min(3, Math.max(c.visibleComps || 1, c.competitorUrls.filter(Boolean).length)));
  }
  updateCompSlots();
}

function attachStatePersistence() {
  ['offpage-location', 'offpage-language'].forEach((id) => {
    $(id).addEventListener('change', () => {
      const host = hostOf(pageUrl);
      if (host) setStatePath(['marketByHost', host], getOffpageSelection());
      // A market change shows that market's saved result, if any. It never bills by itself.
      offpageData.dfs = null;
      offpageData.dfsError = null;
      restoreDfsFromCache();
    });
  });
  ['serp-keyword', 'serp-device', 'serp-mydomain'].forEach((id) => {
    const handler = () => setStatePath(`serp.${id}`, $(id).value);
    $(id).addEventListener('input', handler);
    $(id).addEventListener('change', handler);
  });
  // The Google-results market is remembered per site, like the keyword market.
  ['serp-location', 'serp-language'].forEach((id) => {
    $(id).addEventListener('change', () => {
      const host = hostOf(pageUrl);
      if (host) setStatePath(['serpMarketByHost', host], { locationCode: parseInt($('serp-location').value, 10), languageCode: $('serp-language').value });
    });
  });
  $('compare-self').addEventListener('input', () => setStatePath('compare.selfUrl', $('compare-self').value));
  $('compare-keyword').addEventListener('input', () => setStatePath('compare.keyword', $('compare-keyword').value));
  document.querySelectorAll('.competitor-url').forEach((inp) => {
    inp.addEventListener('input', () => {
      setStatePath('compare.competitorUrls', [...document.querySelectorAll('.competitor-url')].map((i) => i.value));
    });
  });
}

// ---------------------------------------------------------------------------
// On-page and technical
// ---------------------------------------------------------------------------

async function loadOnpageAndTechnical(forceRefresh = false) {
  const gen = ++auditGen;
  hreflangCluster = null; // the hreflang card is drawn again without its check result
  const tab = currentTab;
  const url = pageUrl;
  techPending = true;
  imageMeasureNote = '';
  const onpagePanel = $('panel-onpage');
  const technicalPanel = $('panel-technical');
  rerender(onpagePanel, loading('Reading the page…'));
  rerender(technicalPanel, loading('Checking the server…'));
  rerender($('panel-ai'), loading('Checking AI search access…'));
  const id = pageId(url);
  const onKey = cacheKey('onpage', id);
  const techKey = cacheKey('technical', id);

  const onCached = forceRefresh ? null : await getCache(onKey);
  const techCached = forceRefresh ? null : await getCache(techKey);
  if (gen !== auditGen) return;

  const opPromise = onCached
    ? Promise.resolve({ data: onCached.data, age: onCached.age, cached: true })
    : safeSendTabMessage(tab.id, { type: 'ANALYZE_ONPAGE' }).then((data) => ({ data, age: 0 })).catch((e) => ({ error: e.message }));
  const techPromise = techCached
    ? Promise.resolve({ data: techCached.data, age: techCached.age, cached: true })
    : analyzeTechnical(url, pageFetcher(tab.id)).then((data) => ({ data, age: 0 })).catch((e) => ({ error: e.message }));

  // The on-page panel renders as soon as the page is read; the server check fills in after.
  const op = await opPromise;
  if (gen !== auditGen) return;
  if (op.data && !isHtmlDocument(op.data.contentType)) {
    // A text file, XML or image: an audit would only list false alarms.
    onpageData = null;
    techPending = false;
    const notice = notHtmlNotice(op.data.contentType, url);
    rerender(onpagePanel, notice);
    rerender(technicalPanel, notice);
    rerender($('panel-ai'), notice);
    announce("This isn't an HTML page");
    return;
  }
  if (op.error || !op.data) {
    onpageData = null;
    const noAccess = /Cannot access|permission|activeTab/i.test(op.error || '');
    if (IS_PANEL && noAccess) {
      rerender(onpagePanel, panelAccessNotice());
      rerender(technicalPanel, '');
      rerender($('panel-ai'), '');
      return;
    }
    rerender($('panel-ai'), '<p class="muted">The AI checks need the page itself; see the On-page tab.</p>');
    rerender(onpagePanel, errorBox('Needle could not read this page', op.error || 'No answer from the page.',
      `<button type="button" class="primary-btn" data-refresh="onpage">Try again</button>`));
  } else {
    onpageData = op.data;
    onpageAge = op.age;
    if (!op.cached) setCache(onKey, op.data);
    applyImageRules(onpageData.images, imageRules);
    rerender(onpagePanel, renderOnpage(onpageData, onpageAge));
    attachOnpageHandlers();
    // Most findings and the page's own verdict need only the page: show them now, so the
    // cards below don't jump when the server check arrives.
    renderVerdict();
    renderExternalTools();
    // The page's <html lang> picks the language in multilingual markets (fr-BE → French).
    applyMarket();
    announce('Page analysed');
  }

  const tech = await techPromise;
  if (gen !== auditGen) return;
  techPending = false;
  if (tech.error) {
    technicalData = null;
    rerender(technicalPanel, errorBox('The server check failed', tech.error,
      `<button type="button" class="primary-btn" data-refresh="onpage">Try again</button>`));
  } else {
    technicalData = tech.data;
    technicalAge = tech.age;
    // A failed page fetch is not a result worth keeping.
    if (!tech.cached && tech.data.status) setCache(techKey, tech.data);
    rerender(technicalPanel, renderTechnical(technicalData, technicalAge));
    loadRendered(gen);
  }

  if (onpageData) {
    renderVerdict();
    // The report button appears once every check has answered, so a report is never half done.
    loadGEO(gen).finally(() => { if (gen === auditGen) $('export-audit-header').hidden = false; });
    const verdict = computeIndexability(onpageData, technicalData);
    const health = computeHealthScore(onpageData, technicalData, snippetPx());
    saveToHistory(url, onpageData.title || '', verdict.level, health?.score ?? null);
    showChanges(health?.score ?? null, gen);
  }
}

/** Snippet widths of the page's title and description; the score, the findings and the report use them. */
const snippetPx = () => ({
  titlePx: pixelWidth(onpageData?.title || '', SNIPPET.titleFont),
  descPx: pixelWidth(onpageData?.description || '', SNIPPET.descFont)
});

const SEV_KIND = { critical: 'bad', high: 'bad', medium: 'warn', low: 'neutral' };
let showAllFindings = false;

/** "Fix this first": every problem from every check, most important first. */
function renderFindings() {
  const slot = $('findings-slot');
  if (!slot || !onpageData) return;
  currentFindings = collectFindings({
    onpage: onpageData, tech: technicalData, geo: geoData, rendered: renderedData, imageRules, hreflangCluster, ...snippetPx()
  });
  const f = currentFindings;
  const counts = ['critical', 'high', 'medium', 'low'].map((sv) => [sv, f.filter((x) => x.severity === sv).length]).filter(([, n]) => n);
  const shown = showAllFindings ? f : f.slice(0, 8);
  const wasOpen = $('findings-card') ? $('findings-card').open : true;
  // Re-renders (AI checks, link check, image sizes) keep what the reader opened and focused.
  const openWhy = new Set([...slot.querySelectorAll('details.sub[open]')].map((d) => d.dataset.fid));
  const overlayOn = $('toggle-issues')?.getAttribute('aria-pressed') === 'true';
  rerender(slot, `<details class="card collapsible" id="findings-card"${wasOpen ? ' open' : ''}>
    <summary id="findings-summary" data-focus-fallback><h2 class="card-title">Fix this first</h2>
      ${f.length ? counts.map(([sv, n]) => tag(`${n} ${SEVERITY_LABEL[sv].toLowerCase()}`, SEV_KIND[sv])).join(' ') : tag('nothing found', 'good')}</summary>
    <div class="card-body">
      ${f.length ? `<ol class="finding-list">${shown.map((x, i) => {
        const targets = x.targets || [];
        const locate = targets.length === 1
          ? `<button type="button" class="locate" id="loc-${escapeHtml(x.id)}" aria-describedby="ft-${escapeHtml(x.id)}" data-highlight="${escapeHtml(JSON.stringify(targets[0]))}" aria-label="Show on the page">${ICON.locate}</button>`
          : targets.length > 1 ? `<button type="button" class="link-btn" id="show-${escapeHtml(x.id)}" aria-describedby="ft-${escapeHtml(x.id)}" data-finding-show="${i}">Show ${targets.length} on page</button>` : '';
        return `<li class="finding">
          <div class="finding-head">${tag(SEVERITY_LABEL[x.severity], SEV_KIND[x.severity])} <span class="finding-title" id="ft-${escapeHtml(x.id)}">${escapeHtml(x.title)}</span> ${locate}</div>
          <details class="sub" data-fid="${escapeHtml(x.id)}"${openWhy.has(x.id) ? ' open' : ''}><summary id="why-${escapeHtml(x.id)}" aria-describedby="ft-${escapeHtml(x.id)}">Why and how · ${escapeHtml(x.area)}</summary>
            <p>${escapeHtml(x.why)}</p><p><strong>Fix:</strong> ${escapeHtml(x.fix)}</p>
            ${x.examples?.length ? `<ul class="plain-list mono">${x.examples.slice(0, 8).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>${x.examples.length > 8 ? `<p class="muted">…and ${fmtNum(x.examples.length - 8)} more</p>` : ''}` : ''}
          </details>
        </li>`;
      }).join('')}</ol>
      ${f.length > 8 ? `<button type="button" class="link-btn" id="findings-more">${showAllFindings ? 'Show the top 8' : `Show all ${f.length}`}</button>` : ''}`
      : '<p class="muted">The automated checks found nothing to fix. Still read the page as a visitor would.</p>'}
      <div class="actions">
        ${f.some((x) => x.targets?.length) ? `<button type="button" class="secondary-btn" id="toggle-issues" aria-pressed="${overlayOn}">${overlayOn ? 'Hide from page' : 'Show all on page'}</button>` : ''}
        <button type="button" class="secondary-btn copy-btn" id="copy-dev" data-copy-fn="issuesMarkdown">Copy for a developer</button>
        <button type="button" class="secondary-btn copy-btn" id="copy-ai" data-copy-fn="aiPrompt">Copy for AI</button>
      </div>
      <p class="muted">"Copy for AI" copies a prompt with this page's data for ChatGPT, Claude or Gemini.</p>
    </div>
  </details>`);
}

/** Mark findings on the page: all of them, or one finding's elements. */
async function showIssuesOnPage(findings, on = true) {
  try {
    if (!on) {
      await safeSendTabMessage(currentTab.id, { type: 'UNHIGHLIGHT_ISSUES' });
      return;
    }
    const items = findings.flatMap((x) => (x.targets || []).map((target) => ({ target, label: x.title.replace(/^\d+ /, ''), severity: x.severity })));
    const res = await safeSendTabMessage(currentTab.id, { type: 'HIGHLIGHT_ISSUES', items });
    const parts = [`${res.shown} marked on the page`];
    if (res.hidden) parts.push(`${res.hidden} hidden`);
    if (res.missing) parts.push(`${res.missing} not found (refresh?)`);
    showToast(parts.join(', '));
  } catch (e) {
    showToast(e.message);
  }
}

/** Compare with the last audit of this URL on this device and show what changed. */
async function showChanges(score, gen = auditGen) {
  if (!$('changes-slot') || !onpageData) return;
  const id = pageId(pageUrl);
  const snap = snapshotOf(onpageData, technicalData?.status ? technicalData : null, score);
  const res = await withStoreLock('snapshots', async () => {
    const { snapshots = {} } = await chrome.storage.local.get('snapshots');
    const r = recordSnapshot(snapshots, id, snap, Date.now());
    await chrome.storage.local.set({ snapshots: r.store });
    return r;
  });
  const slot = $('changes-slot');
  if (gen !== auditGen || !slot || !res.changes.length) return;
  const fmt = (v) => (v === '' || v == null ? '(empty)' : String(v));
  rerender(slot, `<details class="card collapsible" open>
    <summary><h2 class="card-title">Changed since ${escapeHtml(timeAgo(res.since))}</h2> ${tag(`${res.changes.length} change${res.changes.length === 1 ? '' : 's'}`, 'neutral')}</summary>
    <div class="card-body"><table class="data-table"><thead><tr><th scope="col">What</th><th scope="col">Before</th><th scope="col">Now</th></tr></thead><tbody>
      ${res.changes.map((c) => `<tr><th scope="row">${escapeHtml(c.label)}</th><td>${escapeHtml(fmt(c.before))}</td><td>${escapeHtml(fmt(c.after))}</td></tr>`).join('')}
    </tbody></table><p class="muted">Compared with your previous audit of this URL in this browser.</p></div>
  </details>`);
}

function renderVerdict() {
  const slot = $('verdict-slot');
  if (!slot || !onpageData) return;
  const verdict = computeIndexability(onpageData, techPending ? { pending: true } : technicalData);
  const health = computeHealthScore(onpageData, technicalData, snippetPx());
  const failing = health.checks.filter((c) => c.score < 1);
  const hasIssues = verdict.issues.length && verdict.issues[0].msg !== 'All checks passed';
  const sym = verdict.level === 'good' ? '✓' : verdict.level === 'warn' ? '!' : verdict.level === 'pending' ? '…' : '✗';
  const scoreOpen = !!slot.querySelector('.score-details')?.open;
  rerender(slot, `
    <div class="verdict verdict-${verdict.level}">
      <div class="verdict-head">
        <span class="verdict-sym" aria-hidden="true">${sym}</span>
        <span class="verdict-title">${escapeHtml(verdict.verdict)}</span>
        <span class="health" title="On-page checklist score, not a ranking prediction">${techPending ? '<span class="muted">Score <span aria-hidden="true">…</span><span class="visually-hidden">after the server check</span></span>' : `Score ${health.score}<span class="muted">/100</span>`}</span>
      </div>
      ${hasIssues ? `<ul class="verdict-reasons">${verdict.issues.map((iss) => `<li>${escapeHtml(iss.msg)}${iss.hint ? `<div class="hint">${escapeHtml(iss.hint)}</div>` : ''}</li>`).join('')}</ul>` : ''}
      ${failing.length ? `<details class="score-details"${scoreOpen ? ' open' : ''}><summary id="score-summary">What the score is missing (${failing.length})</summary>
        <p class="muted">A checklist score for this page, not a ranking prediction.</p>
        <ul>${failing.map((c) => `<li>${escapeHtml(c.label)}: ${Math.round(c.score * 100)}%</li>`).join('')}</ul>
      </details>` : ''}
    </div>`);
  renderFindings();
}

async function loadRendered(gen = auditGen) {
  if (!technicalData?.raw) return;
  let rendered = null;
  try {
    rendered = await safeSendTabMessage(currentTab.id, { type: 'GET_RENDERED' });
  } catch {}
  if (gen !== auditGen) return;
  renderedData = rendered;
  const slot = $('rendering-slot');
  if (slot && renderedData) rerender(slot, renderComparison(technicalData.raw, renderedData));
  else if (slot) rerender(slot, '<p class="muted">Needle could not compare the server HTML with the page after JavaScript. Refresh to try again.</p>');
  renderFindings();
}

// ---------------------------------------------------------------------------
// GEO (AI search readiness)
// ---------------------------------------------------------------------------

async function loadGEO(gen = auditGen) {
  if (!onpageData) return;
  const pagePath = (() => { try { const u = new URL(pageUrl); return u.pathname + u.search; } catch { return '/'; } })();
  const aiAccess = analyzeAIAccess(technicalData?.robotsTxt?.ok ? technicalData.robotsTxt : null, pagePath);
  const eeat = analyzeEEAT(onpageData);
  const citability = analyzeCitability(onpageData);
  let llmsTxt = null;
  const origin = (() => { try { return new URL(pageUrl).origin; } catch { return ''; } })();
  if (origin) {
    const tabId = currentTab.id;
    try {
      llmsTxt = (await cachedCall(cacheKey('llms', origin), async () => {
        const r = await fetchLlmsTxt(origin, pageFetcher(tabId));
        // A network failure says nothing about the files: don't keep it for an hour.
        if (r.summary.error && r.full.error) throw new Error(r.summary.error);
        return r;
      })).data;
    } catch {}
  }
  if (gen !== auditGen) return;
  const slot = $('panel-ai');
  if (!slot) return;
  const score = aiReadinessScore(aiAccess, eeat, citability);
  // A 4xx robots.txt means "no rules"; 429 and 5xx mean crawlers stay away, so nothing is known.
  const robotsKnown = !!technicalData?.robotsTxt?.ok || ((technicalData?.robotsTxt?.status || 0) >= 400 && technicalData.robotsTxt.status < 500 && technicalData.robotsTxt.status !== 429);
  geoData = { aiAccess, eeat, citability, llmsTxt, score, robotsKnown };
  renderFindings();

  const blockedSearch = aiAccess.bots.filter((b) => !b.allowed && b.kind === 'search');
  const kindLabel = { search: 'AI search', user: 'user fetch', training: 'training', control: 'Gemini use (token)' };
  const signalRows = (rows, failText) => rows.map((s) => `
    <div class="row"><div class="k">${escapeHtml(s.label)}</div>
      <div class="v">${s.ok ? tag('ok', 'good') : s.info ? tag('not scored', 'info') : tag(failText, 'warn')} <span class="muted">${escapeHtml(s.value)}</span>
      ${s.hint && !s.ok ? `<div class="hint">${escapeHtml(s.hint)}</div>` : ''}</div></div>`).join('');

  rerender(slot, `
    <div class="card">
      <h2>AI search readiness ${robotsKnown ? tag(`${score.score}/100`, score.level) : tag(`${score.score}/100, robots.txt not read`, 'neutral')}</h2>
      <p class="muted">Can AI search engines reach and quote this page? ${escapeHtml(AI_SCORE_NOTE)}</p>
      ${aiAccess.cloudflareManaged ? '<div class="hint">Cloudflare manages this robots.txt. Its AI Crawl Control may also block AI bots at the network level (HTTP 403), even ones allowed below. Check AI Crawl Control in the Cloudflare dashboard.</div>' : ''}
      <h3>AI crawlers in robots.txt ${!robotsKnown ? tag('robots.txt not read', 'warn') : blockedSearch.length ? tag(`${blockedSearch.length} AI search bot${blockedSearch.length === 1 ? '' : 's'} blocked`, 'bad') : tag('AI search bots allowed', 'good')}</h3>
      <ul class="bot-list">
        ${aiAccess.bots.map((b) => `
          <li>
            ${!robotsKnown ? tag('unknown', 'neutral') : b.allowed ? tag('allowed', 'good') : tag('blocked', b.kind === 'search' ? 'bad' : 'neutral')}
            <span class="bot-name">${escapeHtml(b.ua)}</span>
            <span class="muted">${escapeHtml(b.vendor)} · ${kindLabel[b.kind]}</span>
            ${!b.allowed && b.rule ? `<span class="mono bot-rule">${escapeHtml(b.rule)}</span>` : ''}
            <span class="bot-purpose">${escapeHtml(b.purpose)}</span>
          </li>`).join('')}
      </ul>
      <h3>llms.txt <span class="muted">(information only)</span></h3>
      ${row('/llms.txt', !llmsTxt ? tag('could not check', 'neutral') : llmsTxt.summary?.ok ? tag(llmsTxt.summary.size ? `found, ${(llmsTxt.summary.size / 1024).toFixed(1)} KB` : 'found', 'good') : tag('not found', 'neutral'))}
      ${row('/llms-full.txt', !llmsTxt ? tag('could not check', 'neutral') : llmsTxt.full?.ok ? tag('found', 'good') : tag('not found', 'neutral'))}
      <p class="muted">A proposed file that points AI tools to your key pages. Google says no special file is needed for its AI features.</p>
      <h3>Trust signals (E-E-A-T)</h3>
      ${signalRows(eeat, 'missing')}
      <h3>Easy to quote</h3>
      ${signalRows(citability, 'low')}
    </div>`);
}

// ---------------------------------------------------------------------------
// Speed and keywords (PageSpeed Insights, DataForSEO)
// ---------------------------------------------------------------------------

async function restoreOffpageFromCache() {
  const tg = tabGen;
  const psi = await getCache(cacheKey('psi', pageId(pageUrl)));
  if (tg !== tabGen) return;
  if (psi) {
    offpageData.psi = psi.data;
    rerender($('psi-result'), renderPsi(psi.data, psi.age));
    $('run-psi').textContent = 'Run again';
  }
  restoreDfsFromCache();
}

async function restoreDfsFromCache() {
  const tg = tabGen;
  const { locationCode, languageCode } = getOffpageSelection();
  const hit = await getCache(cacheKey('dfs', `${pageId(pageUrl)}|${locationCode}|${languageCode}`));
  if (tg !== tabGen) return;
  if (hit) {
    offpageData.dfs = hit.data;
    rerender($('dfs-result'), renderDfs(hit.data, hit.age));
    $('run-dfs').textContent = 'Look up again';
  } else {
    rerender($('dfs-result'), '');
    $('run-dfs').textContent = 'Look up keywords';
  }
}

let psiRunning = false;
async function runPsi(force = false) {
  if (psiRunning || !/^https?:/.test(pageUrl)) return;
  const tg = tabGen;
  const { psiKey } = await getSecrets();
  if (!psiKey) {
    rerender($('psi-result'), `<div class="notice"><strong>Add a free PageSpeed Insights API key</strong>
      <div>Google only answers requests that carry a key. It is free: create one in Google Cloud, then paste it in Settings.</div>
      <div class="actions"><button type="button" class="primary-btn" data-action="open-options" data-section="h-psi">Open Settings</button>
        <a class="link-btn" href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener noreferrer">Test on the PageSpeed Insights website ${ICON.external}</a></div></div>`);
    return;
  }
  if (tabGen !== tg) return;
  psiRunning = true;
  const btn = $('run-psi');
  setBusy(btn, true);
  rerender($('psi-result'), loading('Running Lighthouse on mobile and desktop. This takes 20 to 60 seconds…'));
  announce('Speed test started');
  try {
    const res = await sendWithRetry({ type: 'RUN_PSI', url: pageUrl, force, viewId: viewId() });
    if (tg !== tabGen) return;
    offpageData.psi = res.data;
    offpageData.psiError = null;
    rerender($('psi-result'), renderPsi(res.data, res.age));
    announce('Speed test finished');
    btn.textContent = 'Run again';
  } catch (e) {
    if (tg !== tabGen) return;
    offpageData.psiError = e.message;
    const keyMissing = /API key/.test(e.message);
    rerender($('psi-result'), errorBox('The speed test did not finish', e.message,
      keyMissing ? `<button type="button" class="primary-btn" data-action="open-options" data-section="h-psi">Add a key in Settings</button>
        <a class="link-btn" href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener">Open PageSpeed Insights ${ICON.external}</a>` : ''));
  } finally {
    if (tg === tabGen) {
      psiRunning = false;
      setBusy(btn, false);
    }
  }
}

let dfsRunning = false;
async function runDfs(force = false) {
  if (dfsRunning || !/^https?:/.test(pageUrl)) return;
  const tg = tabGen;
  const { dfsLogin, dfsPassword } = await getSecrets();
  if (!dfsLogin || !dfsPassword) {
    rerender($('dfs-result'), `<div class="notice"><strong>Add your DataForSEO login first</strong>
      <div>DataForSEO is a pay-per-use data provider. Needle uses your own account; it has no account of its own.</div>
      <div class="actions"><button type="button" class="primary-btn" data-action="open-options" data-section="h-dfs">Open Settings</button></div></div>`);
    return;
  }
  if (tg !== tabGen) return;
  dfsRunning = true;
  const btn = $('run-dfs');
  setBusy(btn, true);
  const { locationCode, languageCode } = getOffpageSelection();
  rerender($('dfs-result'), loading('Asking DataForSEO…'));
  try {
    const res = await sendWithRetry({ type: 'RUN_DFS', url: pageUrl, locationCode, languageCode, force });
    if (tg !== tabGen) return;
    offpageData.dfs = res.data;
    offpageData.dfsError = null;
    rerender($('dfs-result'), renderDfs(res.data, res.age));
    btn.textContent = 'Look up again';
    announce('Keyword lookup finished');
  } catch (e) {
    if (tg !== tabGen) return;
    if (e.message === NEEDS_PERMISSION) {
      rerender($('dfs-result'), dfsPermissionNotice().replace('data-grant="dataforseo"', 'data-grant="dataforseo" data-retry="run-dfs"'));
    } else {
      offpageData.dfsError = e.message;
      rerender($('dfs-result'), errorBox('The keyword lookup failed', e.message,
        `<button type="button" class="link-btn" data-action="open-options" data-section="h-dfs">Check Settings</button>`));
    }
  } finally {
    if (tg === tabGen) {
      dfsRunning = false;
      setBusy(btn, false);
    }
  }
}

$('run-psi').addEventListener('click', () => runPsi(!!offpageData.psi));
$('run-crux').addEventListener('click', () => runCrux());
$('run-bing').addEventListener('click', () => runBing());

/** A small line chart of weekly values with the "good" threshold. */
function sparkline(values, good, poor, fmt) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return '<span class="muted">not enough weeks</span>';
  const W = 220, H = 46, pad = 4;
  const max = Math.max(...pts.map(([, v]) => v), poor) * 1.05;
  const x = (i) => pad + (i / (values.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  const last = pts[pts.length - 1];
  const first = pts[0];
  const desc = `From ${fmt(first[1])} to ${fmt(last[1])} over ${values.length} weeks; good is under ${fmt(good)}.`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(desc)}">
    <line x1="${pad}" x2="${W - pad}" y1="${y(good)}" y2="${y(good)}" class="spark-good"/>
    <polyline points="${pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" class="spark-line"/>
    <circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="3.2" class="spark-dot"/>
  </svg>`;
}

function renderCrux(d, age) {
  const metric = (key, label, fmt) => {
    const vals = d[key] || [];
    const lastVal = [...vals].reverse().find((v) => v != null);
    const kind = lastVal == null ? 'neutral' : lastVal <= CWV_GOOD[key] ? 'good' : lastVal <= CWV_POOR[key] ? 'warn' : 'bad';
    const word = { good: 'good', warn: 'needs work', bad: 'poor', neutral: 'no data' }[kind];
    return `<div class="crux-row"><div><strong>${label}</strong> ${lastVal != null ? `${escapeHtml(fmt(lastVal))} ${tag(word, kind)}` : tag('no data', 'neutral')}</div>${sparkline(vals, CWV_GOOD[key], CWV_POOR[key], fmt)}</div>`;
  };
  return `${cachedBanner(age, null)}
    <p class="muted">${d.scope === 'page' ? 'This page' : 'Whole site (not enough data for this page alone)'}, weeks ending ${escapeHtml(d.weeks[0] || '')} to ${escapeHtml(d.weeks[d.weeks.length - 1] || '')}. The dashed line is Google's "good" limit.</p>
    ${metric('lcp', 'LCP', (v) => `${(v / 1000).toFixed(2)} s`)}
    ${metric('inp', 'INP', (v) => `${Math.round(v)} ms`)}
    ${metric('cls', 'CLS', (v) => v.toFixed(2))}`;
}

async function runCrux() {
  const { psiKey } = await getSecrets();
  if (!psiKey) {
    rerender($('crux-result'), `<div class="notice"><strong>Add a Google API key first</strong><div>The same key as for PageSpeed, with the Chrome UX Report API turned on.</div>
      <div class="actions"><button type="button" class="primary-btn" data-action="open-options" data-section="h-psi">Open Settings</button></div></div>`);
    return;
  }
  const tg = tabGen;
  const btn = $('run-crux');
  setBusy(btn, true);
  rerender($('crux-result'), loading('Asking the Chrome UX Report…'));
  try {
    const res = await sendWithRetry({ type: 'RUN_CRUX', url: pageUrl, formFactor: $('crux-desktop').checked ? 'DESKTOP' : 'PHONE' });
    if (tg === tabGen) rerender($('crux-result'), renderCrux(res.data, res.age));
  } catch (e) {
    if (tg === tabGen) rerender($('crux-result'), errorBox('No trend available', e.message));
  } finally {
    if (tg === tabGen) setBusy(btn, false);
  }
}

async function runBing() {
  const { bingKey } = await getSecrets();
  if (!bingKey) {
    rerender($('bing-result'), `<div class="notice"><strong>Add your Bing Webmaster Tools API key</strong><div>In Bing Webmaster Tools: Settings, then API Access. Settings in Needle shows the steps.</div>
      <div class="actions"><button type="button" class="primary-btn" data-action="open-options" data-section="h-bing">Open Settings</button></div></div>`);
    return;
  }
  const tg = tabGen;
  const btn = $('run-bing');
  setBusy(btn, true);
  rerender($('bing-result'), loading('Asking Bing Webmaster Tools…'));
  try {
    const res = await sendWithRetry({ type: 'RUN_BING', url: pageUrl });
    if (tg !== tabGen) return;
    const d = res.data;
    rerender($('bing-result'), `${cachedBanner(res.age, null)}
      ${row('Site in your account', `<span class="mono">${escapeHtml(d.site)}</span>`)}
      ${d.crawl ? row('Last crawled by Bing', `${escapeHtml(d.crawl.lastCrawled || 'unknown')}${d.crawl.status ? ` <span class="muted">HTTP ${d.crawl.status}</span>` : ''}`) : ''}
      ${row('Clicks and impressions', `${fmtNum(d.clicks)} clicks · ${fmtNum(d.impressions)} impressions <span class="muted">(the period Bing keeps)</span>`)}
      ${d.queries.length ? `<table class="data-table"><thead><tr><th scope="col">Query</th><th scope="col">Clicks</th><th scope="col">Impr.</th><th scope="col">Pos.</th></tr></thead><tbody>
        ${d.queries.map((q) => `<tr><td>${escapeHtml(q.query)}</td><td>${fmtNum(q.clicks)}</td><td>${fmtNum(q.impressions)}</td><td>${q.position ?? '—'}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Bing has no search data for this page yet.</p>'}`);
  } catch (e) {
    if (tg !== tabGen) return;
    if (e.message === NEEDS_PERMISSION) {
      rerender($('bing-result'), `<div class="notice"><strong>Allow Needle to contact Bing Webmaster Tools</strong><div>Requests go to ssl.bing.com with your own key.</div>
        <div class="actions"><button type="button" class="primary-btn" data-grant-bing>Allow Bing</button></div></div>`);
    } else {
      rerender($('bing-result'), errorBox('No Bing data', e.message));
    }
  } finally {
    if (tg === tabGen) setBusy(btn, false);
  }
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-grant-bing]')) return;
  if (await requestOrigins(BING_ORIGINS)) runBing();
});
$('run-dfs').addEventListener('click', () => runDfs(!!offpageData.dfs));

function renderPsi(d, age) {
  if (!d) return '';
  const scoreTag = (n) => n == null ? tag('—', 'neutral') : tag(String(n), n >= 90 ? 'good' : n >= 50 ? 'warn' : 'bad');
  const col = (p, label) => {
    if (!p) return '';
    if (p.error) return `<div class="psi-col"><h3>${label}</h3>${errorBox('Not available', p.error)}</div>`;
    const field = p.hasFieldData ? `
      ${p.originFallback ? `<p class="muted">Not enough real-user data for this page; these are whole-site numbers.</p>` : ''}
      ${row('LCP', p.lcp != null ? `${(p.lcp / 1000).toFixed(2)} s ${cwvTag(p.lcpCategory)}` : 'no data')}
      ${row('INP', p.inp != null ? `${fmtNum(p.inp)} ms ${cwvTag(p.inpCategory)}` : 'no data')}
      ${row('CLS', p.cls != null ? `${p.cls.toFixed(2)} ${cwvTag(p.clsCategory)}` : 'no data')}`
      : `<p class="muted">No real-user (Chrome UX Report) data for this page.</p>`;
    return `<div class="psi-col">
      <h3>${label}</h3>
      ${row('Performance', scoreTag(p.performanceScore))}
      ${row('Accessibility', scoreTag(p.accessibilityScore))}
      ${row('Best practices', scoreTag(p.bestPracticesScore))}
      ${row('SEO', scoreTag(p.seoScore))}
      ${field}
      ${p.opportunities?.length ? `<details><summary>${p.opportunities.length} thing${p.opportunities.length === 1 ? '' : 's'} to improve</summary>
        <ul class="plain-list">${p.opportunities.slice(0, 10).map((o) => `<li>${escapeHtml(o.title)}${o.displayValue ? ` <span class="muted">${escapeHtml(o.displayValue)}</span>` : ''}</li>`).join('')}</ul>
      </details>` : ''}
    </div>`;
  };
  return `${cachedBanner(age, null)}<div class="psi-grid">${col(d.mobile, 'Mobile')}${col(d.desktop, 'Desktop')}</div>`;
}

function renderDfs(d, age) {
  if (!d) return '';
  const locName = LOCATIONS.find((l) => l.code === d.locationCode)?.name || d.locationCode;
  const langName = LANGUAGES.find((l) => l.code === d.languageCode)?.name || d.languageCode;
  return `${cachedBanner(age, null)}
    <h3>${escapeHtml(bareHost(pageUrl))} in ${escapeHtml(locName)}, ${escapeHtml(langName)}</h3>
    ${row('Organic keywords (whole site)', fmtNum(d.organicKeywords))}
    ${row('Estimated monthly organic visits', fmtNum(d.organicTraffic))}
    <h3>Top keywords for this page</h3>
    ${d.topKeywords?.length
      ? `<table class="data-table"><thead><tr><th scope="col">Keyword</th><th scope="col">Position</th><th scope="col">Volume</th></tr></thead><tbody>
          ${d.topKeywords.map((k) => `<tr><td>${escapeHtml(k.keyword)}</td><td>${k.pos ? `#${k.pos}${k.isFeaturedSnippet ? ' <span class="muted">snippet</span>' : ''}` : '—'}</td><td>${fmtNum(k.volume)}</td></tr>`).join('')}
        </tbody></table>`
      : `<p class="muted">DataForSEO has no rankings for this exact URL in this market.</p>`}
    ${d.cost ? `<p class="muted">This lookup cost ${usd(d.cost)}.</p>` : ''}`;
}

function renderExternalTools() {
  const el = $('external-tools');
  if (!el) return;
  if (!/^https?:/.test(pageUrl)) { el.innerHTML = ''; return; }
  const host = hostOf(pageUrl);
  const domainOnly = host.replace(/^www\./, '');
  let origin = '';
  try { origin = new URL(pageUrl).origin + '/'; } catch {}
  const enc = encodeURIComponent(pageUrl);
  // Country for keyword tools from the domain: any two-letter country domain (uk → gb), else the US.
  const tld = host.split('.').pop();
  const country = /^[a-z]{2}$/.test(tld) ? (tld === 'uk' ? 'gb' : tld) : 'us';
  const titleKw = (onpageData?.title || '').split(/[|–—-]/)[0].trim();
  const links = [
    ['PageSpeed Insights', `https://pagespeed.web.dev/analysis?url=${enc}`],
    ['Rich Results Test', `https://search.google.com/test/rich-results?url=${enc}`],
    ['Schema.org validator', `https://validator.schema.org/#url=${enc}`],
    ['Search Console (URL-prefix property)', `https://search.google.com/search-console?resource_id=${encodeURIComponent(origin)}`],
    ['Search Console (domain property)', `https://search.google.com/search-console?resource_id=${encodeURIComponent('sc-domain:' + domainOnly)}`],
    ['Ahrefs: this URL', `https://app.ahrefs.com/site-explorer?target=${enc}&mode=exact`],
    ['Ahrefs: whole domain', `https://app.ahrefs.com/site-explorer?target=${encodeURIComponent(host)}&mode=subdomains`],
    ...(titleKw ? [[`Ahrefs Keywords Explorer: "${titleKw.slice(0, 40)}"`, `https://app.ahrefs.com/keywords-explorer?country=${country}&input=${encodeURIComponent(titleKw)}`]] : []),
    ['SE Ranking: domain', `https://online.seranking.com/research.competitor.html/research/overview?domain=${encodeURIComponent(domainOnly)}`],
    ['Wayback Machine', `https://web.archive.org/web/*/${pageUrl}`],
    ['Facebook sharing debugger', `https://developers.facebook.com/tools/debug/?q=${enc}`],
    ['LinkedIn Post Inspector', `https://www.linkedin.com/post-inspector/inspect/${enc}`],
    ['Social card preview (opengraph.xyz)', `https://www.opengraph.xyz/url/${enc}`]
  ];
  el.innerHTML = `<details class="card collapsible">
    <summary><h2 class="card-title">Open in other tools</h2></summary>
    <p class="muted">These open the tool's own site in a new tab with this URL filled in. Some need an account there.</p>
    <ul class="plain-list">${links.map(([label, href]) => `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ${ICON.external}</a></li>`).join('')}</ul>
  </details>`;
}

// ---------------------------------------------------------------------------
// SERP
// ---------------------------------------------------------------------------

function myDomainFromInput(value) {
  const v = (value || '').trim();
  if (!v) return bareHost(pageUrl);
  try { return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, ''); } catch { return v.replace(/^www\./, ''); }
}

function serpParams() {
  return {
    keyword: $('serp-keyword').value.trim(),
    locationCode: parseInt($('serp-location').value, 10),
    languageCode: $('serp-language').value,
    device: $('serp-device').value
  };
}

let serpRunning = false;
async function loadSerp(force = false) {
  if (serpRunning) return;
  const result = $('serp-result');
  const params = serpParams();
  const myDomain = myDomainFromInput($('serp-mydomain').value);
  if (!params.keyword) {
    rerender(result, errorBox('Type a keyword first', ''));
    $('serp-keyword').focus();
    return;
  }
  const { dfsLogin, dfsPassword } = await getSecrets();
  if (!dfsLogin || !dfsPassword) {
    rerender(result, `<div class="notice"><strong>Add your DataForSEO login first</strong>
      <div>Google results come from DataForSEO, a pay-per-use provider, through your own account.</div>
      <div class="actions"><button type="button" class="primary-btn" data-action="open-options" data-section="h-dfs">Open Settings</button></div></div>`);
    return;
  }
  serpRunning = true;
  setBusy($('run-serp'), true);
  rerender(result, loading('Searching Google through DataForSEO…'));
  try {
    const res = await sendWithRetry({ type: 'FETCH_SERP', params, force });
    rerender(result, renderSerp(res.data, myDomain, res.age));
    announce('Search results ready');
  } catch (e) {
    if (e.message === NEEDS_PERMISSION) rerender(result, dfsPermissionNotice().replace('data-grant="dataforseo"', 'data-grant="dataforseo" data-retry="run-serp"'));
    else rerender(result, errorBox('The search failed', e.message));
  } finally {
    serpRunning = false;
    setBusy($('run-serp'), false);
  }
}

async function autoRestoreSerpResult() {
  const params = serpParams();
  if (!params.keyword) return;
  const hit = await getCache(cacheKey('serp', `${params.keyword}|${params.locationCode}|${params.languageCode}|${params.device}`));
  if (hit) rerender($('serp-result'), renderSerp(hit.data, myDomainFromInput($('serp-mydomain').value), hit.age));
}

$('run-serp').addEventListener('click', () => loadSerp(false));
let lastSerp = null;
$('serp-result').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-serp-copy]');
  if (!btn || !lastSerp) return;
  copyWithFeedback(btn, tsv(['Position', 'Title', 'URL', 'Domain', 'Snippet', 'Featured snippet'],
    lastSerp.organic.map((o) => [o.position, o.title, o.url, o.domain, o.snippet, o.isFeaturedSnippet ? 'yes' : ''])), 'Results copied: paste into a spreadsheet');
});
$('serp-keyword').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSerp(false); });

function renderAiOverview(ai, me) {
  if (!ai) return '';
  if (!ai.present) return `<div class="card"><h2>AI Overview</h2><p class="muted">Google showed no AI Overview for this search (one that loads later may be missed).</p></div>`;
  const cited = me && ai.references.some((r) => (r.domain || '').replace(/^www\./, '') === me);
  return `<div class="card"><h2>AI Overview</h2>
    ${me ? `<p>${cited ? tag(`${me} is cited`, 'good') : tag(`${me} is not cited`, 'warn')}</p>` : ''}
    ${ai.references.length ? `<p class="muted">Sources it cites:</p><ol class="plain-list">${ai.references.slice(0, 15).map((r) => `<li>${escapeHtml(r.domain)} ${isSafeHttpUrl(r.url) ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title || r.url)}</a>` : ''}</li>`).join('')}</ol>` : '<p class="muted">No cited sources were returned.</p>'}
  </div>`;
}

function renderSerp(d, myDomain, age) {
  if (!d) return '';
  lastSerp = d;
  const me = (myDomain || '').replace(/^www\./, '');
  const mine = d.organic.filter((o) => (o.domain || '').replace(/^www\./, '') === me);
  const top = mine[0];
  const features = Object.entries(d.features || {}).map(([type, info]) => `${FEATURE_LABELS[type] || type.replace(/_/g, ' ')}${info.count > 1 ? ` (${info.count})` : ''}`);
  const intent = classifyIntent(d.keyword, d.organic);
  const locName = LOCATIONS.find((l) => l.code === d.locationCode)?.name || d.locationCode;
  const langName = LANGUAGES.find((l) => l.code === d.languageCode)?.name || d.languageCode;

  const banner = me
    ? top
      ? `<div class="notice notice-good"><strong>${escapeHtml(me)} ranks #${top.position}</strong>${top.isFeaturedSnippet ? ' (featured snippet)' : ''}${mine.length > 1 ? ` <span class="muted">${mine.length} URLs in the top ${d.organic.length}</span>` : ''}</div>`
      : `<div class="notice"><strong>${escapeHtml(me)} is not in the top ${d.organic.length}</strong></div>`
    : '';

  return `${cachedBanner(age, 'serp')}
    <p class="muted">${escapeHtml(d.keyword)} · ${escapeHtml(locName)} · ${escapeHtml(langName)} · ${escapeHtml(d.device)}${d.cost ? ` · cost ${usd(d.cost)}` : ''}</p>
    ${banner}
    ${intent ? `<p>Search intent: ${tag(intent.label, 'neutral')} <span class="muted">${escapeHtml(intent.description)} (${escapeHtml(intent.confidence)} confidence)</span></p>` : ''}
    ${features.length ? `<div class="card"><h2>On this results page</h2><p>${features.map((f) => `<span class="chip">${escapeHtml(f)}</span>`).join(' ')}</p></div>` : ''}
    ${renderAiOverview(d.aiOverview, me)}
    <div class="card">
      <h2>Top ${d.organic.length} results</h2>
      <div class="actions"><button type="button" class="secondary-btn" data-serp-copy>Copy results as table</button></div>
      <ol class="serp-list">
        ${d.organic.map((o) => {
          const isMe = me && (o.domain || '').replace(/^www\./, '') === me;
          const safe = isSafeHttpUrl(o.url) ? o.url : '';
          return `<li class="serp-item${isMe ? ' is-me' : ''}">
            <div class="serp-head"><span class="serp-pos">#${o.position}</span> <span class="serp-domain">${escapeHtml(o.domain)}</span>
              ${isMe ? tag('your site', 'good') : ''}${o.isFeaturedSnippet ? tag('featured snippet', 'neutral') : ''}</div>
            ${safe ? `<a class="serp-title" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.title)}</a>` : `<div class="serp-title">${escapeHtml(o.title)}</div>`}
            <div class="serp-snippet">${escapeHtml(o.snippet)}</div>
            ${o.rating ? `<div class="muted">Rating ${escapeHtml(o.rating.value)} (${fmtNum(o.rating.count)} reviews)</div>` : ''}
          </li>`;
        }).join('') || '<li class="muted">No organic results.</li>'}
      </ol>
    </div>`;
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

let visibleComps = 1;
function updateCompSlots() {
  document.querySelectorAll('.comp-slot').forEach((slot) => {
    slot.hidden = parseInt(slot.dataset.idx, 10) >= visibleComps;
  });
  $('add-competitor').hidden = visibleComps >= 3;
}

$('add-competitor').addEventListener('click', () => {
  if (visibleComps < 3) visibleComps++;
  updateCompSlots();
  setStatePath('compare.visibleComps', visibleComps);
  document.querySelector(`.competitor-url[data-idx="${visibleComps - 1}"]`)?.focus();
});

$('clear-compare').addEventListener('click', () => {
  $('compare-self').value = '';
  $('compare-keyword').value = '';
  document.querySelectorAll('.competitor-url').forEach((inp) => { inp.value = ''; });
  visibleComps = 1;
  updateCompSlots();
  rerender($('compare-result'), '');
  popupState.compare = { visibleComps: 1, competitorUrls: [], selfUrl: '', keyword: '' };
  queueSaveState();
});

$('run-compare').addEventListener('click', () => loadCompare(false));

/** The current tab, measured from its served HTML exactly like the competitors. */
async function snapshotCurrentTab() {
  try {
    const [r] = await fetchInPage(currentTab.id, [{ url: pageId(pageUrl), maxBytes: 5 * 1024 * 1024 }]);
    if (r?.ok && r.text) return { ...parseCompetitorHtml(r.text, r.url || pageUrl), requestedUrl: pageUrl };
  } catch {}
  return null;
}

const normUrl = (u) => urlKey(u) || u;

function serpPositionFor(url, serpData) {
  if (!serpData?.organic) return null;
  const exact = serpData.organic.find((o) => normUrl(o.url) === normUrl(url));
  if (exact) return { position: exact.position, exact: true };
  const host = bareHost(url);
  const sameSite = serpData.organic.find((o) => (o.domain || '').replace(/^www\./, '') === host);
  return sameSite ? { position: sameSite.position, exact: false, url: sameSite.url } : null;
}

let compareRunning = false;
async function loadCompare(force = false) {
  if (compareRunning) return;
  const result = $('compare-result');
  const selfUrl = $('compare-self').value.trim();
  const keyword = $('compare-keyword').value.trim();
  const competitorUrls = [...document.querySelectorAll('.competitor-url')].map((i) => i.value.trim()).filter(Boolean);

  if (!competitorUrls.length) { rerender(result, errorBox('Add at least one competitor URL', '')); return; }
  const bad = [...competitorUrls, ...(selfUrl ? [selfUrl] : [])].find((u) => !/^https?:\/\//i.test(u));
  if (bad) { rerender(result, errorBox('URLs must start with https:// or http://', bad)); return; }
  if (!selfUrl && !/^https?:/.test(pageUrl)) { rerender(result, errorBox('Fill in your page', 'This tab is not a web page.')); return; }

  if (!(await hasOrigins(ALL_SITES))) {
    rerender(result, permissionNotice('To read competitor pages, Needle has to load them from their sites.').replace('data-grant="all-sites"', 'data-grant="all-sites" data-retry="run-compare"'));
    return;
  }

  compareRunning = true;
  setBusy($('run-compare'), true);
  rerender(result, loading(`Loading ${competitorUrls.length + 1} pages…`));
  try {
    let oldest = 0;
    const fetchOne = async (url) => {
      const r = await cachedCall(cacheKey('compare', url), () => fetchCompetitor(url), { force });
      oldest = Math.max(oldest, r.age || 0);
      return r.data;
    };
    const meData = selfUrl ? await fetchOne(selfUrl) : (await snapshotCurrentTab());
    if (!meData) throw new Error('Needle could not read this tab. Reload it and try again.');

    const settled = await Promise.allSettled(competitorUrls.map(fetchOne));
    const failures = [];
    const sources = [{ label: 'You', data: meData, isMe: true }];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') sources.push({ label: `Competitor ${i + 1}`, data: r.value, isMe: false });
      else failures.push(`${competitorUrls[i]}: ${r.reason?.message || 'failed'}`);
    });

    let serpData = null;
    let serpError = null;
    if (keyword) {
      const market = marketFor(meData.url || pageUrl, meData.lang);
      try {
        serpData = (await sendWithRetry({ type: 'FETCH_SERP', params: { keyword, locationCode: market.code, languageCode: market.lang, device: 'desktop' }, force })).data;
        sources.forEach((s) => { s.serp = serpPositionFor(s.data.url, serpData); s.serpPosition = s.serp?.exact ? s.serp.position : null; });
      } catch (e) {
        serpError = e.message === NEEDS_PERMISSION ? 'Allow DataForSEO in Settings to add Google positions.' : e.message;
      }
    }

    const failHtml = failures.length ? errorBox(`${failures.length} page${failures.length === 1 ? '' : 's'} could not be loaded`, failures.join(' · ')) : '';
    rerender(result, failHtml + cachedBanner(oldest, 'compare') + renderCompareMulti(sources, serpData, keyword, serpError));
    attachCompareExportHandlers(sources, serpData, keyword);
    announce('Comparison ready');
  } catch (e) {
    rerender(result, errorBox('The comparison failed', e.message));
  } finally {
    compareRunning = false;
    setBusy($('run-compare'), false);
  }
}

async function autoRestoreCompareResult() {
  const competitorUrls = [...document.querySelectorAll('.competitor-url')].map((i) => i.value.trim()).filter(Boolean);
  const selfUrl = $('compare-self').value.trim();
  if (!competitorUrls.length || !selfUrl) return;
  const hits = await Promise.all([selfUrl, ...competitorUrls].map((u) => getCache(cacheKey('compare', u))));
  if (hits.some((h) => !h)) return;
  const sources = hits.map((h, i) => ({ label: i === 0 ? 'You' : `Competitor ${i}`, data: h.data, isMe: i === 0 }));
  rerender($('compare-result'), cachedBanner(Math.max(...hits.map((h) => h.age || 0)), 'compare') + renderCompareMulti(sources, null, '', null));
  attachCompareExportHandlers(sources, null, '');
}

function renderCompareMulti(sources, serpData, keyword, serpError) {
  const active = sources.filter((s) => s.data);
  if (active.length < 2) return errorBox('Nothing to compare', 'At least two pages must load.');

  const headers = active.map((s) => `<th scope="col" class="${s.isMe ? 'you' : ''}">${escapeHtml(s.label)}<small>${escapeHtml(bareHost(s.data.url))}</small></th>`).join('');
  const table = (title, rowsHtml) => `<div class="card compare-scroll"><h2>${escapeHtml(title)}</h2>
    <table class="compare-table"><thead><tr><th scope="col"><span class="visually-hidden">Metric</span></th>${headers}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;

  const textRow = (label, get) => `<tr><th scope="row">${escapeHtml(label)}</th>${active.map((s) => `<td>${escapeHtml(String(get(s.data) ?? '—').slice(0, 300))}</td>`).join('')}</tr>`;
  // better: "lower" marks the lowest value as best (text + style, not colour alone).
  const numRow = (label, get, better = null, fmt = fmtNum) => {
    const vals = active.map((s) => get(s.data));
    const nums = vals.filter((v) => typeof v === 'number');
    const best = better === 'lower' ? Math.min(...nums) : better === 'higher' ? Math.max(...nums) : null;
    const distinct = new Set(nums).size > 1;
    return `<tr><th scope="row">${escapeHtml(label)}</th>${vals.map((v) => {
      const isBest = better && distinct && v === best;
      return `<td class="${isBest ? 'best' : ''}">${v == null ? '—' : escapeHtml(fmt(v))}${isBest ? ' <span class="best-mark">best</span>' : ''}</td>`;
    }).join('')}</tr>`;
  };
  const lenRow = (label, get, min, max) => `<tr><th scope="row">${escapeHtml(label)}</th>${active.map((s) => {
    const n = (get(s.data) || '').length;
    return `<td>${n ? tag(String(n), n >= min && n <= max ? 'good' : 'warn') : tag('empty', 'bad')}</td>`;
  }).join('')}</tr>`;

  let serpBlock = '';
  if (keyword && serpData) {
    const intent = classifyIntent(keyword, serpData.organic);
    const posRow = `<tr><th scope="row">Google position</th>${active.map((s) => {
      if (!s.serp) return '<td><span class="muted">not in top 20</span></td>';
      return s.serp.exact ? `<td>#${s.serp.position}</td>` : `<td><span class="muted">this page not ranking; same site #${s.serp.position}</span></td>`;
    }).join('')}</tr>`;
    const ai = serpData.aiOverview;
    const aiRow = ai?.present ? `<tr><th scope="row">Cited in AI Overview</th>${active.map((s) => {
      const host = bareHost(s.data.url);
      const hit = ai.references.find((r) => normUrl(r.url) === normUrl(s.data.url)) || ai.references.find((r) => (r.domain || '').replace(/^www\./, '') === host);
      return `<td>${hit ? tag(normUrl(hit.url) === normUrl(s.data.url) ? 'this page' : 'same site', 'good') : '<span class="muted">no</span>'}</td>`;
    }).join('')}</tr>` : '';
    serpBlock = `<div class="card compare-scroll"><h2>Google for "${escapeHtml(keyword)}"</h2>
      ${intent ? `<p>Search intent: ${tag(intent.label, 'neutral')}</p>` : ''}
      ${ai ? `<p class="muted">${ai.present ? 'Google shows an AI Overview for this search.' : 'No AI Overview for this search.'}</p>` : ''}
      <table class="compare-table"><thead><tr><th scope="col"><span class="visually-hidden">Metric</span></th>${headers}</tr></thead><tbody>${posRow}${aiRow}</tbody></table></div>`;
  } else if (keyword && serpError) {
    serpBlock = errorBox(`No Google positions for "${keyword}"`, serpError);
  }

  const typeKey = (t) => (Array.isArray(t) ? t.join(',') : String(t));
  const allTypes = [...new Set(active.flatMap((s) => (s.data.schemaTypes || []).map(typeKey)))].sort();
  const schemaRows = allTypes.map((type) => `<tr><th scope="row">${escapeHtml(type)}</th>${active.map((s) => {
    const has = (s.data.schemaTypes || []).some((t) => typeKey(t) === type);
    return `<td>${has ? tag('yes', 'good') : '<span class="muted">no</span>'}</td>`;
  }).join('')}</tr>`).join('');
  const meTypes = new Set((active[0].data.schemaTypes || []).map(typeKey));
  const missing = [...new Set(active.slice(1).flatMap((s) => (s.data.schemaTypes || []).map(typeKey)))].filter((t) => !meTypes.has(t));

  return `
    ${serpBlock}
    ${table('Title and meta', `
      ${textRow('Title', (d) => d.title)}
      ${lenRow('Title length', (d) => d.title, 30, 60)}
      ${textRow('Description', (d) => d.description)}
      ${lenRow('Description length', (d) => d.description, 70, 160)}
      ${textRow('Canonical', (d) => d.canonical)}
      ${textRow('Robots', (d) => d.robots || 'not set')}
      ${textRow('Language', (d) => d.lang)}`)}
    ${table('Headings', `
      ${textRow('H1', (d) => (d.h1s || []).join(' | '))}
      ${numRow('H1 count', (d) => d.h1Count)}
      ${numRow('H2 count', (d) => d.h2Count)}
      ${numRow('H3 count', (d) => d.h3Count)}`)}
    ${table('Content and links', `
      ${numRow('Words', (d) => d.wordCount)}
      ${numRow('Links', (d) => d.links)}
      ${numRow('Images', (d) => d.images)}
      ${numRow('Images without alt', (d) => d.imagesWithoutAlt, 'lower')}`)}
    ${allTypes.length ? `${table('Structured data', schemaRows)}
      ${missing.length ? `<p class="muted">Competitors use ${missing.length} type${missing.length === 1 ? '' : 's'} you don't: ${missing.map((m) => `<strong>${escapeHtml(m)}</strong>`).join(', ')}</p>` : ''}` : ''}
    <div class="card">
      <h2>Export</h2>
      <div class="actions">
        <button type="button" class="secondary-btn" data-compare-export="copy-csv">Copy CSV</button>
        <button type="button" class="secondary-btn" data-compare-export="copy-md">Copy Markdown</button>
        <button type="button" class="secondary-btn" data-compare-export="dl-csv">Download CSV</button>
        <button type="button" class="secondary-btn" data-compare-export="dl-md">Download Markdown</button>
      </div>
    </div>`;
}

function attachCompareExportHandlers(sources, serpData, keyword) {
  const active = sources.filter((s) => s.data);
  document.querySelectorAll('[data-compare-export]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.compareExport;
      const isCsv = kind.endsWith('csv');
      if (kind.startsWith('copy')) {
        copyWithFeedback(btn, isCsv ? buildCompareCsv(active, serpData, keyword) : buildCompareMd(active, serpData, keyword));
      } else {
        const text = isCsv
          ? buildCompareCsv(active, serpData, keyword, { forExcel: true, separator: csvSeparator })
          : buildCompareMd(active, serpData, keyword);
        download(compareExportFilename(active, keyword, isCsv ? 'csv' : 'md'), text, isCsv ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8');
        showToast('Downloaded');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

let linkFilter = { kind: 'all', ctx: 'all', checkStatus: 'all' };
let imageFilter = { kind: 'all' };

const CONTEXT_LETTER = { header: 'H', nav: 'N', breadcrumb: 'B', main: 'M', sidebar: 'S', footer: 'F', other: 'O' };
const CONTEXT_NAME = { header: 'header', nav: 'menu', breadcrumb: 'breadcrumb', main: 'main content', sidebar: 'sidebar', footer: 'footer', other: 'other' };
const ctxMark = (c) => `<span class="ctx-mark ctx-${c}" aria-hidden="true">${CONTEXT_LETTER[c] || '?'}</span>`;

function getFilteredLinks() {
  if (!onpageData?.links?.details) return [];
  return onpageData.links.details.filter((l) => {
    if (linkFilter.kind === 'internal' && !l.internal) return false;
    if (linkFilter.kind === 'external' && !l.external) return false;
    if (linkFilter.kind === 'nofollow' && !l.nofollow) return false;
    if (linkFilter.kind === 'broken' && !l.broken) return false;
    if (linkFilter.ctx !== 'all' && l.context !== linkFilter.ctx) return false;
    if (linkFilter.checkStatus !== 'all' && l.checkedStatus?.kind !== linkFilter.checkStatus) return false;
    return true;
  });
}

function linkCheckHint(l) {
  const cs = l.checkedStatus;
  if (!cs) return '';
  if (cs.kind === 'redirect' && cs.finalUrl && cs.finalUrl !== l.href) return `<div class="hint">Redirects to ${escapeHtml(cs.finalUrl)}. Link straight to the final URL.</div>`;
  if (cs.kind === 'broken') return `<div class="hint">${cs.status ? `HTTP ${cs.status}` : 'No answer'}. Fix or remove this link.</div>`;
  if (cs.kind === 'blocked') return `<div class="hint">The site refused an automated check (HTTP ${cs.status}). Open it to be sure.</div>`;
  if (cs.kind === 'timeout') return `<div class="hint">No answer within 8 seconds. Try again later.</div>`;
  return '';
}

const CHECK_LABEL = { ok: ['works', 'good'], redirect: ['redirects', 'warn'], broken: ['broken', 'bad'], blocked: ['refused check', 'neutral'], timeout: ['timed out', 'warn'], skipped: ['not checked', 'neutral'] };

function renderLinkList() {
  const list = $('link-list');
  if (!list) return;
  const filtered = getFilteredLinks();
  if (!filtered.length) { list.innerHTML = `<p class="muted">${onpageData?.links?.details?.length ? 'No links match this filter.' : 'This page has no links.'}</p>`; return; }
  list.innerHTML = `<ul class="item-list">${filtered.slice(0, 200).map((l) => {
    const flags = [];
    if (l.external) flags.push(tag('external', 'neutral'));
    if (l.nofollow) flags.push(tag('nofollow', 'neutral'));
    if (l.ugc) flags.push(tag('ugc', 'neutral'));
    if (l.sponsored) flags.push(tag('sponsored', 'neutral'));
    if (l.broken) flags.push(tag('empty href', 'warn'));
    if (l.checkedStatus) {
      const [label, kind] = CHECK_LABEL[l.checkedStatus.kind] || [l.checkedStatus.kind, 'neutral'];
      flags.push(tag(l.checkedStatus.status ? `${label} (${l.checkedStatus.status})` : label, kind));
    }
    return `<li class="item">
      <button type="button" class="locate" data-highlight="${escapeHtml(JSON.stringify({ kind: 'link', index: l.index, href: l.href }))}" aria-label="Show this link on the page">${ICON.locate}</button>
      <div class="item-body">
        <div class="item-meta">${ctxMark(l.context)}<span class="muted">${escapeHtml(CONTEXT_NAME[l.context] || l.context)}</span> ${flags.join(' ')}</div>
        <div class="item-title">${escapeHtml(l.text) || '<em class="muted">no link text</em>'}</div>
        <div class="item-url">${escapeHtml(l.href)}</div>
        ${linkCheckHint(l)}
      </div>
    </li>`;
  }).join('')}</ul>${filtered.length > 200 ? `<p class="muted">First 200 of ${fmtNum(filtered.length)} links.</p>` : ''}`;
}

async function runLinkCheck() {
  const btn = $('check-broken');
  if (!onpageData?.links?.details || !btn) return;
  const urls = [...new Set(onpageData.links.details.filter((l) => /^https?:/.test(l.href)).map((l) => l.href))];
  if (!urls.length) return;
  const key = cacheKey('linkcheck', pageId(pageUrl));
  if (!(await hasOrigins(ALL_SITES))) {
    rerender($('link-check-status'), permissionNotice('To check whether links work, Needle has to request each linked page.').replace('data-grant="all-sites"', 'data-grant="all-sites" data-retry="check-broken"'));
    return;
  }
  const gen = auditGen;
  setBusy(btn, true);
  rerender($('link-check-status'), loading(`Checking ${plural(urls.length, 'link')}…`));
  try {
    const res = await sendWithRetry({ type: 'CHECK_LINKS', urls, pageUrl, viewId: viewId() });
    await setCache(key, res.data);
    if (gen === auditGen) applyLinkCheckResults(res.data, 0);
  } catch (e) {
    if (gen === auditGen) rerender($('link-check-status'), errorBox('The link check stopped', e.message));
  } finally {
    setBusy(btn, false);
  }
}

function applyLinkCheckResults(results, ageMs) {
  const map = new Map(results.map((r) => [r.url, r]));
  onpageData.links.details.forEach((l) => { const r = map.get(l.href); if (r) l.checkedStatus = r; });
  const count = (k) => results.filter((r) => r.kind === k).length;
  const parts = [['ok', 'works', 'work'], ['redirect', 'redirects', 'redirect'], ['broken', 'broken', 'broken'], ['blocked', 'refused the check', 'refused the check'], ['timeout', 'timed out', 'timed out']]
    .filter(([k]) => count(k)).map(([k, one, many]) => `${fmtNum(count(k))} ${count(k) === 1 ? one : many}`);
  rerender($('link-check-status'), `<p>${plural(results.length, 'link')} checked: ${escapeHtml(parts.join(', '))}${ageMs ? ` <span class="muted">(saved ${escapeHtml(formatAge(ageMs))})</span>` : ''}</p>`);
  $('check-broken').textContent = 'Check again';
  renderCheckFilters();
  renderLinkList();
  renderFindings();
  announce(`${plural(results.length, 'link')} checked`);
}

function filterButtons(group, options, current) {
  return `<div class="filter-row" role="group" data-filter-group="${group}">${options.map(([val, label]) =>
    `<button type="button" class="filter-btn${current === val ? ' active' : ''}" aria-pressed="${current === val}" data-filter-val="${escapeHtml(val)}">${label}</button>`).join('')}</div>`;
}

function renderCheckFilters() {
  const container = $('check-filters');
  if (!container || !onpageData?.links?.details) return;
  const d = onpageData.links.details;
  const kinds = ['ok', 'redirect', 'broken', 'blocked', 'timeout'].filter((k) => d.some((l) => l.checkedStatus?.kind === k));
  if (!kinds.length) { container.innerHTML = ''; return; }
  container.innerHTML = filterButtons('checkStatus', [['all', 'Any status'], ...kinds.map((k) => [k, `${CHECK_LABEL[k][0]} ${d.filter((l) => l.checkedStatus?.kind === k).length}`])], linkFilter.checkStatus);
}

function linkHighlightFilter() {
  const filter = {
    internal: linkFilter.kind === 'internal' || linkFilter.kind === 'external' ? linkFilter.kind : 'all',
    nofollowOnly: linkFilter.kind === 'nofollow',
    brokenOnly: linkFilter.kind === 'broken',
    contexts: linkFilter.ctx === 'all' ? [] : [linkFilter.ctx]
  };
  if (linkFilter.checkStatus !== 'all') filter.hrefs = getFilteredLinks().map((l) => l.href);
  return filter;
}

async function setLinkHighlight(on) {
  try {
    const res = await safeSendTabMessage(currentTab.id, on ? { type: 'HIGHLIGHT_LINKS', filter: linkHighlightFilter() } : { type: 'UNHIGHLIGHT_LINKS' });
    const btn = $('toggle-links');
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? 'Hide on page' : 'Show on page';
    $('highlight-count').textContent = on ? `${res?.matched || 0} marked on the page` : '';
  } catch (e) {
    showToast(e.message);
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function getBodyImages() {
  return (onpageData?.images || []).filter(isContentImage);
}

const imgMissingAlt = (i) => i.altMissing ?? !i.alt;

function imageIssues(img) {
  const out = [];
  if (img.brokenLoad) out.push(['does not load', 'bad']);
  if (imgMissingAlt(img)) out.push(['no alt attribute', 'bad']);
  out.push(...imageSizeIssues(img, imageRules));
  if (img.lazyAboveFold) out.push(['lazy-loaded above the fold', 'warn']);
  if (img.missingDims) out.push(['no width/height (layout shift)', 'warn']);
  if (hasUncleanFilename(img.src)) out.push(['unclear file name', 'warn']);
  return out;
}

function getFilteredImages() {
  return getBodyImages().filter((i) => {
    if (imageFilter.kind === 'issues') return imageIssues(i).length > 0;
    if (imageFilter.kind === 'no-alt') return imgMissingAlt(i);
    if (imageFilter.kind === 'oversized') return i.bytes > imageRules.maxKB * 1024;
    if (imageFilter.kind === 'size') return imageSizeIssues(i, imageRules).some(([t]) => !/^over /.test(t));
    if (imageFilter.kind === 'unclean-name') return hasUncleanFilename(i.src);
    if (imageFilter.kind === 'broken') return i.brokenLoad;
    return true;
  }).sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
}

function imageFilename(src) {
  try {
    const u = new URL(src);
    return decodeURIComponent(u.pathname.split('/').pop() || u.hostname || src);
  } catch {
    return src.split('?')[0].split('/').pop() || src;
  }
}

function renderImagesCard() {
  const card = $('images-card');
  if (!card) return;
  const imgs = getBodyImages();
  const counts = {
    issues: imgs.filter((i) => imageIssues(i).length).length,
    noAlt: imgs.filter(imgMissingAlt).length,
    oversized: imgs.filter((i) => i.bytes > imageRules.maxKB * 1024).length,
    size: imgs.filter((i) => imageSizeIssues(i, imageRules).some(([t]) => !/^over /.test(t))).length,
    unclean: imgs.filter((i) => hasUncleanFilename(i.src)).length,
    broken: imgs.filter((i) => i.brokenLoad).length
  };
  const unknownSizes = imgs.filter((i) => !i.bytes).length;
  const opts = [['all', `All ${imgs.length}`]];
  if (counts.issues) opts.push(['issues', `With issues ${counts.issues}`]);
  if (counts.noAlt) opts.push(['no-alt', `No alt ${counts.noAlt}`]);
  if (counts.oversized) opts.push(['oversized', `Over ${imageRules.maxKB} KB ${counts.oversized}`]);
  if (counts.size) opts.push(['size', `Size or shape ${counts.size}`]);
  if (counts.unclean) opts.push(['unclean-name', `Unclear name ${counts.unclean}`]);
  if (counts.broken) opts.push(['broken', `Not loading ${counts.broken}`]);
  const body = card.querySelector('.card-body');
  rerender(body, imgs.length
    ? `${filterButtons('kind', opts, imageFilter.kind)}
      <div class="actions"><button type="button" class="secondary-btn copy-btn" data-copy-fn="imagesTsv">Copy as table</button></div>
      ${(() => {
        const lead = leadImageCheck(imgs, onpageData.og);
        if (!lead) return '';
        const big = lead.width >= LEAD_IMAGE_MIN_WIDTH;
        return `<p>${big ? tag(`Main image ${lead.width} px wide`, 'good')
          : lead.wideEnough ? `${tag(`Share image ${lead.shareWidth} px wide`, 'good')} <span class="muted">The largest image on the page is ${lead.width} px.</span>`
          : tag(`Main image only ${lead.width} px wide`, 'warn')}
          <span class="muted">Google recommends at least ${LEAD_IMAGE_MIN_WIDTH} px for large previews in Discover.</span></p>`;
      })()}
      ${imageRules.width ? `<p class="muted">Your size rule: ${imageRules.mode === 'exact' ? `exactly ${imageRules.width}×${imageRules.height}` : `the shape of ${imageRules.width}×${imageRules.height}`} (Settings).</p>` : ''}
      ${unknownSizes ? `<p class="muted" id="image-size-note">${plural(unknownSizes, 'file size')} unknown. <button type="button" class="link-btn" id="measure-images">${unknownSizes === 1 ? 'Measure it' : 'Measure them'}</button></p>` : ''}
      <p class="muted" id="image-size-status">${escapeHtml(imageMeasureNote)}</p>
      <ul class="item-list" id="image-list">${renderImageItems()}</ul>`
    : `<p class="muted">No content images found. Logos, icons, backgrounds and images under 200 px are left out.</p>`);
  const sum = card.querySelector('.card-sum');
  if (sum) sum.innerHTML = counts.issues ? tag(`${counts.issues} with issues`, 'warn') : imgs.length ? tag('no issues', 'good') : '';
}

function renderImageItems() {
  const filtered = getFilteredImages();
  if (!filtered.length) return '<li class="muted">No images match this filter.</li>';
  return filtered.slice(0, 100).map((img) => {
    const issues = imageIssues(img);
    const safe = isSafeHttpUrl(img.src) && !img.brokenLoad;
    const dims = img.naturalWidth ? `${img.naturalWidth}×${img.naturalHeight}` : 'size unknown';
    return `<li class="item image-item">
      ${safe ? `<img class="thumb" src="${escapeHtml(img.src)}" alt="" loading="lazy">` : '<span class="thumb thumb-empty" aria-hidden="true">✗</span>'}
      <div class="item-body">
        <div class="item-title" title="${escapeHtml(img.src)}">${escapeHtml(imageFilename(img.src))}</div>
        <div class="item-meta">${escapeHtml(dims)} · ${img.bytes ? escapeHtml(fmtKB(img.bytes)) : 'file size unknown'}</div>
        <div class="item-meta">${imgMissingAlt(img) ? '<em>no alt attribute</em>' : img.alt ? `alt: ${escapeHtml(img.alt)}` : '<span class="muted">empty alt (decorative)</span>'}</div>
        ${issues.length ? `<div class="item-meta">${issues.map(([t, k]) => tag(t, k)).join(' ')}</div>` : ''}
      </div>
      <button type="button" class="locate" data-highlight="${escapeHtml(JSON.stringify({ kind: 'image', index: img.domIndex, src: img.src }))}" aria-label="Show this image on the page">${ICON.locate}</button>
    </li>`;
  }).join('');
}

/** Ask servers for image sizes the browser didn't expose. Needs site access. */
async function measureImages() {
  const missing = [...new Set(getBodyImages().filter((i) => !i.bytes && /^https?:/.test(i.src)).map((i) => i.src))];
  if (!missing.length) return;
  if (!(await hasOrigins(ALL_SITES))) {
    const note = $('image-size-note');
    if (note) note.outerHTML = permissionNotice('To measure image files, Needle asks each image server for the file size.').replace('data-grant="all-sites"', 'data-grant="all-sites" data-retry="measure-images"');
    return;
  }
  const btn = $('measure-images');
  const hadFocus = document.activeElement === btn;
  setBusy(btn, true);
  if ($('image-size-status')) $('image-size-status').textContent = `Measuring ${plural(missing.length, 'image')}…`;
  const gen = auditGen;
  try {
    const res = await sendWithRetry({ type: 'FETCH_IMAGE_SIZES', urls: missing, pageUrl, viewId: viewId() });
    if (gen !== auditGen) return;
    const sizes = res.data || {};
    onpageData.images.forEach((i) => {
      if (sizes[i.src] != null) i.bytes = sizes[i.src];
    });
    const got = missing.filter((u) => sizes[u] != null).length;
    imageMeasureNote = got === missing.length ? `Measured ${plural(got, 'image')}.`
      : got === 0 ? 'The image servers gave no file sizes.'
      : `Measured ${fmtNum(got)} of ${plural(missing.length, 'image')}; the servers gave no size for the rest.`;
    applyImageRules(onpageData.images, imageRules);
    renderImagesCard();
    renderVerdict();
    announce(imageMeasureNote);
    // The button is gone once every size is known: keep focus in the images card.
    if (hadFocus) ($('measure-images') || $('images-card')?.querySelector('summary'))?.focus();
  } catch (e) {
    setBusy($('measure-images'), false);
    if (gen === auditGen && $('image-size-status')) $('image-size-status').textContent = e.message;
  }
}

// ---------------------------------------------------------------------------
// On-page rendering
// ---------------------------------------------------------------------------

/** Cut text to what fits in maxPx, the way Google adds an ellipsis. */
function truncateToPx(text, maxPx, font) {
  if (!text || pixelWidth(text, font) <= maxPx) return text || '';
  let lo = 0;
  let hi = text.length;
  let fit = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const slice = text.slice(0, mid).replace(/\s+\S*$/, '') + '…';
    if (pixelWidth(slice, font) <= maxPx) { fit = slice; lo = mid + 1; } else { hi = mid - 1; }
  }
  return fit || text.slice(0, 20) + '…';
}

/** og:image: 1.91:1 at 1200 px wide or more is the safe size for every network. */
function ogSizeVerdict(w, h) {
  if (!w || !h) return null;
  const ratio = w / h;
  const okRatio = ratio >= 1.8 && ratio <= 2.0;
  if (w >= 1200 && okRatio) return ['good', `${w}×${h}`];
  if (w >= 600 && okRatio) return ['warn', `${w}×${h}, small (1200 px wide is best)`];
  return ['warn', `${w}×${h}, may be cropped (use 1200×630)`];
}

function renderOnpage(d, age) {
  const titleLen = d.title?.length || 0;
  const descLen = d.description?.length || 0;
  const titlePx = pixelWidth(d.title || '', SNIPPET.titleFont);
  const descPx = pixelWidth(d.description || '', SNIPPET.descFont);
  const h1Count = d.headings.filter((h) => h.level === 1 && !h.hidden).length;
  const host = bareHost(d.url);

  let prev = 0;
  const headingsTree = d.headings.map((h, i) => {
    const skipped = prev > 0 && h.level > prev + 1;
    const from = prev;
    prev = h.level;
    return `<li class="h-row" style="--indent:${(h.level - 1) * 14}px">
      <button type="button" class="locate" data-highlight="${escapeHtml(JSON.stringify({ kind: 'heading', index: i }))}" aria-label="Show this heading on the page">${ICON.locate}</button>
      <span class="h-level">H${h.level}</span>
      <span class="h-text">${escapeHtml(h.text) || '<em class="muted">empty heading</em>'}</span>
      ${skipped ? tag(`skips from H${from}`, 'warn') : ''}
    </li>`;
  }).join('');

  const validated = validateSchema(d.schema || []);
  const faqDupes = detectFaqDuplicates(d.schema || []);
  const jsonLdTypes = collectAllSchemaTypes(d.schema || []);
  const microdataTypes = d.microdataTypes || [];
  const allTypes = [...new Set([...jsonLdTypes, ...microdataTypes])].sort();
  const suggestions = suggestMissingSchemas(d);
  const schemaErrors = validated.reduce((n, s) => n + s.issues.filter((i) => i.level === 'error').length, 0);

  const author = (() => {
    for (const s of d.schema || []) {
      const a = s.raw?.author;
      if (!a) continue;
      if (typeof a === 'string') return a;
      if (Array.isArray(a)) return a.map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean).join(', ');
      if (a.name) return a.name;
    }
    return d.authorMeta || d.authorByline || '';
  })();

  const ogImage = isSafeHttpUrl(d.og?.image) ? d.og.image : '';
  let ogW = d.og?.imageWidth || 0;
  let ogH = d.og?.imageHeight || 0;
  if ((!ogW || !ogH) && ogImage) {
    const match = (d.images || []).find((i) => i.src === ogImage);
    if (match) { ogW = ogW || match.naturalWidth; ogH = ogH || match.naturalHeight; }
  }
  const ogSize = ogImage ? ogSizeVerdict(ogW, ogH) : null;
  const twitterImage = isSafeHttpUrl(d.twitter?.image) ? d.twitter.image : ogImage;
  let crumbs = host;
  try {
    const parts = new URL(d.url).pathname.split('/').filter(Boolean).slice(0, 2);
    if (parts.length) crumbs += ' › ' + parts.join(' › ');
  } catch {}

  const metaField = (label, value, extra = '') => `<div class="meta-field"><div class="meta-label">${escapeHtml(label)} ${extra}</div><div class="meta-value">${value}</div></div>`;
  const missing = (text) => `<em class="missing">${escapeHtml(text)}</em>`;
  const ctxOrder = ['header', 'nav', 'breadcrumb', 'main', 'sidebar', 'footer', 'other'];

  return `
    ${cachedBanner(age, 'onpage')}
    <div id="verdict-slot"><div class="loading" role="status">Checking indexability…</div></div>
    <div id="findings-slot"></div>
    <div id="changes-slot"></div>

    <details class="card collapsible" open>
      <summary><h2 class="card-title">Title and description</h2></summary>
      <div class="card-body">
        ${metaField('Title', d.title ? escapeHtml(d.title) : missing('No title'),
          `${charTag(titleLen, 30, 60, 70, titlePx > 0 && titlePx <= SNIPPET.titleMaxPx)} ${d.title ? pixelTag(titlePx, SNIPPET.titleIdealPx, SNIPPET.titleMaxPx) : ''} ${d.title ? `<button type="button" class="icon-only copy-btn" data-copy-fn="title" aria-label="Copy title" title="Copy title">${ICON.copy}</button>` : ''}`)}
        ${metaField('Meta description', d.description ? escapeHtml(d.description) : missing('No meta description'),
          `${charTag(descLen, 70, 160, 170, descPx > 0 && descPx <= SNIPPET.descMaxPx)} ${d.description ? pixelTag(descPx, SNIPPET.descIdealPx, SNIPPET.descMaxPx) : ''} ${d.description ? `<button type="button" class="icon-only copy-btn" data-copy-fn="description" aria-label="Copy description" title="Copy description">${ICON.copy}</button>` : ''}`)}
        <div class="serp-preview" aria-label="Preview of the Google result">
          <div class="g-crumbs">${escapeHtml(crumbs)}</div>
          <div class="g-title">${escapeHtml(truncateToPx(d.title || '', SNIPPET.titleMaxPx, SNIPPET.titleFont)) || missing('No title')}</div>
          <div class="g-desc">${escapeHtml(truncateToPx(d.description || '', SNIPPET.descMaxPx, SNIPPET.descFont)) || missing('No description')}</div>
        </div>
        <p class="muted">Google often rewrites titles and descriptions; this shows where yours would be cut.</p>
        <details class="sub">
          <summary>More meta tags</summary>
          ${metaField('URL', `<span class="mono">${escapeHtml(d.url)}</span>`)}
          ${metaField('Canonical', d.canonical ? `<span class="mono">${escapeHtml(d.canonical)}</span>` : missing('No canonical'))}
          ${metaField('Robots', d.robots ? escapeHtml(d.robots) : '<span class="muted">not set (indexable by default)</span>')}
          ${metaField('Language', d.lang ? escapeHtml(d.lang) : missing('No lang attribute on <html>'))}
          ${metaField('Viewport', d.viewport ? escapeHtml(d.viewport) : missing('No viewport tag: the page is not mobile-friendly'))}
          ${metaField('Author', author ? escapeHtml(author) : '<span class="muted">not found</span>')}
          ${metaField('Meta keywords', d.keywords ? escapeHtml(d.keywords) : '<span class="muted">not set (Google ignores this tag)</span>')}
          <div class="actions">
            <button type="button" class="secondary-btn copy-btn" data-copy-fn="metaTsv">Copy as table</button>
            <button type="button" class="secondary-btn copy-btn" data-copy-fn="fullJson">Copy all data (JSON)</button>
          </div>
        </details>
      </div>
    </details>

    <details class="card collapsible" id="headings-card">
      <summary><h2 class="card-title">Headings (${fmtNum(d.headings.length)})</h2>
        ${h1Count === 1 ? tag('one H1', 'good') : h1Count === 0 ? tag('no H1', 'bad') : tag(`${h1Count} H1s`, 'warn')}</summary>
      <div class="card-body">
        <p class="muted">${[1, 2, 3, 4, 5, 6].map((l) => `H${l}: ${fmtNum(d.headings.filter((h) => h.level === l).length)}`).join(' · ')}</p>
        <div class="actions">
          <button type="button" class="secondary-btn" id="toggle-headings" aria-pressed="false">Show on page</button>
          <button type="button" class="secondary-btn copy-btn" data-copy-fn="headingsMarkdown">Copy as Markdown</button>
        </div>
        <ul class="h-tree">${headingsTree || '<li class="muted">No headings on this page.</li>'}</ul>
      </div>
    </details>

    <details class="card collapsible" id="links-card">
      <summary><h2 class="card-title">Links (${fmtNum(d.links.total)})</h2>
        <span class="muted">${fmtNum(d.links.internal)} internal · ${fmtNum(d.links.external)} external</span></summary>
      <div class="card-body">
        ${d.links.total ? `<div class="actions">
          <button type="button" class="secondary-btn" id="toggle-links" aria-pressed="false">Show on page</button>
          <button type="button" class="secondary-btn" id="check-broken">Check if links work</button>
          <button type="button" class="secondary-btn copy-btn" data-copy-fn="linksTsv">Copy as table</button>
          <span id="highlight-count" class="muted" role="status"></span>
        </div>` : ''}
        <div id="link-check-status" aria-live="polite"></div>
        ${d.links.total ? `${filterButtons('kind', [['all', 'All'], ['internal', `Internal ${fmtNum(d.links.internal)}`], ['external', `External ${fmtNum(d.links.external)}`], ['nofollow', `Nofollow ${fmtNum(d.links.nofollow)}`], ...(d.links.broken ? [['broken', `Empty href ${fmtNum(d.links.broken)}`]] : [])], 'all')}
        ${filterButtons('ctx', [['all', 'Anywhere'], ...ctxOrder.filter((c) => d.links.byContext[c]).map((c) => [c, `${ctxMark(c)}${CONTEXT_NAME[c]} ${fmtNum(d.links.byContext[c])}`])], 'all')}` : ''}
        <div id="check-filters"></div>
        <div id="link-list"></div>
      </div>
    </details>

    <details class="card collapsible" id="images-card">
      <summary><h2 class="card-title">Content images</h2> <span class="card-sum"></span></summary>
      <div class="card-body"></div>
    </details>

    <details class="card collapsible" id="schema-card">
      <summary><h2 class="card-title">Structured data</h2>
        ${validated.length === 0 && !microdataTypes.length ? tag('none found', 'warn') : schemaErrors ? tag(`${schemaErrors} error${schemaErrors === 1 ? '' : 's'}`, 'bad') : tag('valid', 'good')}
        ${suggestions.length ? tag(`${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}`, 'neutral') : ''}</summary>
      <div class="card-body">
        ${allTypes.length ? `<p>${allTypes.map((t) => `<span class="chip">${escapeHtml(t)}${microdataTypes.includes(t) && !jsonLdTypes.includes(t) ? ' <span class="muted">microdata</span>' : ''}</span>`).join(' ')}</p>` : '<p class="muted">No JSON-LD, microdata or RDFa on this page.</p>'}
        ${suggestions.length ? `<h3>Worth adding</h3><ul class="plain-list">${suggestions.map((s) => `<li><strong>${escapeHtml(s.type)}</strong> <span class="muted">${escapeHtml(s.priority)} priority</span><div class="hint">${escapeHtml(s.reason)}</div></li>`).join('')}</ul>` : ''}
        ${faqDupes.length ? `<div class="notice"><strong>${faqDupes.length} repeated FAQ question${faqDupes.length === 1 ? '' : 's'}</strong>
          <ul class="plain-list">${faqDupes.map((q) => `<li>"${escapeHtml(q.question)}" appears ${q.count} times</li>`).join('')}</ul>
          <div class="hint">Usually a template or plugin mistake. Keep each question once.</div></div>` : ''}
        ${validated.map((s, i) => {
          const errors = s.issues.filter((x) => x.level === 'error');
          const warns = s.issues.filter((x) => x.level === 'warn');
          return `<details class="sub"${errors.length ? ' open' : ''}>
            <summary>${escapeHtml(s.types.join(', ') || 'Unknown type')} #${i + 1} ${errors.length ? tag(`${errors.length} error${errors.length === 1 ? '' : 's'}`, 'bad') : warns.length ? tag(`${warns.length} warning${warns.length === 1 ? '' : 's'}`, 'warn') : tag('valid', 'good')}</summary>
            ${s.issues.length ? `<ul class="plain-list">${s.issues.map((iss) => `<li>${tag(iss.level === 'error' ? 'required' : iss.level === 'warn' ? 'warning' : iss.level === 'note' ? 'note' : 'recommended', iss.level === 'error' ? 'bad' : iss.level === 'warn' ? 'warn' : iss.level === 'note' ? 'info' : 'neutral')} ${escapeHtml(iss.msg)}</li>`).join('')}</ul>` : ''}
            <pre class="code">${escapeHtml(JSON.stringify(s.raw, null, 2))}</pre>
          </details>`;
        }).join('')}
        <div class="actions">
          ${validated.length ? `<button type="button" class="secondary-btn copy-btn" data-copy-fn="schemaAll">Copy all JSON-LD</button>` : ''}
          <a class="link-btn" href="https://search.google.com/test/rich-results?url=${encodeURIComponent(d.url)}" target="_blank" rel="noopener noreferrer">Rich Results Test ${ICON.external}</a>
        </div>
      </div>
    </details>

    ${d.hreflang.length || d.hreflangOutsideHead ? `
    <details class="card collapsible">
      <summary><h2 class="card-title">Hreflang (${d.hreflang.length})</h2></summary>
      <div class="card-body">${renderHreflang(d)}</div>
    </details>` : ''}

    <details class="card collapsible" id="content-card">
      <summary><h2 class="card-title">Content and keywords</h2> <span class="muted">${fmtNum(d.mainContentWordCount ?? d.wordCount)} words</span></summary>
      <div class="card-body">
        ${row('Words in the main content', d.mainContentWordCount != null ? `${fmtNum(d.mainContentWordCount)} <span class="muted">(${escapeHtml(d.mainContentSelector)})</span>` : '<span class="muted">main content not detected</span>')}
        ${row('Words on the whole page', `${fmtNum(d.wordCount)} <span class="muted">incl. menus and footer</span>`)}
        ${row('Text to HTML ratio', `${d.textRatio}%`)}
        <div id="text-analysis"><div class="loading" role="status">Reading the text…</div></div>
        <h3>Check a keyword</h3>
        <div class="inline-form">
          <label class="field"><span>Keyword or phrase</span><input type="text" id="kw-input" placeholder="e.g. trail running shoes" autocomplete="off"></label>
          <button type="button" class="secondary-btn" id="kw-check">Check</button>
        </div>
        <div id="kw-result" aria-live="polite"></div>
      </div>
    </details>

    <details class="card collapsible">
      <summary><h2 class="card-title">Social previews</h2>
        ${ogImage ? (ogSize ? tag(ogSize[1], ogSize[0]) : tag('image size unknown', 'neutral')) : tag('no og:image', 'warn')}</summary>
      <div class="card-body social-grid">
        <figure class="social-card">
          <figcaption>Facebook, LinkedIn, Slack</figcaption>
          ${ogImage ? `<img src="${escapeHtml(ogImage)}" alt="">` : '<div class="social-empty">No og:image</div>'}
          <div class="social-body"><div class="muted">${escapeHtml(host)}</div><strong>${escapeHtml(d.og?.title || d.title) || missing('No title')}</strong><div>${escapeHtml(d.og?.description || d.description)}</div></div>
        </figure>
        <figure class="social-card">
          <figcaption>X (${escapeHtml(d.twitter?.card || 'no card type')}${!d.twitter?.title && d.og?.title ? ', uses og: tags' : ''})</figcaption>
          ${twitterImage ? `<img src="${escapeHtml(twitterImage)}" alt="">` : '<div class="social-empty">No image</div>'}
          <div class="social-body"><div class="muted">${escapeHtml(host)}</div><strong>${escapeHtml(d.twitter?.title || d.og?.title || d.title) || missing('No title')}</strong></div>
        </figure>
      </div>
    </details>

  `;
}

async function loadTextAnalysis() {
  const box = $('text-analysis');
  if (!box || mainText != null) return;
  const gen = auditGen;
  try {
    const res = await safeSendTabMessage(currentTab.id, { type: 'GET_MAIN_TEXT' });
    if (gen !== auditGen) return;
    mainText = res?.text || '';
    const read = readability(mainText, res?.lang || onpageData?.lang);
    const tf = termFrequency(mainText, 10);
    const readHtml = !read.supported
      ? `<p class="muted">Readability is scored for English, Dutch, French and German pages; this page is "${escapeHtml(read.lang)}".</p>`
      : read.tooShort ? '<p class="muted">Too little text to score readability.</p>'
      : `${row('Readability', `${tag(`${read.score}/100, ${read.band}`, read.score >= 60 ? 'good' : read.score >= 30 ? 'warn' : 'bad')} <span class="muted">${escapeHtml(read.formula)}</span>`)}
         ${row('Average sentence', `${read.avgSentence} words`)}
         ${row('Long sentences (25+ words)', `${fmtNum(read.longSentences)} of ${fmtNum(read.sentences)}`)}`;
    const list = (items) => items.length ? `<ol class="plain-list">${items.map((x) => `<li>${escapeHtml(x.term)} <span class="muted">${x.count}× (${x.pct}%)</span></li>`).join('')}</ol>` : '<p class="muted">None repeated.</p>';
    rerender(box, `<h3>Readability</h3>${readHtml}
      <p class="muted">A rough guide from sentence and word length. Plain language helps every reader.</p>
      <details class="sub"><summary>Most used words and phrases</summary>
        <div class="term-grid"><div><h3>Words</h3>${list(tf.words)}</div><div><h3>2-word phrases</h3>${list(tf.phrases2)}</div><div><h3>3-word phrases</h3>${list(tf.phrases3)}</div></div>
      </details>`);
  } catch (e) {
    if (gen === auditGen) rerender(box, `<p class="muted">Could not read the text: ${escapeHtml(e.message)}</p>`);
  }
}

async function checkKeyword() {
  const phrase = $('kw-input')?.value.trim();
  if (!phrase || !onpageData) return;
  const gen = auditGen;
  if (mainText == null) await loadTextAnalysis();
  if (gen !== auditGen) return;
  const rows = keywordPlacement(phrase, onpageData, mainText || '');
  const found = rows.filter((r) => r.found).length;
  rerender($('kw-result'), `<p>"${escapeHtml(phrase)}" appears in ${found} of ${rows.length} places.</p>
    ${rows.map((r) => row(escapeHtml(r.place), `${r.found ? tag('yes', 'good') : tag('no', 'warn')} <span class="muted">${escapeHtml(r.detail)}</span>`)).join('')}
    <p class="muted">Plural forms count too. Use the phrase where it reads naturally; repeating it more doesn't help.</p>`);
}

/** Load every hreflang alternate and check status, canonical, noindex and return links. */
async function runHreflangCluster() {
  const box = $('hreflang-cluster');
  if (!box || !onpageData?.hreflang?.length) return;
  const btn = $('hreflang-check');
  // Busy while it runs: a second Enter would load every alternate again.
  if (btn?.getAttribute('aria-disabled') === 'true') return;
  if (!(await hasOrigins(ALL_SITES))) {
    rerender(box, permissionNotice('To check the alternates, Needle loads each of them from its site.').replace('data-grant="all-sites"', 'data-grant="all-sites" data-retry="hreflang-check"'));
    return;
  }
  // A campaign link (?utm_…) is the same page: alternates link back to the URL without it.
  const self = withoutTracking(pageUrl);
  const total = alternatesOf(self, onpageData.hreflang).length;
  rerender(box, loading(total > CLUSTER_MAX ? `Loading the first ${CLUSTER_MAX} of ${total} alternates…` : `Loading ${plural(total, 'alternate')}…`));
  const gen = auditGen;
  // Alternates are chosen by the page: never request addresses on the user's own network.
  const pageIsLocal = isLocalUrl(pageUrl);
  const load = async (url) => {
    if (!pageIsLocal && isLocalUrl(url)) throw new Error('local-network address, not requested');
    const r = await fetchWithTimeout(url, { credentials: 'omit', redirect: 'follow' }, 15000);
    if (!pageIsLocal && isLocalUrl(r.url)) {
      try { await r.body?.cancel(); } catch {}
      throw new Error('redirects to a local-network address');
    }
    const html = r.ok ? (await readTextCapped(r, 2 * 1024 * 1024)).text : '';
    return { status: r.status, url: r.url || url, html };
  };
  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
  setBusy(btn, true);
  let rows;
  try {
    rows = await checkHreflangCluster(self, onpageData.hreflang, load, parse);
  } finally {
    setBusy(btn, false);
  }
  if (gen !== auditGen) return;
  hreflangCluster = { rows, total };
  renderFindings();
  const bad = rows.filter((r) => r.problems.length).length;
  const partly = total > rows.length ? ` <span class="muted">Checked the first ${rows.length} of ${total} alternates.</span>` : '';
  rerender(box, `<p>${bad ? tag(`${bad} of ${rows.length} alternates with problems`, 'warn') : tag(rows.length === total ? `All ${rows.length} alternates link back` : `All ${rows.length} checked alternates link back`, 'good')}${partly}</p>
    <table class="data-table"><thead><tr><th scope="col" class="lang">hreflang</th><th scope="col">Alternate</th><th scope="col">Result</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="mono lang">${escapeHtml(r.lang)}</td><td class="mono">${escapeHtml(r.href)}</td><td>${r.problems.length ? r.problems.map((p) => tag(p, 'warn')).join(' ') : tag('ok', 'good')}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted">Google ignores hreflang pairs that don't link back to each other.${bad ? ' Added to Fix this first.' : ''}</p>`);
}

function renderHreflang(d) {
  const issues = validateHreflang(d.hreflang, withoutTracking(pageUrl));
  if (d.hreflangOutsideHead) issues.unshift({ level: 'error', msg: `${d.hreflangOutsideHead} hreflang link${d.hreflangOutsideHead === 1 ? '' : 's'} outside <head>`, hint: 'Google only reads hreflang links in <head>.' });
  const issueHtml = issues.length
    ? `<ul class="plain-list">${issues.map((iss) => `<li>${tag(iss.level === 'error' ? 'error' : iss.level === 'warn' ? 'warning' : 'note', iss.level === 'error' ? 'bad' : iss.level === 'warn' ? 'warn' : 'neutral')} ${escapeHtml(iss.msg)}${iss.hint ? `<div class="hint">${escapeHtml(iss.hint)}</div>` : ''}</li>`).join('')}</ul>`
    : `<p>${tag('All hreflang checks passed', 'good')}</p>`;
  return `${issueHtml}<table class="data-table"><thead><tr><th scope="col" class="lang">hreflang</th><th scope="col">URL</th></tr></thead><tbody>
    ${d.hreflang.map((h) => `<tr><td class="mono lang">${escapeHtml(h.lang)}</td><td class="mono">${escapeHtml(h.href)}</td></tr>`).join('')}</tbody></table>
    ${d.hreflang.length > 1 ? `<div class="actions"><button type="button" class="secondary-btn" id="hreflang-check">Check the alternates</button></div><div id="hreflang-cluster" aria-live="polite"></div>` : ''}`;
}

function attachOnpageHandlers() {
  mainText = null;
  $('content-card')?.addEventListener('toggle', (e) => { if (e.target.open) loadTextAnalysis(); });
  $('kw-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkKeyword(); });
  linkFilter = { kind: 'all', ctx: 'all', checkStatus: 'all' };
  imageFilter = { kind: 'all' };
  renderLinkList();
  renderImagesCard();
  const gen = auditGen;
  getCache(cacheKey('linkcheck', pageId(pageUrl))).then((hit) => { if (hit && gen === auditGen && onpageData) applyLinkCheckResults(hit.data, hit.age); });
}

// Delegated handlers for everything inside the on-page panel.
$('panel-onpage').addEventListener('click', async (e) => {
  const filterBtn = e.target.closest('.filter-btn');
  if (filterBtn) {
    const groupEl = filterBtn.closest('[data-filter-group]');
    const group = groupEl.dataset.filterGroup;
    groupEl.querySelectorAll('.filter-btn').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
    filterBtn.classList.add('active');
    filterBtn.setAttribute('aria-pressed', 'true');
    if (filterBtn.closest('#images-card')) {
      imageFilter[group] = filterBtn.dataset.filterVal;
      $('image-list').innerHTML = renderImageItems();
    } else {
      linkFilter[group] = filterBtn.dataset.filterVal;
      renderLinkList();
      if ($('toggle-links')?.getAttribute('aria-pressed') === 'true') setLinkHighlight(true);
    }
    return;
  }
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'toggle-links') setLinkHighlight(t.getAttribute('aria-pressed') !== 'true');
  else if (t.id === 'check-broken') runLinkCheck();
  else if (t.id === 'measure-images') measureImages();
  else if (t.id === 'kw-check') checkKeyword();
  else if (t.id === 'findings-more') { showAllFindings = !showAllFindings; renderFindings(); }
  else if (t.id === 'toggle-issues') {
    const on = t.getAttribute('aria-pressed') !== 'true';
    await showIssuesOnPage(currentFindings, on);
    t.setAttribute('aria-pressed', String(on));
    t.textContent = on ? 'Hide from page' : 'Show all on page';
  } else if (t.dataset.findingShow != null) {
    const finding = (showAllFindings ? currentFindings : currentFindings.slice(0, 8))[Number(t.dataset.findingShow)];
    if (finding) {
      await showIssuesOnPage([finding]);
      const all = $('toggle-issues');
      if (all) { all.setAttribute('aria-pressed', 'true'); all.textContent = 'Hide from page'; }
    }
  }
  else if (t.id === 'hreflang-check') runHreflangCluster();
  else if (t.id === 'toggle-headings') {
    const on = t.getAttribute('aria-pressed') !== 'true';
    try {
      await safeSendTabMessage(currentTab.id, { type: on ? 'HIGHLIGHT_HEADINGS' : 'UNHIGHLIGHT_HEADINGS' });
      t.setAttribute('aria-pressed', String(on));
      t.textContent = on ? 'Hide on page' : 'Show on page';
    } catch (err) { showToast(err.message); }
  } else if (t.dataset.copyFn) {
    const toast = { title: 'Title copied', description: 'Description copied', issuesMarkdown: 'Issues copied as Markdown', aiPrompt: 'Prompt copied: paste it into your AI assistant', linksTsv: 'Links copied: paste into a spreadsheet', imagesTsv: 'Images copied: paste into a spreadsheet' }[t.dataset.copyFn];
    copyWithFeedback(t, copyFunctions[t.dataset.copyFn]?.(), toast);
  }
});

/** Tab-separated table that pastes cleanly into Sheets or Excel. */
const copyFunctions = {
  title: () => onpageData?.title || '',
  description: () => onpageData?.description || '',
  metaTsv: () => {
    if (!onpageData) return '';
    const d = onpageData;
    const h1s = d.headings.filter((h) => h.level === 1 && !h.hidden);
    return [
      ['url', d.url], ['title', d.title], ['title_length', d.title.length],
      ['description', d.description], ['description_length', d.description.length],
      ['canonical', d.canonical], ['robots', d.robots], ['lang', d.lang],
      ['og_title', d.og.title], ['og_description', d.og.description], ['og_image', d.og.image],
      ['h1', h1s.map((h) => h.text).join(' | ')], ['h1_count', h1s.length], ['word_count', d.wordCount]
    ].map((r) => r.map(sheetCell).join('\t')).join('\n');
  },
  headingsMarkdown: () => (onpageData?.headings || []).map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n'),
  fullJson: () => JSON.stringify({ onpage: onpageData, technical: technicalData }, null, 2),
  issuesMarkdown: () => (onpageData ? buildIssuesMarkdown(onpageData, technicalData, { findings: currentFindings }) : ''),
  aiPrompt: () => (onpageData ? buildAiPrompt({ onpage: onpageData, tech: technicalData, findings: currentFindings }) : ''),
  linksTsv: () => tsv(['URL', 'Link text', 'Region', 'Type', 'rel', 'Status'], (onpageData?.links?.details || []).map((l) => [
    l.href, l.text, CONTEXT_NAME[l.context] || l.context, l.internal ? 'internal' : l.external ? 'external' : 'other',
    [l.nofollow && 'nofollow', l.ugc && 'ugc', l.sponsored && 'sponsored'].filter(Boolean).join(' '),
    l.checkedStatus ? `${l.checkedStatus.kind}${l.checkedStatus.status ? ' ' + l.checkedStatus.status : ''}` : ''
  ])),
  imagesTsv: () => tsv(['URL', 'Alt', 'Width', 'Height', 'KB', 'Issues'], getBodyImages().map((i) => [
    i.src, (i.altMissing ?? !i.alt) ? '(no alt attribute)' : i.alt, i.naturalWidth || '', i.naturalHeight || '',
    i.bytes ? (i.bytes / 1024).toFixed(1) : '', imageIssues(i).map(([t]) => t).join('; ')
  ])),
  schemaAll: () => JSON.stringify((onpageData?.schema || []).map((s) => s.raw), null, 2)
};

// ---------------------------------------------------------------------------
// Technical rendering
// ---------------------------------------------------------------------------

function renderTechnical(d, age) {
  const statusTag = !d.status ? tag('not reachable', 'bad') : tag(String(d.status), d.status < 300 ? 'good' : d.status < 400 ? 'warn' : 'bad');
  const xrt = d.headers['x-robots-tag'];
  const sitemapPath = d.sitemap?.url ? (() => { try { return new URL(d.sitemap.url).pathname; } catch { return '/sitemap.xml'; } })() : '/sitemap.xml';
  const robots = d.robotsTxt || {};
  return `
    ${cachedBanner(age, 'onpage')}
    <div class="card">
      <h2>Server answer</h2>
      ${d.fetchError ? `<p class="muted">${escapeHtml(d.fetchError)}</p>` : ''}
      ${row('HTTP status', statusTag)}
      ${row('Final URL', `<span class="mono">${escapeHtml(d.finalUrl)}</span>`)}
      ${row('Redirects', d.redirected ? tag('this URL redirects', 'warn') : 'none')}
      ${row('X-Robots-Tag', xrt ? tag(xrt, /noindex|none/i.test(xrt) ? 'bad' : 'neutral') : '<span class="muted">not set</span>')}
      ${row('HTTPS', /^https:/.test(d.finalUrl) ? tag('yes', 'good') : tag('no', 'bad'))}
      ${row('HSTS', d.headers['strict-transport-security'] ? tag('on', 'good') : '<span class="muted">not set</span>')}
      <div class="actions"><button type="button" class="secondary-btn" id="variants-check">Check http, https and www versions</button></div>
      <div id="variants-result" aria-live="polite"></div>
      ${onpageData ? row('Mixed content', onpageData.mixedContent?.length
        ? `${tag(`${onpageData.mixedContent.length} http: file${onpageData.mixedContent.length === 1 ? '' : 's'}`, 'bad')}<ul class="plain-list mono">${onpageData.mixedContent.slice(0, 5).map((m) => `<li>${escapeHtml(m.url)}</li>`).join('')}</ul>`
        : /^https:/.test(d.finalUrl) ? tag('none', 'good') : '<span class="muted">not an https page</span>') : ''}
    </div>

    ${onpageData ? (() => {
      const dirs = snippetDirectives(onpageData.robots, xrt);
      const limited = dirs.some((x) => x === 'nosnippet' || /^max-snippet:(0|[1-9]\d?)$/.test(x)) || onpageData.dataNosnippetCount > 0;
      return `<div class="card">
      <h2>Snippet and AI controls</h2>
      <p class="muted">These limit what Google may quote in results and in AI Overviews.</p>
      ${row('Directives', dirs.length ? dirs.map((x) => tag(x, /nosnippet|max-snippet/.test(x) ? 'warn' : 'neutral')).join(' ') : '<span class="muted">none (Google may quote freely)</span>')}
      ${row('data-nosnippet', onpageData.dataNosnippetCount ? `${fmtNum(onpageData.dataNosnippetCount)} element${onpageData.dataNosnippetCount === 1 ? '' : 's'} kept out of snippets` : '<span class="muted">none</span>')}
      ${limited ? '<div class="hint">Some text may not be quoted in search snippets or AI answers. Check that this is intended.</div>' : ''}
    </div>`;
    })() : ''}

    <div class="card">
      <h2>robots.txt</h2>
      ${row('File', robots.ok ? tag('found', 'good') : robots.status >= 400 && robots.status < 500 ? '<span class="muted">none (everything allowed)</span>' : tag(robots.status ? `HTTP ${robots.status}` : 'not reachable', 'warn'))}
      ${robots.pathAllowed ? row('This URL for Googlebot', robots.pathAllowed.allowed ? tag('allowed', 'good') : `${tag('blocked', 'bad')} <span class="mono">${escapeHtml(robots.pathAllowed.rule || '')}</span>`) : ''}
      ${row('Sitemaps listed', robots.sitemaps?.length ? fmtNum(robots.sitemaps.length) : '<span class="muted">none</span>')}
      ${robots.sitemaps?.length ? `<ul class="plain-list mono">${robots.sitemaps.slice(0, 10).map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : ''}
      ${robots.ok ? `<details class="sub"><summary>Show robots.txt</summary><pre class="code">${escapeHtml((robots.text || '').slice(0, 20000))}</pre></details>` : ''}
    </div>

    <div class="card">
      <h2>XML sitemap</h2>
      ${row(sitemapPath, d.sitemap?.ok ? tag('valid', 'good') : tag(d.sitemap?.reason || 'not found', 'warn'))}
      ${d.sitemap?.urlCount != null ? row(d.sitemap.isIndex ? 'Sitemaps in this index' : 'URLs listed', `${fmtNum(d.sitemap.urlCount)}${d.sitemap.truncated ? ' <span class="muted">(first 5 MB)</span>' : ''}`) : ''}
      ${d.sitemap?.ok || robots.sitemaps?.length ? `<div class="actions"><button type="button" class="secondary-btn" id="sitemap-check">Is this page in the sitemap?</button></div><div id="sitemap-result" aria-live="polite"></div>` : ''}
    </div>

    <div class="card">
      <h2>Response headers</h2>
      ${Object.keys(d.headers).length ? Object.entries(d.headers).map(([k, v]) => row(`<span class="mono">${escapeHtml(k)}</span>`, `<span class="mono">${escapeHtml(v)}</span>`)).join('') : '<p class="muted">None of the usual SEO headers were sent.</p>'}
    </div>

    <div id="rendering-slot"></div>
  `;
}

async function runSitemapCheck() {
  const box = $('sitemap-result');
  if (!box || !technicalData) return;
  const origin = (() => { try { return new URL(pageUrl).origin; } catch { return ''; } })();
  const starts = technicalData.robotsTxt?.sitemaps?.length ? technicalData.robotsTxt.sitemaps : [technicalData.sitemap?.url || `${origin}/sitemap.xml`];
  rerender(box, loading('Reading the sitemaps…'));
  const gen = auditGen;
  try {
    const r = await findInSitemaps(pageUrl, starts, pageFetcher(currentTab.id));
    if (gen !== auditGen) return;
    rerender(box, r.unreadable
      ? `<p>${tag('could not read the sitemap', 'neutral')}</p><div class="hint">The sitemap did not answer, or it is on another site, which this check can't read. Open it in a tab to check it.</div>`
      : r.found
      ? `<p>${tag('listed', 'good')} in <span class="mono">${escapeHtml(r.sitemap)}</span></p>`
      : `<p>${tag('not listed', 'warn')} <span class="muted">${r.complete ? `checked ${r.filesRead} sitemap file${r.filesRead === 1 ? '' : 's'}` : r.unread ? `${r.unread} of ${r.filesRead} sitemap files could not be read` : `checked the first ${r.filesRead} files only`}</span></p>
         <div class="hint">Pages you want in Google belong in the XML sitemap. Sitemaps on another site can't be read from here.</div>`);
  } catch (e) {
    rerender(box, errorBox('The sitemap check failed', e.message));
  }
}

async function runVariantsCheck() {
  const box = $('variants-result');
  if (!box) return;
  if (!(await hasOrigins(ALL_SITES))) {
    rerender(box, permissionNotice('http and https count as different sites, so Needle needs access to request both.').replace('data-grant="all-sites"', 'data-grant="all-sites" data-retry="variants-check"'));
    return;
  }
  rerender(box, loading('Requesting the four versions of the home page…'));
  const gen = auditGen;
  const r = await checkHostVariants(pageUrl);
  if (gen !== auditGen) return;
  rerender(box, `<p>${r.consistent ? tag(`All versions end on ${r.target}`, 'good') : r.target ? tag(`${plural(r.variants.filter((v) => v.error || !v.status).length, 'version')} could not be checked; the others end on ${r.target}`, 'warn') : tag('Versions end on different URLs', 'bad')}</p>
    <table class="data-table"><thead><tr><th scope="col">You type</th><th scope="col">You end on</th></tr></thead><tbody>
    ${r.variants.map((v) => `<tr><td class="mono">${escapeHtml(v.url)}</td><td class="mono">${v.error ? tag(v.error, 'bad') : `${escapeHtml(v.finalUrl)} <span class="muted">${v.status}</span>`}</td></tr>`).join('')}
    </tbody></table>
    ${r.consistent ? '' : '<div class="hint">Redirect every version (http and https, with and without www) to one address with a permanent (301) redirect.</div>'}`);
}

$('panel-technical').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b?.id === 'sitemap-check') runSitemapCheck();
  else if (b?.id === 'variants-check') runVariantsCheck();
});

function renderComparison(raw, rendered) {
  const diff = rendered.htmlLen - raw.htmlLen;
  const pct = raw.htmlLen ? Math.round((diff / raw.htmlLen) * 100) : 0;
  const level = Math.abs(pct) > 50 ? ['mostly built by JavaScript', 'warn'] : Math.abs(pct) > 20 ? ['partly built by JavaScript', 'neutral'] : ['mostly in the HTML', 'good'];
  const wordsLost = raw.wordCount < rendered.wordCount * 0.7;
  return `<details class="card collapsible">
    <summary><h2 class="card-title">JavaScript rendering</h2> ${tag(level[0], level[1])}</summary>
    <div class="card-body">
      <p class="muted">The HTML the server sends, next to the page after JavaScript ran. Search engines and AI crawlers that don't run JavaScript only see the first.</p>
      <table class="data-table"><thead><tr><th scope="col"></th><th scope="col">Server HTML</th><th scope="col">After JavaScript</th></tr></thead><tbody>
        <tr><th scope="row">Words</th><td>${fmtNum(raw.wordCount)}</td><td>${fmtNum(rendered.wordCount)}</td></tr>
        <tr><th scope="row">Headings</th><td>${fmtNum(raw.headings)}</td><td>${fmtNum(rendered.headings)}</td></tr>
        <tr><th scope="row">Links</th><td>${fmtNum(raw.links)}</td><td>${fmtNum(rendered.links)}</td></tr>
        <tr><th scope="row">JSON-LD blocks</th><td>${fmtNum(raw.schema)}</td><td>${fmtNum(rendered.schema)}</td></tr>
        <tr><th scope="row">HTML size</th><td>${fmtNum(raw.htmlLen)}</td><td>${fmtNum(rendered.htmlLen)} <span class="muted">(${pct >= 0 ? '+' : ''}${pct}%)</span></td></tr>
      </tbody></table>
      ${wordsLost ? `<div class="notice"><strong>Much of the text needs JavaScript</strong><div>Crawlers that don't run JavaScript, including most AI crawlers, miss it.</div></div>` : ''}
      <details class="sub"><summary>First 5 KB of the server HTML</summary><pre class="code">${escapeHtml(raw.htmlSnippet)}</pre></details>
    </div>
  </details>`;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function saveToHistory(url, title, verdict = 'neutral', healthScore = null) {
  await withStoreLock('history', async () => {
    const { history = [] } = await chrome.storage.local.get('history');
    const previous = history.find((h) => h.url === url);
    // Keep the last *different* score, so reopening the popup doesn't reset the change.
    const previousScore = previous
      ? (previous.healthScore !== healthScore ? previous.healthScore : previous.previousScore ?? null)
      : null;
    const rest = history.filter((h) => h.url !== url);
    rest.unshift({ url, title, verdict, healthScore, previousScore, ts: Date.now() });
    await chrome.storage.local.set({ history: rest.slice(0, 50) });
  });
}

function closeHistory() {
  $('history-panel').hidden = true;
  document.body.classList.remove('history-open');
  $('open-history').setAttribute('aria-expanded', 'false');
  $('open-history').focus();
}

async function toggleHistory() {
  const panel = $('history-panel');
  const btn = $('open-history');
  if (!panel.hidden) {
    closeHistory();
    return;
  }
  const { history = [] } = await chrome.storage.local.get('history');
  $('history-list').innerHTML = history.length
    ? `<ul class="item-list">${history.map((h) => {
        const delta = h.healthScore != null && h.previousScore != null ? h.healthScore - h.previousScore : 0;
        const verdictWord = { good: 'indexable', warn: 'check', bad: 'not indexable' }[h.verdict] || '';
        return `<li class="item history-item">
          <div class="item-body">
            <div class="item-title">${escapeHtml(h.title || 'Untitled page')}</div>
            <div class="item-url">${escapeHtml(h.url)}</div>
            <div class="item-meta muted">${escapeHtml(timeAgo(h.ts))}${h.healthScore != null ? ` · score ${h.healthScore}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}` : ''}${verdictWord ? ` · ${verdictWord}` : ''}</div>
          </div>
          <div class="history-actions">
            <button type="button" class="link-btn history-here" data-url="${escapeHtml(h.url)}">Audit again here</button>
            <button type="button" class="link-btn history-open" data-url="${escapeHtml(h.url)}">New tab</button>
          </div>
        </li>`;
      }).join('')}</ul>`
    : '<p class="muted">Pages you audit show up here.</p>';
  $('history-list').querySelectorAll('.history-open').forEach((b) => b.addEventListener('click', () => {
    if (isSafeHttpUrl(b.dataset.url)) chrome.tabs.create({ url: b.dataset.url });
  }));
  // Load the page in the current tab; reopen Needle there to audit it.
  $('history-list').querySelectorAll('.history-here').forEach((b) => b.addEventListener('click', async () => {
    if (!isSafeHttpUrl(b.dataset.url) || !currentTab) return;
    await chrome.tabs.update(currentTab.id, { url: b.dataset.url });
    if (!IS_PANEL) window.close();
  }));
  panel.hidden = false;
  document.body.classList.add('history-open');
  btn.setAttribute('aria-expanded', 'true');
  $('close-history').focus();
}

$('open-history').addEventListener('click', toggleHistory);
$('close-history').addEventListener('click', closeHistory);
confirmClick($('clear-history'), async () => {
  await withStoreLock('history', () => withStoreLock('snapshots', () => chrome.storage.local.set({ history: [], snapshots: {} })));
  $('history-list').innerHTML = '<p class="muted">History cleared.</p>';
  announce('History cleared');
});

// ---------------------------------------------------------------------------
// Header actions, refresh, locate, export
// ---------------------------------------------------------------------------

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

/** Label the theme switch with where a click takes you. */
function labelThemeToggle() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  $('toggle-theme').setAttribute('aria-label', label);
  $('toggle-theme').title = label;
}
$('toggle-theme').addEventListener('click', async () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  await setTheme(dark ? 'light' : 'dark');
  labelThemeToggle();
  announce(dark ? 'Light theme' : 'Dark theme');
});
document.addEventListener('click', (e) => {
  const opt = e.target.closest("[data-action='open-options']");
  if (!opt) return;
  // Straight to the right section (Google key, DataForSEO, Bing) instead of the top of Settings.
  if (opt.dataset.section) chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#${opt.dataset.section}`) });
  else chrome.runtime.openOptionsPage();
});

document.addEventListener('click', (e) => {
  const r = e.target.closest('[data-refresh]');
  if (!r) return;
  // The button disappears with the panel's content; keep keyboard focus in the panel (it is not replaced).
  if (r.matches(':focus')) r.closest('[role="tabpanel"]')?.focus();
  const kind = r.dataset.refresh;
  if (kind === 'onpage') loadOnpageAndTechnical(true);
  else if (kind === 'serp') loadSerp(true);
  else if (kind === 'compare') loadCompare(true);
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-highlight]');
  if (!el || !currentTab) return;
  try {
    const res = await safeSendTabMessage(currentTab.id, { type: 'HIGHLIGHT', target: JSON.parse(el.dataset.highlight) });
    if (res?.ok && res.hidden) showToast('Found, but hidden on the page (in a menu, slider or closed tab).');
    else if (res?.ok) { if (!IS_PANEL) window.close(); }
    else showToast('Not found on the page any more. Click Refresh to update.');
  } catch (err) {
    showToast(err.message);
  }
});

/** The two house fonts as data URLs, so the downloaded report looks like Needle offline too (about 100 KB). */
async function reportFontCss() {
  const face = async (family, file, extra) => {
    try {
      const buf = new Uint8Array(await (await fetch(chrome.runtime.getURL(`fonts/${file}`))).arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return `@font-face { font-family: "${family}"; src: url(data:font/woff2;base64,${btoa(bin)}) format("woff2"); ${extra} font-display: swap; }`;
    } catch { return ''; }
  };
  return (await Promise.all([
    face('Atkinson Hyperlegible Next', 'atkinson-hyperlegible-next-latin.woff2', 'font-weight: 200 800;'),
    face('Martian Mono', 'martian-mono-latin.woff2', 'font-weight: 100 800; font-stretch: 75% 112.5%;')
  ])).join('\n');
}

$('export-audit-header').addEventListener('click', async () => {
  if (!onpageData) return;
  const { theme = 'auto' } = await chrome.storage.sync.get('theme');
  const html = buildHtmlReport({
    url: pageUrl,
    onpage: onpageData,
    technical: technicalData,
    offpage: offpageData,
    geo: geoData,
    health: computeHealthScore(onpageData, technicalData, snippetPx()),
    verdict: computeIndexability(onpageData, technicalData),
    theme,
    version: chrome.runtime.getManifest().version,
    findings: currentFindings,
    ...snippetPx(),
    storeLink: await storeUrl(),
    fontCss: await reportFontCss()
  });
  download(`seo-audit-${hostOf(pageUrl) || 'page'}-${new Date().toISOString().slice(0, 10)}.html`, html, 'text/html');
  showToast('Report downloaded');
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts: 1–6 switch tabs, / jumps to the search field, Esc clears
// page highlights. Single keys can be turned off in Settings (WCAG 2.1.4).
// ---------------------------------------------------------------------------

const TAB_KEYS = { 1: 'onpage', 2: 'technical', 3: 'ai', 4: 'offpage', 5: 'compare', 6: 'serp' };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('history-panel').hidden) { closeHistory(); return; }
  if (e.target.matches?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' && currentTab && /^https?:/.test(pageUrl)) {
    safeSendTabMessage(currentTab.id, { type: 'UNHIGHLIGHT_LINKS' }).catch(() => {});
    safeSendTabMessage(currentTab.id, { type: 'UNHIGHLIGHT_HEADINGS' }).catch(() => {});
    safeSendTabMessage(currentTab.id, { type: 'UNHIGHLIGHT_ISSUES' }).catch(() => {});
    ['toggle-links', 'toggle-headings'].forEach((id) => {
      const b = $(id);
      if (b) { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Show on page'; }
    });
    const ti = $('toggle-issues');
    if (ti) { ti.setAttribute('aria-pressed', 'false'); ti.textContent = 'Show all on page'; }
    return;
  }
  if (!shortcutsOn) return;
  if (TAB_KEYS[e.key]) {
    if (!$('history-panel').hidden) closeHistory();
    selectTab(TAB_KEYS[e.key], { focus: true });
    return;
  }
  if (e.key === '/') {
    const active = tabs.find((t) => t.classList.contains('active'))?.dataset.tab;
    const target = active === 'serp' ? 'serp-keyword' : active === 'compare' ? 'compare-keyword' : null;
    if (target) { e.preventDefault(); $(target).focus(); }
  }
});

init();
