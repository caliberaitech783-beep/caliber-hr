/* Is an HR site the same site as a Pulse-II (MIS) site? One rule for the browser and the server (28 Nov 2026): the
   roster keeps a trip card when sameSite says so, and the server now leaves the other sites out of the answer with the
   same rule, so it can never drop a card the roster would have kept.
   HR site names and MIS site names are written differently ("Jayant" / "Jayant OB"): compare letters and digits only. */
const siteWords = site => String(site || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Words that only say what kind of site it is: "Sasti OC", "Sasti OCP" and "Sasti" are the same site.
const SITE_KIND = new Set(['ob', 'oc', 'ocp', 'ocm', 'opencast', 'coal', 'mine', 'mines', 'project', 'site', 'colliery']);
const placeWords = site => {const words = siteWords(site).split(' ').filter(Boolean), place = words.filter(w => !SITE_KIND.has(w)); return place.length ? place : words;};
export function sameSite(hrSite, misSite) {
  const a = siteWords(hrSite), b = siteWords(misSite);
  if (!a || !b) return false;
  if (a === b || (' ' + b + ' ').includes(' ' + a + ' ') || (' ' + a + ' ').includes(' ' + b + ' ')) return true;
  const pa = placeWords(hrSite), pb = placeWords(misSite);
  return pa.every(w => pb.includes(w)) || pb.every(w => pa.includes(w));
}

/* Two sites with almost the same name (owner, 28 Nov 2026: "plz do this and all other such mine names").
   HR has "Dudhichua OB East" and "Dudhichua OB West"; MIS has "Dudhichua East OC" and "Dudhichua OC". sameSite alone
   says East is both MIS sites ("Dudhichua OC" has no word East lacks), so the East roster also took the other site's
   trip cards. The rule now looks at every site name MIS sent:
   - when one of them is exactly this site (the same place words: "Dudhichua OB East" and "Dudhichua East OC"), only
     exact names are this site;
   - when none is (HR "Dudhichua OB West", MIS "Dudhichua OC"), the looser sameSite decides, as before.
   Checked on live on 28 Nov 2026: every MIS answer names every site of the login on every date in its shift list, also
   a site that saved no card, so the names known do not change with the day.
   Of the site names HR Pulse shows and the eight MIS sites, East was the only one that took two (tested by name in
   mis-attendance.test.mjs). */
const samePlace = (a, b) => {const pa = placeWords(a), pb = placeWords(b); return pa.length === pb.length && pa.every(w => pb.includes(w));};
export const exactSite = (hrSite, misSite) => Boolean(siteWords(hrSite)) && Boolean(siteWords(misSite)) && samePlace(hrSite, misSite);
/** known: every MIS site name (and site key) at hand. Gives the test "is this MIS name the HR site?". */
export function siteMatcher(hrSite, known = []) {
  const strict = [...known].some(name => exactSite(hrSite, name));
  return misSite => strict ? exactSite(hrSite, misSite) : sameSite(hrSite, misSite);
}
