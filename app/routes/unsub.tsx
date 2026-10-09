// Public unsubscribe page for Semafor recovery e-mails.
// GET  → confirmation page (link scanners never unsubscribe anyone by just opening it)
// POST → unsubscribe: no more Semafor e-mails + e-mail marketing consent set to UNSUBSCRIBED in Shopify.
//        Also used by mail apps' one-click "Unsubscribe" (List-Unsubscribe-Post).
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { readUnsubToken, unsubscribe, isOptedOut } from "../semafor/recovery.server";

export const meta: MetaFunction = () => [{ title: "Unsubscribe" }, { name: "robots", content: "noindex" }];

const T: Record<string, { q: string; btn: string; done: string; doneSub: string; bad: string }> = {
  ro: { q: "Nu mai vrei să primești e-mailuri de la {shop}?", btn: "Da, dezabonează-mă", done: "Te-ai dezabonat.", doneSub: "Nu vei mai primi e-mailuri promoționale de la {shop}.", bad: "Link invalid sau expirat." },
  de: { q: "Möchtest du keine E-Mails mehr von {shop} erhalten?", btn: "Ja, abmelden", done: "Du wurdest abgemeldet.", doneSub: "Du erhältst keine Werbe-E-Mails mehr von {shop}.", bad: "Ungültiger oder abgelaufener Link." },
  pl: { q: "Nie chcesz już otrzymywać wiadomości od {shop}?", btn: "Tak, wypisz mnie", done: "Zostałaś wypisana.", doneSub: "Nie będziesz już otrzymywać wiadomości promocyjnych od {shop}.", bad: "Nieprawidłowy lub wygasły link." },
  en: { q: "Don't want e-mails from {shop} anymore?", btn: "Yes, unsubscribe me", done: "You're unsubscribed.", doneSub: "You won't receive marketing e-mails from {shop} anymore.", bad: "Invalid or expired link." },
};

async function context(t: string | null) {
  const tok = t ? readUnsubToken(t) : null;
  if (!tok) return null;
  const shop = await db.shop.findUnique({ where: { id: tok.shopId }, select: { id: true, domain: true } });
  if (!shop) return null;
  const last = (await db.checkoutAttempt.findFirst({ where: { shopId: shop.id, email: { equals: tok.email, mode: "insensitive" } }, orderBy: { createdAt: "desc" }, select: { locale: true, host: true } })) as any;
  const lang = (last?.locale || "").slice(0, 2);
  return { tok, shop, lang: T[lang] ? lang : "en", host: (last?.host as string) || shop.domain };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const ctx = await context(new URL(request.url).searchParams.get("t"));
  if (!ctx) return { ok: false as const, lang: "en", shop: "", already: false };
  return { ok: true as const, lang: ctx.lang, shop: ctx.host.replace(/^www\./, ""), already: await isOptedOut(ctx.shop.id, ctx.tok.email) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const ctx = await context(new URL(request.url).searchParams.get("t"));
  if (!ctx) return new Response("invalid", { status: 400 });
  let admin: any = null;
  try { admin = (await unauthenticated.admin(ctx.shop.domain)).admin; } catch { admin = null; }

  if (new URL(request.url).searchParams.get("test") !== "1") await unsubscribe(admin, ctx.shop.id, ctx.tok.email);
  // one-click from a mail app: plain 200 is enough
  if (!(request.headers.get("accept") || "").includes("text/html") && !(request.headers.get("content-type") || "").includes("form-urlencoded")) return new Response("ok");
  return { done: true };
};

const box: React.CSSProperties = { maxWidth: 440, margin: "12vh auto", padding: "40px 28px", textAlign: "center", fontFamily: "Georgia, 'Times New Roman', serif", color: "#2a1a12", background: "#fffdf9", border: "1px solid #e6ddd1" };
const btn: React.CSSProperties = { marginTop: 22, padding: "13px 26px", background: "#2a1a12", color: "#fff", border: 0, fontFamily: "Arial, sans-serif", fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", cursor: "pointer" };

export default function Unsub() {
  const d = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>() as any;
  const t = T[d.lang] || T.en;
  const f = (s: string) => s.replace("{shop}", d.shop);
  return (
    <div style={{ background: "#f3eee6", minHeight: "100vh", padding: "1px 16px" }}>
      <div style={box}>
        {!d.ok ? <p>{t.bad}</p>
          : a?.done || d.already ? <><h1 style={{ fontWeight: 400, fontSize: 26, margin: 0 }}>{t.done}</h1><p style={{ fontFamily: "Arial, sans-serif", fontSize: 14, color: "#8a7662" }}>{f(t.doneSub)}</p></>
          : <Form method="post"><h1 style={{ fontWeight: 400, fontSize: 24, margin: 0, lineHeight: 1.3 }}>{f(t.q)}</h1><button type="submit" style={btn}>{t.btn}</button></Form>}
      </div>
    </div>
  );
}
