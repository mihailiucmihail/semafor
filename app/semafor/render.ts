// Shared (server + browser): fills {{placeholders}} in a recovery e-mail template.
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function render(tpl: { subject: string; html: string }, v: Record<string, string>, hasDiscount: boolean) {
  const fill = (s: string, html: boolean) => s
    .replace(/\{\{#discount\}\}([\s\S]*?)\{\{\/discount\}\}/g, (_, inner) => (hasDiscount ? inner : ""))
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k === "items" ? (html ? v.items ?? "" : "") : html ? esc(v[k] ?? "") : (v[k] ?? "")))
    .replace(/\{\{[^}]*\}\}/g, "");
  return { subject: fill(tpl.subject, false).replace(/\s+/g, " ").trim(), html: fill(tpl.html, true) };
}

export const STEP_ORDER = ["started", "contact", "address", "shipping", "payment", "completed"] as const;
export const STEP_LABEL: Record<string, string> = {
  started: "a intrat în checkout",
  contact: "a introdus e-mailul / telefonul",
  address: "a completat adresa",
  shipping: "a ales livrarea",
  payment: "a trimis plata",
  completed: "a plasat comanda",
};
/** Where the buyer stopped, in plain words (the next step she did NOT do). */
export function stoppedAt(events: string[]): string {
  if (events.includes("completed")) return "a plasat comanda";
  if (events.includes("payment")) return "a trimis plata, dar comanda nu s-a creat (plată refuzată / 3-D Secure / Klarna anulat)";
  if (events.includes("shipping")) return "a plecat la pasul de plată";
  if (events.includes("address")) return "a plecat la alegerea livrării";
  if (events.includes("contact")) return "a plecat la adresă";
  return "a plecat imediat după ce a deschis checkout-ul";
}

