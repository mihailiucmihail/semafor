export const APP = "https://semafor-production.up.railway.app";
export const TITLE = {
  green: "Verde — clientul nu e în lista neagră",
  yellow: "Galben — atenție, verifică înainte de expediere",
  red: "Roșu — client din lista neagră",
};
export const KIND = { email: "e-mail", phone: "telefon", name: "nume", address: "adresă", name_address: "nume + adresă", device: "dispozitiv" };
export const REASONS = [
  ["refuz_colet", "Refuz colet"],
  ["chargeback", "Chargeback"],
  ["return_fraud", "Retur fraudulos"],
  ["abuse", "Abuz / amenințări"],
  ["other", "Altul"],
];
export async function api(path, init) {
  const r = await fetch(path, init);
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
