const REQUIRED_BY_TYPE = {
  // A nested array means Google needs any one of those properties; "a.b" is property b inside a.
  Article: [],
  NewsArticle: [],
  BlogPosting: [],
  Product: ["name", ["offers", "review", "aggregateRating"]],
  // Product snippets accept the price on the Offer or in its priceSpecification.
  // The currency is checked in WARN_BY_TYPE: recommended for snippets, required for merchant listings.
  Offer: [["price", "priceSpecification.price"]],
  BreadcrumbList: ["itemListElement"],
  Organization: [],
  LocalBusiness: ["name", "address"],
  Person: ["name"],
  // FAQPage, HowTo and SearchAction are in NO_RICH_RESULT: what's missing there is a note.
  FAQPage: ["mainEntity"],
  // An FAQ answer is an accepted answer; a Q&A thread may have only suggested ones.
  // Required only inside a QAPage, see richResultGone.
  Question: ["name", ["acceptedAnswer", "suggestedAnswer"]],
  HowTo: ["name", "step"],
  Recipe: ["name", "image"],
  Event: ["name", "startDate", "location"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
  Review: ["itemReviewed", "reviewRating", "author"],
  AggregateRating: ["ratingValue", ["ratingCount", "reviewCount"]],
  WebPage: [],
  // Site names: Google needs both, on the site's home page.
  WebSite: ["name", "url"],
  // Image metadata names the file in contentUrl; url is the older form.
  ImageObject: [["contentUrl", "url"]],
  Service: [],
  // A fully remote job may give applicantLocationRequirements instead of jobLocation.
  JobPosting: ["title", "description", "datePosted", "hiringOrganization", ["jobLocation", "applicantLocationRequirements"]],
  // The Course list (carousel) still needs these. The single-course result was retired in 2025.
  Course: ["name", "description"],
  // shortcut: checks offers is present, not offers.price; upgrade if nested checks are added.
  // Ratings are a condition for the rich result, not for valid markup: see RATING_FOR_RICH_RESULT.
  SoftwareApplication: ["name", "offers"],
  WebApplication: ["name", "offers"],
  Place: ["name"],
  Restaurant: ["name", "address"],
  Hotel: ["name", "address"],
  Store: ["name", "address"],
  TouristAttraction: ["name"],
  ProfilePage: ["mainEntity"],
  CollectionPage: [],
  SearchAction: ["target"],
  // Google and schema.org require nothing on these; see RECOMMENDED_BY_TYPE.
  ContactPoint: [],
  PostalAddress: [],
  ListItem: ["position"],
  ItemList: ["itemListElement"],
  ReadAction: [],
  SearchResultsPage: [],
  AboutPage: [],
  ContactPage: [],
  ItemPage: [],
  MediaObject: [],
  Brand: [],
  SiteNavigationElement: []
};

/**
 * Rich results Google no longer shows. Their missing properties are notes, never errors:
 * FAQ (gone from Search on 7 May 2026), How-to (13 September 2023) and the sitelinks
 * search box, which is WebSite's SearchAction (November 2024).
 */
const NO_RICH_RESULT = new Set(["FAQPage", "HowTo", "SearchAction"]);

/** Strip a schema.org prefix: "https://schema.org/WebSite" and "schema:WebSite" are WebSite. */
export function bareType(t) {
  return String(t ?? "").trim().replace(/^(?:https?:\/\/(?:www\.)?schema\.org\/|schema:)/i, "");
}

/**
 * Organization and its common subtypes.
 * shortcut: partial subtype list, add types when a page needs them.
 */
const ORG_TYPES = new Set([
  "Organization", "Corporation", "OnlineBusiness", "OnlineStore", "NGO", "EducationalOrganization",
  "LocalBusiness", "HomeAndConstructionBusiness", "RoofingContractor", "Electrician", "Plumber",
  "HVACBusiness", "GeneralContractor", "HousePainter", "Locksmith", "MovingCompany",
  "ProfessionalService", "FinancialService", "LegalService", "Attorney", "Dentist", "Physician",
  "MedicalBusiness", "Store", "BikeStore", "BookStore", "ClothingStore", "ElectronicsStore", "FurnitureStore", "GroceryStore", "HardwareStore", "HomeGoodsStore", "PetStore", "SportingGoodsStore", "AutoDealer", "AutoRepair", "Restaurant", "FoodEstablishment", "CafeOrCoffeeShop",
  "Bakery", "BarOrPub", "Hotel", "LodgingBusiness", "RealEstateAgent", "TravelAgency", "SportsActivityLocation",
  "HealthAndBeautyBusiness", "EntertainmentBusiness", "NewsMediaOrganization", "SportsOrganization"
]);

/**
 * Is a schema.org type an organisation (Organization, LocalBusiness or a subtype)?
 * @param {string} t
 * @returns {boolean}
 */
export function isOrgType(t) {
  return ORG_TYPES.has(bareType(t));
}

// The properties Google's Article documentation recommends (it requires none).
const RECOMMENDED_BY_TYPE = {
  Article: ["headline", "author", "datePublished", "image", "dateModified"],
  NewsArticle: ["headline", "author", "datePublished", "image", "dateModified"],
  BlogPosting: ["headline", "author", "datePublished", "image", "dateModified"],
  Product: ["image", "description", "brand", "offers", "aggregateRating", "review"],
  Offer: ["availability"],
  LocalBusiness: ["telephone", "openingHours", "geo", "url", "priceRange"],
  Organization: ["name", "logo", "url", "sameAs"],
  Event: ["endDate", "description", "image", "offers"],
  Recipe: ["recipeIngredient", "recipeInstructions", "nutrition", "totalTime"],
  VideoObject: ["description", "duration", "contentUrl"],
  Service: ["provider", "description", "areaServed", "serviceType"],
  JobPosting: ["baseSalary", "employmentType", "validThrough"],
  Course: ["provider", "url", "image"],
  SoftwareApplication: ["applicationCategory", "operatingSystem"],
  WebApplication: ["applicationCategory", "operatingSystem"],
  Restaurant: ["servesCuisine", "priceRange", "openingHours", "telephone"],
  Hotel: ["starRating", "amenityFeature", "priceRange"],
  // Recommended in Google's Organization and Product documentation, "if applicable".
  ContactPoint: [["telephone", "email"]],
  PostalAddress: ["streetAddress", "addressLocality", "addressCountry"],
  Brand: ["name"]
};

// Missing these is a warning: the markup is valid, but some Google features need them.
const WARN_BY_TYPE = {
  Offer: [{ props: ["priceCurrency", "priceSpecification.priceCurrency"], why: "Google recommends it for product snippets and requires it for merchant listings" }]
};

/**
 * @typedef {Object} SchemaIssue
 * @property {"error"|"warn"|"info"|"note"} level - note: information only, never something to add
 * @property {string} msg
 */

/**
 * @typedef {Object} ValidatedSchemaItem
 * @property {string} type - schema type label (may be comma-joined for @type arrays)
 * @property {Object} raw - the original parsed JSON-LD object
 * @property {string[]} types - normalized @type array
 * @property {SchemaIssue[]} issues
 */

// Google shows the software rich result only for apps with ratings or reviews. Without them the
// markup is still valid, so this is a note, never an error: telling people to add ratings they
// don't have would push them toward fake reviews.
const RATING_FOR_RICH_RESULT = new Set(["SoftwareApplication", "WebApplication", "MobileApplication"]);

/**
 * Why a type's missing properties no longer cost a Google rich result, or null when they do.
 * A Question gives a Q&A result only as the mainEntity of a QAPage; under an FAQPage it is part of the retired FAQ result.
 */
function richResultGone(type, parentTypes) {
  if (NO_RICH_RESULT.has(type)) return "Google no longer shows this rich result.";
  if (type === "Question") {
    if (parentTypes.includes("FAQPage")) return "Google no longer shows FAQ rich results.";
    if (!parentTypes.includes("QAPage")) return "Google uses a Question for Q&A results only inside a QAPage.";
  }
  return null;
}

/** Required, rich-result and recommended checks for one typed node; `where` prefixes the messages. */
function checkNode(obj, issues, where = "", parentTypes = []) {
  const missing = (anyOf) => !anyOf.some(p => hasProp(obj, p));
  const names = (anyOf) => anyOf.map(p => `"${p}"`).join(" or ");
  normalizeTypes(obj).forEach(type => {
    const label = `${where}${type}`;
    const gone = richResultGone(type, parentTypes);
    (REQUIRED_BY_TYPE[type] || []).forEach(prop => {
      const anyOf = [].concat(prop); // a nested array means Google needs any one of these
      if (!missing(anyOf)) return;
      issues.push(gone
        ? { level: "note", msg: `${label}: missing ${names(anyOf)}. ${gone}` }
        : { level: "error", msg: `${label}: missing required ${names(anyOf)}` });
    });
    (WARN_BY_TYPE[type] || []).forEach(({ props, why }) => {
      if (missing(props)) issues.push({ level: "warn", msg: `${label}: missing ${names(props)}. ${why}.` });
    });
    if (RATING_FOR_RICH_RESULT.has(type) && !hasProp(obj, "aggregateRating") && !hasProp(obj, "review")) {
      issues.push({ level: "note", msg: `${label}: no star-rating rich result without real ratings or reviews ("aggregateRating" or "review"). Fine without them; never add made-up ones.` });
    }
    (RECOMMENDED_BY_TYPE[type] || []).forEach(prop => {
      const anyOf = [].concat(prop);
      if (missing(anyOf)) issues.push({ level: "info", msg: `${label}: missing recommended ${names(anyOf)}` });
    });
  });
}

/**
 * The page's main thing is often nested: WebPage → mainEntity → SoftwareApplication.
 * Google reads it there too, so it gets the same checks as a top-level block.
 */
function* mainEntities(obj, depth = 0, prefix = "") {
  if (depth > 3) return;
  const list = [].concat(obj?.mainEntity || []);
  const parentTypes = normalizeTypes(obj);
  for (const [i, e] of list.entries()) {
    if (e && typeof e === "object" && normalizeTypes(e).length) {
      const where = `${prefix}${entityLabel(e, i, list.length)} › `;
      yield { node: e, where, parentTypes };
      yield* mainEntities(e, depth + 1, where);
    }
  }
}

/** "mainEntity", or "mainEntity 3 "Why is…"" when there are several, so each message says which one. */
function entityLabel(e, i, count) {
  if (count < 2) return "mainEntity";
  const name = typeof e.name === "string" ? e.name.trim() : "";
  return `mainEntity ${i + 1}${name ? ` "${name.length > 40 ? `${name.slice(0, 40)}…` : name}"` : ""}`;
}

/**
 * Validate JSON-LD blocks against per-type required and recommended properties,
 * including the block's mainEntity.
 * @param {Array<{type: string, raw: Object}>} items - extracted schema blocks
 * @returns {ValidatedSchemaItem[]}
 */
export function validateSchema(items) {
  return items.map(item => {
    const issues = [];
    const types = normalizeTypes(item.raw);
    const obj = item.raw || {};

    if (!obj["@context"]) {
      issues.push({ level: "error", msg: "Missing @context" });
    } else if (typeof obj["@context"] === "string" && !/schema\.org/.test(obj["@context"])) {
      issues.push({ level: "warn", msg: `@context is "${obj["@context"]}", expected schema.org` });
    }

    if (!types.length) {
      issues.push({ level: "error", msg: "Missing @type" });
    }

    checkNode(obj, issues);
    for (const { node, where, parentTypes } of mainEntities(obj)) checkNode(node, issues, where, parentTypes);
    // An FAQ answer is an accepted answer; only a Q&A page may have suggested ones only.
    // (A question with no answer at all is already reported by the Question rule.)
    if (types.includes("FAQPage")) {
      const questions = [].concat(obj.mainEntity || []);
      for (const [i, q] of questions.entries()) {
        if (normalizeTypes(q).includes("Question") && !hasProp(q, "acceptedAnswer") && hasProp(q, "suggestedAnswer")) {
          issues.push({ level: "note", msg: `${entityLabel(q, i, questions.length)} › Question: missing "acceptedAnswer" (an FAQ answer). ${richResultGone("Question", types)}` });
        }
      }
    }

    return { ...item, issues, types };
  });
}

/**
 * @typedef {Object} FaqDuplicate
 * @property {string} question - original (un-normalized) question text
 * @property {number} count - how many times it appears across all FAQPage(s) on the page
 * @property {number[]} schemaIndexes - which schema block indexes contain this question
 */

/**
 * Detect duplicate FAQ questions within and across FAQPage schema blocks on a page.
 * Repeated questions are usually a template or plugin mistake worth cleaning up.
 *
 * Comparison is case-insensitive and trimmed.
 *
 * @param {Array<{type: string, raw: Object}>} items - extracted schema blocks
 * @returns {FaqDuplicate[]}
 */
export function detectFaqDuplicates(items) {
  /** @type {{text: string, originalName: string, schemaIdx: number}[]} */
  const questions = [];

  items.forEach((item, schemaIdx) => {
    const obj = item.raw || {};
    if (!normalizeTypes(obj).includes("FAQPage")) return;
    const entries = Array.isArray(obj.mainEntity)
      ? obj.mainEntity
      : (obj.mainEntity ? [obj.mainEntity] : []);
    entries.forEach(q => {
      const original = (q?.name || "").trim();
      const norm = original.toLowerCase().replace(/\s+/g, " ");
      if (!norm) return;
      questions.push({ text: norm, originalName: original, schemaIdx });
    });
  });

  /** @type {Record<string, typeof questions>} */
  const grouped = {};
  questions.forEach(q => {
    (grouped[q.text] = grouped[q.text] || []).push(q);
  });

  return Object.values(grouped)
    .filter(refs => refs.length > 1)
    .map(refs => ({
      question: refs[0].originalName,
      count: refs.length,
      schemaIndexes: [...new Set(refs.map(r => r.schemaIdx))]
    }));
}

/**
 * Recursively walk all schema objects and collect every @type value found,
 * including nested ones (e.g. PostalAddress inside Organization.address).
 * @param {Array<{type: string, raw: Object}>} items
 * @returns {string[]} sorted unique list of @type values
 */
// SCHEMA DETECTION COVERAGE (definitive reference)
// ------------------------------------------------------------------
// Sources scanned (all three combined into the "detected types" set):
//   1. JSON-LD <script type="application/ld+json"> blocks
//      - Top-level object
//      - @graph arrays
//      - Recursive walk through every nested property (so PostalAddress
//        inside Organization.address surfaces, ImageObject inside
//        Article.image surfaces, etc.) — handled by collectAllSchemaTypes
//   2. Microdata: any element with [itemtype]
//      - URL is stripped to bare name ("https://schema.org/Foo" → "Foo")
//      - Nested itemscopes ALL counted (querySelectorAll walks the whole tree)
//   3. RDFa: any element with [typeof] (space-separated, "schema:" prefix stripped)
//
// Content script emits:
//   - schema:          parsed JSON-LD objects (recursive types via collectAllSchemaTypes)
//   - microdataTypes:  flat array of types found via itemtype/typeof
//
// The suggester (suggestMissingSchemas) considers the UNION of JSON-LD types
// (recursively) AND microdata types. So a page that only declares
// BreadcrumbList in microdata does NOT get a duplicate "missing" suggestion.
// ------------------------------------------------------------------

export function collectAllSchemaTypes(items) {
  const found = new Set();
  function walk(obj) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    normalizeTypes(obj).forEach(t => found.add(t));
    for (const k in obj) {
      if (k === "@type" || k === "@context") continue;
      walk(obj[k]);
    }
  }
  items.forEach(item => walk(item.raw));
  return [...found].sort();
}

