import { dfsPost } from "./offpage.js";
import { UserError } from "./errors.js";

/** Google Ads / DataForSEO location codes. */
export const LOCATIONS = [
  { code: 2036, name: "Australia" },
  { code: 2040, name: "Austria" },
  { code: 2056, name: "Belgium" },
  { code: 2076, name: "Brazil" },
  { code: 2124, name: "Canada" },
  { code: 2208, name: "Denmark" },
  { code: 2250, name: "France" },
  { code: 2276, name: "Germany" },
  { code: 2356, name: "India" },
  { code: 2372, name: "Ireland" },
  { code: 2380, name: "Italy" },
  { code: 2392, name: "Japan" },
  { code: 2484, name: "Mexico" },
  { code: 2528, name: "Netherlands" },
  { code: 2554, name: "New Zealand" },
  { code: 2578, name: "Norway" },
  { code: 2616, name: "Poland" },
  { code: 2620, name: "Portugal" },
  { code: 2724, name: "Spain" },
  { code: 2752, name: "Sweden" },
  { code: 2756, name: "Switzerland" },
  { code: 2826, name: "United Kingdom" },
  { code: 2840, name: "United States" }
];

export const LANGUAGES = [
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "no", name: "Norwegian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "es", name: "Spanish" },
  { code: "sv", name: "Swedish" }
];

/**
 * Google top-20 results for a keyword through DataForSEO (paid, about $0.004).
 * @param {{keyword: string, locationCode: number, languageCode: string, device: string}} params
 * @param {{dfsLogin?: string, dfsPassword?: string}} creds
 */
export async function fetchSerp({ keyword, locationCode, languageCode, device }, creds) {
  if (!creds?.dfsLogin || !creds?.dfsPassword) {
    throw new UserError("Add your DataForSEO login in Settings to search Google results.");
  }

  const auth = "Basic " + btoa(`${creds.dfsLogin}:${creds.dfsPassword}`);
  const task = await dfsPost("serp/google/organic/live/advanced", {
    keyword,
    location_code: locationCode,
    language_code: languageCode,
    device,
    depth: 20,
    calculate_rectangles: false
  }, auth);
  const result = task.result?.[0];
  if (!result) throw new UserError("DataForSEO returned no results for this search.");

  const items = result.items || [];
  const features = collectFeatures(items);
  // The featured snippet is an organic result shown in a box, so it counts as a ranking.
  const organic = items
    .filter(it => it.type === "organic" || it.type === "featured_snippet")
    .map(it => ({
      position: it.rank_group,
      isFeaturedSnippet: it.type === "featured_snippet",
      title: it.title || "",
      url: it.url || "",
      domain: it.domain || "",
      snippet: it.description || "",
      breadcrumb: it.breadcrumb || "",
      rating: it.rating ? { value: it.rating.value, count: it.rating.votes_count } : null,
      isAmp: !!it.amp_version,
      hasSitelinks: Array.isArray(it.links) && it.links.length > 0
    }));

  return {
    keyword,
    locationCode,
    languageCode,
    device,
    aiOverview: readAiOverview(items),
    seType: result.se_type,
    checkUrl: result.check_url,
    totalCount: result.items_count,
    cost: task.cost ?? null,
    features,
    organic
  };
}

/**
 * The AI Overview on the results page, if any, and the pages it cites.
 * DataForSEO puts references on the ai_overview item and on its elements.
 * AI Overviews that Google loads after the page may be missing.
 * @param {Array<Object>} items
 * @returns {{present: boolean, references: Array<{domain: string, url: string, title: string}>}}
 */
export function readAiOverview(items) {
  const ai = (items || []).filter(it => it.type === "ai_overview");
  const refs = [];
  const seen = new Set();
  const add = (r) => {
    const url = r?.url || "";
    if (!url || seen.has(url)) return;
    seen.add(url);
    let domain = r.domain || "";
    try { domain = domain || new URL(url).hostname; } catch {}
    refs.push({ domain, url, title: r.title || r.source || "" });
  };
  for (const it of ai) {
    (it.references || []).forEach(add);
    (it.items || []).forEach(el => (el.references || []).forEach(add));
  }
  return { present: ai.length > 0, references: refs };
}

function collectFeatures(items) {
  const features = {};
  items.forEach(it => {
    const t = it.type;
    if (!t || t === "organic") return;
    if (!features[t]) features[t] = { count: 0, items: [] };
    features[t].count++;
    if (features[t].items.length < 5) {
      features[t].items.push({
        title: it.title || it.text || it.subtitle || "",
        url: it.url || it.source_url || "",
        snippet: it.description || it.text || ""
      });
    }
  });
  return features;
}

/** Display names for SERP feature types. */
export const FEATURE_LABELS = {
  ai_overview: "AI Overview",
  featured_snippet: "Featured snippet",
  answer_box: "Answer box",
  people_also_ask: "People also ask",
  people_also_search: "People also search",
  local_pack: "Local pack",
  map: "Map",
  knowledge_graph: "Knowledge panel",
  images: "Images",
  video: "Videos",
  top_stories: "Top stories",
  shopping: "Shopping",
  popular_products: "Popular products",
  paid: "Ads",
  twitter: "X posts",
  related_searches: "Related searches",
  faq: "FAQ",
  jobs: "Jobs",
  discussions_and_forums: "Discussions and forums",
  perspectives: "Perspectives"
};
