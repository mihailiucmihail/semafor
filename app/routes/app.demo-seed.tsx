// Demo store only (fictional brand "Lumina de Casă"): fills the store with INVENTED customers, a few blacklist
// entries and orders, so the public demo and the screenshots show Semafor working on realistic but fake data.
// E-mails are @example.com (reserved), phones +40 700 000 xxx. Nothing here ever reaches the shared network
// (shareToNetwork skips demo shops). 404 in every other store.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { Page, Card, BlockStack, Text, Button, Banner } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";
import { isDemoShop } from "../semafor/plan.server";
import { createEntry, pushCheckoutMetafield } from "../semafor/entries.server";

const ENTRIES = [
  { firstName: "Larisa", lastName: "Vasile", phone: "+40700000101", email: "larisa.vasile@example.com", address1: "Str. Teilor 14", city: "Ploiești", reason: "refuz_colet", note: "A refuzat 2 colete în septembrie." },
  { firstName: "Dorin", lastName: "Pop", phone: "+40700000102", email: "dorin.pop@example.com", address1: "Bd. Independenței 3", city: "Iași", reason: "refuz_colet", note: "Comandă pe numele vecinei, coletul s-a întors." },
  { firstName: "Gabriela", lastName: "Matei", phone: "+40700000103", email: "gabriela.matei@example.com", address1: "Str. Lalelelor 7", city: "Cluj-Napoca", reason: "return_fraud", note: "A returnat o lumânare folosită." },
  { firstName: "Client", lastName: "Demo Roșu", phone: "+40700000999", email: "rosu@example.com", address1: "Str. Exemplului 1", city: "București", reason: "refuz_colet", note: "Client de test: folosește acest e-mail la checkout ca să vezi cum dispare plata ramburs." },
] as const;

const P = (t: string, a: number) => ({ title: t, amount: a });
const ITEMS = {
  smochin: P("Lumânare Smochin & cedru, 220 g", 89), lavanda: P("Lumânare Lavandă de Provence, 220 g", 79),
  vanilie: P("Lumânare Vanilie & tonka, 220 g", 89), ambra: P("Lumânare Ambră caldă cu 3 fitiluri, 600 g", 189),
  bumbac: P("Difuzor cu bețișoare Bumbac curat, 100 ml", 99), portocala: P("Difuzor cu bețișoare Portocală & scorțișoară, 100 ml", 99),
  menta: P("Spray de cameră Mentă & eucalipt, 100 ml", 59), set: P("Set cadou Seară liniștită, 2 × 120 g", 149),
};
type K = keyof typeof ITEMS;
// [first, last, email, phone, address, city, zip, items, hours ago]
const ORDERS: Array<[string, string, string, string, string, string, string, K[], number]> = [
  ["Ana", "Popescu", "ana.popescu@example.com", "+40700000201", "Str. Morilor 22", "București", "021452", ["smochin", "menta"], 70],
  ["Mihai", "Ionescu", "mihai.ionescu@example.com", "+40700000202", "Str. Avram Iancu 5", "Brașov", "500089", ["ambra"], 64],
  ["Elena", "Dumitru", "elena.dumitru@example.com", "+40700000203", "Bd. Revoluției 40", "Arad", "310025", ["lavanda", "vanilie"], 58],
  ["Andrei", "Stan", "andrei.stan@example.com", "+40700000204", "Str. Mihai Viteazu 11", "Sibiu", "550350", ["set"], 52],
  ["Ioana", "Marin", "ioana.marin@example.com", "+40700000205", "Str. Florilor 9", "Constanța", "900178", ["bumbac"], 47],
  ["Larisa", "V.", "lv.comenzi@example.com", "+40700000101", "Str. Teilor 14", "Ploiești", "100190", ["ambra", "set"], 41],
  ["Cristina", "Radu", "cristina.radu@example.com", "+40700000206", "Str. Doinei 2", "Timișoara", "300222", ["portocala", "smochin"], 36],
  ["Bogdan", "Tudor", "bogdan.tudor@example.com", "+40700000207", "Str. Republicii 18", "Oradea", "410087", ["menta"], 30],
  ["Ioana", "Marin", "ioana.marin@example.com", "+40700000205", "Str. Florilor 9", "Constanța", "900178", ["lavanda", "set"], 26],
  ["Raluca", "Neagu", "raluca.neagu@example.com", "+40700000208", "Str. Zorilor 31", "Craiova", "200384", ["vanilie"], 21],
  ["Dorin", "Pop", "dorin.pop@example.com", "+40700000209", "Bd. Independenței 3", "Iași", "700105", ["smochin", "ambra", "bumbac"], 16],
  ["Vlad", "Constantin", "vlad.constantin@example.com", "+40700000210", "Str. Gării 6", "Pitești", "110133", ["portocala"], 11],
  ["Simona", "Georgescu", "simona.georgescu@example.com", "+40700000211", "Str. Libertății 12", "Galați", "800033", ["set", "menta"], 6],
  ["Alexandru", "Munteanu", "alex.munteanu@example.com", "+40700000212", "Str. Castanilor 4", "Bacău", "600043", ["lavanda"], 2],
];

