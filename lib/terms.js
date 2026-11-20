/**
 * Word and phrase frequency of a text, and where a target keyphrase appears.
 * Stopword lists cover English, Dutch, French and German page text.
 */

const STOP = new Set(`
a about above after again against all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers him his how i if in
into is it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should
so some such than that the their them then there these they this those through to too under until up very was we were what
when where which while who whom why will with would you your yours get got one two also via per
de het een en van in is dat op te zijn met voor niet aan er ook als bij door om tot uit maar dan wat nog naar kan je jij u
uw we wij ze zij hij ik mijn onze ons hun hem haar die dit deze meer veel geen wel al worden wordt werd zo of over na ook
heeft hebben had was waren zal zullen kunnen moet moeten hoe waar wie wanneer omdat dus toch alleen nu hier daar elk
le la les un une des du de et en est que qui dans pour par sur au aux ce ces se sa son ses il elle ils elles nous vous
je tu on ne pas plus ou mais avec sans sous comme être avoir fait été sont leur leurs y a l d qu c s n m t j votre vos notre nos
der die das ein eine einer eines und in ist zu den dem des mit von für auf im nicht sich es auch an als wie wir sie er ich
du aus bei nach noch nur oder aber so wenn dass sind war wird werden hat haben kann können zum zur am vom
`.trim().split(/\s+/));

/** Lower-case words, letters and digits only (accents kept). */
export function tokenize(text) {
  return (String(text || "").toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) || [])
    .flatMap((w) => w.split(/['’]/));
}

const isContent = (w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w);

/**
 * Most frequent words and 2- and 3-word phrases.
 * @param {string} text
 * @param {number} [limit=15]
 * @returns {{total: number, words: Array<{term, count, pct}>, phrases2: Array, phrases3: Array}}
 */
export function termFrequency(text, limit = 15) {
  const tokens = tokenize(text);
  const total = tokens.length;
  const count = (map, key) => map.set(key, (map.get(key) || 0) + 1);
  const words = new Map();
  const p2 = new Map();
  const p3 = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isContent(t)) count(words, t);
    const b = tokens[i + 1];
    if (b && isContent(t) && isContent(b)) count(p2, `${t} ${b}`);
    const c = tokens[i + 2];
    if (b && c && isContent(t) && isContent(c)) count(p3, `${t} ${b} ${c}`);
  }
  const top = (map, min) => [...map.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, n]) => ({ term, count: n, pct: total ? Math.round((n / total) * 1000) / 10 : 0 }));
  return { total, words: top(words, 2), phrases2: top(p2, 2), phrases3: top(p3, 2) };
}

const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** How often a phrase occurs in a text, as whole words, ignoring case and accents. */
export function countPhrase(text, phrase) {
  const t = ` ${tokenize(fold(text)).join(" ")} `;
  const p = tokenize(fold(phrase)).join(" ");
  if (!p) return 0;
  let n = 0;
  let i = t.indexOf(` ${p} `);
  while (i >= 0) { n++; i = t.indexOf(` ${p} `, i + p.length + 1); }
  return n;
}

/**
 * Where a keyphrase appears on the page.
 * @param {string} phrase
 * @param {{url: string, title: string, description: string, headings: Array<{level, text}>, images: Array<{alt}>}} page
 * @param {string} mainText
 * @returns {Array<{place: string, found: boolean, detail: string}>}
 */
export function keywordPlacement(phrase, page, mainText) {
  const slug = (() => { try { return decodeURIComponent(new URL(page.url).pathname).replace(/[-_/.]+/g, " "); } catch { return ""; } })();
  const h1 = (page.headings || []).filter((h) => h.level === 1 && !h.hidden).map((h) => h.text).join(" ");
  const subs = (page.headings || []).filter((h) => h.level > 1);
  const subHits = subs.filter((h) => countPhrase(h.text, phrase) > 0).length;
  const words = tokenize(mainText);
  const intro = words.slice(0, 100).join(" ");
  const inBody = countPhrase(mainText, phrase);
  const altHits = (page.images || []).filter((i) => countPhrase(i.alt, phrase) > 0).length;
  const phraseLen = Math.max(1, tokenize(phrase).length);
  const density = words.length ? Math.round((inBody * phraseLen / words.length) * 1000) / 10 : 0;
  return [
    { place: "Title", found: countPhrase(page.title, phrase) > 0, detail: "" },
    { place: "Meta description", found: countPhrase(page.description, phrase) > 0, detail: "" },
    { place: "H1", found: countPhrase(h1, phrase) > 0, detail: "" },
    { place: "Subheadings", found: subHits > 0, detail: `${subHits} of ${subs.length}` },
    { place: "URL", found: countPhrase(slug, phrase) > 0, detail: "" },
    { place: "First 100 words", found: countPhrase(intro, phrase) > 0, detail: "" },
    { place: "Main content", found: inBody > 0, detail: `${inBody} time${inBody === 1 ? "" : "s"}, ${density}% of words` },
    { place: "Image alt text", found: altHits > 0, detail: `${altHits} image${altHits === 1 ? "" : "s"}` }
  ];
}
