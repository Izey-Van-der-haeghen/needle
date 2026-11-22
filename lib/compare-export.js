import { localDate } from "./popup-helpers.js";
/**
 * Compare-tab export helpers — turn the matrix you see in the UI into CSV/MD
 * formats suitable for sharing with colleagues, dropping in tickets, or
 * pasting into an LLM prompt for "give me a competitive analysis".
 *
 * Both formats follow the same row layout as the on-screen matrix:
 *   - Each source is a column (You + competitors)
 *   - Each metric is a row
 *   - Schema coverage is a sub-table with one row per schema @type
 */

const SOURCES_HEADER = (sources) =>
  sources.map((s) => {
    const name = s.isMe ? "You" : (s.label || "Competitor");
    const u = s.data?.url || "";
    return u ? `${name} (${u})` : name;
  });

function safeStr(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(" | ");
  return String(v);
}

function csvCell(v) {
  let s = safeStr(v);
  // A cell starting with = + - @ runs as a formula in spreadsheets: competitor titles
  // and H1s are third-party text, so neutralise it with a leading apostrophe.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  // RFC 4180: quote if it contains either separator (, or ;), a quote or a newline,
  // or starts/ends with whitespace.
  if (/[",;\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function mdCell(v) {
  // Pipes and newlines break Markdown tables; < would start raw HTML in some viewers.
  return safeStr(v).replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/\r?\n/g, " ");
}

/**
 * Pull rows in the same order the popup shows them.
 * Returns an array of { metric, values: string[] } records — one per row.
 */
function buildRows(sources, serpData, keyword) {
  const rows = [];

  if (keyword && serpData && !serpData.error) {
    rows.push({
      metric: `SERP position for "${keyword}"`,
      values: sources.map((s) =>
        s.serpPosition != null ? `#${s.serpPosition}` : "not in top 20"
      ),
    });
  }

  // --- Meta ---
  rows.push({ metric: "Title", values: sources.map((s) => s.data?.title) });
  rows.push({
    metric: "Title length (chars)",
    values: sources.map((s) => (s.data?.title || "").length),
  });
  rows.push({ metric: "Description", values: sources.map((s) => s.data?.description) });
  rows.push({
    metric: "Description length (chars)",
    values: sources.map((s) => (s.data?.description || "").length),
  });
  rows.push({ metric: "Canonical", values: sources.map((s) => s.data?.canonical) });
  rows.push({ metric: "Robots meta", values: sources.map((s) => s.data?.robots) });
  rows.push({ metric: "Lang", values: sources.map((s) => s.data?.lang) });

  // --- Headings ---
  rows.push({
    metric: "H1(s)",
    values: sources.map((s) =>
      Array.isArray(s.data?.h1s) ? s.data.h1s.join(" | ") : s.data?.h1s
    ),
  });
  rows.push({ metric: "H1 count", values: sources.map((s) => s.data?.h1Count) });
  rows.push({ metric: "H2 count", values: sources.map((s) => s.data?.h2Count) });
  rows.push({ metric: "H3 count", values: sources.map((s) => s.data?.h3Count) });

  // --- Content / links ---
  rows.push({ metric: "Word count", values: sources.map((s) => s.data?.wordCount) });
  rows.push({ metric: "Links", values: sources.map((s) => s.data?.links) });
  rows.push({ metric: "Images", values: sources.map((s) => s.data?.images) });
  rows.push({
    metric: "Images without alt",
    values: sources.map((s) => s.data?.imagesWithoutAlt),
  });

  return rows;
}

function collectSchemaTypes(sources) {
  const all = new Set();
  sources.forEach((s) => {
    (s.data?.schemaTypes || []).forEach((t) => {
      all.add(Array.isArray(t) ? t.join(",") : String(t));
    });
  });
  return [...all].sort();
}

/**
 * @param {Array} sources
 * @param {Object|null} serpData
 * @param {string} keyword
 * @param {{forExcel?: boolean, separator?: "," | ";"}} [opts]
 *   forExcel: the downloaded file gets a UTF-8 BOM so Excel reads accents correctly.
 *   separator ";": Excel with European regional settings splits a double-clicked
 *   .csv on semicolons. The clipboard copy stays plain comma-separated RFC 4180.
 */
export function buildCompareCsv(sources, serpData, keyword, { forExcel = false, separator = "," } = {}) {
  const sep = separator === ";" ? ";" : ",";
  const cols = ["Metric", ...SOURCES_HEADER(sources)];
  const rows = buildRows(sources, serpData, keyword);

  const lines = [cols.map(csvCell).join(sep)];
  rows.forEach((r) => {
    lines.push([csvCell(r.metric), ...r.values.map(csvCell)].join(sep));
  });

  const schemaTypes = collectSchemaTypes(sources);
  if (schemaTypes.length) {
    lines.push(""); // blank separator row
    lines.push(["Schema @type", ...SOURCES_HEADER(sources)].map(csvCell).join(sep));
    schemaTypes.forEach((type) => {
      const presence = sources.map((s) => {
        const has = (s.data?.schemaTypes || []).some((t) => {
          const norm = Array.isArray(t) ? t.join(",") : String(t);
          return norm === type;
        });
        return has ? "Yes" : "No";
      });
      lines.push([csvCell(type), ...presence.map(csvCell)].join(sep));
    });
  }

  return (forExcel ? "\uFEFF" : "") + lines.join("\r\n");
}

export function buildCompareMd(sources, serpData, keyword) {
  const cols = ["Metric", ...SOURCES_HEADER(sources)];
  const rows = buildRows(sources, serpData, keyword);
  const out = [];

  const title = keyword
    ? `# Compare — keyword "${keyword}"`
    : `# Compare — ${sources.find((s) => s.isMe)?.data?.url || "audit"}`;
  out.push(title);
  out.push(`Made with Needle · ${localDate()}`);
  out.push("");

  out.push(`| ${cols.map(mdCell).join(" | ")} |`);
  out.push(`| ${cols.map(() => "---").join(" | ")} |`);
  rows.forEach((r) => {
    out.push(`| ${[r.metric, ...r.values].map(mdCell).join(" | ")} |`);
  });

  const schemaTypes = collectSchemaTypes(sources);
  if (schemaTypes.length) {
    out.push("");
    out.push("## Schema coverage");
    out.push("");
    const schemaCols = ["@type", ...SOURCES_HEADER(sources)];
    out.push(`| ${schemaCols.map(mdCell).join(" | ")} |`);
    out.push(`| ${schemaCols.map(() => "---").join(" | ")} |`);
    schemaTypes.forEach((type) => {
      const presence = sources.map((s) => {
        const has = (s.data?.schemaTypes || []).some((t) => {
          const norm = Array.isArray(t) ? t.join(",") : String(t);
          return norm === type;
        });
        return has ? "✓" : "—";
      });
      out.push(`| ${[type, ...presence].map(mdCell).join(" | ")} |`);
    });
  }

  return out.join("\n");
}

/**
 * Suggested filename for downloads. Avoids slashes and forces .csv/.md ext.
 */
export function compareExportFilename(sources, keyword, ext) {
  const me = sources.find((s) => s.isMe);
  const host = (() => {
    try {
      return me?.data?.url ? new URL(me.data.url).hostname.replace(/^www\./, "") : "";
    } catch {
      return "";
    }
  })();
  const date = localDate();
  // vélo → velo: accents go before the rest becomes dashes.
  const kw = keyword ? `-${keyword.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 30)}` : "";
  const base = host ? `compare-${host}${kw}` : `compare${kw}`;
  return `${base}-${date}.${ext}`;
}
