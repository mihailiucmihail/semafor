import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Page, Card, Text, Badge, Button, IndexTable, Link, InlineStack, Box, BlockStack } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { requireFeature } from "../semafor/plan.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";
import { useT, useLang, dateLocale, trMsg, type TKey } from "../i18n";

const DAY = 86_400_000;
const LISTS = ["sent", "recovered", "skipped", "failed"] as const;
type ListKind = (typeof LISTS)[number];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  requireFeature(shop, "recovery", redirect);
  const list = (LISTS as readonly string[]).includes(String(params.list)) ? (params.list as ListKind) : "sent";
  const since = new Date(Date.now() - 30 * DAY);
  const storeHandle = session.shop.replace(".myshopify.com", "");

  const sends = (await db.emailSend.findMany({
    where: { shopId: shop.id, createdAt: { gt: since } },
    select: { status: true, kind: true, email: true, createdAt: true, deviceId: true, error: true },
  })) as any[];

  if (list === "skipped" || list === "failed") {
    const rows = sends.filter((s) => s.status === list).sort((a, b) => +b.createdAt - +a.createdAt).slice(0, 500)
      .map((s) => ({ email: s.email, deviceId: s.deviceId, kind: s.kind, error: s.error ?? "", createdAt: s.createdAt }));
    return { list, storeHandle, rows, people: [] as any[] };
  }

  // one row per person we wrote to; "ordered" = checkout completed after our first e-mail
  const sent = sends.filter((s) => s.status === "sent");
  const emails = [...new Set(sent.map((s) => s.email.toLowerCase()))];
  const done = emails.length
    ? ((await db.checkoutAttempt.findMany({ where: { shopId: shop.id, event: "completed", createdAt: { gt: since }, email: { not: null } }, select: { email: true, createdAt: true, orderId: true } })) as any[])
        .filter((d) => emails.includes(String(d.email).toLowerCase()))
    : [];
  const orderOf = new Map<string, any>();
  for (const e of emails) {
    const first = sent.filter((s) => s.email.toLowerCase() === e).sort((a, b) => +a.createdAt - +b.createdAt)[0];
    const d = done.find((x) => String(x.email).toLowerCase() === e && +x.createdAt > +first.createdAt);
    if (d) orderOf.set(e, d);
  }
  const orderIds = [...orderOf.values()].map((d) => d.orderId).filter(Boolean) as string[];
  const onames = orderIds.length ? ((await db.orderCheck.findMany({ where: { shopId: shop.id, orderId: { in: orderIds } }, select: { orderId: true, orderName: true } })) as any[]) : [];
  const nameOf = new Map(onames.map((n) => [n.orderId, n.orderName]));
  let people = emails.map((e) => {
    const mine = sent.filter((s) => s.email.toLowerCase() === e).sort((a, b) => +a.createdAt - +b.createdAt);
    const o = orderOf.get(e);
    return {
      email: mine[0].email, deviceId: mine[mine.length - 1].deviceId, count: mine.length, kinds: mine.map((m) => m.kind), last: mine[mine.length - 1].createdAt,
      ordered: !!o, orderedAt: o?.createdAt ?? null, orderId: o?.orderId ? String(o.orderId).split("/").pop() : null, orderName: o?.orderId ? nameOf.get(o.orderId) ?? null : null,
    };
  });
  if (list === "recovered") people = people.filter((p) => p.ordered);
  people.sort((a, b) => +new Date(b.orderedAt || b.last) - +new Date(a.orderedAt || a.last));
  return { list, storeHandle, rows: [] as any[], people };
};

export default function EmailList() {
  const { list, storeHandle, rows, people } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const tr = useT();
  const lang = useLang();
  const fmt = (d: any) => new Date(d).toLocaleString(dateLocale(lang), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const kindLabel = (k: string) => (k === "auto1" ? "1" : k === "auto2" ? "2" : k === "auto3" ? "3" : tr("common.manual"));
  const isPeople = list === "sent" || list === "recovered";
  const count = isPeople ? people.length : rows.length;
  const tabs: ListKind[] = ["sent", "recovered", "skipped", "failed"];

  return (
    <Page fullWidth title={tr(`emails.list.${list}` as TKey)} backAction={{ content: tr("nav.emails"), onAction: () => navigate("/app/emails") }}>
      <TitleBar title={tr(`emails.list.${list}` as TKey)}>
        <button onClick={() => navigate("/app/emails")}>{tr("nav.emails")}</button>
      </TitleBar>
      <BlockStack gap="400">
        <InlineStack gap="200">
          {tabs.map((k) => (
            <Button key={k} pressed={k === list} onClick={() => navigate(`/app/emails/${k}`)}>{tr(`emails.list.${k}` as TKey)}</Button>
          ))}
        </InlineStack>
        <Card padding="0">
          {count === 0 ? (
            <Box padding="400"><Text as="p" tone="subdued">{tr("emails.list.empty")}</Text></Box>
          ) : (
            <div className="sf-table">
              {isPeople ? (
                <IndexTable selectable={false} itemCount={people.length} resourceName={{ singular: tr("index.resSingular"), plural: tr("index.resPlural") }}
                  headings={[{ title: tr("common.customer") }, { title: tr("stats.colEmails") }, { title: tr("common.result") }, { title: tr("common.when") }]}>
                  {people.map((x: any, i: number) => (
                    <IndexTable.Row id={String(i)} key={i} position={i}>
                      <IndexTable.Cell><Link url={`/app/client/${x.deviceId}`} removeUnderline><Text as="span" fontWeight="semibold"><span className="sf-break">{x.email}</span></Text></Link></IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone="info">{tr(x.count === 1 ? "stats.mailOne" : "stats.mailMany", { n: x.count })}</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">{x.kinds.map(kindLabel).join(", ")}</Text>
                        </InlineStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {x.ordered
                          ? (x.orderId ? <Button variant="plain" url={`https://admin.shopify.com/store/${storeHandle}/orders/${x.orderId}`} target="_top">{x.orderName || tr("stats.order")}</Button> : <Badge tone="success">{tr("common.ordered")}</Badge>)
                          : <Badge>{tr("stats.notOrdered")}</Badge>}
                      </IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" variant="bodySm"><span className="sf-nowrap">{fmt(x.orderedAt || x.last)}</span></Text></IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              ) : (
                <IndexTable selectable={false} itemCount={rows.length} resourceName={{ singular: tr("index.resSingular"), plural: tr("index.resPlural") }}
                  headings={[{ title: tr("common.customer") }, { title: tr("emails.list.colEmail") }, { title: tr("emails.list.colReason") }, { title: tr("common.when") }]}>
                  {rows.map((x: any, i: number) => (
                    <IndexTable.Row id={String(i)} key={i} position={i}>
                      <IndexTable.Cell><Link url={`/app/client/${x.deviceId}`} removeUnderline><Text as="span" fontWeight="semibold"><span className="sf-break">{x.email}</span></Text></Link></IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" variant="bodySm">{kindLabel(x.kind)}</Text></IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" variant="bodySm" tone={list === "failed" ? "critical" : "subdued"}><span className="sf-break">{x.error ? trMsg(lang, x.error) : "—"}</span></Text></IndexTable.Cell>
                      <IndexTable.Cell><Text as="span" variant="bodySm"><span className="sf-nowrap">{fmt(x.createdAt)}</span></Text></IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </div>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
