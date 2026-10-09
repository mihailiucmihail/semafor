import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, Select, Checkbox, TextField, Button, FormLayout, Banner } from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShop, saveSettings } from "../semafor/shop.server";
import { pushCheckoutMetafield, buildCheckoutPayload, syncPaymentBlock } from "../semafor/entries.server";
import { ensureWebhooks, ensurePixel } from "../semafor/webhooks.server";
import { planOf } from "../semafor/plan.server";
import { can } from "../../core/plans";
import { useT, useLang, trMsg, type TKey } from "../i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const webhooks = await ensureWebhooks(admin as any, session.shop, true).catch((e) => [{ topic: "ALL", ok: false, error: String(e?.message || e) }]);
  const pixel = await ensurePixel(admin as any, session.shop, true);
  const pay: any = await syncPaymentBlock(admin as any, await buildCheckoutPayload(shop.id)).catch((e: any) => ({ ok: false, error: String(e?.message || e) }));
  const plan = planOf(shop);
  return { settings: shop.settings, basic: can(plan, "auto_cancel"), webhooks: [...(webhooks as any[]), pixel, { topic: "PAYMENTS", ok: pay.ok, error: pay.error }] };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const fd = await request.formData();
  await saveSettings(shop.id, {
    yellowAction: String(fd.get("yellowAction")) as any,
    cancelRed: fd.get("cancelRed") === "true",
    shareNetwork: fd.get("shareNetwork") === "true",
    thresholds: { block: Number(fd.get("block")) || 100, warn: Number(fd.get("warn")) || 40 },
    // language is sent only when the merchant picked one; otherwise the stored choice (or automatic) stays
    uiLang: fd.get("uiLang") === "en" || fd.get("uiLang") === "ro" ? (String(fd.get("uiLang")) as "en" | "ro") : shop.settings.uiLang ?? null,
  }, (session as any).email || session.shop);
  await pushCheckoutMetafield(admin, shop.id);
  return { ok: true };
};

export default function Settings() {
  const { settings, webhooks, basic } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const tr = useT();
  const lang = useLang();
  const [s, setS] = useState({ yellowAction: settings.yellowAction, cancelRed: settings.cancelRed, shareNetwork: settings.shareNetwork, block: String(settings.thresholds.block), warn: String(settings.thresholds.warn), uiLang: settings.uiLang || "" });
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) app.toast.show(tr("common.settingsSaved")); }, [fetcher.state, fetcher.data, app, tr]);
  const topicLabel = (topic: string) => (["ORDERS_CREATE", "APP_UNINSTALLED", "ORDERS_PAID", "ORDERS_CANCELLED", "ORDERS_FULFILLED", "PIXEL", "PAYMENTS"].includes(topic) ? tr(`settings.topic.${topic}` as TKey) : topic);

  return (
    <Page narrowWidth>
      <TitleBar title={tr("nav.settings")} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{tr("settings.ordersHeading")}</Text>
                {!basic && <Banner tone="info" action={{ content: tr("settings.seePlans"), url: "/app/plan" }}>{tr("settings.freeBanner")}</Banner>}
                <FormLayout>
                  <Select label={tr("settings.yellowLabel")} disabled={!basic} value={basic ? s.yellowAction : "tag"} onChange={(v) => setS({ ...s, yellowAction: v as any })}
                    options={[
                      { label: tr("settings.yellowTag"), value: "tag" },
                      { label: tr("settings.yellowPrepaid"), value: "prepaid" },
                      { label: tr("settings.yellowBlock"), value: "block" },
                    ]} helpText={tr("settings.yellowHelp")} />
                  <Checkbox label={tr("settings.cancelRed")} disabled={!basic} checked={basic && s.cancelRed} onChange={(v) => setS({ ...s, cancelRed: v })} helpText={tr("settings.cancelRedHelp")} />
                </FormLayout>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{tr("settings.networkHeading")}</Text>
                <Checkbox label={tr("settings.networkLabel")} checked={s.shareNetwork} onChange={(v) => setS({ ...s, shareNetwork: v })}
                  helpText={tr("settings.networkHelp")} />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{tr("settings.thresholdsHeading")}</Text>
                <FormLayout.Group>
                  <TextField label={tr("settings.blockFrom")} type="number" value={s.block} onChange={(v) => setS({ ...s, block: v })} autoComplete="off" helpText={tr("settings.blockHelp")} />
                  <TextField label={tr("settings.warnFrom")} type="number" value={s.warn} onChange={(v) => setS({ ...s, warn: v })} autoComplete="off" helpText={tr("settings.warnHelp")} />
                </FormLayout.Group>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">{tr("settings.connHeading")}</Text>
                {(webhooks as any[]).map((w) => (
                  <Text as="p" key={w.topic} tone={w.ok ? "success" : "critical"}>
                    {w.ok ? "✓" : "✗"} {topicLabel(w.topic)}
                    {w.ok ? tr("settings.active") : tr("settings.error", { e: trMsg(lang, w.error) })}
                  </Text>
                ))}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{tr("settings.langHeading")}</Text>
                <Select label={tr("settings.langLabel")} value={s.uiLang || lang} onChange={(v) => setS({ ...s, uiLang: v as "en" | "ro" })}
                  options={[{ label: "English", value: "en" }, { label: "Română", value: "ro" }]} helpText={tr("settings.langHelp")} />
              </BlockStack>
            </Card>
            <Button variant="primary" loading={fetcher.state !== "idle"} onClick={() => fetcher.submit({ ...s, cancelRed: String(s.cancelRed), shareNetwork: String(s.shareNetwork) }, { method: "post" })}>{tr("common.save")}</Button>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