async function guard(request: Request) {
  const { session, admin } = await authenticate.admin(request);
  if (!isDemoShop(session.shop)) throw new Response("Not found", { status: 404 });
  return { session, admin };
}

export const loader = async ({ request }: LoaderFunctionArgs) => { await guard(request); return null; };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await guard(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  const log: string[] = [];
  const step = (await request.formData()).get("step");

  if (step === "entries") {
    for (const e of ENTRIES) {
      const exists = await db.blockEntry.findFirst({ where: { shopId: shop.id, note: e.note } });
      if (exists) { log.push(`exists: ${e.firstName} ${e.lastName}`); continue; }
      await createEntry({ shopId: shop.id, shopDomain: session.shop, country: "RO", settings: shop.settings, actor: "demo-seed", input: { ...e, source: "manual" } as any });
      log.push(`entry: ${e.firstName} ${e.lastName}`);
    }
    await pushCheckoutMetafield(admin as any, shop.id);
    log.push("checkout list synced");
  }

  if (step === "orders") {
    const done = await db.appKv.findUnique({ where: { key: `demo-seed:orders:${session.shop}` } });
    if (done) return { log: ["orders already created"] };
    for (const [first, last, email, phone, address1, city, zip, items, hoursAgo] of ORDERS) {
      const addr = { firstName: first, lastName: last, address1, city, zip, countryCode: "RO", phone };
      const r = await admin.graphql(
        `mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) { orderCreate(order: $order, options: $options) { order { name } userErrors { field message } } }`,
        { variables: {
          order: {
            email, phone: phone === "+40700000101" ? phone : undefined, currency: "RON", financialStatus: "PENDING",
            processedAt: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
            customer: { toUpsert: { email, firstName: first, lastName: last } },
            shippingAddress: addr, billingAddress: addr,
            lineItems: items.map((k) => ({ title: ITEMS[k].title, quantity: 1, requiresShipping: true, priceSet: { shopMoney: { amount: ITEMS[k].amount, currencyCode: "RON" } } })),
            shippingLines: [{ title: "Curier, plata la livrare (ramburs)", priceSet: { shopMoney: { amount: 19, currencyCode: "RON" } } }],
            tags: ["demo", "ramburs"],
          },
          options: { sendReceipt: false, sendFulfillmentReceipt: false },
        } },
      );
      const j: any = await r.json();
      const o = j?.data?.orderCreate;
      log.push(o?.order?.name ? `order ${o.order.name}: ${first} ${last}` : `error ${first} ${last}: ${JSON.stringify(o?.userErrors || j?.errors).slice(0, 200)}`);
      await new Promise((res) => setTimeout(res, 1500)); // webhooks check each order in order
    }
    await db.appKv.create({ data: { key: `demo-seed:orders:${session.shop}`, value: new Date().toISOString() } });
  }
  return { log };
};

export default function DemoSeed() {
  const data = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <Page title="Demo data">
      <Card>
        <BlockStack gap="300">
          <Text as="p">Only for the public demo store: invented customers (@example.com, +40 700 000 xxx). Never shared with the network.</Text>
          <Form method="post"><input type="hidden" name="step" value="entries" /><Button submit loading={busy}>1. Blacklist entries</Button></Form>
          <Form method="post"><input type="hidden" name="step" value="orders" /><Button submit loading={busy}>2. Orders</Button></Form>
          {data?.log && <Banner tone="info"><pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{data.log.join("\n")}</pre></Banner>}
        </BlockStack>
      </Card>
    </Page>
  );
}
