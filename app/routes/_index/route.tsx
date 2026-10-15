import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import styles from "./styles.module.css";

// Public landing page of the app URL. Shopify opens the app with ?shop=… (embedded); anyone else
// only sees what Semafor is. There is deliberately NO "enter your shop domain" form —
// installation starts from the Shopify App Store / Shopify admin (App Store requirement 2.3.1).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) throw redirect(`/app?${url.searchParams.toString()}`);
  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Semafor: COD Fraud &amp; Recovery</h1>
        <p className={styles.text}>
          Stop repeat cash-on-delivery refusers before they order, and bring back abandoned checkouts.
        </p>
        <ul className={styles.list}>
          <li><strong>Blacklist at checkout.</strong> Buyers on your list can't pay, so the order never reaches your courier.</li>
          <li><strong>Traffic light on every order.</strong> Green, yellow or red, based on the buyer's history.</li>
          <li><strong>Abandoned-checkout recovery.</strong> Timed reminder e-mails and an on-site welcome offer.</li>
        </ul>
        <p className={styles.text}>Install Semafor from the Shopify App Store, then open it from your Shopify admin.</p>
      </div>
    </div>
  );
}
