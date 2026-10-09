// Default recovery e-mail templates (seeded once per shop, then editable in Semafor → E-mailuri).
// They use a ready-made design (see designs.ts): the merchant edits only the texts; brand and products are filled in automatically.
import { DEFAULT_COPY, type DesignId } from "./designs";

const LANG: Record<string, string> = { ro: "RO", de: "DE", pl: "PL", en: "EN" };

export function defaultTemplates(design: DesignId = "elegant") {
  const out: { name: string; locale: string; purpose: string; subject: string; html: string; design: string; copy: any }[] = [];
  for (const [locale, t] of Object.entries(DEFAULT_COPY)) {
    const names: Record<string, string> = { auto1: "1 · Reamintire", auto2: "2 · Stoc limitat + reducere", auto3: "3 · Ultima șansă" };
    for (const k of ["auto1", "auto2", "auto3"] as const) {
      const { subject, ...copy } = t[k];
      out.push({ name: `${LANG[locale]} · ${names[k]}`, locale, purpose: k, subject, html: "", design, copy });
    }
  }
  return out;
}