/**
 * @typedef {Object} SchemaSuggestion
 * @property {string} type - schema type to add
 * @property {"high"|"medium"|"low"} priority
 * @property {string} reason - why it should be added
 */

/**
 * Suggest schema types that should be added based on signals detected on the page.
 * @param {Object} onpage - on-page data with `schema` and `schemaSignals`
 * @returns {SchemaSuggestion[]}
 */
export function suggestMissingSchemas(onpage) {
  if (!onpage) return [];
  const existing = new Set([
    ...collectAllSchemaTypes(onpage.schema || []),
    ...(onpage.microdataTypes || [])
  ]);
  const has = (...types) => types.some(t => existing.has(t));
  const s = onpage.schemaSignals || {};
  const out = [];

  // Google reads site names only from the home page of a domain or subdomain ("/"), not from a
  // language folder such as /en/: it doesn't support site names below the domain level.
  if (isSiteRoot(onpage.url) && !has("WebSite")) {
    out.push({
      type: "WebSite",
      priority: "high",
      reason: "Home page of the site. Add WebSite schema (name, url) here so Google can show your site name in results."
    });
  }

  // A personal site is run by a Person; either entity tells search engines who is behind it.
  if (s.isHomepage && ![...existing].some(isOrgType) && !existing.has("Person")) {
    out.push({
      type: "Organization or Person",
      priority: "high",
      reason: "Homepage that doesn't say who runs the site. Add Organization (name, url, logo, sameAs), or Person (name, url, sameAs) for a personal site, so search engines and AI answers can identify you."
    });
  }

  if (s.hasBreadcrumb && !has("BreadcrumbList")) {
    out.push({
      type: "BreadcrumbList",
      priority: "high",
      reason: "Breadcrumb navigation visible on page but no BreadcrumbList schema. Add it for the breadcrumb trail in Google's desktop results."
    });
  }

  // A CV or team page often uses <article> and <time>, but its type is ProfilePage (or AboutPage), not Article.
  // A blog archive, news overview or search page shows <article> cards with dates: it lists articles, it isn't one.
  if (s.hasArticleTag && (s.hasPublishDate || s.hasAuthorByline) && !has("Article", "BlogPosting", "NewsArticle", "ProfilePage", "AboutPage", "ContactPage",
    "CollectionPage", "ItemList", "SearchResultsPage")) {
    out.push({
      type: "Article",
      priority: "high",
      reason: "<article> with author/date detected. Add Article (or BlogPosting/NewsArticle) schema with headline, author, datePublished, image."
    });
  }


  // Google indexes a video only on a watch page, whose main purpose is that one video.
  // content.js leaves out background videos (autoplay and muted, or looping, without controls).
  if (s.hasVideoEmbed && !has("VideoObject")) {
    out.push({
      type: "VideoObject",
      priority: "medium",
      reason: "Video on the page. If the video is the page's main content, add VideoObject (name, thumbnailUrl, uploadDate, contentUrl) so Google can show it as a video result."
    });
  }

  if (s.hasAddress && s.hasPhone && ![...existing].some(isOrgType)) {
    out.push({
      type: "LocalBusiness",
      priority: "medium",
      reason: "Address + phone detected. Add LocalBusiness (name, address, telephone, openingHours, geo) for Google Maps + local pack visibility."
    });
  }

  if (s.hasOpeningHours && has("LocalBusiness") && !openingHoursDeclared(onpage.schema)) {
    out.push({
      type: "LocalBusiness.openingHours",
      priority: "low",
      reason: "Opening hours mentioned in content but missing openingHours field in your LocalBusiness schema."
    });
  }

  if (s.hasRating && !has("Review", "AggregateRating")) {
    out.push({
      type: "AggregateRating",
      priority: "medium",
      reason: "Star rating pattern detected. Add AggregateRating to the Product, or to the business being reviewed, for star snippets. Not eligible when a business marks up ratings about itself (Google's self-serving review rule)."
    });
  }

  if (s.ingredientHints && !has("Recipe")) {
    out.push({
      type: "Recipe",
      priority: "medium",
      reason: "Recipe-style ingredient list detected. Add Recipe (name, recipeIngredient, recipeInstructions, image) for recipe rich results."
    });
  }

  // No JobPosting suggestion: Google allows that markup only on a page with a single job posting,
  // never on a job list or careers page, and may take manual action. Page text can't tell those apart.

  return out;
}

