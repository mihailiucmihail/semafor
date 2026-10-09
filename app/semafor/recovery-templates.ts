// Default recovery e-mail templates (seeded once per shop, then editable in Semafor → E-mailuri).
// They use a ready-made design (see designs.ts): the merchant edits only the texts; brand and products are filled in automatically.
import { DEFAULT_COPY, type DesignId } from "./designs";

const LANG: Record<string, string> = { ro: "RO", de: "DE", pl: "PL", en: "EN" };

export function defaultTemplates(design: DesignId = "elegant") {
  const out: { name: string; locale: string; purpose: string; subject: string; html: string; design: string; copy: any }[] = [];
  for (const [locale, t] of Object.entries(DEFAULT_COPY)) {
    const { subject: s1, ...c1 } = t.auto1;
    const { subject: s2, ...c2 } = t.auto2;
    out.push({ name: `${LANG[locale]} · Reamintire`, locale, purpose: "auto1", subject: s1, html: "", design, copy: c1 });
    out.push({ name: `${LANG[locale]} · Cu reducere`, locale, purpose: "auto2", subject: s2, html: "", design, copy: c2 });
  }
  return out;
}
