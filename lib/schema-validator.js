const REQUIRED_BY_TYPE = {
  // A nested array means Google needs any one of those properties.
  Article: [],
  NewsArticle: [],
  BlogPosting: [],
  Product: ["name", ["offers", "review", "aggregateRating"]],
  Offer: ["price", "priceCurrency"],
  BreadcrumbList: ["itemListElement"],
  Organization: [],
  LocalBusiness: ["name", "address"],
  Person: ["name"],
  FAQPage: ["mainEntity"],
  // FAQ answers are accepted answers; a Q&A thread may have only suggested ones.
  Question: ["name", ["acceptedAnswer", "suggestedAnswer"]],
  HowTo: ["name", "step"],
  Recipe: ["name", "image"],
  Event: ["name", "startDate", "location"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
  Review: ["itemReviewed", "reviewRating", "author"],
  AggregateRating: ["ratingValue", ["ratingCount", "reviewCount"]],
  WebPage: [],
  WebSite: ["url"],
  // Image metadata names the file in contentUrl; url is the older form.
  ImageObject: [["contentUrl", "url"]],
  Service: [],
  JobPosting: ["title", "description", "datePosted", "hiringOrganization"],
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
  ContactPoint: ["telephone"],
  PostalAddress: ["streetAddress", "addressLocality", "addressCountry"],
  ListItem: ["position"],
  ItemList: ["itemListElement"],
  ReadAction: [],
  SearchResultsPage: [],
  AboutPage: [],
  ContactPage: [],
  ItemPage: [],
  MediaObject: ["url"],
  Brand: ["name"],
  SiteNavigationElement: ["name"]
};

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
  return ORG_TYPES.has(String(t || "").replace(/^https?:\/\/schema\.org\//, ""));
}

const RECOMMENDED_BY_TYPE = {
  Article: ["headline", "author", "datePublished", "image", "publisher", "dateModified", "mainEntityOfPage"],
  NewsArticle: ["headline", "author", "datePublished", "image", "publisher", "dateModified"],
  BlogPosting: ["headline", "author", "datePublished", "image", "publisher", "dateModified"],
  Product: ["image", "description", "brand", "offers", "aggregateRating", "review"],
  Offer: ["availability"],
  LocalBusiness: ["telephone", "openingHours", "geo", "url", "priceRange"],
  Organization: ["name", "logo", "url", "sameAs"],
  Event: ["endDate", "description", "image", "offers"],
  Recipe: ["recipeIngredient", "recipeInstructions", "nutrition", "totalTime"],
  VideoObject: ["description", "duration", "contentUrl"],
  Service: ["provider", "description", "areaServed", "serviceType"],
  JobPosting: ["jobLocation", "baseSalary", "employmentType", "validThrough"],
  Course: ["provider", "url", "image"],
  SoftwareApplication: ["applicationCategory", "operatingSystem"],
  WebApplication: ["applicationCategory", "operatingSystem"],
  Restaurant: ["servesCuisine", "priceRange", "openingHours", "telephone"],
  Hotel: ["starRating", "amenityFeature", "priceRange"]
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

/** Required, rich-result and recommended checks for one typed node; `where` prefixes the messages. */
function checkNode(obj, issues, where = "") {
  normalizeTypes(obj).forEach(type => {
    const label = `${where}${type}`;
    const required = REQUIRED_BY_TYPE[type];
    if (required) {
      required.forEach(prop => {
        const anyOf = [].concat(prop); // a nested array means Google needs any one of these
        if (!anyOf.some(p => hasProp(obj, p))) {
          issues.push({ level: "error", msg: `${label}: missing required ${anyOf.map(p => `"${p}"`).join(" or ")}` });
        }
      });
    }
    if (RATING_FOR_RICH_RESULT.has(type) && !hasProp(obj, "aggregateRating") && !hasProp(obj, "review")) {
      issues.push({ level: "note", msg: `${label}: no star-rating rich result without real ratings or reviews ("aggregateRating" or "review"). Fine without them; never add made-up ones.` });
    }
    const recommended = RECOMMENDED_BY_TYPE[type];
    if (recommended) {
      recommended.forEach(prop => {
        if (!hasProp(obj, prop)) {
          issues.push({ level: "info", msg: `${label}: missing recommended "${prop}"` });
        }
      });
    }
  });
}

/**
 * The page's main thing is often nested: WebPage → mainEntity → SoftwareApplication.
 * Google reads it there too, so it gets the same checks as a top-level block.
 */
function* mainEntities(obj, depth = 0) {
  if (depth > 3) return;
  for (const e of [].concat(obj?.mainEntity || [])) {
    if (e && typeof e === "object" && normalizeTypes(e).length) {
      yield e;
      yield* mainEntities(e, depth + 1);
    }
  }
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
    for (const e of mainEntities(obj)) checkNode(e, issues, "mainEntity › ");
    // On an FAQPage every question needs an accepted answer; only a Q&A page may have suggested ones only.
    // (A question with no answer at all is already reported by the Question rule.)
    if (types.includes("FAQPage")) {
      for (const q of [].concat(obj.mainEntity || [])) {
        if (normalizeTypes(q).includes("Question") && !hasProp(q, "acceptedAnswer") && hasProp(q, "suggestedAnswer")) {
          issues.push({ level: "error", msg: 'mainEntity › Question: missing required "acceptedAnswer" (an FAQ answer)' });
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
    const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
    if (!types.includes("FAQPage")) return;
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
    const t = obj["@type"];
    if (t) {
      if (Array.isArray(t)) t.forEach(x => found.add(String(x)));
      else found.add(String(t));
    }
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

  if (s.isHomepage && !has("WebSite")) {
    out.push({
      type: "WebSite",
      priority: "high",
      reason: "Homepage detected. Add WebSite schema (name, url) so Google can show your site name in results."
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
      reason: "Breadcrumb navigation visible on page but no BreadcrumbList schema. Add it for the breadcrumb trail in Google SERPs."
    });
  }

  // A CV or team page often uses <article> and <time>, but its type is ProfilePage (or AboutPage), not Article.
  if (s.hasArticleTag && (s.hasPublishDate || s.hasAuthorByline) && !has("Article", "BlogPosting", "NewsArticle", "ProfilePage", "AboutPage", "ContactPage")) {
    out.push({
      type: "Article",
      priority: "high",
      reason: "<article> with author/date detected. Add Article (or BlogPosting/NewsArticle) schema with headline, author, datePublished, image."
    });
  }


  if (s.hasVideoEmbed && !has("VideoObject")) {
    out.push({
      type: "VideoObject",
      priority: "medium",
      reason: "Video/YouTube/Vimeo embed detected. Add VideoObject (name, thumbnailUrl, uploadDate, contentUrl) for video rich results and Google Discover."
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


  if (s.jobSignals && !has("JobPosting")) {
    out.push({
      type: "JobPosting",
      priority: "high",
      reason: "Job-related keywords detected. Add JobPosting (title, description, hiringOrganization, jobLocation, datePosted) for Google for Jobs."
    });
  }

  return out;
}

function openingHoursDeclared(items) {
  return (items || []).some(item => {
    const obj = item?.raw;
    if (!obj) return false;
    return obj.openingHours || obj.openingHoursSpecification;
  });
}

function normalizeTypes(obj) {
  if (!obj) return [];
  const t = obj["@type"];
  if (!t) return [];
  return Array.isArray(t) ? t : [t];
}

function hasProp(obj, prop) {
  if (!obj || typeof obj !== "object") return false;
  const v = obj[prop];
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}
