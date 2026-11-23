// The names HR Pulse shows for sites whose saved name is older (owner's renames). Display only: site IDs, codes and saved
// names stay unchanged. The screen shows these names (src/siteNames.ts), so a name a screen sends back to the server can be
// a display name; siteNameKeys() gives every name and code the server may find that site under.
export const SITE_ALIASES = {
 'Dhoptala OB 2nd': ['Dhoptala', 'Dhoptala OB', 'Dhoptala OC', 'Dhoptala OB2', 'Dhoptala OB 2', 'Dhoptala OC (2nd)', 'WCL-DHOPTALA'],
 'Gauri Pauni OB 2nd': ['Gauri Pauni OB', 'Gauri Pauni OC', 'Gauri Pauni OB2', 'Gauri Pauni OB 2', 'Gauri Pauni OC (2nd)', 'Gauri Pouni OB', 'Gouri Pauni OB', 'WCL-GAURI', 'WCL-GAURI-PAUNI'],
 'Lalpeth OB': ['Hindustan Lalpeth OC', 'Hindustan Lalpeth OB', 'Lalpeth OC', 'WCL-LALPETH'],
 'Dudhichua OB East': ['Dhudhichua OB East', 'Dudichua OB East', 'NCL-DUDE'],
 'Dudhichua OB West': ['Dhudhichua OB West', 'Dudichua OB West', 'Dudichua OB west', 'NCL-DUDW'],
 'Nagpur Corporate Office': ['Nagpur CO', 'Nagpur Office', 'Corporate Office', 'CMLL-CO'],
 'Chandrapur Head Office': ['Chandrapur HO', 'Head Office', 'Head Office, Chandrapur', 'CMLL-HO'],
};
export const siteKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const labels = new Map(Object.entries(SITE_ALIASES).flatMap(([label, old]) => [label, ...old].map(value => [siteKey(value), label])));
export function siteDisplayName(name, code = '') { return labels.get(siteKey(code)) || labels.get(siteKey(name)) || name; }
/** Every key (letters and digits, lower case) a site shown or sent as `name` may be saved under: the name, and when it is a
 *  display name or an alias, its label and every alias. */
export function siteNameKeys(name) {
 const own = siteKey(name), label = labels.get(own);
 return [...new Set([own, ...(label ? [label, ...SITE_ALIASES[label]].map(siteKey) : [])])].filter(Boolean);
}
/** SQL for "this site row is the site the screen named": the saved name (spaces and case ignored), or its name or code
 *  among siteNameKeys(). nameParam: the name sent; keysParam: siteNameKeys(name) as text[]. */
export const siteNameMatch = (nameParam, keysParam) =>
 `(lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim(${nameParam}),'[[:space:]]+',' ','g'))` +
 ` OR regexp_replace(lower(name),'[^a-z0-9]','','g')=ANY(${keysParam}::text[]) OR regexp_replace(lower(coalesce(code,'')),'[^a-z0-9]','','g')=ANY(${keysParam}::text[]))`;
/** ORDER BY that puts the saved name the screen sent first, so an alias never wins over an exact name. */
export const exactNameFirst = nameParam => `ORDER BY (lower(regexp_replace(btrim(name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim(${nameParam}),'[[:space:]]+',' ','g'))) DESC`;
