// Needle content script. Injected on demand (chrome.scripting, after the user
// opens the popup on this tab), never on every page. Injecting it twice into
// the same page is harmless: the guard below makes the second run a no-op.
(() => {
  if (globalThis.__needleContentLoaded) return;
  globalThis.__needleContentLoaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      switch (msg?.type) {
        case "ANALYZE_ONPAGE": sendResponse(analyzeOnpage()); break;
        case "GET_RENDERED": sendResponse(getRenderedSnapshot()); break;
        case "HIGHLIGHT": sendResponse(highlightElement(msg.target)); break;
        case "HIGHLIGHT_LINKS": sendResponse(highlightLinks(msg.filter || {})); break;
        case "UNHIGHLIGHT_LINKS": sendResponse(unhighlightLinks()); break;
        case "HIGHLIGHT_HEADINGS": sendResponse(highlightHeadings()); break;
        case "UNHIGHLIGHT_HEADINGS": sendResponse(unhighlightHeadings()); break;
        case "GET_MAIN_TEXT": sendResponse(getMainText()); break;
        case "HIGHLIGHT_ISSUES": sendResponse(highlightIssues(msg.items || [])); break;
        case "UNHIGHLIGHT_ISSUES": sendResponse(unhighlightIssues()); break;
        default: return false;
      }
    } catch (e) {
      // A reply (instead of a thrown error) tells the popup the script is alive,
      // so it shows the real problem instead of re-injecting.
      sendResponse({ __error: String(e?.message || e) });
    }
    return false;
  });

  // Page-content detection for schema suggestions (data, not UI text).
  const ADDRESS_RE = new RegExp([
    String.raw`,\s*(?:[A-Z]{1,2}-)?\d{4,5}\s+\p{Lu}[\p{L}-]+`,
    String.raw`\d+[a-zA-Z]?[ \t]*\n\s*(?:[A-Z]{1,2}-)?\d{4,5}\s+\p{Lu}[\p{L}-]+`,
    String.raw`\b[A-Z]{1,2}-\d{4,5}\s+\p{Lu}[\p{L}-]+`,
    String.raw`,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b`
  ].join("|"), "u");
  const DAY_OR_OPEN = "open|opening|openingsuren|openingstijden|geopend|gesloten|closed|geöffnet|ouvert|fermé|horaires|" +
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|" +
    "maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|ma|di|wo|do|vr|za|zo|" +
    "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag";
  const TIME = String.raw`\d{1,2}(?:[:.hu]\d{2}|[hu]|\s*(?:am|pm))`;
  const OPENING_HOURS_RE = new RegExp(String.raw`\b(?:${DAY_OR_OPEN})\b[^\n]{0,40}?${TIME}\s*(?:-|–|—|to|tot|à|bis|until)\s*${TIME}`, "i");

  const pageLinks = [];
  const pageImages = [];
  const highlighted = new WeakMap(); // element -> its own outline, while a HIGHLIGHT is showing
  let lastLinkFilter = null; // last HIGHLIGHT_LINKS filter, so GET_RENDERED can put the overlay back

  // Overlay colours. Kept in sync with the link legend in popup.css.
  const CONTEXT_COLORS = {
    header: { bg: "#3B6FD4", fg: "#FFFFFF", letter: "H" },
    nav: { bg: "#7A4FC9", fg: "#FFFFFF", letter: "N" },
    breadcrumb: { bg: "#C2387F", fg: "#FFFFFF", letter: "B" },
    main: { bg: "#FF6A55", fg: "#141312", letter: "M" },
    sidebar: { bg: "#E0A31B", fg: "#141312", letter: "S" },
    footer: { bg: "#2F7D5B", fg: "#FFFFFF", letter: "F" },
    other: { bg: "#5F5A55", fg: "#FFFFFF", letter: "O" }
  };

  /**
   * The text a reader sees. textContent alone returns <noscript> fallback markup,
   * SVG <title> and our own labels, glues words at <br> and keeps newlines. The
   * copy goes into an inert document because cloneNode makes Chrome fetch lazy images.
   * shortcut: sibling blocks (<div>A</div><div>B</div>) still run together.
   */
  function cleanText(el) {
    if (!el) return "";
    const c = document.implementation.createHTMLDocument("").importNode(el, true);
    c.querySelectorAll("script, style, noscript, template, title, [data-needle-inserted]").forEach(n => n.remove());
    c.querySelectorAll("br").forEach(br => br.replaceWith(" "));
    return (c.textContent || "").replace(/[ \t\n\f\r]+/g, " ").trim(); // ASCII whitespace only: no-break spaces stay
  }

  /** Hidden from readers: hidden attribute, display:none, visibility:hidden, or inside one. */
  function isHidden(el) {
    if (el.closest("[hidden], [aria-hidden='true']")) return true;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
    }
    return false;
  }

  /**
   * Visible text plus the text inside closed <details>: innerText skips it, but
   * search engines index it (FAQ answers are often in closed <details>).
   */
  function readableText(el) {
    if (!el) return "";
    let text = el.innerText || "";
    el.querySelectorAll("details:not([open])").forEach((det) => {
      const body = [...det.childNodes].filter((n) => !(n.nodeType === 1 && n.tagName === "SUMMARY")).map((n) => n.textContent || "").join(" ");
      if (body.trim()) text += " " + body;
    });
    return text;
  }

  function resolveUrl(raw) {
    try { return new URL(raw, document.baseURI).href; } catch { return raw || ""; }
  }

  // ---------------------------------------------------------------------------
  // Heading overlay
  // ---------------------------------------------------------------------------

  function ensureHeadingStylesheet() {
    if (document.getElementById("needle-heading-style")) return;
    const style = document.createElement("style");
    style.id = "needle-heading-style";
    style.textContent = `
      /* A white, coral and ink ring stands out on light, dark and coloured pages alike. */
      .needle-h-outline {
        outline: 3px solid #FF6A55 !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 3px #FFFFFF, 0 0 0 9px #141312 !important;
      }
      .needle-h-label, .needle-skip-warn {
        display: inline-block !important;
        font: 700 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
        letter-spacing: 0 !important;
        text-transform: none !important;
        text-shadow: none !important;
        text-decoration: none !important;
        padding: 2px 7px !important;
        vertical-align: middle !important;
        border-radius: 2px !important;
        box-shadow: 0 0 0 2px #FFFFFF !important;
        -webkit-text-fill-color: currentColor !important;
      }
      .needle-h-label { background: #141312 !important; color: #FFFFFF !important; border-left: 4px solid #FF6A55 !important; margin-right: 10px !important; }
      .needle-skip-warn { background: #FF6A55 !important; color: #141312 !important; margin-left: 10px !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function highlightHeadings() {
    unhighlightHeadings();
    ensureHeadingStylesheet();
    const all = document.querySelectorAll("h1,h2,h3,h4,h5,h6");
    let prevLevel = 0;
    all.forEach(h => {
      const level = parseInt(h.tagName.slice(1), 10);
      const skipped = prevLevel > 0 && level > prevLevel + 1;
      const from = prevLevel;
      prevLevel = level;

      h.classList.add("needle-h-outline");
      const label = document.createElement("span");
      label.className = "needle-h-label";
      label.textContent = `H${level}`;
      label.dataset.needleInserted = "label";
      h.insertBefore(label, h.firstChild);

      if (skipped) {
        const warn = document.createElement("span");
        warn.className = "needle-skip-warn";
        warn.textContent = `skips from H${from}`;
        warn.dataset.needleInserted = "warn";
        h.appendChild(warn);
      }
    });
    return { ok: true, count: all.length };
  }

  function unhighlightHeadings() {
    document.querySelectorAll('[data-needle-inserted="label"], [data-needle-inserted="warn"]').forEach(el => el.remove());
    document.querySelectorAll(".needle-h-outline").forEach(h => {
      h.classList.remove("needle-h-outline");
      if (!h.classList.length) h.removeAttribute("class");
    });
    document.getElementById("needle-heading-style")?.remove();
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Where on the page an element sits (header, nav, main, ...)
  // ---------------------------------------------------------------------------

  const NAV_TOKENS = new Set([
    "menu", "navbar", "navigation", "navmenu", "topnav", "topbar",
    "menubar", "menulist", "menumain", "menuprimary", "menusecondary"
  ]);
  const HEADER_TOKENS = new Set(["masthead", "topheader", "pageheader", "siteheader", "appbar"]);
  const FOOTER_TOKENS = new Set(["colophon", "pagefooter", "sitefooter"]);
  const SIDEBAR_WHOLE = new Set(["secondary", "widget-area"]);
  const SIDEBAR_PART = /(sidebar|sidenav|side-nav|side-bar)/;
  const SIDEBAR_NOT = /(toggle|btn|button|trigger)/;

  const NAV_COMPOUND = /(menu-wrapper|main-nav|primary-nav|secondary-nav|site-nav|main-menu|primary-menu|secondary-menu|site-menu|nav-bar|nav-menu|navigation-wrapper|navbar-nav|nav-primary|nav-main|nav-secondary|nav-collapse|navbar-collapse|elementor-nav-menu|primary-menu-container|secondary-menu-container|page-navigation|main-navigation|primary-navigation|secondary-navigation|nav-list|nav-links|menucontainer|v-app-bar|v-navigation-drawer)/;
  const HEADER_FIXED = /(site-header|main-header|page-header|global-header|app-header|header-wrapper|header-container|header-content|wp-header|toolbar-wrapper|sticky-header|fixed-header|topbar-wrapper)/;
  const FOOTER_FIXED = /(site-footer|main-footer|page-footer|global-footer|app-footer|footer-wrapper|footer-container|footer-content|wp-footer|sticky-footer|fixed-footer|copyright-bar)/;
  // Generic suffixes (`acme-header`, `shop-footer`) catch site-specific theme prefixes.
  const HEADER_SUFFIX = /[a-z]+-header\b/;
  const FOOTER_SUFFIX = /[a-z]+-footer\b/;

  /**
   * Classify by class and id tokens.
   * @param {string} clsRaw
   * @param {string} idRaw
   * @param {boolean} insideMain - inside the main content, generic -header/-footer
   *   suffixes are ignored (a card header is not the page header).
   */
  function classifyByHints(clsRaw, idRaw, insideMain = false) {
    const combined = `${clsRaw || ""} ${idRaw || ""}`.toLowerCase();
    if (!combined.trim()) return null;
    if (HEADER_FIXED.test(combined) || (!insideMain && HEADER_SUFFIX.test(combined))) return "header";
    if (FOOTER_FIXED.test(combined) || (!insideMain && FOOTER_SUFFIX.test(combined))) return "footer";
    if (NAV_COMPOUND.test(combined)) return "nav";
    const words = combined.split(/\s+/).filter(Boolean);
    const tokens = new Set(words.flatMap(w => w.split(/[_-]+/)).filter(Boolean));
    for (const t of HEADER_TOKENS) if (tokens.has(t)) return "header";
    for (const t of FOOTER_TOKENS) if (tokens.has(t)) return "footer";
    for (const t of NAV_TOKENS) if (tokens.has(t)) return "nav";
    if (words.some(w => SIDEBAR_WHOLE.has(w) || (SIDEBAR_PART.test(w) && !SIDEBAR_NOT.test(w)))) return "sidebar";
    return null;
  }

  // Attributes, not n.id/n.className: a form control named "id" or "className" shadows those properties.
  const attrOf = (n, name) => (n.getAttribute ? n.getAttribute(name) || "" : "");

  let docHeightCache = 0;
  function classifyByPosition(el) {
    if (!docHeightCache) {
      docHeightCache = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    }
    if (docHeightCache <= 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    const absoluteTop = rect.top + window.scrollY;
    const absoluteBottom = rect.bottom + window.scrollY;
    if (absoluteTop < Math.min(250, docHeightCache * 0.12)) return "header";
    if (absoluteBottom > docHeightCache * 0.85) return "footer";
    return null;
  }

  // Breadcrumb hints in several languages (class/id tokens, aria-label, schema).
  const BREADCRUMB_HINT = /\b(breadcrumb|breadcrumbs|crumbs|kruimel|kruimelpad|fil-?d-?ariane|brotkrumen)\b/;
  const BREADCRUMB_ARIA = /breadcrumb|kruimel|brood|fil[\s-]?d.ariane|brotkrumen/i;

  function isBreadcrumbNode(n) {
    if (!n || !n.getAttribute) return false;
    const cls = attrOf(n, "class").toLowerCase();
    const id = attrOf(n, "id").toLowerCase();
    if (BREADCRUMB_HINT.test(cls) || BREADCRUMB_HINT.test(id)) return true;
    const aria = attrOf(n, "aria-label");
    if (aria && BREADCRUMB_ARIA.test(aria)) return true;
    if (attrOf(n, "itemtype").toLowerCase().includes("breadcrumblist")) return true;
    if (attrOf(n, "itemprop").toLowerCase() === "breadcrumb") return true;
    return false;
  }

  function categorizeElement(el) {
    let n = el;
    while (n && n !== document.body && n !== document.documentElement) {
      const tag = n.tagName?.toLowerCase();
      const role = attrOf(n, "role");
      if (isBreadcrumbNode(n)) return "breadcrumb";
      if (tag === "nav" || role === "navigation") return "nav";
      if (tag === "header" || role === "banner") return "header";
      if (tag === "footer" || role === "contentinfo") return "footer";
      if (tag === "aside" || role === "complementary") return "sidebar";
      const hint = classifyByHints(attrOf(n, "class"), attrOf(n, "id"));
      if (hint) return hint;
      if (tag === "main" || tag === "article" || role === "main") return "main";
      n = n.parentElement;
    }
    return classifyByPosition(el) || "other";
  }

  /**
   * The page's likely main-content container: <main>, the longest <article>,
   * or a common id/class, whichever holds the most text.
   * @returns {Element|null}
   */
  function detectMainBoundary() {
    const cands = [];
    const mainEl = document.querySelector("main");
    if (mainEl) cands.push({ el: mainEl, text: mainEl.innerText || "" });
    const articles = Array.from(document.querySelectorAll("article")).map(a => ({ el: a, text: a.innerText || "" }));
    if (articles.length) {
      articles.sort((a, b) => b.text.length - a.text.length);
      cands.push(articles[0]);
    }
    ["[role='main']", "#main", "#content", "#main-content", "#primary",
      ".main-content", ".post-content", ".entry-content", ".article-body", ".page-content"
    ].forEach(sel => {
      const e = document.querySelector(sel);
      if (e) cands.push({ el: e, text: e.innerText || "" });
    });
    cands.sort((a, b) => b.text.length - a.text.length);
    return cands[0]?.el || null;
  }

  /**
   * Inside the main boundary everything is "main" unless it sits in a nested
   * nav, sidebar or breadcrumb. <header>/<footer> inside main are section
   * headers, not the page's (HTML-AAM scopes them to their section).
   */
  function categorizeWithMain(el, mainBoundaryEl) {
    if (mainBoundaryEl && mainBoundaryEl.contains(el)) {
      let n = el;
      while (n && n !== mainBoundaryEl) {
        const tag = n.tagName?.toLowerCase();
        const role = attrOf(n, "role");
        if (isBreadcrumbNode(n)) return "breadcrumb";
        if (tag === "nav" || role === "navigation") return "nav";
        if (role === "banner") return "header";
        if (role === "contentinfo") return "footer";
        if (tag === "aside" || role === "complementary") return "sidebar";
        const hint = classifyByHints(attrOf(n, "class"), attrOf(n, "id"), true);
        if (hint) return hint;
        n = n.parentElement;
      }
      return "main";
    }
    return categorizeElement(el);
  }

  // ---------------------------------------------------------------------------
  // Links
  // ---------------------------------------------------------------------------

  /** Every <a href> except same-page anchors (#top, #section). Empty hrefs are kept. */
  function collectLinks() {
    return Array.from(document.querySelectorAll("a[href]")).filter(a => !(a.getAttribute("href") || "").trim().startsWith("#"));
  }

  function linkKind(a) {
    const raw = a.getAttribute("href") || "";
    let u = null;
    try { u = new URL(raw, document.baseURI); } catch {}
    const isHttp = !!u && /^https?:$/.test(u.protocol);
    const internal = isHttp && u.hostname === location.hostname;
    return { u, isHttp, internal, external: isHttp && !internal, raw };
  }

  // Attributes where lazy-loading plugins keep the real image URL (the src shows a placeholder).
  const LAZY_SRC_ATTRS = ["data-lazy-src", "data-src", "data-original", "data-defer-src", "data-echo", "data-lazy-original"];

  // Split a srcset as the HTML spec does: a URL is a run of non-space characters (it may hold
  // commas, as in w_800,c_fill), trailing commas end it, and its descriptor runs to the next comma.
  // So "a.jpg 800w,b.jpg 1600w" (no space after the comma) is two candidates. Returns [{u, d}].
  function parseSrcset(set) {
    const out = [];
    let i = 0;
    while (i < set.length) {
      while (i < set.length && /[\s,]/.test(set[i])) i++;
      if (i >= set.length) break;
      let j = i;
      while (j < set.length && !/\s/.test(set[j])) j++;
      let url = set.slice(i, j);
      let desc = "";
      if (/,$/.test(url)) url = url.replace(/,+$/, "");
      else {
        const k = set.indexOf(",", j);
        desc = set.slice(j, k < 0 ? set.length : k).trim();
        j = k < 0 ? set.length : k + 1;
      }
      out.push({ u: url, d: desc.split(/\s+/)[0] || "" });
      i = j;
    }
    return out;
  }

  /** The URLs an <img> names besides src: lazy-load attributes and all srcset candidates. */
  function declaredImageUrls(img) {
    const urls = new Set();
    const fromSrcset = (v) => parseSrcset(v || "").forEach(({ u }) => { if (u) urls.add(resolveUrl(u)); });
    for (const attr of LAZY_SRC_ATTRS) {
      const v = img.getAttribute(attr);
      if (v && !v.startsWith("data:")) urls.add(resolveUrl(v));
    }
    fromSrcset(img.getAttribute("srcset"));
    fromSrcset(img.getAttribute("data-srcset"));
    img.closest("picture")?.querySelectorAll("source").forEach((src) => { fromSrcset(src.getAttribute("srcset")); fromSrcset(src.getAttribute("data-srcset")); });
    return urls;
  }

  /** Every URL an <img> may show: src, the chosen srcset variant, all srcset candidates and lazy-load attributes. */
  function imageUrls(img) {
    const urls = declaredImageUrls(img);
    [img.currentSrc, img.src].filter(Boolean).forEach((u) => urls.add(u));
    return urls;
  }

  // Vector images: a .svg path, a query value "svg" (?format=svg), or a data:image/svg+xml URL.
  // Same rule as isSvgSource in lib/image-rules.js (this injected script can't import it).
  function isSvgSource(src) {
    const s = String(src || "");
    if (/^data:image\/svg\+xml[;,]/i.test(s)) return true;
    try {
      const u = new URL(s);
      if (/\.svgz?$/i.test(u.pathname)) return true;
      return [...u.searchParams.values()].some((v) => /^(svg|image\/svg\+xml)$/i.test(v));
    } catch {
      return /\.svgz?(?:[?#]|$)/i.test(s);
    }
  }

  // Elements that paint a CSS background image, by image URL. Built at most once
  // per highlight request: getComputedStyle on 1,500 elements for every missing
  // image would freeze the page.
  let bgIndex = null;
  function backgroundImageOwner(src) {
    if (!bgIndex) {
      bgIndex = new Map();
      const cands = document.querySelectorAll("div, section, header, footer, aside, article, main, span, a, button, li, figure");
      for (let i = 0; i < Math.min(cands.length, 1500); i++) {
        const bg = getComputedStyle(cands[i]).backgroundImage;
        if (!bg || bg === "none") continue;
        for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          const u = resolveUrl(m[1]);
          if (bgIndex.has(u)) continue;
          // A 0×0 box paints nothing a reader sees; the analysis skips those too.
          const r = cands[i].getBoundingClientRect();
          if (r.width || r.height) bgIndex.set(u, cands[i]);
        }
      }
    }
    return bgIndex.get(src) || null;
  }

  function findElement(target) {
    if (target?.kind === "heading") {
      // A consent banner or a re-render can add a heading above it, and the popup may show a saved
      // read: check it is the same heading (level and text), else look for it by those.
      const all = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"));
      const same = (h) => (target.level == null || h.tagName === `H${target.level}`) && (target.text == null || cleanText(h).slice(0, 200) === target.text);
      const el = all[target.index];
      if (el && same(el)) return el;
      return target.text == null && target.level == null ? el || null : all.find(same) || null;
    }
    if (target?.kind === "image") {
      // The popup may show a saved result: refill the index from the page, then check it is the same image.
      if (!pageImages.length) document.querySelectorAll("img").forEach((img, i) => { pageImages[i] = img; });
      let el = typeof target.index === "number" ? pageImages[target.index] || null : null;
      if (el && (!document.contains(el) || (target.src && !imageUrls(el).has(target.src)))) el = null;
      if (!el && target.src) el = Array.from(document.querySelectorAll("img")).find((img) => imageUrls(img).has(target.src)) || null;
      // A CSS background image: find the element that paints it.
      if (!el && target.src) el = backgroundImageOwner(target.src);
      return el;
    }
    if (target?.kind === "link") {
      if (!pageLinks.length) collectLinks().forEach((a, i) => { pageLinks[i] = a; });
      let el = pageLinks[target.index] || null;
      const hrefOf = (a) => linkKind(a).u?.href || a.getAttribute("href") || "";
      if (el && (!document.contains(el) || (target.href && hrefOf(el) !== target.href))) el = null;
      if (!el && target.href) el = collectLinks().find((a) => hrefOf(a) === target.href) || null;
      return el;
    }
    return null;
  }

  /**
   * A ring drawn over the element in its own layer, so it stays visible when the
   * element sits in a box that clips its outline (cards with overflow: hidden).
   */
  function showLocator(el) {
    document.querySelectorAll('[data-needle-inserted="locator"]').forEach((n) => n.remove());
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.dataset.needleInserted = "locator";
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = [
      "position:absolute", "pointer-events:none", "z-index:2147483647", "box-sizing:border-box",
      `left:${r.left + window.scrollX - 6}px`, `top:${r.top + window.scrollY - 6}px`,
      `width:${r.width + 12}px`, `height:${r.height + 12}px`,
      "border:3px solid #FF6A55", "box-shadow:0 0 0 3px #FFFFFF, 0 0 0 6px #141312, inset 0 0 0 3px #FFFFFF",
      "border-radius:4px"
    ].join(";");
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 2500);
  }

  const ISSUE_COLORS = { critical: "#A8241C", high: "#A8241C", medium: "#7A4A00", low: "#141312" };

  /**
   * Mark every problem on the page at once: a ring around each element and a
   * label with what is wrong. Items: [{target, label, severity}].
   */
  function highlightIssues(items) {
    unhighlightIssues();
    bgIndex = null;
    const byEl = new Map();
    let hidden = 0;
    let missing = 0;
    for (const it of items.slice(0, 200)) {
      const el = findElement(it.target);
      if (!el) { missing++; continue; }
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) { hidden++; continue; }
      if (!byEl.has(el)) byEl.set(el, []);
      byEl.get(el).push(it);
    }
    for (const [el, list] of byEl) {
      const r = el.getBoundingClientRect();
      const left = r.left + window.scrollX;
      const top = r.top + window.scrollY;
      const worst = list.map((i) => i.severity).sort((a, b) => ["critical", "high", "medium", "low"].indexOf(a) - ["critical", "high", "medium", "low"].indexOf(b))[0];
      const box = document.createElement("div");
      box.dataset.needleInserted = "issue";
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = [
        "position:absolute", "pointer-events:none", "z-index:2147483646", "box-sizing:border-box",
        `left:${left - 4}px`, `top:${top - 4}px`, `width:${r.width + 8}px`, `height:${r.height + 8}px`,
        "border:3px solid #FF6A55", "box-shadow:0 0 0 2px #FFFFFF, 0 0 0 4px #141312", "border-radius:3px"
      ].join(";");
      const label = document.createElement("div");
      label.dataset.needleInserted = "issue";
      label.setAttribute("aria-hidden", "true");
      label.textContent = list.map((i) => i.label).join(" · ");
      label.style.cssText = [
        "position:absolute", "pointer-events:none", "z-index:2147483647",
        `left:${Math.max(0, left - 4)}px`, `top:${Math.max(0, top - 26)}px`, "max-width:420px",
        `background:${ISSUE_COLORS[worst] || "#141312"}`, "color:#FFFFFF", "font:700 12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
        "padding:3px 7px", "border-radius:2px", "box-shadow:0 0 0 2px #FFFFFF", "white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis",
        "letter-spacing:0", "text-transform:none"
      ].join(";");
      document.body.append(box, label);
    }
    return { ok: true, shown: byEl.size, hidden, missing };
  }

  function unhighlightIssues() {
    document.querySelectorAll('[data-needle-inserted="issue"]').forEach((n) => n.remove());
    return { ok: true };
  }

  function highlightElement(target) {
    bgIndex = null;
    const el = findElement(target);
    if (!el) return { ok: false };
    const rect = el.getBoundingClientRect();
    const hidden = rect.width === 0 && rect.height === 0;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    if (!hidden && document.body) showLocator(el);
    // Keep the element's own outline from before the first highlight, even when
    // it is highlighted again within 2.5 s.
    let saved = highlighted.get(el);
    if (saved) clearTimeout(saved.timer);
    else {
      saved = { outline: el.style.outline, outlineOffset: el.style.outlineOffset, hadStyle: el.hasAttribute("style") };
      highlighted.set(el, saved);
    }
    el.style.outline = "3px solid #FF6A55";
    el.style.outlineOffset = "3px";
    saved.timer = setTimeout(() => {
      el.style.outline = saved.outline;
      el.style.outlineOffset = saved.outlineOffset;
      // Leave no empty style="" behind on elements that had none.
      if (!saved.hadStyle && !el.getAttribute("style")) el.removeAttribute("style");
      highlighted.delete(el);
    }, 2500);
    return hidden ? { ok: true, hidden: true } : { ok: true };
  }

  // ---------------------------------------------------------------------------
  // On-page analysis
  // ---------------------------------------------------------------------------

  function analyzeOnpage() {
    // Analyse the page as served; the popup turns its overlay buttons off after this.
    unhighlightHeadings();
    unhighlightLinks();
    unhighlightIssues();
    docHeightCache = 0;
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    const getMeta = (name) => {
      const el = document.querySelector(`meta[name="${name}" i]`) ||
                 document.querySelector(`meta[property="${name}"]`);
      return el?.getAttribute("content") || "";
    };

    const headings = $$("h1, h2, h3, h4, h5, h6").map(h => ({
      level: parseInt(h.tagName.slice(1), 10),
      text: cleanText(h).slice(0, 200),
      hidden: isHidden(h)
    }));

    const mainBoundaryEl = detectMainBoundary();
    const categorize = (el) => categorizeWithMain(el, mainBoundaryEl);

    pageLinks.length = 0;
    const linkDetails = collectLinks().map((a, i) => {
      const k = linkKind(a);
      const rels = (a.getAttribute("rel") || "").toLowerCase().split(/\s+/);
      // Google reads an image link's alt, else the title attribute, as its anchor text.
      const text = (cleanText(a) || a.querySelector('img[alt]:not([alt=""])')?.getAttribute("alt")?.trim() || a.getAttribute("title")?.trim() || "").slice(0, 100);
      pageLinks[i] = a;
      return {
        index: i,
        href: k.u ? k.u.href : k.raw,
        text,
        internal: k.internal,
        external: k.external,
        nofollow: rels.includes("nofollow"),
        ugc: rels.includes("ugc"),
        sponsored: rels.includes("sponsored"),
        broken: !k.raw.trim(),
        context: categorize(a)
      };
    });

    const internal = linkDetails.filter(l => l.internal).length;
    const external = linkDetails.filter(l => l.external).length;
    const nofollow = linkDetails.filter(l => l.nofollow).length;
    const broken = linkDetails.filter(l => l.broken).length;

    const byContext = { header: 0, nav: 0, breadcrumb: 0, main: 0, sidebar: 0, footer: 0, other: 0 };
    linkDetails.forEach(l => { byContext[l.context]++; });

    // File sizes from the Performance API. encodedBodySize is the file size;
    // transferSize is ~300 bytes for any 304 revalidation, so it is not used.
    // 0 = unknown, and the popup asks the server instead.
    const resourceMap = {};
    performance.getEntriesByType("resource").forEach(r => {
      if (r.initiatorType === "img" || r.initiatorType === "image" || r.initiatorType === "css" ||
          /\.(jpe?g|png|gif|webp|avif|svg|bmp)(\?|$)/i.test(r.name)) {
        resourceMap[r.name] = { encodedBodySize: r.encodedBodySize };
      }
    });

    const bgImageEls = [];
    const seenBg = new Set();
    const bgCandidates = document.querySelectorAll("div, section, header, footer, aside, article, main, span, a, button, li, figure");
    const scanLen = Math.min(bgCandidates.length, 1500);
    for (let i = 0; i < scanLen; i++) {
      const el = bgCandidates[i];
      const box = el.getBoundingClientRect();
      if (!box.width && !box.height) continue; // display:none or empty: not shown
      try {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === "none" || !bg.includes("url(")) continue;
        for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
          const u = m[1];
          if (!u || u.startsWith("data:")) continue;
          const src = resolveUrl(u);
          if (seenBg.has(src)) continue;
          seenBg.add(src);
          bgImageEls.push({ el, src });
        }
      } catch {}
    }

    const bgImages = bgImageEls.map(({ el, src }) => {
      const ext = (src.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || "").toLowerCase();
      const bytes = resourceMap[src]?.encodedBodySize || 0;
      const rect = el.getBoundingClientRect();
      return {
        src,
        alt: "",
        altMissing: false,
        naturalWidth: 0,
        naturalHeight: 0,
        displayedWidth: Math.round(rect.width),
        displayedHeight: Math.round(rect.height),
        lazy: false,
        format: ext || "unknown",
        bytes,
        oversized: bytes > 100 * 1024,
        downscaled: false,
        brokenLoad: false,
        context: categorize(el),
        isBackground: true
      };
    });

    const viewportH = window.innerHeight || 800;

    // Lazy-loading plugins put the real URL in a data-* attribute and show a placeholder.
    const LAZY_ATTRS = [...LAZY_SRC_ATTRS, "data-srcset"];
    const realImageSrc = (img) => {
      for (const attr of LAZY_ATTRS) {
        const v = img.getAttribute(attr);
        if (v && !v.startsWith("data:")) {
          return resolveUrl(attr === "data-srcset" ? parseSrcset(v)[0]?.u || "" : v);
        }
      }
      return img.currentSrc || img.src || "";
    };

    // The srcset candidates of an <img> and its <picture> sources: [{url, w, x}].
    // <source media> that doesn't apply now is another crop (art direction), not a size of this image.
    const srcsetCandidates = (img) => [img.getAttribute("srcset"), ...[...(img.closest("picture")?.querySelectorAll("source") || [])]
      .filter((s) => { const m = s.getAttribute("media"); try { return !m || window.matchMedia(m).matches; } catch { return true; } })
      .map((s) => s.getAttribute("srcset"))]
      .filter(Boolean)
      // set: which srcset the candidate came from (the img's own, or a <source>).
      .flatMap((set, i) => parseSrcset(set).map(({ u, d }) => ({ url: u ? resolveUrl(u) : "", w: parseInt(d.match(/^(\d+)w$/)?.[1], 10) || 0, x: parseFloat(d.match(/^([\d.]+)x$/)?.[1]) || 0, set: i })))
      .filter((c) => c.url);
    // The pixel width of the file the browser actually loaded. With a srcset, naturalWidth is
    // already divided by the candidate's density, so the descriptor tells the real width.
    const loadedFileWidth = (img, cands) => {
      const n = img.naturalWidth || 0;
      const c = img.currentSrc ? cands.find((k) => k.url === img.currentSrc) : null;
      if (c?.w) return c.w;
      if (c?.x) return Math.round(n * c.x);
      return n;
    };

    pageImages.length = 0;
    const imgEls = $$("img").map((img, idx) => {
      pageImages[idx] = img;
      const rawSrc = img.currentSrc || img.src || "";
      const lazyResolved = realImageSrc(img);
      const isPlaceholder = rawSrc.startsWith("data:") || /transparent\.gif|placeholder/i.test(rawSrc);
      // A lazy-load script keeps its data-* attributes after it has run (lazysizes keeps data-srcset):
      // when the browser shows a URL from the image's srcset or data-* attributes, that file is the image.
      const swappedIn = !isPlaceholder && declaredImageUrls(img).has(rawSrc);
      const src = isPlaceholder ? lazyResolved : swappedIn ? rawSrc : (lazyResolved || rawSrc);
      const r = resourceMap[src] || resourceMap[rawSrc];
      const ext = (src.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || "").toLowerCase();
      const isDataUrl = src.startsWith("data:");
      // Vector images never look blurry, and their pixel size says nothing about the file.
      const isSvg = isSvgSource(src);
      const bytes = r?.encodedBodySize || 0;
      const rect = img.getBoundingClientRect();
      const isLazy = img.loading === "lazy" || LAZY_ATTRS.some(a => img.hasAttribute(a));
      // Above the fold = in the first viewport of the page, whatever the current scroll.
      const top = rect.top + window.scrollY;
      const aboveFold = top < viewportH && rect.bottom + window.scrollY > 0 && rect.width > 0 && rect.height > 0;

      // The file the browser loaded (the srcset candidate for this screen), not the width
      // attribute, which describes the layout. The attributes only stand in before loading.
      const attrW = parseInt(img.getAttribute("width"), 10) || 0;
      const attrH = parseInt(img.getAttribute("height"), 10) || 0;
      const cands = srcsetCandidates(img);
      // Not loaded yet (lazy): without a srcset the attributes usually give the file's size;
      // with one, the file depends on the screen, so it isn't judged until it loads.
      // A lazy-load placeholder (a 1×1 data: GIF while the real file waits in data-src) is not the image.
      const loaded = img.naturalWidth > 0 && !(rawSrc.startsWith("data:") && src !== rawSrc);
      const fileW = loaded ? loadedFileWidth(img, cands) : (cands.length ? 0 : attrW);
      const fileH = loaded ? Math.round(img.naturalHeight * fileW / img.naturalWidth) : (cands.length ? 0 : attrH);
      const naturalW = fileW || attrW;
      const naturalH = fileH || attrH;
      // The largest file the page offers (Google may pick it for large previews).
      const largestWidth = Math.max(naturalW, ...cands.map((c) => c.w));
      // Larger than even a 2x (retina) screen needs for the box it fills.
      const needed = (img.width || 0) * Math.max(2, window.devicePixelRatio || 1);
      // With a srcset the browser picks the smallest file that covers the box at this screen's
      // density (640w for a 300 px box on a 2x screen). That choice is only a problem when a smaller
      // candidate would have covered the box too, or when the page offers nothing near the size.
      const shownPx = (img.width || 0) * (window.devicePixelRatio || 1);
      // Only the srcset the browser picked from: a <source> for another screen (art direction)
      // and the img's own srcset next to a matching <source> are other crops, not smaller sizes of this file.
      const picked = img.currentSrc ? cands.find((c) => c.url === img.currentSrc) : null;
      const widths = cands.filter((c) => !picked || c.set === picked.set).map((c) => c.w).filter(Boolean);
      const smallerWouldDo = widths.some((w) => w < fileW && w >= shownPx);
      const downscaled = !isSvg && fileW > 0 && img.width > 0 && fileW > needed &&
        (!widths.length || smallerWouldDo || fileW > needed * 1.5);

      // A lazy image still waiting reports complete=false, so complete with no pixels means it failed, lazy or not.
      const brokenLoad = img.complete && !!src && !isDataUrl && img.naturalWidth === 0 && img.naturalHeight === 0 &&
        !(isLazy && (img.currentSrc || img.src || "").startsWith("data:"));
      // Without width and height attributes the browser can't reserve space, so the layout shifts (CLS).
      // CSS can reserve it too: an aspect-ratio, or a width and height in the inline style.
      // (A stylesheet's width and height can't be told from the computed size, so only inline counts.)
      const cssReservesSpace = () => {
        try {
          const ar = getComputedStyle(img).aspectRatio;
          if (ar && ar !== "auto") return true;
        } catch {}
        const { width, height } = img.style;
        return !!width && !!height && width !== "auto" && height !== "auto";
      };
      const missingDims = !(img.hasAttribute("width") && img.hasAttribute("height")) && !img.closest("picture")?.querySelector("source[width][height]") && !cssReservesSpace();
      return {
        domIndex: idx,
        missingDims,
        src,
        alt: img.getAttribute("alt") || "",
        altMissing: !img.hasAttribute("alt"),
        naturalWidth: naturalW,
        naturalHeight: naturalH,
        displayedWidth: img.width || attrW,
        displayedHeight: img.height || attrH,
        lazy: isLazy,
        format: isSvg ? "svg" : isDataUrl ? "data-url" : (ext || "unknown"),
        bytes,
        oversized: bytes > 100 * 1024,
        largestWidth,
        downscaled,
        // A lazy image that hasn't loaded yet can't be judged on how large it is shown.
        loaded,
        // The file the browser loaded is smaller than the box it fills: it looks blurry.
        // fileW is the file's real width; naturalWidth is divided by the density that srcset and sizes imply.
        upscaled: loaded && !isSvg && img.width > fileW * 1.05,
        aboveFold,
        lazyAboveFold: isLazy && aboveFold,
        brokenLoad,
        context: categorize(img),
        isBackground: false
      };
    });

    const seenSrcs = new Set(imgEls.map(i => i.src));
    const images = [...imgEls, ...bgImages.filter(b => !seenSrcs.has(b.src))];
    const imagesByContext = { header: 0, nav: 0, breadcrumb: 0, main: 0, sidebar: 0, footer: 0, other: 0 };
    images.forEach(i => { imagesByContext[i.context] = (imagesByContext[i.context] || 0) + 1; });

    const schema = $$('script[type="application/ld+json"]').map(s => {
      try {
        const parsed = JSON.parse(s.textContent || "{}");
        const parentContext = parsed?.["@context"];
        const items = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ? parsed["@graph"] : [parsed];
        return items.map(item => {
          const withContext = (item && typeof item === "object" && !item["@context"] && parentContext)
            ? { "@context": parentContext, ...item }
            : item;
          return {
            type: withContext?.["@type"]
              ? (Array.isArray(withContext["@type"]) ? withContext["@type"].join(", ") : withContext["@type"])
              : "Unknown",
            raw: withContext
          };
        });
      } catch (e) {
        return [{ type: "Invalid JSON", raw: { error: e.message, text: (s.textContent || "").slice(0, 200) } }];
      }
    }).flat();

    // hreflang: only <head> links count for Google; body ones are flagged.
    const hreflangEls = $$('link[rel~="alternate"][hreflang]');
    const hreflang = hreflangEls.filter(l => l.closest("head")).map(l => ({
      lang: l.getAttribute("hreflang"),
      href: l.getAttribute("href")
    }));
    const hreflangOutsideHead = hreflangEls.filter(l => !l.closest("head")).length;

    // Canonical: the first one in <head> counts; several or body-placed ones are problems.
    const canonicalEls = $$('link[rel~="canonical"]');
    const headCanonical = canonicalEls.find(l => l.closest("head"));
    // Resolved against <base href>, as a crawler does.
    const canonical = headCanonical?.getAttribute("href") ? resolveUrl(headCanonical.getAttribute("href")) : "";
    const canonicalOutsideHead = canonicalEls.some(l => !l.closest("head"));
    const canonicalDistinct = new Set(canonicalEls.map(l => resolveUrl(l.getAttribute("href") || ""))).size;

    const microdataTypes = (() => {
      const found = new Set();
      document.querySelectorAll("[itemtype]").forEach(el => {
        (el.getAttribute("itemtype") || "").split(/\s+/).forEach(t => {
          const name = t.split("/").pop().trim();
          if (name) found.add(name);
        });
      });
      document.querySelectorAll("[typeof]").forEach(el => {
        (el.getAttribute("typeof") || "").trim().split(/\s+/).forEach(t => {
          const name = t.replace(/^schema:/i, "").split("/").pop();
          if (name) found.add(name);
        });
      });
      return [...found].sort();
    })();

    const bodyText = readableText(document.body).trim();
    const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
    const htmlLen = document.documentElement.outerHTML.length;
    const textRatio = htmlLen ? Math.round((bodyText.length / htmlLen) * 100) : 0;

    // Main-content word count: prefer <main> or [role=main] when it holds at least
    // half the words of the largest candidate, so outer wrappers don't win.
    const countWords = (text) => text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
    const candidates = [];
    const addCandidate = (selector, el) => {
      const t = readableText(el).trim();
      if (t) candidates.push({ selector, text: t, count: countWords(t) });
    };
    addCandidate("main", document.querySelector("main"));
    const articles = document.querySelectorAll("article");
    if (articles.length === 1) addCandidate("article", articles[0]);
    else if (articles.length > 1) {
      const combined = Array.from(articles).map(a => readableText(a).trim()).filter(Boolean).join(" ");
      if (combined) candidates.push({ selector: `article × ${articles.length}`, text: combined, count: countWords(combined) });
    }
    ["[role='main']", "#main", "#content", "#main-content", "#primary",
      ".main-content", ".post-content", ".entry-content", ".article-body", ".page-content"
    ].forEach(sel => addCandidate(sel, document.querySelector(sel)));
    candidates.sort((a, b) => b.count - a.count);
    const largest = candidates[0];
    const semantic = candidates.find(c => c.selector === "main" || c.selector === "[role='main']");
    const best = semantic && largest && semantic.count >= largest.count / 2 ? semantic : largest;

    return {
      url: location.href,
      // text/plain, XML or an image opened in a tab: the popup shows "not an HTML page" instead of an audit.
      contentType: document.contentType || "",
      title: document.title || "",
      generator: document.querySelector('meta[name="generator" i]')?.getAttribute("content") || "",
      description: getMeta("description"),
      // An element not allowed in <head> (img, div, iframe) ends it early; search engines ignore metadata after it.
      descriptionOutsideHead: !!document.querySelector('meta[name="description" i]') && !document.querySelector('head meta[name="description" i]'),
      keywords: getMeta("keywords"),
      canonical,
      canonicalOutsideHead,
      canonicalDistinct,
      // Google honours robots metas anywhere in the document, for robots and googlebot.
      robots: $$('meta[name="robots" i], meta[name="googlebot" i]').map(m => m.getAttribute("content")?.trim()).filter(Boolean).join(", "),
      lang: document.documentElement.getAttribute("lang") || "",
      viewport: getMeta("viewport"),
      publisherMeta: getMeta("publisher"),
      og: {
        title: getMeta("og:title"),
        description: getMeta("og:description"),
        image: getMeta("og:image") ? resolveUrl(getMeta("og:image")) : "",
        imageWidth: parseInt(getMeta("og:image:width"), 10) || 0,
        imageHeight: parseInt(getMeta("og:image:height"), 10) || 0,
        type: getMeta("og:type"),
        url: getMeta("og:url"),
        siteName: getMeta("og:site_name")
      },
      twitter: {
        card: getMeta("twitter:card"),
        title: getMeta("twitter:title"),
        description: getMeta("twitter:description"),
        image: getMeta("twitter:image") ? resolveUrl(getMeta("twitter:image")) : "",
        site: getMeta("twitter:site")
      },
      headings,
      links: { internal, external, nofollow, broken, total: linkDetails.length, byContext, details: linkDetails },
      images,
      imagesByContext,
      // An AMP page, or a page with an AMP version: Discover may show large images without max-image-preview.
      amp: document.documentElement.hasAttribute("amp") || document.documentElement.hasAttribute("\u26a1") || !!document.querySelector('link[rel~="amphtml" i]'),
      schema,
      microdataTypes,
      hreflang,
      hreflangOutsideHead,
      wordCount,
      mainContentWordCount: best?.count ?? null,
      mainContentSelector: best?.selector || null,
      textRatio,
      authorMeta: document.querySelector('meta[name="author" i]')?.getAttribute("content") || "",
      authorByline: cleanText(document.body?.querySelector('a[rel~="author"], .author, .byline, [itemprop="author"]:not(meta):not(link)')).slice(0, 100),
      publishedMeta: document.querySelector('meta[property="article:published_time"]')?.getAttribute("content")
        || document.querySelector('time[datetime][pubdate], time[datetime][itemprop="datePublished"]')?.getAttribute("datetime") || "",
      modifiedMeta: document.querySelector('meta[property="article:modified_time"]')?.getAttribute("content")
        || document.querySelector('time[datetime][itemprop="dateModified"]')?.getAttribute("datetime") || "",
      externalLinkCount: external,
      listCount: [...(mainBoundaryEl || document.body || document.documentElement).querySelectorAll("ul, ol")]
        .filter(l => !l.closest("nav, [role=navigation], header, footer, aside")).length,
      tableCount: document.querySelectorAll("table").length,
      // Text marked data-nosnippet is kept out of Google snippets and AI Overviews.
      dataNosnippetCount: document.querySelectorAll("[data-nosnippet]").length,
      mixedContent: findMixedContent(),
      schemaSignals: detectSchemaSignals()
    };
  }

  /** http: resources on an https: page (browsers block or warn about them). */
  function findMixedContent() {
    if (location.protocol !== "https:") return [];
    const out = [];
    const sel = "img[src], script[src], iframe[src], video[src], audio[src], source[src], link[rel~='stylesheet'][href], embed[src], object[data]";
    for (const el of document.querySelectorAll(sel)) {
      const raw = el.getAttribute("src") || el.getAttribute("href") || el.getAttribute("data") || "";
      if (/^http:\/\//i.test(raw.trim()) || (raw && !/^[a-z]+:/i.test(raw) && document.baseURI.startsWith("http:"))) {
        out.push({ tag: el.tagName.toLowerCase(), url: resolveUrl(raw) });
        if (out.length >= 20) break;
      }
    }
    return out;
  }

  function detectSchemaSignals() {
    const bodyText = (document.body?.innerText || "").slice(0, 50000);
    const lowerBody = bodyText.toLowerCase();

    const hasBreadcrumb = !!document.querySelector(
      '#breadcrumb, #breadcrumbs, [id*="breadcrumb" i], ' +
      '.breadcrumb, .breadcrumbs, [class*="breadcrumb" i], ' +
      '[class*="kruimel" i], [class*="brotkrumen" i], ' +
      'nav[aria-label*="breadcrumb" i], nav[aria-label*="brood" i], nav[aria-label*="kruimel" i], ' +
      '[role="navigation"][aria-label*="breadcrumb" i], ' +
      '[itemtype*="BreadcrumbList" i], [itemprop="breadcrumb"]'
    );

    const hasVideoEmbed = !!document.querySelector(
      'video, iframe[src*="youtube.com" i], iframe[src*="youtu.be" i], iframe[src*="vimeo.com" i], iframe[src*="wistia" i]'
    );

    const hasArticleTag = document.querySelectorAll("article").length > 0;
    const faqQuestionCount = Array.from(document.querySelectorAll("h2, h3, h4")).filter(h => /\?$/.test(cleanText(h))).length;

    const hasPricing = /(?:€|\$|£)\s*\d|\d[\d.,]*\s*(?:€|\$|£)|\d[.,]\d{2}\s*(?:eur|usd|gbp)\b/i.test(bodyText);

    // Page-content detection in several languages (data, not UI text).
    const cartKeywords = /\b(add to cart|add to basket|in cart|in winkelwagen|toevoegen aan|ajouter au panier|in den warenkorb|comprar|aggiungi|voeg toe)\b/i;
    const hasCartButton = cartKeywords.test(bodyText) || !!document.querySelector('[data-add-to-cart], .add-to-cart, .btn-cart, button[name*="cart" i]');

    const hasRating = /\b\d(?:[.,]\d)?\s*\/\s*5\b|⭐⭐|★★/i.test(bodyText) ||
                      !!document.querySelector('[class*="rating" i], [itemprop="ratingValue"]');

    // A postal code before a capitalised place name, in an address-like position:
    // after a comma ("Kerkstraat 12, 2000 Antwerpen", "12 rue X, 75001 Paris"), on the
    // line after a house number, with a country prefix ("B-2000"), or a US state + ZIP.
    // Not a year or a count before a word ("In 2026 kiezen", "1500 Kunden").
    const hasAddress = !!document.querySelector('address, [itemtype*="PostalAddress" i]') ||
                       ADDRESS_RE.test(bodyText.slice(0, 5000));

    // At least nine digits; not a date or a date range (14.10.2026 - 20.11.2026), not a big number (1.000.000.000).
    const phoneLike = (bodyText.slice(0, 5000).match(/\+?\(?\d[\d\s().\/-]{7,}\d/g) || [])
      .filter((m) => (m.match(/\d/g) || []).length >= 9 &&
        !/\d{1,2}[.\/-]\d{1,2}[.\/-](?:19|20)\d{2}/.test(m) &&
        !/^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2}$/.test(m.trim()) &&
        !/^\d{1,3}(?:[.,]\d{3}){2,}$/.test(m.trim()));
    const hasPhone = !!document.querySelector('a[href^="tel:"]') || phoneLike.length > 0;

    // A day or "open" word followed closely by a time range: "Ma-vr 9:00 - 17:00", "van 9u tot 17u".
    const hasOpeningHours = OPENING_HOURS_RE.test(bodyText);

    const hasAuthorByline = !!document.querySelector('[rel="author"], .author, .byline, [itemprop="author"], .post-author, .article-author');
    const hasPublishDate = !!document.querySelector('time[datetime], [itemprop="datePublished"], meta[property="article:published_time"]');

    const isHomepage = location.pathname === "/" || location.pathname === "" ||
                       /^\/[a-z]{2}(-[a-z]{2})?\/?$/i.test(location.pathname);

    const ingredientHints = !!document.querySelector('[itemprop="recipeIngredient"], [class*="ingredient" i]');
    const stepsListed = !!document.querySelector('[class*="step" i] ol, [itemprop="recipeInstructions"]') ||
                        (document.querySelectorAll("ol > li").length >= 3 && /\b(step|stap|étape|schritt|paso|passo)\b/i.test(bodyText.slice(0, 5000)));

    const jobSignals = /\b(vacature|job posting|we're hiring|we are hiring|nous recrutons|stelle|empleo|posizione|salary|salaris|salaire|gehalt)\b/i.test(bodyText.slice(0, 5000));

    return {
      hasBreadcrumb, hasVideoEmbed, hasArticleTag, faqQuestionCount, hasPricing, hasCartButton,
      hasRating, hasAddress, hasPhone, hasOpeningHours, hasAuthorByline, hasPublishDate,
      isHomepage, ingredientHints, stepsListed, jobSignals
    };
  }

  // ---------------------------------------------------------------------------
  // Link overlay
  // ---------------------------------------------------------------------------

  function ensureLinkStylesheet() {
    if (document.getElementById("needle-link-style")) return;
    const style = document.createElement("style");
    style.id = "needle-link-style";
    const rules = Object.entries(CONTEXT_COLORS).map(([ctx, c]) => `
      .needle-link-hl.needle-ctx-${ctx} { text-decoration-color: ${c.bg} !important; }
      .needle-link-tag.needle-ctx-${ctx} { background: ${c.bg} !important; color: ${c.fg} !important; }`).join("");
    style.textContent = `
      .needle-link-hl {
        text-decoration-line: underline !important;
        text-decoration-thickness: 3px !important;
        text-underline-offset: 3px !important;
      }
      .needle-link-tag {
        box-shadow: 0 0 0 1px #FFFFFF !important;
        -webkit-text-fill-color: currentColor !important;
        display: inline-block !important;
        font: 700 10px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
        padding: 0 3px !important;
        margin-right: 3px !important;
        vertical-align: middle !important;
        text-decoration: none !important;
        letter-spacing: 0 !important;
        text-transform: none !important;
        border-radius: 0 !important;
      }${rules}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function highlightLinks(filter) {
    unhighlightLinks();
    lastLinkFilter = filter;
    ensureLinkStylesheet();
    const mainBoundaryEl = detectMainBoundary();
    // All reads first, then all writes, so the page lays out once.
    const matches = [];
    for (const a of collectLinks()) {
      const k = linkKind(a);
      if (filter.internal === "internal" && !k.internal) continue;
      if (filter.internal === "external" && !k.external) continue;
      const ctx = categorizeWithMain(a, mainBoundaryEl);
      if (filter.contexts && filter.contexts.length && !filter.contexts.includes(ctx)) continue;
      if (filter.nofollowOnly && !(a.getAttribute("rel") || "").toLowerCase().split(/\s+/).includes("nofollow")) continue;
      if (filter.brokenOnly && k.raw.trim()) continue;
      if (Array.isArray(filter.hrefs) && !filter.hrefs.includes(k.u ? k.u.href : k.raw)) continue;
      matches.push({ a, ctx });
    }
    for (const { a, ctx } of matches) {
      a.classList.add("needle-link-hl", `needle-ctx-${ctx}`);
      const tag = document.createElement("span");
      tag.className = `needle-link-tag needle-ctx-${ctx}`;
      tag.textContent = CONTEXT_COLORS[ctx]?.letter || "?";
      tag.title = ctx;
      tag.dataset.needleInserted = "link-tag";
      a.insertBefore(tag, a.firstChild);
    }
    return { ok: true, matched: matches.length };
  }

  function unhighlightLinks() {
    document.querySelectorAll('[data-needle-inserted="link-tag"]').forEach(el => el.remove());
    document.querySelectorAll("a.needle-link-hl").forEach(a => {
      a.classList.remove("needle-link-hl", ...Object.keys(CONTEXT_COLORS).map(c => `needle-ctx-${c}`));
      if (!a.classList.length) a.removeAttribute("class");
    });
    document.getElementById("needle-link-style")?.remove();
    return { ok: true };
  }

  /**
   * Measure the page as served: take Needle's own marks off (heading labels, link
   * tags, issue rings and labels, the locator), run fn, then put back what was on.
   */
  function withoutMarks(fn) {
    const headingsOn = !!document.querySelector('[data-needle-inserted="label"]');
    const linkFilter = document.querySelector('[data-needle-inserted="link-tag"]') ? lastLinkFilter : null;
    const floating = [...document.querySelectorAll('[data-needle-inserted="issue"], [data-needle-inserted="locator"]')];
    unhighlightHeadings();
    unhighlightLinks();
    floating.forEach((n) => n.remove());
    try {
      return fn();
    } finally {
      if (headingsOn) highlightHeadings();
      if (linkFilter) highlightLinks(linkFilter);
      if (document.body) floating.forEach((n) => document.body.appendChild(n));
    }
  }

  /** The main content's visible text, for readability and word frequency. Not cached. */
  function getMainText() {
    return withoutMarks(() => {
      const el = detectMainBoundary() || document.body;
      return { text: readableText(el).slice(0, 200000), lang: document.documentElement.getAttribute("lang") || "" };
    });
  }

  // ---------------------------------------------------------------------------
  // Rendered snapshot, compared with the raw HTML in the Technical tab
  // ---------------------------------------------------------------------------

  // Keep the word count in sync with extractWordCount in lib/technical.js.
  function htmlWordCount(html) {
    const bodyMatch = html.match(/<body[\s\S]*$/i);
    const stripped = (bodyMatch ? bodyMatch[0] : html)
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|template|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return stripped ? stripped.split(" ").length : 0;
  }

  function getRenderedSnapshot() {
    return withoutMarks(() => {
      const html = document.documentElement.outerHTML;
      return {
        htmlLen: html.length,
        wordCount: htmlWordCount(html),
        headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
        links: document.querySelectorAll("a[href]").length,
        schema: document.querySelectorAll('script[type="application/ld+json"]').length
      };
    });
  }
})();
