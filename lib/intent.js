const INTENT_KEYWORDS = {
  informational: [
    "what", "wat", "qu'est-ce", "was ist",
    "how", "hoe", "comment", "wie",
    "why", "waarom", "pourquoi", "warum",
    "when", "wanneer", "quand", "wann",
    "where", "waar", "où", "wo",
    "who", "wie", "qui", "wer",
    "guide", "gids",
    "tutorial",
    "uitleg", "explication",
    "betekenis", "meaning",
    "definition", "definitie",
    "ideeën", "ideas",
    "tips", "advies",
    "voorbeeld", "example", "exemple", "beispiel"
  ],
  commercial: [
    "best", "beste", "meilleur",
    "top", "rangschikking", "ranking",
    "vs", "versus", "vergelijking", "vergelijken", "compare", "comparison",
    "review", "recensie", "avis", "rezension",
    "alternative", "alternatief", "alternatieven",
    "vs.", "of", "or",
    "rated", "rating",
    "test", "testen",
    "comparatif", "ervaringen"
  ],
  transactional: [
    "buy", "kopen", "acheter", "kaufen",
    "price", "prijs", "kost", "kosten", "cost", "tarief", "tarif",
    "deal", "korting", "discount", "promo", "promotie", "promotion",
    "near me", "bij mij", "in de buurt",
    "offerte", "quote", "devis", "angebot",
    "bestellen", "order",
    "service", "diensten",
    "huren", "rent",
    "installateur", "vakman", "specialist",
    "goedkoop", "cheap", "betaalbaar", "affordable",
    "prix", "pas cher"
  ],
  navigational: [
    "login", "inloggen", "connexion",
    "dashboard",
    "account", "mijn",
    "contact",
    "support", "ondersteuning",
    "homepage"
  ]
};

const wordCache = new Map();
function wordRegex(w) {
  if (!wordCache.has(w)) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    wordCache.set(w, new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u"));
  }
  return wordCache.get(w);
}

const INTENT_LABELS = {
  informational: { label: "Informational", description: "The searcher wants to learn something" },
  commercial: { label: "Commercial investigation", description: "The searcher is comparing options before buying" },
  transactional: { label: "Transactional", description: "The searcher is ready to buy, book or sign up" },
  navigational: { label: "Navigational", description: "The searcher is looking for a specific site or page" },
  mixed: { label: "Mixed intent", description: "Several intents fit this search" }
};

/**
 * @typedef {Object} IntentResult
 * @property {"informational"|"commercial"|"transactional"|"navigational"|"mixed"} intent
 * @property {"high"|"medium"|"low"} confidence
 * @property {Record<string, number>} scores
 * @property {string} label - human-readable label
 * @property {string} description
 */

/**
 * Classify search intent from keyword + (optional) SERP top results.
 * Heuristics for search terms in English, Dutch, French and German.
 * @param {string} keyword
 * @param {Array<{url: string, title: string, snippet: string}>} [serpResults]
 * @returns {IntentResult|null}
 */
export function classifyIntent(keyword, serpResults = []) {
  if (!keyword) return null;
  const kw = keyword.toLowerCase();
  const scores = { informational: 0, commercial: 0, transactional: 0, navigational: 0 };

  for (const [intent, words] of Object.entries(INTENT_KEYWORDS)) {
    for (const w of words) {
      // Whole words and phrases only ("of" must not match "offer").
      if (wordRegex(w).test(kw)) {
        scores[intent] += w.length >= 4 ? 2 : 1;
      }
    }
  }

  if (serpResults && serpResults.length) {
    serpResults.slice(0, 10).forEach(r => {
      const url = (r.url || "").toLowerCase();
      const title = (r.title || "").toLowerCase();
      const snippet = (r.snippet || "").toLowerCase();
      const combined = `${url} ${title} ${snippet}`;

      if (/\b(price|prijs|kosten|buy|kopen|offerte|quote|prix|devis|tarif)\b/.test(combined) || /\/product|\/shop|\/koop/.test(url)) {
        scores.transactional += 0.5;
      }
      if (/\b(best|beste|top|review|vs|versus|vergelijking)\b/.test(combined)) {
        scores.commercial += 0.5;
      }
      if (/\b(guide|how|tutorial|what|hoe|wat|gids)\b/.test(combined) || /\/blog|\/article|\/wiki/.test(url)) {
        scores.informational += 0.5;
      }
    });
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topIntent, topScore] = sorted[0];
  const [, secondScore] = sorted[1] || ["", 0];

  if (topScore === 0) return { intent: "informational", confidence: "low", scores, ...INTENT_LABELS.informational };
  const confidence = topScore >= 3 && (topScore - secondScore) >= 1 ? "high"
    : (topScore - secondScore) >= 0.5 ? "medium"
    : "low";
  if (confidence === "low" && topScore <= secondScore + 0.5) {
    return { intent: "mixed", confidence, scores, ...INTENT_LABELS.mixed };
  }

  return { intent: topIntent, confidence, scores, ...INTENT_LABELS[topIntent] };
}
