// Lightweight page just for sending a test e-mail (the full E-mailuri page can be heavy in the admin).
import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Select, Button, Banner, TextField, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const templates = (await db.emailTemplate.findMany({ where: { shopId: shop.id }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, design: true } })) as any[];
  return { templates, email: (session as any).email || "" };
};

export default function TestEmail() {
  const { templates, email } = useLoaderData<typeof loader>();
  const f = useFetcher<any>();
  const [to, setTo] = useState(email);
  const [tpl, setTpl] = useState(templates[0]?.id || "");
  return (
    <Page title="E-mail de test" backAction={{ url: "/app/emails" }}>
      <Card>
        <BlockStack gap="300">
          <Text as="p" tone="subdued">Butonul din e-mail duce în magazin cu produsul în coș; la e-mailurile 2 și 3 se creează un cod real, valabil 24 h, aplicat automat.</Text>
          <TextField label="Trimite la" value={to} onChange={setTo} autoComplete="email" />
          <Select label="Șablon" options={templates.map((t) => ({ label: `${t.name} · ${t.design}`, value: t.id }))} value={tpl} onChange={setTpl} />
          <InlineStack>
            <Button variant="primary" loading={f.state !== "idle"} disabled={!to} onClick={() => f.submit({ intent: "test", to, templateId: tpl }, { method: "post", action: "/app/emails" })}>Trimite test</Button>
          </InlineStack>
          {f.data?.test && <Banner tone={f.data.ok ? "success" : "critical"}>{f.data.test}</Banner>}
        </BlockStack>
      </Card>
    </Page>
  );
}
