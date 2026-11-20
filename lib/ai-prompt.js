import { SEVERITY_LABEL } from "./findings.js";

/**
 * A ready-to-paste prompt for an AI assistant (ChatGPT, Claude, Gemini) with the
 * page's key data and Needle's findings, asking for a prioritised action plan.
 * @param {{onpage: Object, tech?: Object|null, findings: Array, now?: Date}} input
 * @returns {string}
 */
export function buildAiPrompt({ onpage: d, tech = null, findings, now = new Date() }) {
  const h1 = (d.headings || []).filter((h) => h.level === 1 && !h.hidden).map((h) => h.text).join(" | ") || "(none)";
  const outline = (d.headings || []).slice(0, 40).map((h) => `${"  ".repeat(h.level - 1)}H${h.level} ${h.text}`).join("\n");
  const types = [...new Set((d.schema || []).map((s) => s.type).filter(Boolean))].join(", ") || "(none)";
  const lines = [
    "You are an experienced SEO and content specialist. Below is an audit of one web page, made with the Needle browser extension.",
    "Give me a prioritised action plan. For each fix: what to change, why it matters, and the exact new text or code where you can.",
    `Write any new page text in the page's own language (${d.lang || "unknown"}). Don't invent facts about the business.`,
    "",
    "## Page",
    `- URL: ${d.url}`,
    `- Title: ${d.title || "(none)"}`,
    `- Meta description: ${d.description || "(none)"}`,
    `- H1: ${h1}`,
    `- Language: ${d.lang || "(not set)"}`,
    `- Words in the main content: ${d.mainContentWordCount ?? d.wordCount ?? 0}`,
    `- Structured data types: ${types}`,
    `- HTTP status: ${tech?.status || "not checked"}; canonical: ${d.canonical || "(none)"}; robots meta: ${d.robots || "(none)"}`,
    "",
    "## Heading outline",
    outline || "(no headings)",
    "",
    "## Problems found, most important first"
  ];
  if (!findings.length) lines.push("- No problems found by the automated checks.");
  findings.forEach((f) => {
    lines.push(`- [${SEVERITY_LABEL[f.severity]}] ${f.title}. ${f.why} Suggested fix: ${f.fix}`);
    (f.examples || []).slice(0, 5).forEach((x) => lines.push(`  - ${x}`));
  });
  lines.push("", `Audit date: ${now.toISOString().slice(0, 10)}. The data comes from the live page; counts are not rankings.`);
  return lines.join("\n");
}
