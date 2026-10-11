import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, InlineGrid, Text, Checkbox, TextField, Button, ButtonGroup, Banner, Badge, Box, Divider, Tabs, Icon } from "@shopify/polaris";
import { EmailIcon, CartIcon, OrderIcon, ExternalIcon, CheckCircleIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShop, saveSettings } from "../semafor/shop.server";
import { requireFeature, planOf } from "../semafor/plan.server";
import { pushPopupConfig, checkDiscountCode, popupStats, type CodeCheck } from "../semafor/popup.server";
import { can } from "../../core/plans";
import { POPUP_LANGS, POPUP_DESIGNS, type PopupLang, type PopupSettings, type PopupTexts } from "../../core/settings";
import { POPUP_DEFAULT_TEXTS, buildPopupConfig, cleanPopup, popupTexts } from "../../core/popup";
import { Kpi, SectionHead } from "../components/semafor-ui";
import { useT, useLang, dateLocale, type TKey } from "../i18n";
// the storefront files themselves → the preview is exactly what visitors see
import popupCss from "../../extensions/semafor-popup/assets/popup.css?raw";
import popupJs from "../../extensions/semafor-popup/assets/popup.js?raw";

type Texts = Record<PopupLang, PopupTexts>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "popup", redirect);
  const p = shop.settings.popup;
  let shopName = "";
  try { const j: any = await (await admin.graphql(`query { shop { name } }`)).json(); shopName = j?.data?.shop?.name || ""; } catch { /* ignore */ }
  const [stats, code] = await Promise.all([popupStats(shop.id, 30), checkDiscountCode(admin as any, p.code)]);
  const texts = Object.fromEntries(POPUP_LANGS.map((l) => [l, popupTexts(p, l)])) as Texts;
  const plan = planOf(shop);
  const handle = session.shop.replace(/\.myshopify\.com$/, "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  return {
    popup: p, texts, shopName, stats, code,
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
  if (fd.get("intent") === "checkCode") return { check: true, code: await checkDiscountCode(admin as any, String(fd.get("code") || "").trim().toUpperCase()) };
  let input: Partial<PopupSettings>;
  try { input = JSON.parse(String(fd.get("payload") || "{}")); } catch { return { ok: false, pushError: "bad payload" }; }
  const popup = cleanPopup(input);
  const next = await saveSettings(shop.id, { popup }, (session as any).email || session.shop);
  let pushError: string | null = null;
  try { await pushPopupConfig(admin as any, { ...shop, settings: next }); } catch (e: any) { pushError = String(e?.message || e).slice(0, 300); console.error("[semafor] popup push", pushError); }
  return { ok: true, pushError, code: await checkDiscountCode(admin as any, popup.code) };
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
  const [tab, setTab] = useState(0);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [state, setState] = useState<"form" | "success">("form");
  const set = <K extends keyof PopupSettings>(k: K, v: PopupSettings[K]) => setP((x) => ({ ...x, [k]: v }));
  const tl = POPUP_LANGS[tab];

  const res: any = fetcher.data;
  useEffect(() => { if (fetcher.state === "idle" && res?.ok && !res.pushError) app.toast.show(tr("popup.saved")); }, [fetcher.state, res, app, tr]);
  const codeInfo: CodeCheck = (codeFetcher.data as any)?.code ?? res?.code ?? data.code;

  const draft = useMemo(() => ({ ...p, texts }), [p, texts]);
  const cfg = useMemo(() => buildPopupConfig(cleanPopup({ ...draft, enabled: true }), data.shopName), [draft, data.shopName]);
  const save = useCallback(() => fetcher.submit({ payload: JSON.stringify(draft) }, { method: "post" }), [fetcher, draft]);
  const checkCode = () => codeFetcher.submit({ intent: "checkCode", code: p.code }, { method: "post" });

  const seen = data.seenAt ? new Date(data.seenAt) : null;
  const seenRecent = !!seen && Date.now() - +seen < 3 * 86_400_000;
  const code = (p.code || "").trim().toUpperCase();

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

        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
          <Kpi icon={EmailIcon} label={tr("popup.kpiLeads")} value={data.stats.leads} hint={tr("popup.kpiLeadsHint")} />
          <Kpi icon={CartIcon} label={tr("popup.kpiCart")} value={data.stats.cart} hint={tr("popup.kpiCartHint")} />
          <Kpi icon={OrderIcon} label={tr("popup.kpiOrdered")} value={data.stats.ordered} tone={data.stats.ordered ? "success" : undefined} hint={tr("popup.kpiOrderedHint")} />
        </InlineGrid>

        <div className="sf-pp-layout">
          <BlockStack gap="400">
            {/* when */}
            <Card>
              <BlockStack gap="400">
                <SectionHead title={tr("popup.whenHeading")} />
                <div className="sf-pp-modes" role="radiogroup">
                  {(["site", "cart"] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={p.mode === m} className={`sf-pp-mode${p.mode === m ? " active" : ""}`} onClick={() => set("mode", m)}>
                      <span className="sf-pp-mode-icon"><Icon source={m === "site" ? EmailIcon : CartIcon} /></span>
                      <span className="sf-pp-mode-title">{tr(m === "site" ? "popup.modeSite" : "popup.modeCart")}</span>
                      <span className="sf-pp-mode-desc">{tr(m === "site" ? "popup.modeSiteDesc" : "popup.modeCartDesc")}</span>
                    </button>
                  ))}
                </div>
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                  {p.mode === "site"
                    ? <TextField label={tr("popup.delay")} type="number" min={0} max={300} value={String(p.delay)} onChange={(v) => set("delay", Number(v))} autoComplete="off" />
                    : <TextField label={tr("popup.cartDelay")} type="number" min={0} max={120} value={String(p.cartDelay)} onChange={(v) => set("cartDelay", Number(v))} autoComplete="off" helpText={tr("popup.cartDelayHelp")} />}
                  <TextField label={tr("popup.hideDays")} type="number" min={1} max={365} value={String(p.hideDays)} onChange={(v) => set("hideDays", Number(v))} autoComplete="off" />
                </InlineGrid>
                <Checkbox label={tr("popup.exitIntent")} checked={p.exitIntent} onChange={(v) => set("exitIntent", v)} />
                <Text as="p" variant="bodySm" tone="subdued">{tr("popup.hideHelp")}</Text>
              </BlockStack>
            </Card>

            {/* discount */}
            <Card>
              <BlockStack gap="400">
                <SectionHead title={tr("popup.discountHeading")} description={tr("popup.discountDesc")} />
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                  <TextField label={tr("popup.code")} value={p.code} onChange={(v) => set("code", v.toUpperCase().replace(/\s+/g, ""))} onBlur={checkCode} autoComplete="off" monospaced />
                  <TextField label={tr("popup.pct")} type="number" min={1} max={100} suffix="%" value={String(p.pct)} onChange={(v) => set("pct", Number(v))} autoComplete="off" />
                </InlineGrid>
                {code && codeInfo && (
                  !codeInfo.exists
                    ? <Banner tone="critical" action={{ content: tr("popup.openDiscounts"), url: data.discountsUrl, target: "_blank" }}>{tr("popup.codeMissing", { code })}</Banner>
                    : codeInfo.status && codeInfo.status !== "ACTIVE"
                      ? <Banner tone="warning" action={{ content: tr("popup.openDiscounts"), url: data.discountsUrl, target: "_blank" }}>{tr("popup.codeInactive", { code, status: codeInfo.status })}</Banner>
                      : <InlineStack gap="200" blockAlign="center"><Badge tone="success">{code}</Badge><Text as="span" variant="bodySm" tone="subdued">{tr("popup.codeOk", { title: codeInfo.title || code })}</Text></InlineStack>
                )}
                {codeInfo?.exists && codeInfo.pct != null && codeInfo.pct !== Number(p.pct) && <Banner tone="info">{tr("popup.codePct", { pct: codeInfo.pct, shown: p.pct })}</Banner>}
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
                    <Button variant="plain" onClick={() => setTexts((x) => ({ ...x, [tl]: { ...POPUP_DEFAULT_TEXTS[tl] } }))}>{tr("popup.textsReset")}</Button>
                  </InlineStack>
                </BlockStack>
              </Box>
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
