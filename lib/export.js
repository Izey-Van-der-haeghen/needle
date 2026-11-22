import { charCount } from "./snippet.js";
import { validateHreflang } from "./hreflang.js";
import { withoutTracking } from "./urls.js";
import { escapeHtml as esc, fmtNum, snippetWidthVerdict, SNIPPET, localDate } from "./popup-helpers.js";
import { isContentImage } from "./image-rules.js";
import { REPO_URL } from "./links.js";
import { SEVERITY_LABEL } from "./findings.js";
import { AI_SCORE_NOTE } from "./geo.js";
import { SEV_KIND, BOT_KIND_LABEL, botStatus, signalStatus, llmsStatus, cwvStatus, LEVEL_KIND, leftOutNote, HREFLANG_LEVEL_WORD } from "./labels.js";

/** Length labels for the title or description: the width decides when it was measured, else the count. */
function lengthTags(len, px, minChars, maxChars, idealPx, maxPx) {
  if (!len) return "";
  if (!px) return tag(`${len} characters`, len >= minChars && len <= maxChars ? "good" : "warn");
  const v = snippetWidthVerdict(px, idealPx, maxPx);
  return `${tag(`${len} characters`, "info")} ${tag(v.label, v.kind)}`;
}

/** Status word with a symbol, so the meaning never rests on colour alone. */
function tag(text, kind = "neutral") {
  const sym = { good: "✓", warn: "!", bad: "✗" }[kind] || "";
  return `<span class="tag ${kind}">${sym ? `<span aria-hidden="true">${sym}</span> ` : ""}${esc(text)}</span>`;
}

function statusKind(s) {
  if (!s) return "neutral";
  if (s >= 200 && s < 300) return "good";
  if (s >= 300 && s < 400) return "warn";
  return "bad";
}

/** Rows of [label, valueHtml]. Labels are text; values are trusted HTML built here. */
function kvTable(rows) {
  return `<table><tbody>${rows
    .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v ?? "—"}</td></tr>`)
    .join("")}</tbody></table>`;
}

const pct = (n) => Math.round((Number(n) || 0) * 100);
const cwvKind = (c) => cwvStatus(c)[1];
const cwvWord = (c) => cwvStatus(c)[0];

/** GEO rows from lib/geo.js ({label, ok, value, hint}), printed like the popup prints them. */
function geoRows(rows, failText) {
  return kvTable((rows || []).map(s => [s.label,
    `${tag(...signalStatus(s, failText))} ${esc(s.value)}${!s.ok && s.hint ? `<div class="hint">${esc(s.hint)}</div>` : ""}`]));
}

function psiTable(p) {
  if (!p) return "<p class=\"muted\">Not run.</p>";
  if (p.error) return `<p>${tag("error", "bad")} ${esc(p.error)}</p>`;
  const score = p.performanceScore;
  return kvTable([
    ["Performance", score == null ? "—" : tag(`${score}/100`, score >= 90 ? "good" : score >= 50 ? "warn" : "bad")],
    ...(p.seoScore != null ? [["SEO", `${p.seoScore}/100`]] : []),
    ...(p.accessibilityScore != null ? [["Accessibility", `${p.accessibilityScore}/100`]] : []),
    ...(p.bestPracticesScore != null ? [["Best practices", `${p.bestPracticesScore}/100`]] : []),
    ...(p.originFallback ? [["Field data", "Whole site: not enough real-user data for this page alone"]] : []),
    ["LCP", p.lcp != null ? `${fmtNum(p.lcp)} ms ${tag(cwvWord(p.lcpCategory), cwvKind(p.lcpCategory))}` : "no field data"],
    ["INP", p.inp != null ? `${fmtNum(p.inp)} ms ${tag(cwvWord(p.inpCategory), cwvKind(p.inpCategory))}` : "no field data"],
    ["CLS", p.cls != null ? `${p.cls.toFixed(2)} ${tag(cwvWord(p.clsCategory), cwvKind(p.clsCategory))}` : "no field data"]
  ]);
}

/** The same content images the popup and "Fix this first" report on. */
function contentImages(images) {
  return (images || []).filter(isContentImage);
}

/**
 * Build a standalone HTML audit report.
 * @param {{url: string, onpage: Object, technical: Object|null, offpage: Object|null,
 *          geo: Object|null, health: Object|null, verdict: Object|null, theme?: string,
 *          version?: string, storeLink?: string|null}} input
 * @returns {string}
 */
export function buildHtmlReport({ url, onpage, technical, offpage, geo, health, verdict, theme, version, storeLink = null, fontCss = "", findings = null, titlePx = 0, descPx = 0 }) {
  const now = new Date();
  const dateText = now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });
  const hostname = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  // The report has no access to the extension's settings, so the theme is baked in.
  const resolvedTheme = theme === "dark" || theme === "light"
    ? theme
    : (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  const headings = onpage.headings || [];
  const h1Count = headings.filter(h => h.level === 1 && !h.hidden).length;
  const titleLen = charCount(onpage.title);
  const descLen = charCount(onpage.description);
  const hreflangTags = onpage.hreflang || [];

  return `<!DOCTYPE html>
