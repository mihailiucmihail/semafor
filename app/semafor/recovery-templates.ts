// Default recovery e-mail templates (seeded once per shop, then editable in Semafor → E-mailuri).
// They use a ready-made design (see designs.ts): the merchant edits only the texts; brand and products are filled in automatically.
import { DEFAULT_COPY, type DesignId } from "./designs";

const LANG: Record<string, string> = { ro: "RO", de: "DE", pl: "PL", en: "EN" };

/** Template names, each in the template's own language. */
export const TEMPLATE_NAMES: Record<string, Record<"auto1" | "auto2" | "auto3", string>> = {
  ro: { auto1: "1 · Reamintire", auto2: "2 · Stoc limitat + reducere", auto3: "3 · Ultima șansă" },
  en: { auto1: "1 · Reminder", auto2: "2 · Low stock + discount", auto3: "3 · Last chance" },
  de: { auto1: "1 · Erinnerung", auto2: "2 · Begrenzter Vorrat + Rabatt", auto3: "3 · Letzte Chance" },
  pl: { auto1: "1 · Przypomnienie", auto2: "2 · Ograniczony zapas + rabat", auto3: "3 · Ostatnia szansa" },
};

/** Old default names (all Romanian) → renamed to the template's language, see renameOldDefaults. */
export const OLD_NAMES: Record<string, string> = { auto1: "1 · Reamintire", auto2: "2 · Stoc limitat + reducere", auto3: "3 · Ultima șansă" };

export function defaultTemplates(design: DesignId = "elegant") {
  const out: { name: string; locale: string; purpose: string; subject: string; html: string; design: string; copy: any }[] = [];
  for (const [locale, t] of Object.entries(DEFAULT_COPY)) {
    const names = TEMPLATE_NAMES[locale] ?? TEMPLATE_NAMES.en;
    for (const k of ["auto1", "auto2", "auto3"] as const) {
      const { subject, ...copy } = t[k];
      out.push({ name: `${LANG[locale]} · ${names[k]}`, locale, purpose: k, subject, html: "", design, copy });
    }
  }
  return out;
}
