// Shared (admin card + public page /help/sending-domain): how to add Semafor's DNS records, per provider. en + ro.
export type GuideLang = "en" | "ro";
export type Guide = { title: string; intro: string; providers: Array<{ name: string; steps: string[] }>; faqTitle: string; faq: Array<{ q: string; a: string }> };

export const DOMAIN_GUIDE: Record<GuideLang, Guide> = {
  ro: {
    title: "Cum adaug înregistrările DNS?",
    intro: "Deschide locul unde ai cumpărat domeniul (sau unde sunt administrate DNS-urile lui) și adaugă, una câte una, înregistrările din tabel: același Tip, Nume și Valoare (și Prioritatea, la MX). TTL: lasă valoarea implicită („Auto” / 3600). Apoi revino aici și apasă „Verifică acum”.",
    providers: [
      { name: "Shopify (domeniu cumpărat prin Shopify)", steps: ["Shopify admin → Setări → Domenii → alege domeniul.", "Setări domeniu → Editează setările DNS → Adaugă înregistrare personalizată.", "Alege tipul (TXT / MX / CNAME), scrie Numele doar ca subdomeniu (de ex. send sau resend._domainkey) și lipește Valoarea.", "Merge doar pentru domenii cumpărate prin Shopify; pentru domenii conectate de la alt furnizor, adaugă înregistrările acolo."] },
      { name: "Cloudflare", steps: ["Cloudflare → alege domeniul → DNS → Records → Add record.", "Tip, Name (doar subdomeniul, de ex. send) și Content = Valoarea.", "La CNAME setează Proxy status pe „DNS only” (norișor gri), altfel verificarea nu trece.", "La MX completează și Priority."] },
      { name: "GoDaddy", steps: ["My Products → Domains → domeniul → DNS → Add New Record.", "Type, Name (doar subdomeniul), Value; la MX și Priority.", "TTL: implicit (1 oră)."] },
      { name: "Namecheap", steps: ["Domain List → Manage → Advanced DNS → Add New Record.", "Host = doar subdomeniul (send, resend._domainkey), Value = valoarea.", "Înregistrările MX se adaugă la secțiunea Mail Settings → Custom MX (lasă celelalte MX neschimbate)."] },
      { name: "Furnizori din România (cyber_Folks, ROMARG, Hostico …, panou cPanel)", steps: ["Intră în cPanel → Zone Editor (Editor zonă DNS) → Manage la domeniul tău.", "+ Add Record → alege tipul; la Name scrie numele complet (de ex. send.domeniu.ro.) sau doar subdomeniul, cum cere panoul.", "Dacă DNS-ul domeniului .ro e la registrar (ROMARG), adaugă înregistrările în contul de acolo, la „Administrare DNS”."] },
      { name: "Squarespace Domains (fost Google Domains)", steps: ["Domains → domeniul → DNS → DNS Settings → Custom records → Add record.", "Host = doar subdomeniul, Type, Data = valoarea; la MX și Priority."] },
      { name: "Alt furnizor", steps: ["Caută în panou „DNS”, „Zone Editor” sau „Records”.", "Adaugă fiecare înregistrare din tabel cu același Tip, Nume și Valoare.", "Unii furnizori vor numele complet (send.domeniu.ro), alții doar subdomeniul (send) — dacă după salvare apare „send.domeniu.ro.domeniu.ro”, scrie doar subdomeniul."] },
    ],
    faqTitle: "Întrebări frecvente",
    faq: [
      { q: "Îmi afectează e-mailul pe care îl folosesc deja?", a: "Nu. Nu schimbăm MX-ul domeniului principal: înregistrările sunt pe subdomeniile send. și resend._domainkey, deci căsuța ta de e-mail funcționează ca înainte." },
      { q: "Am deja SPF pe domeniu.", a: "Nu-l modifica. SPF-ul Semafor stă pe subdomeniul send., separat de cel al domeniului principal." },
      { q: "Cât durează verificarea?", a: "De la câteva minute până la 24–48 de ore, în funcție de furnizor. Poți apăsa „Verifică acum” oricând." },
      { q: "Se oprește ceva până la verificare?", a: "Nu. Până la verificare e-mailurile pleacă de la adresa Semafor, în numele magazinului tău. După verificare trec automat pe adresa ta." },
    ],
  },
  en: {
    title: "How do I add the DNS records?",
    intro: "Open the place where you bought the domain (or where its DNS is managed) and add the records from the table one by one: same Type, Name and Value (and Priority for MX). TTL: keep the default (“Auto” / 3600). Then come back and press “Verify now”.",
    providers: [
      { name: "Shopify (domain bought through Shopify)", steps: ["Shopify admin → Settings → Domains → pick the domain.", "Domain settings → Edit DNS settings → Add custom record.", "Choose the type (TXT / MX / CNAME), enter the Name as the subdomain only (e.g. send or resend._domainkey) and paste the Value.", "Only for domains bought through Shopify; for domains connected from another provider add the records there."] },
      { name: "Cloudflare", steps: ["Cloudflare → pick the domain → DNS → Records → Add record.", "Type, Name (subdomain only, e.g. send) and Content = the Value.", "For CNAME set Proxy status to “DNS only” (grey cloud), otherwise verification fails.", "For MX also fill in Priority."] },
      { name: "GoDaddy", steps: ["My Products → Domains → your domain → DNS → Add New Record.", "Type, Name (subdomain only), Value; Priority for MX.", "TTL: default (1 hour)."] },
      { name: "Namecheap", steps: ["Domain List → Manage → Advanced DNS → Add New Record.", "Host = subdomain only (send, resend._domainkey), Value = the value.", "MX records go under Mail Settings → Custom MX (keep your other MX records unchanged)."] },
      { name: "Romanian providers (cyber_Folks, ROMARG, Hostico …, cPanel)", steps: ["Log in to cPanel → Zone Editor → Manage next to your domain.", "+ Add Record → pick the type; enter the Name as the full name (e.g. send.yourdomain.ro.) or the subdomain only, as the panel asks.", "If the .ro domain's DNS is at the registrar (ROMARG), add the records there under DNS management."] },
      { name: "Squarespace Domains (formerly Google Domains)", steps: ["Domains → your domain → DNS → DNS Settings → Custom records → Add record.", "Host = subdomain only, Type, Data = the value; Priority for MX."] },
      { name: "Other provider", steps: ["Look for “DNS”, “Zone Editor” or “Records” in the panel.", "Add every record from the table with the same Type, Name and Value.", "Some providers want the full name (send.yourdomain.com), others only the subdomain (send) — if you end up with “send.yourdomain.com.yourdomain.com”, enter the subdomain only."] },
    ],
    faqTitle: "FAQ",
    faq: [
      { q: "Does this affect the e-mail I already use?", a: "No. We don't change your root domain's MX: the records are on the send. and resend._domainkey subdomains, so your mailbox keeps working as before." },
      { q: "I already have SPF on my domain.", a: "Don't change it. Semafor's SPF lives on the send. subdomain, separate from your root domain's." },
      { q: "How long does verification take?", a: "From a few minutes up to 24–48 hours, depending on the provider. You can press “Verify now” anytime." },
      { q: "Does anything stop until it's verified?", a: "No. Until then e-mails go from the Semafor address on behalf of your store. Once verified they switch to your address automatically." },
    ],
  },
};