/** Is this the home page of a domain or subdomain (path "/")? */
function isSiteRoot(url) {
  try { return new URL(url).pathname === "/"; } catch { return false; }
}

function openingHoursDeclared(items) {
  return (items || []).some(item => {
    const obj = item?.raw;
    if (!obj) return false;
    return obj.openingHours || obj.openingHoursSpecification;
  });
}

/** A node's @type values without a schema.org prefix ("https://schema.org/Product" is Product). */
function normalizeTypes(obj) {
  if (!obj || typeof obj !== "object") return [];
  const t = obj["@type"];
  if (!t) return [];
  return [].concat(t).filter(x => typeof x === "string").map(bareType).filter(Boolean);
}

/**
 * The nodes of one parsed JSON-LD block. JSON-LD allows a top-level array, "@graph" as an array
 * or as one node, and an array of such documents; a node keeps the @context of the document
 * around it. null, {} and other non-objects hold no structured data, so they give no node.
 * content.js keeps a copy (an injected script can't import): change both together.
 * @param {*} parsed - what JSON.parse returned
 * @param {*} [context] - the @context of the enclosing document
 * @returns {Object[]}
 */
export function flattenJsonLd(parsed, context) {
  if (Array.isArray(parsed)) return parsed.flatMap((p) => flattenJsonLd(p, context));
  if (!parsed || typeof parsed !== "object" || !Object.keys(parsed).length) return [];
  if (parsed["@graph"] !== undefined) return flattenJsonLd([].concat(parsed["@graph"]), parsed["@context"] ?? context);
  return [context && !parsed["@context"] ? { "@context": context, ...parsed } : parsed];
}

/** Is the property there and not empty? "a.b" means b inside a (or inside any item of a). */
function hasProp(obj, prop) {
  if (!obj || typeof obj !== "object") return false;
  const dot = prop.indexOf(".");
  if (dot > 0) return [].concat(obj[prop.slice(0, dot)] ?? []).some(v => hasProp(v, prop.slice(dot + 1)));
  const v = obj[prop];
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}
