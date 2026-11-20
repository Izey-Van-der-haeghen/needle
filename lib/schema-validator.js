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
  Question: ["name", "acceptedAnswer"],
  HowTo: ["name", "step"],
  Recipe: ["name", "image"],
  Event: ["name", "startDate", "location"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
  Review: ["itemReviewed", "reviewRating", "author"],
  AggregateRating: ["ratingValue", ["ratingCount", "reviewCount"]],
  WebPage: [],
  WebSite: ["url"],
  ImageObject: ["url"],
  Service: [],
  JobPosting: ["title", "description", "datePosted", "hiringOrganization"],
  Course: ["name", "description"],
  // shortcut: checks offers is present, not offers.price; upgrade if nested checks are added
  SoftwareApplication: ["name", "offers", ["aggregateRating", "review"]],
  WebApplication: ["name", "offers", ["aggregateRating", "review"]],
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
 * @property {"error"|"warn"|"info"} level
 * @property {string} msg
 */

/**
 * @typedef {Object} ValidatedSchemaItem
 * @property {string} type - schema type label (may be comma-joined for @type arrays)
 * @property {Object} raw - the original parsed JSON-LD object
 * @property {string[]} types - normalized @type array
 * @property {SchemaIssue[]} issues
 */

/**
 * Validate JSON-LD blocks against per-type required and recommended properties.
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

    types.forEach(type => {
      const required = REQUIRED_BY_TYPE[type];
      if (required) {
        required.forEach(prop => {
          const anyOf = [].concat(prop); // a nested array means Google needs any one of these
          if (!anyOf.some(p => hasProp(obj, p))) {
            issues.push({ level: "error", msg: `${type}: missing required ${anyOf.map(p => `"${p}"`).join(" or ")}` });
          }
        });
      }
      const recommended = RECOMMENDED_BY_TYPE[type];
      if (recommended) {
        recommended.forEach(prop => {
          if (!hasProp(obj, prop)) {
            issues.push({ level: "info", msg: `${type}: missing recommended "${prop}"` });
          }
        });
      }
    });

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

  if (s.isHomepage && ![...existing].some(isOrgType)) {
    out.push({
      type: "Organization",
      priority: "high",
      reason: "Homepage with no organisation schema. Add Organization (name, url, logo, sameAs) so search engines and AI answers can identify who runs the site."
    });
  }

  if (s.hasBreadcrumb && !has("BreadcrumbList")) {
    out.push({
      type: "BreadcrumbList",
      priority: "high",
      reason: "Breadcrumb navigation visible on page but no BreadcrumbList schema. Add it for the breadcrumb trail in Google SERPs."
    });
  }

  if (s.hasArticleTag && (s.hasPublishDate || s.hasAuthorByline) && !has("Article", "BlogPosting", "NewsArticle")) {
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
