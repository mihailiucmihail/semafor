import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [{ title: "Semafor — Politica de confidențialitate / Privacy policy" }];

const S: React.CSSProperties = { maxWidth: 760, margin: "40px auto", padding: "0 20px", font: "16px/1.6 -apple-system, Segoe UI, Roboto, sans-serif", color: "#1a1a1a" };

export default function Privacy() {
  return (
    <main style={S}>
      <h1>Semafor — Privacy policy</h1>
      <p><em>Last updated: 8 October 2026 · Operator: Mihailiuc Group SRL, Bucharest, Romania · Contact: mihailiucmihail@gmail.com</em></p>
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
      <h2>Hosting</h2>
      <p>Data is stored in an encrypted PostgreSQL database hosted by Railway (USA) under standard contractual clauses.</p>
      <hr />
      <h1>Politica de confidențialitate (RO)</h1>
      <p>Semafor este o aplicație de prevenire a fraudei pentru magazinele Shopify. Prelucrăm datele comenzilor (nume, e-mail, telefon, adresă), datele introduse la checkout împreună cu un identificator aleator al dispozitivului, amprenta tehnică a browserului și adresa IP, exclusiv pentru a recunoaște clienții din lista neagră a magazinului. Temei: interesul legitim al comerciantului (art. 6 alin. (1) lit. f GDPR). Comerciantul este operator, noi suntem persoană împuternicită. Datele de checkout se păstrează 120 de zile; datele magazinului se șterg la 48 de ore după dezinstalare. Contact: mihailiucmihail@gmail.com.</p>
    </main>
  );
}
