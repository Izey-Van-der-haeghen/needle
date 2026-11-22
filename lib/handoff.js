import { localDate } from "./popup-helpers.js";
import { computeIndexability } from "./popup-compute.js";
import { leftOutNote } from "./labels.js";
import { collectFindings, SEVERITY_LABEL } from "./findings.js";


/**
 * A Markdown list of a page's problems for a developer or writer, grouped by
 * priority, from the same findings the popup shows.
 * @param {Object} onpage - ANALYZE_ONPAGE result
 * @param {Object|null} tech - analyzeTechnical result
 * @param {{now?: Date, geo?: Object, rendered?: Object, imageRules?: Object, findings?: Array}} [opts]
 * @returns {string}
 */
export function buildIssuesMarkdown(onpage, tech, { now = new Date(), geo = null, rendered = null, imageRules, findings } = {}) {
  const list = findings || collectFindings({ onpage, tech, geo, rendered, imageRules });
  const verdict = computeIndexability(onpage, tech);
  const out = [
    `# SEO issues: ${onpage.title || onpage.url}`,
    "",
    `URL: ${onpage.url}`,
    `Checked: ${localDate(now)} with Needle`,
    `Indexability: ${verdict.verdict}`
  ];
  if (!list.length) out.push("", "No problems found.");
  if (list.leftOut?.length) out.push("", leftOutNote(list.leftOut.length));
  for (const sev of ["critical", "high", "medium", "low"]) {
    const group = list.filter((f) => f.severity === sev);
    if (!group.length) continue;
    out.push("", `## ${SEVERITY_LABEL[sev]}`);
    for (const f of group) {
      out.push(`- **${f.title}** (${f.area}). ${f.why} Fix: ${f.fix}`);
      (f.examples || []).slice(0, 10).forEach((x) => out.push(`  - ${x}`));
      if ((f.examples || []).length > 10) out.push(`  - …and ${f.examples.length - 10} more`);
    }
  }
  return out.join("\n");
}
