// Lightweight page just for sending a test e-mail (the full E-mailuri page can be heavy in the admin).
import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Select, Button, Banner, TextField, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";
import { useT } from "../i18n";

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
  const tr = useT();
  return (
    <Page title={tr("test.title")} backAction={{ url: "/app/emails" }}>
      <Card>
        <BlockStack gap="300">
          <Text as="p" tone="subdued">{tr("test.intro")}</Text>
          <TextField label={tr("test.sendTo")} value={to} onChange={setTo} autoComplete="email" />
          <Select label={tr("common.template")} options={templates.map((t) => ({ label: `${t.name} · ${t.design}`, value: t.id }))} value={tpl} onChange={setTpl} />
          <InlineStack>
            <Button variant="primary" loading={f.state !== "idle"} disabled={!to} onClick={() => f.submit({ intent: "test", to, templateId: tpl }, { method: "post", action: "/app/emails" })}>{tr("common.sendTest")}</Button>
          </InlineStack>
          {f.data?.test && <Banner tone={f.data.ok ? "success" : "critical"}>{f.data.test}</Banner>}
        </BlockStack>
      </Card>
    </Page>
  );
}
