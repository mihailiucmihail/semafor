import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { DOMAIN_GUIDE, type GuideLang } from "../semafor/domain-guide";
import { EXTRA, LANGS, LANG_NAMES, isLang } from "../i18n";

// Public help page (no login): sending Semafor e-mails from the merchant's own domain. ?lang=en | ro | es | fr | pl | ru
export const meta: MetaFunction = () => [{ title: "Semafor — Sending domain / Domeniu de trimitere" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const l = new URL(request.url).searchParams.get("lang");
  return { lang: (isLang(l) ? l : "en") as GuideLang };
};

const S: React.CSSProperties = { maxWidth: 760, margin: "40px auto", padding: "0 20px", font: "16px/1.6 -apple-system, Segoe UI, Roboto, sans-serif", color: "#1a1a1a" };
const BASE_INTRO: Record<"en" | "ro", { h: string; p: string[]; other: string }> = {
  en: {
    h: "Semafor — Send e-mails from your own domain",
    p: [
      "By default Semafor sends reminder and welcome e-mails from a Semafor address on behalf of your store, with replies going to your store's e-mail. You can send them from your own address instead (e.g. info@yourstore.com).",
      "In Semafor → Emails → “Send from your own domain”, enter your domain and press “Connect domain”. Semafor shows a few DNS records (on the send. and resend._domainkey subdomains). Add them where your domain's DNS is managed, then press “Verify now”. Once verified, enter your address in “Send from” and save.",
      "Your domain is linked only to your store: no other store can send from it. You can disconnect it at any time.",
    ],
    other: "Română",
  },
  ro: {
    h: "Semafor — Trimite e-mailurile de pe domeniul tău",
    p: [
      "Implicit, Semafor trimite e-mailurile de reamintire și de bun venit de la o adresă Semafor, în numele magazinului tău, iar răspunsurile ajung la e-mailul magazinului. Le poți trimite de la adresa ta (de ex. info@magazinul-tau.ro).",
      "În Semafor → E-mailuri → „Trimite de pe domeniul tău”, scrie domeniul și apasă „Conectează domeniul”. Semafor îți arată câteva înregistrări DNS (pe subdomeniile send. și resend._domainkey). Adaugă-le acolo unde sunt administrate DNS-urile domeniului, apoi apasă „Verifică acum”. După verificare, scrie adresa ta la „Trimite de la” și salvează.",
      "Domeniul tău este legat doar de magazinul tău: niciun alt magazin nu poate trimite de pe el. Îl poți deconecta oricând.",
    ],
    other: "English",
  },
};

const INTRO: Record<GuideLang, { h: string; p: string[]; other: string }> = {
  ...BASE_INTRO, es: EXTRA.es.helpIntro, fr: EXTRA.fr.helpIntro, pl: EXTRA.pl.helpIntro, ru: EXTRA.ru.helpIntro,
};

export default function SendingDomainHelp() {
  const { lang } = useLoaderData<typeof loader>();
  const g = DOMAIN_GUIDE[lang];
  const t = INTRO[lang];
  return (
    <main style={S}>
      <p style={{ textAlign: "right", margin: 0 }}>
        {LANGS.filter((l) => l !== lang).map((l, i) => <span key={l}>{i ? " · " : ""}<a href={`?lang=${l}`}>{LANG_NAMES[l]}</a></span>)}
      </p>
      <h1>{t.h}</h1>
      {t.p.map((x, i) => <p key={i}>{x}</p>)}
      <h2>{g.title}</h2>
      <p>{g.intro}</p>
      {g.providers.map((pr) => (
        <section key={pr.name}>
          <h3>{pr.name}</h3>
          <ol>{pr.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </section>
      ))}
      <h2>{g.faqTitle}</h2>
      {g.faq.map((f) => (<div key={f.q}><p><b>{f.q}</b><br />{f.a}</p></div>))}
      <hr />
      <p><small>Semafor · <a href="/privacy">Privacy policy</a> · mihailiuc.co@gmail.com</small></p>
    </main>
  );
}
