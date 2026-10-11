import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, InlineGrid, Text, Checkbox, TextField, Button, ButtonGroup, Banner, Badge, Box, Divider, Tabs, Icon, Collapsible } from "@shopify/polaris";
import { EmailIcon, CartIcon, OrderIcon, ExternalIcon, CheckCircleIcon, AlertCircleIcon, MagicIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShop, saveSettings } from "../semafor/shop.server";
import { requireFeature, planOf } from "../semafor/plan.server";
import { pushPopupConfig, checkDiscountCode, popupStats, ensurePopupDiscount, type CodeCheck } from "../semafor/popup.server";
import db from "../db.server";
import { can } from "../../core/plans";
import { POPUP_LANGS, POPUP_DESIGNS, type PopupLang, type PopupSettings, type PopupTexts, type WelcomeTexts } from "../../core/settings";
import { PCT_CHOICES, WELCOME_KEYS, autoCode, buildPopupConfig, cleanPopup, popupTexts, popupDefaults, promisesEmail, welcomeTexts } from "../../core/popup";
import { sendWelcome } from "../semafor/welcome.server";
import { senderOf, MAIL_DOMAIN, mailReady } from "../semafor/recovery.server";
import { Kpi, SectionHead } from "../components/semafor-ui";
import { AttrKpi } from "../components/attribution";
import { attributionSummary, backfillAttribution } from "../semafor/attribution.server";
import { useT, useLang, dateLocale, type TKey } from "../i18n";
// the storefront files themselves → the preview is exactly what visitors see
import popupCss from "../../extensions/semafor-popup/assets/popup.css?raw";
import popupJs from "../../extensions/semafor-popup/assets/popup.js?raw";

