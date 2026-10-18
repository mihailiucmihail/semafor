import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Select, Checkbox, TextField, Button, FormLayout, Banner, Badge, Icon, Divider } from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { Lamp } from "../components/semafor-ui";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShop, saveSettings } from "../semafor/shop.server";
import { pushCheckoutMetafield, buildCheckoutPayload, syncPaymentBlock } from "../semafor/entries.server";
import { ensureWebhooks, ensurePixel } from "../semafor/webhooks.server";
import { planOf } from "../semafor/plan.server";
import { can } from "../../core/plans";
import { useT, useLang, trMsg, isLang, LANGS, LANG_NAMES, type Lang, type TKey } from "../i18n";

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
    tagAttributed: fd.get("tagAttributed") !== "false",
    thresholds: { block: Number(fd.get("block")) || 100, warn: Number(fd.get("warn")) || 40 },
    // language is sent only when the merchant picked one; otherwise the stored choice (or automatic) stays
    uiLang: isLang(fd.get("uiLang")) ? (fd.get("uiLang") as Lang) : shop.settings.uiLang ?? null,
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
  const [s, setS] = useState({ yellowAction: settings.yellowAction, cancelRed: settings.cancelRed, shareNetwork: settings.shareNetwork, tagAttributed: settings.tagAttributed !== false, block: String(settings.thresholds.block), warn: String(settings.thresholds.warn), uiLang: settings.uiLang || "" });
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) app.toast.show(tr("common.settingsSaved")); }, [fetcher.state, fetcher.data, app, tr]);
  const topicLabel = (topic: string) => (["ORDERS_CREATE", "APP_UNINSTALLED", "ORDERS_PAID", "ORDERS_CANCELLED", "ORDERS_FULFILLED", "ORDERS_UPDATED", "PIXEL", "PAYMENTS"].includes(topic) ? tr(`settings.topic.${topic}` as TKey) : topic);

  const allOk = (webhooks as any[]).every((w) => w.ok);
  const save = () => fetcher.submit({ ...s, cancelRed: String(s.cancelRed), shareNetwork: String(s.shareNetwork), tagAttributed: String(s.tagAttributed) }, { method: "post" });

  return (
    <Page fullWidth>
      <TitleBar title={tr("nav.settings")} />
      <BlockStack gap="500">
        <Layout>
          <Layout.AnnotatedSection title={tr("settings.ordersHeading")} description={tr("settings.ordersDesc")}>
            <Card>
              <BlockStack gap="400">
                {!basic && <Banner tone="info" action={{ content: tr("settings.seePlans"), url: "/app/plan" }}>{tr("settings.freeBanner")}</Banner>}
                <InlineStack gap="300" blockAlign="start" wrap={false}>
                  <Lamp level="yellow" label={tr("level.yellow")} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Select label={tr("settings.yellowLabel")} disabled={!basic} value={basic ? s.yellowAction : "tag"} onChange={(v) => setS({ ...s, yellowAction: v as any })}
                      options={[
                        { label: tr("settings.yellowTag"), value: "tag" },
                        { label: tr("settings.yellowPrepaid"), value: "prepaid" },
                        { label: tr("settings.yellowBlock"), value: "block" },
                      ]} helpText={tr("settings.yellowHelp")} />
                  </div>
                </InlineStack>
                <Divider />
                <InlineStack gap="300" blockAlign="start" wrap={false}>
                  <Lamp level="red" label={tr("level.red")} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Checkbox label={tr("settings.cancelRed")} disabled={!basic} checked={basic && s.cancelRed} onChange={(v) => setS({ ...s, cancelRed: v })} helpText={tr("settings.cancelRedHelp")} />
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection title={tr("settings.networkHeading")} description={tr("settings.networkDesc")}>
            <Card>
              <Checkbox label={tr("settings.networkLabel")} checked={s.shareNetwork} onChange={(v) => setS({ ...s, shareNetwork: v })} helpText={tr("settings.networkHelp")} />
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection title={tr("attr.settingsHeading")} description={tr("attr.settingsDesc")}>
            <Card>
              <Checkbox label={tr("attr.settingsLabel")} checked={s.tagAttributed} onChange={(v) => setS({ ...s, tagAttributed: v })} helpText={tr("attr.settingsHelp")} />
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection title={tr("settings.thresholdsHeading")} description={tr("settings.thresholdsDesc")}>
            <Card>
              <FormLayout>
                <FormLayout.Group>
                  <TextField label={tr("settings.blockFrom")} type="number" value={s.block} onChange={(v) => setS({ ...s, block: v })} autoComplete="off" helpText={tr("settings.blockHelp")} />
                  <TextField label={tr("settings.warnFrom")} type="number" value={s.warn} onChange={(v) => setS({ ...s, warn: v })} autoComplete="off" helpText={tr("settings.warnHelp")} />
                </FormLayout.Group>
              </FormLayout>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection title={tr("settings.connHeading")} description={tr("settings.connDesc")}>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">{allOk ? tr("settings.connAllOk") : tr("settings.connSomeErr")}</Text>
                  <Badge tone={allOk ? "success" : "critical"}>{allOk ? tr("settings.connActive") : tr("settings.connError")}</Badge>
                </InlineStack>
                <BlockStack gap="200">
                  {(webhooks as any[]).map((w) => (
                    <div className="sf-conn" key={w.topic}>
                      <Icon source={w.ok ? CheckCircleIcon : AlertCircleIcon} tone={w.ok ? "success" : "critical"} />
                      <BlockStack gap="050">
                        <Text as="span">{topicLabel(w.topic)}</Text>
                        {!w.ok && <Text as="span" variant="bodySm" tone="critical">{trMsg(lang, w.error)}</Text>}
                      </BlockStack>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>

          <Layout.AnnotatedSection title={tr("settings.langHeading")} description={tr("settings.langHelp")}>
            <Card>
              <Select label={tr("settings.langLabel")} value={s.uiLang || lang} onChange={(v) => setS({ ...s, uiLang: v as Lang })}
                options={LANGS.map((l) => ({ label: LANG_NAMES[l], value: l }))} />
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
        <Divider />
        <InlineStack align="end">
          <Button variant="primary" size="large" loading={fetcher.state !== "idle"} onClick={save}>{tr("common.save")}</Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
