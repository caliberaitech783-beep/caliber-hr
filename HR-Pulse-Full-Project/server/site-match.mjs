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
