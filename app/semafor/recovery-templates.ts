// Default recovery e-mail templates (seeded once per shop, then editable in Semafor → E-mailuri).
// Placeholders: {{first_name}} {{items}} {{total}} {{recovery_url}} {{discount_code}} {{discount_pct}} {{valid_until}} {{shop_name}}
// Blocks shown only when there is a discount: {{#discount}} … {{/discount}}

type Copy = { subject: string; hi: string; lead: string; body: string; cta: string; disc?: string; foot: string };

function layout(c: Copy) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3eee6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3eee6;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf9;border:1px solid #e6ddd1">
<tr><td style="padding:30px 32px 6px;text-align:center;font-family:Georgia,'Times New Roman',serif;color:#2a1a12">
<div style="font-size:30px;letter-spacing:.12em">MIA</div><div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:.24em;color:#8a7662">BY MIHAILIUC</div>
</td></tr>
<tr><td style="padding:22px 32px 4px;font-family:Arial,Helvetica,sans-serif;color:#2a1a12;font-size:15px;line-height:1.6">
<p style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;line-height:1.3">${c.hi}</p>
<p style="margin:0 0 14px">${c.lead}</p>
{{items}}
<p style="margin:14px 0">${c.body}</p>
${c.disc ? `{{#discount}}<div style="margin:18px 0;padding:16px;border:1px dashed #b8924f;background:#faf3e6;text-align:center">${c.disc}<div style="margin-top:8px;font-family:Georgia,serif;font-size:24px;letter-spacing:.14em;color:#5e2a26">{{discount_code}}</div></div>{{/discount}}` : ""}
<p style="margin:22px 0;text-align:center"><a href="{{recovery_url}}" style="display:inline-block;background:#2a1a12;color:#ffffff;text-decoration:none;padding:14px 26px;font-size:13px;letter-spacing:.14em;text-transform:uppercase">${c.cta}</a></p>
<p style="margin:0 0 6px;color:#8a7662;font-size:12px">${c.foot}</p>
</td></tr>
<tr><td style="padding:16px 32px 26px;font-family:Arial,sans-serif;color:#a08f80;font-size:11px;text-align:center">{{shop_name}}</td></tr>
</table></td></tr></table></body></html>`;
}

const T: Record<string, { auto1: Copy; auto2: Copy }> = {
  de: {
    auto1: {
      subject: "Deine MIA wartet noch auf dich",
      hi: "Hallo {{first_name}},",
      lead: "du hast deine Bestellung noch nicht abgeschlossen. Wir haben deinen Warenkorb für dich gespeichert:",
      body: "Mit einem Klick bist du wieder an der Kasse – bezahlen kannst du mit Karte, PayPal oder Klarna (auch später bezahlen).",
      cta: "Bestellung abschließen",
      foot: "Fragen zur Größe oder Farbe? Antworte einfach auf diese E-Mail – wir helfen dir gern.",
    },
    auto2: {
      subject: "Nur heute: {{discount_pct}} % auf deine MIA",
      hi: "Hallo {{first_name}},",
      lead: "deine MIA liegt noch in deinem Warenkorb:",
      body: "Damit dir die Entscheidung leichter fällt, schenken wir dir einen Rabatt – er wird an der Kasse automatisch abgezogen.",
      cta: "Rabatt sichern",
      disc: "<b>{{discount_pct}} % Rabatt</b> · gültig bis {{valid_until}}",
      foot: "Der Code gilt einmalig und nur bis {{valid_until}}.",
    },
  },
  pl: {
    auto1: {
      subject: "Twoja MIA wciąż na Ciebie czeka",
      hi: "Cześć {{first_name}},",
      lead: "Twoje zamówienie nie zostało jeszcze sfinalizowane. Zapisaliśmy Twój koszyk:",
      body: "Jednym kliknięciem wrócisz do kasy – zapłacisz kartą, BLIK-iem, PayPalem lub przy odbiorze.",
      cta: "Dokończ zamówienie",
      foot: "Masz pytania o kolor lub rozmiar? Po prostu odpisz na tę wiadomość – chętnie pomożemy.",
    },
    auto2: {
      subject: "Tylko dziś: {{discount_pct}}% rabatu na Twoją MIA",
      hi: "Cześć {{first_name}},",
      lead: "Twoja MIA wciąż czeka w koszyku:",
      body: "Żeby ułatwić Ci decyzję, mamy dla Ciebie rabat – naliczy się automatycznie w kasie.",
      cta: "Odbierz rabat",
      disc: "<b>{{discount_pct}}% rabatu</b> · ważny do {{valid_until}}",
      foot: "Kod jest jednorazowy i ważny tylko do {{valid_until}}.",
    },
  },
  ro: {
    auto1: {
      subject: "Geanta ta MIA te așteaptă",
      hi: "Bună, {{first_name}},",
      lead: "nu ai finalizat încă comanda. Ți-am păstrat coșul:",
      body: "Cu un singur clic te întorci la finalizarea comenzii – poți plăti cu cardul sau ramburs.",
      cta: "Finalizează comanda",
      foot: "Ai întrebări despre culoare sau mărime? Răspunde la acest e-mail – te ajutăm cu drag.",
    },
    auto2: {
      subject: "Doar azi: {{discount_pct}}% reducere la MIA ta",
      hi: "Bună, {{first_name}},",
      lead: "geanta ta MIA e încă în coș:",
      body: "Ca să-ți fie mai ușor să te hotărăști, îți oferim o reducere – se aplică automat la finalizarea comenzii.",
      cta: "Folosește reducerea",
      disc: "<b>{{discount_pct}}% reducere</b> · valabilă până la {{valid_until}}",
      foot: "Codul se poate folosi o singură dată, până la {{valid_until}}.",
    },
  },
};

export function defaultTemplates() {
  const out: { name: string; locale: string; purpose: string; subject: string; html: string }[] = [];
  for (const [locale, t] of Object.entries(T)) {
    out.push({ name: `${locale.toUpperCase()} · Reamintire (fără reducere)`, locale, purpose: "auto1", subject: t.auto1.subject, html: layout(t.auto1) });
    out.push({ name: `${locale.toUpperCase()} · Cu reducere`, locale, purpose: "auto2", subject: t.auto2.subject, html: layout(t.auto2) });
  }
  return out;
}
