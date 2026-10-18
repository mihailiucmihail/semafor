import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "Semafor — Politica de confidențialitate / Privacy policy" }];

const S: React.CSSProperties = { maxWidth: 760, margin: "40px auto", padding: "0 20px", font: "16px/1.6 -apple-system, Segoe UI, Roboto, sans-serif", color: "#1a1a1a" };

export default function Privacy() {
  return (
    <main style={S}>
      <h1>Semafor — Privacy policy</h1>
      <p><em>Last updated: 19 October 2026 · Developer: Mihail Mihailiuc, Bucharest, Romania · Contact: mihailiucmihail@gmail.com</em></p>
      <h2>What Semafor does</h2>
      <p>Semafor is a fraud-prevention app for Shopify merchants. It lets a merchant keep a blacklist of customers who refused cash-on-delivery parcels, filed chargebacks or abused the store, checks new orders against that list and, if the merchant enables it, prevents blacklisted customers from paying at checkout.</p>
      <h2>Data we process</h2>
      <ul>
        <li><b>Order and customer data</b> received from Shopify (name, e-mail, phone, shipping/billing address, order number) — to check each order.</li>
        <li><b>Checkout events</b> (the contact, address and delivery details typed in checkout) together with a random device identifier stored in the buyer's browser, a technical fingerprint (browser, language, screen size, time zone) and the IP address — to recognise the same device trying different identities.</li>
        <li><b>The merchant's blacklist</b> entries and notes.</li>
      </ul>
      <h2>Why (legal basis)</h2>
      <p>Fraud prevention is the merchant's legitimate interest (GDPR art. 6(1)(f)). Semafor acts as a processor on behalf of the merchant, who is the controller.</p>
      <h2>Shared network</h2>
      <p>If a merchant joins the Semafor network, only one-way cryptographic hashes of e-mail, phone and name+address are shared, never the values in clear. Other merchants see only a count of reports.</p>
      <h2>Retention</h2>
      <p>Checkout events: 120 days. Order checks: 12 months. Blacklist entries: until the merchant removes them or 24 months. All data of a shop is deleted 48 hours after the app is uninstalled (Shopify <code>shop/redact</code>).</p>
      <h2>Your rights</h2>
      <p>Customers can ask the merchant (or us) for access to or deletion of their data; requests received through Shopify (<code>customers/data_request</code>, <code>customers/redact</code>) are fulfilled automatically.</p>
      <h2>Abandoned checkout e-mails</h2>
      <p>If the merchant turns on reminder e-mails, Semafor sends them on the merchant's behalf to the e-mail address the buyer typed in checkout, only when the buyer accepted marketing or the merchant's settings allow it. Each e-mail contains the cart contents and, optionally, a one-time discount code. Sending is done through Resend (USA). A log of sent e-mails is kept so the merchant can see the results; it is deleted with the shop data on uninstall.</p>
      <h2>Storefront pop-up</h2>
      <p>If the merchant turns on the Semafor pop-up, a visitor can leave their e-mail address in exchange for a discount code. With the visitor's consent (given by submitting the form) Semafor stores the e-mail together with the random device identifier kept in the visitor's browser (the same one used for checkout events), the storefront language and the page address, and creates or updates the customer in the merchant's Shopify store with e-mail marketing consent (never overriding an earlier unsubscribe). The device link lets the merchant recognise the subscriber later — for example when they leave products in the cart without typing an e-mail — and send the cart reminder e-mails described above. Every e-mail contains an unsubscribe link. The pop-up data is kept until the customer asks for deletion (<code>customers/redact</code>) or the app is uninstalled. Semafor also records, without personal data, what was in the cart before checkout so those reminders can show the products.</p>
      <h2>Hosting and sub-processors</h2>
      <p>Data is stored in an encrypted PostgreSQL database hosted by Railway (USA). E-mails are delivered by Resend (USA). Both operate under standard contractual clauses.</p>
      <h2>Security and incident response</h2>
      <p>Data is encrypted in transit (HTTPS/TLS) and at rest. Access to production data is limited to the developer, protected by strong passwords and two-factor authentication, and access is logged. Test and production data are kept in separate apps and databases. If a security incident affects personal data, we contain it, investigate it, and notify the affected merchants without undue delay and in any case within 72 hours of becoming aware of it, so they can meet their own obligations to customers and authorities.</p>
      <h2>Our website (kastellabs.com)</h2>
      <p>Our website kastellabs.com uses Google Analytics 4 (Google Ireland Limited) with Consent Mode. Analytics cookies are set only after a visitor clicks "Accept" in the cookie bar; until then the analytics storage stays denied and no analytics cookies are written. The choice is remembered in the visitor's browser. We use the statistics only to measure visits (pages, language, where visitors came from, including the UTM parameters of the link they followed) and clicks on the "Install" buttons that lead to the Shopify App Store. We do not store IP addresses, and Google Analytics 4 does not log or store them either. The website does not use advertising cookies.</p>
      <h2>Our Shopify App Store listing</h2>
      <p>The Semafor page on the Shopify App Store (apps.shopify.com/semafor) is hosted by Shopify. Through the tracking options Shopify offers to app developers, we receive statistics from it via Google Analytics and the Meta Pixel (Meta Platforms Ireland Limited): Shopify sends listing views, clicks on the install button and installs. Cookies on that page are controlled by Shopify's own cookie banner and privacy policy. We use this data only to measure and improve how merchants find Semafor.</p>
      <h2>Who we are</h2>
      <p>Semafor is developed by MIHAILIUC GROUP SRL, Bucharest, Romania. Contact: mihailiuc.co@gmail.com.</p>
      <hr />
      <h1>Politica de confidențialitate (RO)</h1>
      <p>Semafor este o aplicație de prevenire a fraudei pentru magazinele Shopify. Prelucrăm datele comenzilor (nume, e-mail, telefon, adresă), datele introduse la checkout împreună cu un identificator aleator al dispozitivului, amprenta tehnică a browserului și adresa IP, exclusiv pentru a recunoaște clienții din lista neagră a magazinului. Dacă magazinul folosește pop-up-ul Semafor, adresa de e-mail lăsată de vizitator (cu acordul său) este salvată împreună cu identificatorul dispozitivului, pentru a crea clientul în Shopify cu acord de marketing și pentru a-i trimite reamintiri pentru coșul abandonat; fiecare e-mail conține link de dezabonare. Temei: interesul legitim al comerciantului (art. 6 alin. (1) lit. f GDPR). Comerciantul este operator, noi suntem persoană împuternicită. Datele de checkout se păstrează 120 de zile; datele magazinului se șterg la 48 de ore după dezinstalare. Contact: mihailiucmihail@gmail.com.</p>
      <p>Site-ul nostru kastellabs.com folosește Google Analytics 4 cu Consent Mode: cookie-urile de analiză se setează doar după ce vizitatorul apasă „Accept” în bara de cookie-uri. Folosim statisticile doar pentru a măsura vizitele și clicurile pe butoanele „Instalează”; nu stocăm adrese IP. Pentru pagina Semafor din Shopify App Store, Shopify ne transmite prin Google Analytics și Meta Pixel vizualizările paginii, clicurile pe instalare și instalările; cookie-urile de pe acea pagină sunt gestionate de Shopify.</p>
    </main>
  );
}