<html lang="en" data-theme="${resolvedTheme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SEO audit: ${esc(hostname)} (${localDate(now)})</title>
  <style>
    ${fontCss}
    :root {
      /* The same names and values as base.css (tests/site-round-fixes checks they stay equal). */
      --paper: #FAFAF7; --surface: #F1EFEA; --ink: #141312; --ink-2: #4D4945; --line: #8C8780; --rule: rgba(20, 19, 18, .14);
      --accent: #FF6A55; --on-accent: #141312;
      --good: #1E6B43; --good-bg: #E4F1E8; --warn: #7A4A00; --warn-bg: #FAEED5; --bad: #A8241C; --bad-bg: #FBE5E2;
      --text: "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", sans-serif;
      --mono: "Martian Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color-scheme: light;
    }
    :root[data-theme="dark"] {
      --paper: #121110; --surface: #1C1A18; --ink: #F2EFE9; --ink-2: #B6B0A7; --line: #6E6962; --rule: rgba(242, 239, 233, .16);
      --accent: #FF7862; --on-accent: #121110;
      --good: #86D6A8; --good-bg: #15291E; --warn: #F0C266; --warn-bg: #2C2312; --bad: #FF9F95; --bad-bg: #361816;
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 400 16px/1.6 var(--text); -webkit-font-smoothing: antialiased; }
    /* About 75 characters per line, no one-word last lines. */
    main p, main li { max-width: 40em; text-wrap: pretty; }
    main { max-width: 920px; margin: 0 auto; padding: 48px 24px 72px; }
    a { color: inherit; text-decoration-color: var(--accent); text-decoration-thickness: .12em; text-underline-offset: .2em; }
    header.report { border-bottom: 3px solid var(--ink); padding-bottom: 20px; margin-bottom: 28px; }
    .brand { font: 700 13px/1 var(--mono); letter-spacing: .02em; text-transform: lowercase; }
    .brand::before { content: ""; display: inline-block; width: .7em; height: .7em; border-radius: 50%; background: var(--accent); margin-right: .45em; vertical-align: -.05em; }
    h1 { font: 700 30px/1.2 var(--text); margin: 14px 0 8px; }
    h2 { font: 700 20px/1.3 var(--text); margin: 0 0 12px; }
    h3 { font: 700 16px/1.4 var(--text); margin: 22px 0 8px; }
    .meta { color: var(--ink-2); font-size: 14px; overflow-wrap: anywhere; }
    section { padding: 24px 0; border-top: 1px solid var(--rule); }
    nav.toc { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0 0 8px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; vertical-align: top; padding: 7px 10px 7px 0; border-bottom: 1px solid var(--rule); overflow-wrap: anywhere; }
    td.lang { white-space: nowrap; overflow-wrap: normal; }
    tbody th { width: 34%; font-weight: 700; color: var(--ink-2); }
    thead th { font: 700 11px/1.4 var(--mono); text-transform: uppercase; letter-spacing: .04em; color: var(--ink-2); }
    .tag { display: inline-block; font-size: 13px; font-weight: 700; padding: 0 6px; border-radius: 3px; white-space: nowrap; }
    .tag.good { color: var(--good); background: var(--good-bg); }
    .tag.warn { color: var(--warn); background: var(--warn-bg); }
    .tag.bad { color: var(--bad); background: var(--bad-bg); }
    .tag.neutral { color: var(--ink-2); background: var(--surface); }
    /* Information only, nothing to do: outlined, so it never looks like a "Low" finding. */
    .tag.info { color: var(--ink-2); background: transparent; box-shadow: inset 0 0 0 1px var(--rule); }
    .code, code, pre { font-family: var(--mono); font-size: 12px; }
    pre { background: var(--surface); padding: 12px; overflow: auto; max-height: 420px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .muted { color: var(--ink-2); }
    .hint { color: var(--ink-2); font-size: 13px; margin-top: 2px; }
    .hint::before { content: "→ "; }
    .score { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
    .score b { font: 700 48px/1 var(--text); }
    .bar { width: 96px; height: 8px; background: var(--surface); display: inline-block; vertical-align: middle; margin-right: 8px; }
    .bar i { display: block; height: 100%; background: var(--ink); }
    .verdict { border-left: 6px solid var(--ink-2); padding: 4px 0 4px 14px; }
    .verdict.good { border-color: var(--good); } .verdict.warn { border-color: var(--warn); } .verdict.bad { border-color: var(--bad); }
    .verdict-title { font-weight: 700; font-size: 18px; margin-bottom: 6px; }
    .issue { margin: 6px 0; }
    .findings { padding-left: 22px; }
    .findings li { margin: 0 0 14px; }
    .findings p { margin: 2px 0; }
    .h-row { padding: 3px 0; font-size: 14px; }
    .h-level { font: 700 11px/1 var(--mono); background: var(--ink); color: var(--paper); padding: 2px 5px; margin-right: 6px; }
    .img-row { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--rule); font-size: 13px; }
    .img-row img { width: 64px; height: 48px; object-fit: cover; background: var(--surface); }
    .img-row .code, ul.code li { overflow-wrap: anywhere; }
    .bots { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px 16px; font-size: 14px; }
    .social { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .card { border: 1px solid var(--rule); }
    .card img { display: block; width: 100%; aspect-ratio: 1.91 / 1; object-fit: cover; background: var(--surface); }
    .card div { padding: 10px 12px; font-size: 14px; }
    footer { margin-top: 32px; padding-top: 16px; border-top: 3px solid var(--ink); color: var(--ink-2); font-size: 13px; }
    /* Print and PDF always in light colours, also for a report saved in dark theme. */
    @media print {
      :root, :root[data-theme="dark"] {
        --paper: #FFFFFF; --surface: #F1EFEA; --ink: #141312; --ink-2: #4D4945; --line: #8C8780; --rule: rgba(20, 19, 18, .14);
        --good: #1E6B43; --good-bg: #E4F1E8; --warn: #7A4A00; --warn-bg: #FAEED5; --bad: #A8241C; --bad-bg: #FBE5E2;
        color-scheme: light;
      }
      section { break-inside: avoid-page; }
      /* The fix list can be longer than a page: let it break between items, not before it. */
      #fix-first { break-inside: auto; }
      .findings li { break-inside: avoid; }
    }
  </style>
</head>
<body>
<main>
  <header class="report">
    <div class="brand">needle</div>
    <h1>SEO audit</h1>
    <div class="meta"><a href="${esc(url)}">${esc(url)}</a><br>${esc(dateText)}</div>
  </header>

  <nav class="toc" aria-label="Sections">
    ${Array.isArray(findings) ? `<a href="#fix-first">Fix this first</a>` : ""}
    ${health ? `<a href="#health">Health score</a>` : ""}
    ${verdict ? `<a href="#verdict">Indexability</a>` : ""}
    <a href="#meta">Title and meta</a>
    <a href="#headings">Headings</a>
    <a href="#content">Content</a>
    <a href="#links">Links</a>
    <a href="#images">Images</a>
    <a href="#schema">Schema</a>
    ${hreflangTags.length ? `<a href="#hreflang">Hreflang</a>` : ""}
    <a href="#social">Social previews</a>
    ${geo ? `<a href="#ai">AI search</a>` : ""}
    ${technical ? `<a href="#technical">Technical</a>` : ""}
    <a href="#offpage">Speed and keywords</a>
  </nav>

  ${Array.isArray(findings) ? `
  <section id="fix-first">
    <h2>Fix this first</h2>
    ${findings.leftOut?.length ? `<p class="muted">${esc(leftOutNote(findings.leftOut.length))}</p>` : ""}
    ${findings.length ? `<ol class="findings">${findings.map(f => `
      <li>
        <p>${tag(SEVERITY_LABEL[f.severity] || f.severity, SEV_KIND[f.severity] || "neutral")} <strong>${esc(f.title)}</strong> <span class="muted">${esc(f.area || "")}</span></p>
        <p class="muted">${esc(f.why)}</p>
        <p><strong>Fix:</strong> ${esc(f.fix)}</p>
        ${f.examples?.length ? `<ul class="code">${f.examples.slice(0, 3).map(e => `<li>${esc(e)}</li>`).join("")}</ul>${f.examples.length > 3 ? `<p class="muted">…and ${fmtNum(f.examples.length - 3)} more</p>` : ""}` : ""}
      </li>`).join("")}</ol>` : "<p>The automated checks found nothing to fix. Still read the page as a visitor would.</p>"}
  </section>` : ""}

  ${health ? `
  <section id="health">
    <h2>Health score</h2>
    <div class="score"><b>${health.score}</b><span>grade ${esc(health.grade)} · ${health.level === "good" ? "looking good" : health.level === "warn" ? "room to improve" : "needs attention"}</span></div>
    <p class="muted">An on-page checklist score, not a ranking prediction.</p>
    <table>
      <thead><tr><th>Check</th><th>Score</th></tr></thead>
      <tbody>
        ${health.checks.map(c => `<tr><td>${esc(c.label)}</td><td><span class="bar" aria-hidden="true"><i style="width:${pct(c.score)}%"></i></span>${pct(c.score)}%</td></tr>`).join("")}
      </tbody>
    </table>
  </section>` : ""}

  ${verdict ? `
  <section id="verdict">
    <h2>Indexability</h2>
    <div class="verdict ${esc(verdict.level)}">
      <div class="verdict-title">${esc(verdict.verdict)}</div>
      ${(verdict.issues || []).map(iss => `<div class="issue">${esc(iss.msg === "All checks passed" ? "No indexing problems found." : iss.msg)}${iss.hint ? `<div class="hint">${esc(iss.hint)}</div>` : ""}</div>`).join("")}
    </div>
  </section>` : ""}

  <section id="meta">
    <h2>Title and meta</h2>
    ${kvTable([
      // As in the popup card: the pixel width gives the verdict when it is known; the count is information.
      ["Title", `${esc(onpage.title) || "<em>missing</em>"} ${lengthTags(titleLen, titlePx, 30, 60, SNIPPET.titleIdealPx, SNIPPET.titleMaxPx)}`],
      ["Description", `${esc(onpage.description) || "<em>missing</em>"} ${lengthTags(descLen, descPx, 70, 160, SNIPPET.descIdealPx, SNIPPET.descMaxPx)}`],
      ["Canonical", `<span class="code">${esc(onpage.canonical) || "—"}</span>`],
      ["Robots meta", esc(onpage.robots) || "—"],
      ["Language", esc(onpage.lang) || "—"],
      ["Viewport", esc(onpage.viewport) || "—"]
    ])}
    <h3>Open Graph</h3>
    ${kvTable([
      ["og:title", esc(onpage.og?.title) || "—"],
      ["og:description", esc(onpage.og?.description) || "—"],
      ["og:type", esc(onpage.og?.type) || "—"],
      ["og:url", `<span class="code">${esc(onpage.og?.url) || "—"}</span>`],
      ["og:image", `<span class="code">${esc(onpage.og?.image) || "—"}</span>`],
      ["og:site_name", esc(onpage.og?.siteName) || "—"]
    ])}
    <h3>X (Twitter) card</h3>
    ${kvTable([
      ["twitter:card", esc(onpage.twitter?.card) || "—"],
      ["twitter:title", esc(onpage.twitter?.title) || "—"],
      ["twitter:description", esc(onpage.twitter?.description) || "—"],
      ["twitter:image", `<span class="code">${esc(onpage.twitter?.image) || "—"}</span>`],
      ["twitter:site", esc(onpage.twitter?.site) || "—"]
    ])}
  </section>

  <section id="headings">
    <h2>Headings (${fmtNum(headings.length)})</h2>
    <p class="muted">${[1, 2, 3, 4, 5, 6].map(l => `H${l}: ${headings.filter(h => h.level === l).length}`).join(" · ")}</p>
    ${h1Count !== 1 ? `<p>${tag(h1Count === 0 ? "No H1" : `${h1Count} H1s`, "warn")}</p>` : ""}
    <div>${headings.map(h => `<div class="h-row" style="margin-left:${(h.level - 1) * 16}px"><span class="h-level">H${h.level}</span>${esc(h.text)}</div>`).join("")}</div>
  </section>

  <section id="content">
    <h2>Content</h2>
    ${kvTable([
      ["Words on the page (incl. menus and footer)", fmtNum(onpage.wordCount || 0)],
      onpage.mainContentWordCount != null
        ? [`Main content (${onpage.mainContentSelector || "detected"})`,
           `${fmtNum(onpage.mainContentWordCount)} <span class="muted">(${Math.round(onpage.mainContentWordCount / Math.max(onpage.wordCount || 0, 1) * 100)}% of all words)</span>`]
        : ["Main content", "<em>not detected</em>"],
      ["Text to HTML ratio", `${onpage.textRatio ?? 0}%`]
    ])}
  </section>

  <section id="links">
    <h2>Links</h2>
    ${kvTable([
      ["Total", fmtNum(onpage.links?.total ?? 0)],
      ["Internal", fmtNum(onpage.links?.internal ?? 0)],
      ["External", fmtNum(onpage.links?.external ?? 0)],
      ["Nofollow", fmtNum(onpage.links?.nofollow ?? 0)],
      ["Empty href", fmtNum(onpage.links?.broken ?? 0)],
      ...(onpage.links?.byContext ? Object.entries(onpage.links.byContext).filter(([, v]) => v).map(([k, v]) => [`In ${k}`, fmtNum(v)]) : [])
    ])}
  </section>

  <section id="images">
    <h2>Content images</h2>
    ${(() => {
      const imgs = contentImages(onpage.images);
      if (!imgs.length) return "<p><em>No content images found (logos, icons and tracking pixels are left out).</em></p>";
      const missingAlt = imgs.filter(i => i.altMissing ?? !i.alt).length;
      const oversized = imgs.filter(i => i.oversized).length;
      const totalKb = (imgs.reduce((s, i) => s + (i.bytes || 0), 0) / 1024).toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      return `
        <p>${imgs.length} image${imgs.length === 1 ? "" : "s"} · ${tag(`${missingAlt} without alt`, missingAlt ? "warn" : "good")} ${tag(`${oversized} over the size limit`, oversized ? "warn" : "good")} <span class="muted">${totalKb} KB known</span></p>
        ${imgs.slice(0, 100).map(i => `
          <div class="img-row">
            <img src="${esc(i.src)}" alt="" loading="lazy">
            <div><span class="code">${esc(i.src)}</span><br>${(i.altMissing ?? !i.alt) ? "<em>no alt attribute</em>" : i.alt ? `alt: ${esc(i.alt)}` : "<span class=\"muted\">empty alt (decorative)</span>"}</div>
            <div class="code" style="text-align:right">${i.naturalWidth ? `${i.naturalWidth}×${i.naturalHeight}` : "?"}<br>${i.bytes ? `${(i.bytes / 1024).toFixed(1)} KB` : "—"}</div>
          </div>`).join("")}
        ${imgs.length > 100 ? `<p class="muted">First 100 of ${imgs.length} images.</p>` : ""}`;
    })()}
  </section>

  <section id="schema">
    <h2>Structured data (${(onpage.schema || []).length} block${(onpage.schema || []).length === 1 ? "" : "s"})</h2>
    ${(onpage.schema || []).length === 0
      ? "<p><em>No JSON-LD structured data found.</em></p>"
      : (onpage.schema || []).map((s, i) => `
          <h3>${esc(s.type || "Unknown")} <span class="muted">#${i + 1}</span></h3>
          <pre>${esc(JSON.stringify(s.raw ?? s, null, 2))}</pre>`).join("")}
  </section>

  ${hreflangTags.length ? (() => {
    const issues = validateHreflang(hreflangTags, withoutTracking(url));
    return `
  <section id="hreflang">
    <h2>Hreflang (${hreflangTags.length})</h2>
    ${issues.some(iss => iss.level !== "info") ? "" : `<p>${tag("All hreflang checks passed", "good")}</p>`}
    ${issues.map(iss => `<div class="issue">${tag(HREFLANG_LEVEL_WORD[iss.level], LEVEL_KIND[iss.level])} ${esc(iss.msg)}${iss.hint ? `<div class="hint">${esc(iss.hint)}</div>` : ""}</div>`).join("")}
    <table>
      <thead><tr><th>hreflang</th><th>URL</th></tr></thead>
      <tbody>${hreflangTags.map(h => `<tr><td class="lang">${esc(h.lang)}</td><td class="code">${esc(h.href)}</td></tr>`).join("")}</tbody>
    </table>
  </section>`;
  })() : ""}

  <section id="social">
    <h2>Social previews</h2>
    <div class="social">
      <div>
        <h3>Facebook and LinkedIn</h3>
        <div class="card">
          ${onpage.og?.image ? `<img src="${esc(onpage.og.image)}" alt="">` : ""}
          <div><span class="muted">${esc(hostname)}</span><br><strong>${esc(onpage.og?.title || onpage.title) || "<em>no title</em>"}</strong><br>${esc(onpage.og?.description || onpage.description) || "<em>no description</em>"}</div>
        </div>
      </div>
      <div>
        <h3>X (${esc(onpage.twitter?.card || "summary")})</h3>
        <div class="card">
          ${onpage.twitter?.image || onpage.og?.image ? `<img src="${esc(onpage.twitter?.image || onpage.og?.image)}" alt="">` : ""}
          <div><span class="muted">${esc(hostname)}</span><br><strong>${esc(onpage.twitter?.title || onpage.og?.title || onpage.title) || "<em>no title</em>"}</strong></div>
        </div>
      </div>
    </div>
  </section>

  ${geo ? `
  <section id="ai">
    <h2>AI search readiness: ${geo.score?.score ?? "—"}/100</h2>
    ${geo.aiAccess?.cloudflareManaged ? '<p class="hint">Cloudflare manages this robots.txt. Its AI Crawl Control may also block AI bots at the network level (HTTP 403), even ones allowed below.</p>' : ""}
    ${geo.robotsKnown === false ? '<p class="muted">robots.txt could not be read, so the bots below are unknown and the score leaves them out of account.</p>' : ""}
    <p class="muted">${esc(AI_SCORE_NOTE)}</p>
    <h3>AI crawler access (robots.txt)</h3>
    <div class="bots">
      ${(geo.aiAccess?.bots || []).map(b => `<div>${tag(...botStatus(b, geo.robotsKnown !== false))} <strong>${esc(b.ua)}</strong> <span class="muted">${esc(b.vendor)}, ${BOT_KIND_LABEL[b.kind] || b.kind}</span></div>`).join("")}
    </div>
    <h3>llms.txt</h3>
    <p>${geo.llmsTxt?.summary?.ok ? `${tag("found", "good")} /llms.txt${geo.llmsTxt.summary.size ? ` · ${(geo.llmsTxt.summary.size / 1024).toFixed(1)} KB` : ""}` : `${tag(...llmsStatus(geo.llmsTxt?.summary))} /llms.txt`}
      <span class="muted">Information only: Google says no special file is needed for AI features.</span></p>
    <h3>Trust signals (E-E-A-T)</h3>
    ${geoRows(geo.eeat, "missing")}
    <h3>Easy to quote</h3>
    ${geoRows(geo.citability, "low")}
  </section>` : ""}

  ${technical ? `
  <section id="technical">
    <h2>Technical</h2>
    ${kvTable([
      ["HTTP status", technical.status ? tag(String(technical.status), statusKind(technical.status)) : tag("not checked", "warn")],
      ["Final URL", `<span class="code">${esc(technical.finalUrl)}</span>`],
      ["Redirects", technical.redirected ? tag("this URL redirects", "warn") : "none"],
      ["X-Robots-Tag", esc(technical.headers?.["x-robots-tag"]) || "not set"]
    ])}
    <h3>Response headers</h3>
    ${kvTable(Object.entries(technical.headers || {}).map(([k, v]) => [k, `<span class="code">${esc(v)}</span>`]))}
    <h3>robots.txt</h3>
    ${kvTable([
      ["Status", technical.robotsTxt?.ok ? tag("found", "good") : tag(technical.robotsTxt?.status ? `HTTP ${technical.robotsTxt.status}` : "not reachable", "warn")],
      ...(technical.robotsTxt?.pathAllowed
        ? [["This URL for Googlebot", technical.robotsTxt.pathAllowed.allowed
            ? tag("allowed", "good")
            : `${tag("blocked", "bad")} <span class="code">${esc(technical.robotsTxt.pathAllowed.rule || "")}</span>`]]
        : []),
      ["Sitemaps declared", String((technical.robotsTxt?.sitemaps || []).length)]
    ])}
    ${(technical.robotsTxt?.sitemaps || []).length ? `<ul class="code">${technical.robotsTxt.sitemaps.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    <h3>Sitemap</h3>
    ${kvTable([
      [technical.sitemap?.url ? (() => { try { return new URL(technical.sitemap.url).pathname; } catch { return "/sitemap.xml"; } })() : "/sitemap.xml",
        technical.sitemap?.ok ? tag("valid", "good") : tag(technical.sitemap?.reason || "missing", technical.sitemap?.unchecked ? "neutral" : "warn")],
      ...(technical.sitemap?.urlCount != null ? [["URLs listed", `${fmtNum(technical.sitemap.urlCount)}${technical.sitemap.isIndex ? " (sitemap index)" : ""}${technical.sitemap.truncated ? " (first 5 MB only)" : ""}`]] : [])
    ])}
  </section>` : ""}

  <section id="offpage">
    <h2>Speed and keywords</h2>
    ${offpage?.psi || offpage?.psiError ? `
      <h3>PageSpeed Insights: mobile</h3>
      ${offpage.psiError ? `<p>${tag("error", "bad")} ${esc(offpage.psiError)}</p>` : psiTable(offpage.psi?.mobile)}
      <h3>PageSpeed Insights: desktop</h3>
      ${offpage.psiError ? "" : psiTable(offpage.psi?.desktop)}`
      : `<p class="muted">PageSpeed Insights was not run before this export.</p>`}
    ${offpage?.dfsError ? `<h3>DataForSEO</h3><p>${tag("error", "bad")} ${esc(offpage.dfsError)}</p>`
      : offpage?.dfs ? `
      <h3>DataForSEO: domain overview</h3>
      ${kvTable([
        ["Organic keywords (whole domain)", fmtNum(offpage.dfs.organicKeywords)],
        ["Estimated organic traffic", fmtNum(offpage.dfs.organicTraffic)],
        ["Market", `${esc(offpage.dfs.locationCode)} / ${esc(offpage.dfs.languageCode)}`]
      ])}
      <h3>Top keywords for this page</h3>
      ${(offpage.dfs.topKeywords || []).length === 0
        ? "<p><em>DataForSEO has no rankings for this exact URL in this market.</em></p>"
        : `<table><thead><tr><th>Keyword</th><th>Position</th><th>Volume</th><th>CPC</th></tr></thead><tbody>
            ${offpage.dfs.topKeywords.map(k => `<tr><td>${esc(k.keyword)}</td><td>${k.pos ? `#${k.pos}${k.isFeaturedSnippet ? " (featured snippet)" : ""}` : "—"}</td><td>${fmtNum(k.volume)}</td><td>${k.cpc != null ? "$" + Number(k.cpc).toFixed(2) : "—"}</td></tr>`).join("")}
          </tbody></table>`}`
      : `<p class="muted">No DataForSEO lookup was run before this export.</p>`}
  </section>

  <footer>Made with <a href="${esc(storeLink || REPO_URL)}">Needle</a>${version ? ` ${esc(version)}` : ""}, a free and open-source SEO audit extension · ${esc(dateText)}</footer>
</main>
</body>
</html>`;
}
