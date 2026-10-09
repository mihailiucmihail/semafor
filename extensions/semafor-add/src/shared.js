export const APP = "https://semafor-production.up.railway.app";
// Texts: locales/en.default.json + locales/ro.json (shopify.i18n.translate).
export const LEVELS = ["green", "yellow", "red"];
export const KINDS = ["email", "phone", "name", "address", "name_address", "device"];
export const REASONS = ["refuz_colet", "chargeback", "return_fraud", "abuse", "other"];
export const tr = (key, vars) => shopify.i18n.translate(key, vars);
/** "en" / "ro" — sent to the Semafor backend so stored texts come back in the same language. */
export const lang = () => tr("lang");
export async function api(path, init) {
  const r = await fetch(path, init);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