type Texts = Record<PopupLang, PopupTexts>;
type WTexts = Record<PopupLang, WelcomeTexts>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "popup", redirect);
  let p = shop.settings.popup;
  // first visit: a store that already has the classic BUNVENIT15 code keeps using it (advanced → own code)
  const raw = (await db.shop.findUnique({ where: { id: shop.id }, select: { settings: true } }))?.settings as any;
  if (!raw?.popup) {
    const own = await checkDiscountCode(admin as any, "BUNVENIT15");
    if (own.exists && own.status === "ACTIVE") p = { ...p, codeMode: "own", code: "BUNVENIT15", pct: own.pct || p.pct };
  }
  let shopName = "";
  try { const j: any = await (await admin.graphql(`query { shop { name } }`)).json(); shopName = j?.data?.shop?.name || ""; } catch { /* ignore */ }
  await backfillAttribution(db, admin as any, shop);
  const [stats, code, attr] = await Promise.all([popupStats(shop.id, 30), checkDiscountCode(admin as any, p.code), attributionSummary(db, shop.id, 30, ["popup_site", "popup_cart"])]);
  const texts = Object.fromEntries(POPUP_LANGS.map((l) => [l, popupTexts(p, l)])) as Texts;
  const wtexts = Object.fromEntries(POPUP_LANGS.map((l) => [l, welcomeTexts(p, l)])) as WTexts;
  const sender = await senderOf(session.shop, shop.settings.recovery);
  const plan = planOf(shop);
  const handle = session.shop.replace(/\.myshopify\.com$/, "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  return {
    popup: p, texts, wtexts, shopName, stats, code, attr,
    mail: { ready: mailReady(), sender, semaforDomain: !!MAIL_DOMAIN && sender.endsWith("@" + MAIL_DOMAIN) },
    seenAt: shop.settings.popupSeenAt ?? null,
    recovery: { pro: can(plan, "recovery"), auto: !!shop.settings.recovery.enabled },
    editorUrl: `https://${session.shop}/admin/themes/current/editor?context=apps&template=index&activateAppId=${apiKey}/semafor-popup`,
    discountsUrl: `https://admin.shopify.com/store/${handle}/discounts`,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "popup", redirect);
  const fd = await request.formData();
  if (fd.get("intent") === "welcomeTest" || fd.get("intent") === "welcomePreview") {
    const preview = fd.get("intent") === "welcomePreview";
    const to = String(fd.get("to") || "").trim();
    if (!preview && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { welcome: true, ok: false, error: "invalid" };
    try {
      const draft = cleanPopup(JSON.parse(String(fd.get("payload") || "{}")));
      const out = await sendWelcome({ shop, admin: admin as any, to: to || "preview@example.com", locale: String(fd.get("lang") || "en"), host: null, deviceId: "test", popup: draft, test: !preview, preview });
      return { welcome: true, ok: true, sent: !preview, to, html: out.html.replace(/https?:\/\/[^"'\s>]*\/unsub\?t=[^"'\s>]*/g, "#"), subject: out.subject };
    } catch (e: any) { return { welcome: true, ok: false, error: String(e?.message || e).slice(0, 300) }; }
  }
  if (fd.get("intent") === "checkCode") return { check: true, code: await checkDiscountCode(admin as any, String(fd.get("code") || "").trim().toUpperCase()) };
  let input: Partial<PopupSettings>;
  try { input = JSON.parse(String(fd.get("payload") || "{}")); } catch { return { ok: false, pushError: "bad payload" }; }
  const popup = cleanPopup(input);
  let codeError: string | null = null;
  if (popup.codeMode === "auto") {
    try { popup.code = (await ensurePopupDiscount(admin as any, popup.pct)).code; }
    catch (e: any) { codeError = String(e?.message || e).slice(0, 300); console.error("[semafor] popup discount", codeError); }
  }
  const next = await saveSettings(shop.id, { popup }, (session as any).email || session.shop);
  let pushError: string | null = null;
  try { await pushPopupConfig(admin as any, { ...shop, settings: next }); } catch (e: any) { pushError = String(e?.message || e).slice(0, 300); console.error("[semafor] popup push", pushError); }
  return { ok: true, pushError, codeError, savedCode: popup.code, code: await checkDiscountCode(admin as any, popup.code) };
};

/** Small swatches for the design picker (the real palettes live in popup.css). */
const THUMB: Record<string, { visual: string; bg: string; accent: string; line: string }> = {
  classic: { visual: "linear-gradient(160deg,#7a3620 0%,#5e2a26 55%,#3d1c17 100%)", bg: "#f7f1e6", accent: "#9a4a2a", line: "#c9a46b" },
  winter: { visual: "linear-gradient(165deg,#3a6b93 0%,#1f3f5f 52%,#0f2135 100%)", bg: "#f5f8fb", accent: "#2f5d86", line: "#a9bccd" },
  spring: { visual: "linear-gradient(160deg,#e3a9b2 0%,#c27585 48%,#7d4c58 100%)", bg: "#fcf6f4", accent: "#b45a6c", line: "#8fae86" },
  summer: { visual: "linear-gradient(180deg,#f5d083 0%,#eaa660 34%,#2d9c98 68%,#135d5d 100%)", bg: "#fcf7ee", accent: "#1b8584", line: "#e8b545" },
  autumn: { visual: "linear-gradient(155deg,#d08236 0%,#a3531f 45%,#4c2a10 100%)", bg: "#faf3e7", accent: "#b4561d", line: "#dc9c3f" },
};
const LANG_NAME: Record<PopupLang, string> = { ro: "Română", de: "Deutsch", pl: "Polski", en: "English" };
const GROUPS: Array<{ key: TKey; fields: Array<keyof PopupTexts> }> = [
  { key: "popup.groupBefore", fields: ["bigLabel", "bigSub", "eyebrow", "heading", "text", "placeholder", "button", "note", "decline"] },
  { key: "popup.groupAfter", fields: ["successEyebrow", "successHeading", "successText", "successButton", "successNote"] },
  { key: "popup.groupSystem", fields: ["copy", "copied", "close", "invalid", "failed"] },
];
const MULTI = new Set<keyof PopupTexts>(["text", "successText", "note"]);

const FRAME = { desktop: { w: 1100, h: 700 }, mobile: { w: 390, h: 780 } } as const;
const PREVIEW_DOC = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&display=swap">
<style>${popupCss}
html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#fff;overflow:hidden}
.pv{padding:22px 28px;color:#999}.pv-h{display:flex;justify-content:space-between;align-items:center;padding-bottom:18px;border-bottom:1px solid #eee}
.pv-b{height:12px;border-radius:6px;background:#e9e6e1}.pv-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px;margin-top:24px}
.pv-c{height:210px;border-radius:10px;background:#efece7}
</style></head><body>
<div class="pv"><div class="pv-h"><div class="pv-b" style="width:120px;height:18px"></div><div style="display:flex;gap:14px"><div class="pv-b" style="width:60px"></div><div class="pv-b" style="width:60px"></div><div class="pv-b" style="width:28px"></div></div></div>
<div class="pv-b" style="width:45%;height:26px;margin-top:28px"></div><div class="pv-g"><div class="pv-c"></div><div class="pv-c"></div><div class="pv-c"></div><div class="pv-c"></div><div class="pv-c"></div><div class="pv-c"></div></div></div>
<script>${popupJs}</script>
<script>
var cur=null;
function draw(d){try{var ui=window.SemaforPopupUI.render(d.cfg,d.lang,{preview:true,instant:true,state:d.state,code:d.cfg.code});if(cur&&cur.parentNode)cur.parentNode.removeChild(cur);document.body.appendChild(ui.root);cur=ui.root;}catch(e){console.error(e)}}
window.addEventListener('message',function(e){if(e.data&&e.data.type==='smf-pp')draw(e.data)});
parent.postMessage({type:'smf-pp-ready'},'*');
</script></body></html>`;

function Preview({ cfg, lang, state, device }: { cfg: unknown; lang: PopupLang; state: "form" | "success"; device: "desktop" | "mobile" }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(600);
  const msg = useMemo(() => ({ type: "smf-pp", cfg, lang, state }), [cfg, lang, state]);
  const latest = useRef(msg);
  latest.current = msg;
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && e.data?.type === "smf-pp-ready") frame.current?.contentWindow?.postMessage(latest.current, "*"); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  useEffect(() => { frame.current?.contentWindow?.postMessage(msg, "*"); }, [msg, device]);
  const f = FRAME[device];
  const scale = Math.min(1, width / f.w);
  return (
    <div ref={box} className="sf-pp-stage" style={{ height: f.h * scale }}>
      <div style={{ width: f.w, height: f.h, transform: `scale(${scale})`, transformOrigin: "top left", marginLeft: Math.max(0, (width - f.w * scale) / 2) }} className="sf-pp-device">
        <iframe key={device} ref={frame} title="preview" sandbox="allow-scripts" srcDoc={PREVIEW_DOC} onLoad={() => frame.current?.contentWindow?.postMessage(latest.current, "*")} style={{ width: f.w, height: f.h, border: 0, display: "block" }} />
      </div>
    </div>
  );
}

export default function PopupPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const codeFetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const tr = useT();
  const lang = useLang();
  const [p, setP] = useState<PopupSettings>(data.popup as PopupSettings);
  const [texts, setTexts] = useState<Texts>(data.texts as Texts);
  const [wtexts, setWtexts] = useState<WTexts>(data.wtexts as WTexts);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const welcomeFetcher = useFetcher<typeof action>();
  const wres: any = welcomeFetcher.data;
  /** Toggling the welcome e-mail swaps the untouched pop-up texts between "code comes by e-mail" and "code shown here". */
  const setWelcome = (on: boolean) => {
    setP((x) => ({ ...x, welcome: on }));
    setTexts((cur) => Object.fromEntries(POPUP_LANGS.map((l) => {
      const from = popupDefaults(l, !on), to = popupDefaults(l, on);
      return [l, Object.fromEntries(Object.entries(cur[l]).map(([k, v]) => [k, v === (from as any)[k] ? (to as any)[k] : v]))];
    })) as Texts);
  };
  const [tab, setTab] = useState(0);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [state, setState] = useState<"form" | "success">("form");
  const [advanced, setAdvanced] = useState(p.codeMode === "own");
  const [otherPct, setOtherPct] = useState(!PCT_CHOICES.includes(Number(p.pct)));
  const set = <K extends keyof PopupSettings>(k: K, v: PopupSettings[K]) => setP((x) => ({ ...x, [k]: v }));
  const tl = POPUP_LANGS[tab];

  const res: any = fetcher.data;
  useEffect(() => { if (fetcher.state === "idle" && res?.ok && !res.pushError) app.toast.show(tr("popup.saved")); }, [fetcher.state, res, app, tr]);
  useEffect(() => { if (fetcher.state === "idle" && res?.savedCode) setP((x) => ({ ...x, code: res.savedCode })); }, [fetcher.state, res]);
  const codeInfo: CodeCheck = (codeFetcher.data as any)?.code ?? res?.code ?? data.code;

  const draft = useMemo(() => ({ ...p, texts, welcomeTexts: wtexts }), [p, texts, wtexts]);
  const promiseWarn = !p.welcome && POPUP_LANGS.some((l) => promisesEmail(texts[l]));
  const cfg = useMemo(() => { const c = cleanPopup({ ...draft, enabled: true }); if (c.codeMode === "auto" && draft.code?.startsWith(c.code)) c.code = draft.code; return buildPopupConfig(c, data.shopName); }, [draft, data.shopName]);
  const save = useCallback(() => fetcher.submit({ payload: JSON.stringify(draft) }, { method: "post" }), [fetcher, draft]);
  const checkCode = () => codeFetcher.submit({ intent: "checkCode", code: p.code }, { method: "post" });

  const seen = data.seenAt ? new Date(data.seenAt) : null;
  const seenRecent = !!seen && Date.now() - +seen < 3 * 86_400_000;
  const auto = p.codeMode !== "own";
  const code = auto ? (res?.savedCode && (res.savedCode as string).startsWith(autoCode(p.pct)) ? res.savedCode : autoCode(p.pct)) : (p.code || "").trim().toUpperCase();

  return (
    <Page fullWidth>
      <TitleBar title={tr("nav.popup")}>
        <button variant="primary" onClick={save} disabled={fetcher.state !== "idle"}>{tr("common.save")}</button>
      </TitleBar>
      <BlockStack gap="500">
        {/* status + install */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="start" gap="400">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h1" variant="headingLg">{tr("nav.popup")}</Text>
                  <Badge tone={p.enabled ? "success" : undefined}>{p.enabled ? tr("popup.on") : tr("popup.off")}</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">{tr("popup.subtitle")}</Text>
              </BlockStack>
              <Checkbox label={tr("popup.enabled")} checked={p.enabled} onChange={(v) => set("enabled", v)} helpText={tr("popup.enabledHelp")} />
            </InlineStack>
            <Divider />
            <div className="sf-pp-embed">
              <span className={`sf-pp-embed-icon${seenRecent ? " ok" : ""}`}><Icon source={seenRecent ? CheckCircleIcon : AlertCircleIcon} /></span>
              <BlockStack gap="100">
                <Text as="h2" variant="headingSm">{seenRecent && seen ? tr("popup.embedSeen", { date: seen.toLocaleString(dateLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }) : tr("popup.embedTitle")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{tr("popup.embedBody")}</Text>
                <Text as="p" variant="bodySm" tone="caution">{tr("popup.embedNote")}</Text>
              </BlockStack>
              <Button url={data.editorUrl} target="_blank" icon={ExternalIcon} variant={seenRecent ? "secondary" : "primary"}>{tr("popup.embedButton")}</Button>
            </div>
            {res?.pushError && <Banner tone="critical">{tr("popup.pushError", { error: res.pushError })}</Banner>}
          </BlockStack>
        </Card>

        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="300">
          <Kpi icon={EmailIcon} label={tr("popup.kpiLeads")} value={data.stats.leads} hint={tr("popup.kpiLeadsHint")} />
          <Kpi icon={CartIcon} label={tr("popup.kpiCart")} value={data.stats.cart} hint={tr("popup.kpiCartHint")} />
          <Kpi icon={OrderIcon} label={tr("popup.kpiOrdered")} value={data.stats.ordered} tone={data.stats.ordered ? "success" : undefined} hint={tr("popup.kpiOrderedHint")} />
          <AttrKpi s={data.attr} sources={["popup_site", "popup_cart"]} src="popup" />
        </InlineGrid>

        <div className="sf-pp-layout">
          <BlockStack gap="400">
            {/* when */}
            <Card>
              <BlockStack gap="400">
                <SectionHead title={tr("popup.whenHeading")} />
                <div className="sf-pp-modes" role="radiogroup">
                  {(["smart", "site", "cart"] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={p.mode === m} className={`sf-pp-mode${p.mode === m ? " active" : ""}`} onClick={() => set("mode", m)}>
                      <span className="sf-pp-mode-icon"><Icon source={m === "smart" ? MagicIcon : m === "site" ? EmailIcon : CartIcon} /></span>
                      <span className="sf-pp-mode-title">{tr(m === "smart" ? "popup.modeSmart" : m === "site" ? "popup.modeSite" : "popup.modeCart")}{m === "smart" && <> <Badge tone="success">{tr("popup.recommended")}</Badge></>}</span>
                      <span className="sf-pp-mode-desc">{tr(m === "smart" ? "popup.modeSmartDesc" : m === "site" ? "popup.modeSiteDesc" : "popup.modeCartDesc")}</span>
                    </button>
                  ))}
                </div>
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                  {p.mode !== "cart" && <TextField label={tr("popup.delay")} type="number" min={0} max={300} value={String(p.delay)} onChange={(v) => set("delay", Number(v))} autoComplete="off" />}
                  {p.mode !== "site" && <TextField label={tr(p.mode === "smart" ? "popup.cartDelaySmart" : "popup.cartDelay")} type="number" min={0} max={120} value={String(p.cartDelay)} onChange={(v) => set("cartDelay", Number(v))} autoComplete="off" helpText={tr("popup.cartDelayHelp")} />}
                  <TextField label={tr("popup.hideDays")} type="number" min={1} max={365} value={String(p.hideDays)} onChange={(v) => set("hideDays", Number(v))} autoComplete="off" />
                </InlineGrid>
                <Checkbox label={tr("popup.exitIntent")} checked={p.exitIntent} onChange={(v) => set("exitIntent", v)} />
                <Text as="p" variant="bodySm" tone="subdued">{tr("popup.hideHelp")}</Text>
              </BlockStack>
            </Card>

            {/* discount */}
            <Card>
              <BlockStack gap="400">
                <SectionHead title={tr("popup.discountHeading")} description={tr("popup.discountDescSimple")} />
                <InlineStack gap="200" blockAlign="center">
                  {PCT_CHOICES.map((x) => (
                    <button key={x} type="button" className={`sf-pp-chip${!otherPct && Number(p.pct) === x ? " active" : ""}`} aria-pressed={!otherPct && Number(p.pct) === x} onClick={() => { setOtherPct(false); set("pct", x); }}>{x}%</button>
                  ))}
                  <button type="button" className={`sf-pp-chip${otherPct ? " active" : ""}`} aria-pressed={otherPct} onClick={() => setOtherPct(true)}>{tr("popup.pctOther")}</button>
                  {otherPct && <div style={{ width: 96 }}><TextField label={tr("popup.pct")} labelHidden type="number" min={1} max={90} suffix="%" value={String(p.pct)} onChange={(v) => set("pct", Number(v))} autoComplete="off" /></div>}
                </InlineStack>
                {auto ? (
                  <BlockStack gap="150">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={codeInfo?.exists && codeInfo.pct === Number(p.pct) ? "success" : "info"}>{code}</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">{codeInfo?.exists && codeInfo.pct === Number(p.pct) ? tr("popup.autoActive", { pct: p.pct }) : tr("popup.autoWill", { code, pct: p.pct })}</Text>
                    </InlineStack>
                    {res?.codeError && <Banner tone="critical">{tr("popup.autoError", { error: res.codeError })}</Banner>}
                  </BlockStack>
                ) : null}
                <Box>
                  <Button variant="plain" disclosure={advanced ? "up" : "down"} onClick={() => setAdvanced((v) => !v)}>{tr("popup.advanced")}</Button>
                </Box>
                <Collapsible id="sf-pp-own" open={advanced}>
                  <BlockStack gap="300">
                    <Checkbox label={tr("popup.ownCode")} checked={!auto} onChange={(v) => set("codeMode", v ? "own" : "auto")} helpText={tr("popup.ownCodeHelp")} />
                    {!auto && (
                      <>
                        <TextField label={tr("popup.code")} value={p.code} onChange={(v) => set("code", v.toUpperCase().replace(/\s+/g, ""))} onBlur={checkCode} autoComplete="off" monospaced />
                        {code && codeInfo && (
                          !codeInfo.exists
                            ? <Banner tone="critical" action={{ content: tr("popup.openDiscounts"), url: data.discountsUrl, target: "_blank" }}>{tr("popup.codeMissing", { code })}</Banner>
                            : codeInfo.status && codeInfo.status !== "ACTIVE"
                              ? <Banner tone="warning" action={{ content: tr("popup.openDiscounts"), url: data.discountsUrl, target: "_blank" }}>{tr("popup.codeInactive", { code, status: codeInfo.status })}</Banner>
                              : <InlineStack gap="200" blockAlign="center"><Badge tone="success">{code}</Badge><Text as="span" variant="bodySm" tone="subdued">{tr("popup.codeOk", { title: codeInfo.title || code })}</Text></InlineStack>
                        )}
                        {codeInfo?.exists && codeInfo.pct != null && codeInfo.pct !== Number(p.pct) && <Banner tone="info">{tr("popup.codePct", { pct: codeInfo.pct, shown: p.pct })}</Banner>}
                      </>
                    )}
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>

            {/* design */}
            <Card>
              <BlockStack gap="400">
                <SectionHead title={tr("popup.designHeading")} description={tr("popup.designDesc")} />
                <div className="sf-pp-designs" role="radiogroup">
                  {POPUP_DESIGNS.map((d) => (
                    <button key={d} type="button" role="radio" aria-checked={p.design === d} className={`sf-pp-thumb${p.design === d ? " active" : ""}`} onClick={() => set("design", d)}>
                      <span className="sf-pp-thumb-art" style={{ background: THUMB[d].bg }}>
                        <span className="v" style={{ background: THUMB[d].visual }}><b>-%</b></span>
                        <span className="c"><i style={{ background: THUMB[d].line }} /><i /><i /><em style={{ background: THUMB[d].accent }} /></span>
                      </span>
                      <span className="sf-pp-thumb-name">{tr(`popup.design.${d}` as TKey)}</span>
                    </button>
                  ))}
                </div>
                <TextField label={tr("popup.imageUrl")} value={p.imageUrl} onChange={(v) => set("imageUrl", v.trim())} autoComplete="off" placeholder="https://cdn.shopify.com/…" helpText={tr("popup.imageHelp")} />
              </BlockStack>
            </Card>

            {/* texts */}
            <Card padding="0">
              <Box padding="400"><SectionHead title={tr("popup.textsHeading")} description={tr("popup.textsDesc")} /></Box>
              <Tabs tabs={POPUP_LANGS.map((l) => ({ id: l, content: LANG_NAME[l] }))} selected={tab} onSelect={setTab} />
              <Box padding="400">
                <BlockStack gap="500">
                  {GROUPS.map((g) => (
                    <BlockStack key={g.key} gap="300">
                      <Text as="h3" variant="headingSm">{tr(g.key)}</Text>
                      <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                        {g.fields.map((k) => (
                          <div key={k} style={MULTI.has(k) ? { gridColumn: "1 / -1" } : undefined}>
                            <TextField label={tr(`popup.f.${k}` as TKey)} value={texts[tl][k]} multiline={MULTI.has(k) ? 3 : undefined} autoComplete="off"
                              onFocus={() => setState(g.key === "popup.groupAfter" ? "success" : "form")}
                              onChange={(v) => setTexts((x) => ({ ...x, [tl]: { ...x[tl], [k]: v } }))} />
                          </div>
                        ))}
                      </InlineGrid>
                    </BlockStack>
                  ))}
                  <InlineStack align="start">
                    <Button variant="plain" onClick={() => setTexts((x) => ({ ...x, [tl]: { ...popupDefaults(tl, p.welcome) } }))}>{tr("popup.textsReset")}</Button>
                  </InlineStack>
                </BlockStack>
              </Box>
            </Card>

            {/* welcome e-mail */}
            <Card>
              <BlockStack gap="300">
                <SectionHead title={tr("popup.welcomeHeading")} description={tr("popup.welcomeDesc")} />
                <Checkbox label={tr("popup.welcomeToggle")} checked={p.welcome} onChange={setWelcome} />
                {promiseWarn && <Banner tone="warning">{tr("popup.welcomePromiseWarn")}</Banner>}
                {p.welcome && (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued">{tr("popup.welcomeSender", { sender: data.mail.sender || "—" })}</Text>
                    {data.mail.semaforDomain && <Text as="p" variant="bodySm" tone="subdued">{tr("popup.welcomeOwnDomain")}</Text>}
                    {!data.mail.ready && <Banner tone="info">{tr("client.sendingSoon")}</Banner>}
                    <Box>
                      <Button variant="plain" disclosure={welcomeOpen ? "up" : "down"} onClick={() => setWelcomeOpen((v) => !v)}>{tr("popup.welcomeEdit", { lang: LANG_NAME[tl] })}</Button>
                    </Box>
                    <Collapsible id="sf-pp-welcome" open={welcomeOpen}>
                      <BlockStack gap="300">
                        <Tabs tabs={POPUP_LANGS.map((l) => ({ id: "w-" + l, content: LANG_NAME[l] }))} selected={tab} onSelect={setTab} />
                        {WELCOME_KEYS.map((k) => (
                          <TextField key={k} label={tr(`popup.w.${k}` as TKey)} value={wtexts[tl][k]} multiline={k === "text" || k === "note" ? 2 : undefined} autoComplete="off"
                            onChange={(v) => setWtexts((x) => ({ ...x, [tl]: { ...x[tl], [k]: v } }))} />
                        ))}
                        <InlineStack gap="200" blockAlign="end">
                          <div style={{ flex: 1, minWidth: 200 }}><TextField label={tr("popup.welcomeTestTo")} type="email" value={testTo} onChange={setTestTo} autoComplete="email" placeholder="you@example.com" /></div>
                          <Button onClick={() => welcomeFetcher.submit({ intent: "welcomePreview", payload: JSON.stringify(draft), lang: tl }, { method: "post" })} loading={welcomeFetcher.state !== "idle" && welcomeFetcher.formData?.get("intent") === "welcomePreview"}>{tr("client.preview")}</Button>
                          <Button disabled={!data.mail.ready} onClick={() => welcomeFetcher.submit({ intent: "welcomeTest", payload: JSON.stringify(draft), lang: tl, to: testTo }, { method: "post" })} loading={welcomeFetcher.state !== "idle" && welcomeFetcher.formData?.get("intent") === "welcomeTest"}>{tr("common.sendTest")}</Button>
                        </InlineStack>
                        {wres && !wres.ok && <Banner tone="critical">{wres.error === "invalid" ? tr("emails.msg.invalidEmail") : wres.error}</Banner>}
                        {wres?.ok && wres.sent && <Banner tone="success">{tr("popup.welcomeTestSent", { to: wres.to })}</Banner>}
                        {wres?.ok && wres.html && (
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">{tr("common.subjectPrefix")}<b>{wres.subject}</b></Text>
                            <Box borderColor="border" borderWidth="025" borderRadius="200" overflowX="hidden" overflowY="hidden">
                              <iframe title="welcome" sandbox="" srcDoc={wres.html} style={{ width: "100%", height: 620, border: 0 }} />
                            </Box>
                          </BlockStack>
                        )}
                      </BlockStack>
                    </Collapsible>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingSm">{tr("popup.howTitle")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{tr("popup.howBody")}</Text>
                <Text as="p" variant="bodySm" tone={data.recovery.pro && data.recovery.auto ? "success" : "caution"}>
                  {!data.recovery.pro ? tr("popup.howPro") : data.recovery.auto ? tr("popup.howProOn") : tr("popup.howProOff")}
                </Text>
              </BlockStack>
            </Card>

            <InlineStack align="end">
              <Button variant="primary" size="large" loading={fetcher.state !== "idle"} onClick={save}>{tr("common.save")}</Button>
            </InlineStack>
          </BlockStack>

          {/* live preview */}
          <div className="sf-pp-sticky">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center" gap="200">
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd">{tr("popup.preview")}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{tr("popup.previewNote")} · {LANG_NAME[tl]}</Text>
                  </BlockStack>
                  <InlineStack gap="200">
                    <ButtonGroup variant="segmented">
                      <Button pressed={state === "form"} onClick={() => setState("form")}>{tr("popup.stateForm")}</Button>
                      <Button pressed={state === "success"} onClick={() => setState("success")}>{tr("popup.stateSuccess")}</Button>
                    </ButtonGroup>
                    <ButtonGroup variant="segmented">
                      <Button pressed={device === "desktop"} onClick={() => setDevice("desktop")}>{tr("popup.desktop")}</Button>
                      <Button pressed={device === "mobile"} onClick={() => setDevice("mobile")}>{tr("popup.mobile")}</Button>
                    </ButtonGroup>
                  </InlineStack>
                </InlineStack>
                <Preview cfg={cfg} lang={tl} state={state} device={device} />
              </BlockStack>
            </Card>
          </div>
        </div>
      </BlockStack>
    </Page>
  );
}
