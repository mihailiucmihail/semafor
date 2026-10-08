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
  }, (session as any).email || session.shop);
  await pushCheckoutMetafield(admin, shop.id);
  return { ok: true };
};

export default function Settings() {
  const { settings, webhooks, basic } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const app = useAppBridge();
  const [s, setS] = useState({ yellowAction: settings.yellowAction, cancelRed: settings.cancelRed, shareNetwork: settings.shareNetwork, block: String(settings.thresholds.block), warn: String(settings.thresholds.warn) });
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) app.toast.show("Setări salvate"); }, [fetcher.state, fetcher.data, app]);

  return (
    <Page narrowWidth>
      <TitleBar title="Setări" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Ce facem cu comenzile</Text>
                {!basic && <Banner tone="info" action={{ content: "Vezi planurile", url: "/app/plan" }}>Pe planul Gratuit comenzile sunt doar marcate (etichetă + semnal de risc). Blocarea în checkout, eliminarea plății ramburs și anularea automată sunt incluse în Basic.</Banner>}
                <FormLayout>
                  <Select label="Client galben (suspect, neconfirmat)" disabled={!basic} value={basic ? s.yellowAction : "tag"} onChange={(v) => setS({ ...s, yellowAction: v as any })}
                    options={[
                      { label: "Doar marchează (etichetă + semnal de risc)", value: "tag" },
                      { label: "Marchează și elimină plata ramburs (doar card)", value: "prepaid" },
                      { label: "Blochează finalizarea comenzii", value: "block" },
                    ]} helpText="Galben = semnalat de 1–2 magazine din rețea sau potrivire doar după nume." />
                  <Checkbox label="Anulează automat comenzile roșii (client din lista ta sau 3+ magazine)" disabled={!basic} checked={basic && s.cancelRed} onChange={(v) => setS({ ...s, cancelRed: v })} helpText="Dezactivat: comanda rămâne, dar e marcată roșu. Clientul nu e notificat la anulare." />
                </FormLayout>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Rețeaua de magazine</Text>
                <Checkbox label="Particip la rețea: raportez și văd semaforul altor magazine" checked={s.shareNetwork} onChange={(v) => setS({ ...s, shareNetwork: v })}
                  helpText="În rețea ajung doar hash-uri (nu nume, e-mail sau adrese în clar). Refuzul de colet se raportează de la al doilea caz; chargeback și amenințările — imediat." />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Praguri (avansat)</Text>
                <FormLayout.Group>
                  <TextField label="Blochează de la" type="number" value={s.block} onChange={(v) => setS({ ...s, block: v })} autoComplete="off" helpText="E-mail / telefon / nume+adresă = 100" />
                  <TextField label="Avertizează de la" type="number" value={s.warn} onChange={(v) => setS({ ...s, warn: v })} autoComplete="off" helpText="Nume = 40, adresă = 60, dispozitiv = 70" />
                </FormLayout.Group>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Legătura cu Shopify</Text>
                {(webhooks as any[]).map((w) => (
                  <Text as="p" key={w.topic} tone={w.ok ? "success" : "critical"}>
                    {w.ok ? "✓" : "✗"} {w.topic === "ORDERS_CREATE" ? "Comenzi noi" : w.topic === "APP_UNINSTALLED" ? "Dezinstalare" : w.topic === "ORDERS_PAID" ? "Comenzi achitate" : w.topic === "ORDERS_CANCELLED" ? "Comenzi anulate" : w.topic === "ORDERS_FULFILLED" ? "Comenzi expediate" : w.topic === "PIXEL" ? "Urmărire dispozitiv la checkout" : w.topic === "PAYMENTS" ? "Ascundere plăți pentru lista neagră" : w.topic}
                    {w.ok ? " — activ" : ` — eroare: ${w.error}`}
                  </Text>
                ))}
              </BlockStack>
            </Card>
            <Button variant="primary" loading={fetcher.state !== "idle"} onClick={() => fetcher.submit({ ...s, cancelRed: String(s.cancelRed), shareNetwork: String(s.shareNetwork) }, { method: "post" })}>Salvează</Button>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
