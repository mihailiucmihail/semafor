// Overview — the first page of Semafor: status, clickable numbers for every section, orders that need a
// decision and one tile per feature. Every number links to the page that lists it.
import type { ReactNode } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useNavigate, useSearchParams } from "@remix-run/react";
import { Page, Card, BlockStack, InlineStack, Text, Button, ButtonGroup, Badge, Box } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { Lamp, Dot, worst, type Level } from "../components/semafor-ui";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ensureShop } from "../semafor/shop.server";
import { catchUpOrders } from "../semafor/backfill.server";
import { planOf, checksThisMonth, trialBanner } from "../semafor/plan.server";
import { TrialBanner } from "../components/trial-banner";
import { blockedSummary } from "../semafor/blocked.server";
import { attributionSummary } from "../semafor/attribution.server";
import { can, FREE_MONTHLY_CHECKS } from "../../core/plans";
import { useT, useLang, dateLocale, trMsg, type TKey } from "../i18n";

const DAY = 86_400_000;
const PERIODS = [1, 7, 30, 90] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop, session.accessToken ?? "");
  // orders whose orders/create webhook was lost still get a verdict before the numbers below are read
  await Promise.race([
    catchUpOrders(admin as any, shop as any).catch((e) => console.error("[semafor] catch-up", e)),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  const d = Number(new URL(request.url).searchParams.get("d"));
  const days = (PERIODS as readonly number[]).includes(d) ? d : 30;
  const since = days === 1 ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(Date.now() - days * DAY);
  const plan = planOf(shop);
  const s = shop.settings;

  const [total, added, shared, groups, attention] = await Promise.all([
    db.blockEntry.count({ where: { shopId: shop.id } }),
    db.blockEntry.count({ where: { shopId: shop.id, createdAt: { gt: since } } }),
    db.blockEntry.count({ where: { shopId: shop.id, shared: true } }),
    (db.orderCheck.groupBy as any)({ by: ["level", "networkLevel"], where: { shopId: shop.id, checkedAt: { gt: since } }, _count: { _all: true } }) as Promise<any[]>,
    // newest yellow / red orders of the last 14 days (or the period, when longer)
    db.orderCheck.findMany({
      where: { shopId: shop.id, checkedAt: { gt: new Date(Date.now() - Math.max(days, 14) * DAY) }, OR: [{ level: { in: ["yellow", "red"] } }, { networkLevel: { in: ["yellow", "red"] } }] },
      orderBy: { checkedAt: "desc" }, take: 6,
      select: { id: true, orderId: true, orderName: true, level: true, networkLevel: true, networkShops: true, matched: true, actionTaken: true, checkedAt: true, total: true, currency: true },
    }),
  ]);
  const verdicts = { green: 0, yellow: 0, red: 0 };
  for (const g of groups) verdicts[worst(g.level, g.networkLevel)] += g._count._all;

  const blocked = can(plan, "checkout_block") ? await blockedSummary(shop, since).catch(() => null) : null;
  const attr = await attributionSummary(db, shop.id, Math.max(1, Math.ceil((Date.now() - +since) / DAY))).catch(() => null);
  const emailsSent = can(plan, "recovery") ? await db.emailSend.count({ where: { shopId: shop.id, status: "sent", createdAt: { gt: since } } }) : null;
  const leads = can(plan, "popup") ? await db.popupLead.count({ where: { shopId: shop.id, createdAt: { gt: since } } }) : null;
  const usedChecks = can(plan, "unlimited_checks") ? null : await checksThisMonth(shop.id);
  const shipCost = typeof s.shipCost === "number" && s.shipCost > 0 ? s.shipCost : null;

  const trial = await trialBanner(shop).catch(() => null);
  return {
    trial, days, plan, total, added, shared, verdicts, attention, blocked, emailsSent, leads, usedChecks, shipCost,
    attr: attr ? { email: attr.bySource.email.count, popup: attr.bySource.popup_site.count + attr.bySource.popup_cart.count, currency: attr.currency } : null,
    status: {
      network: !!s.shareNetwork,
      checkoutBlock: can(plan, "checkout_block"),
      recovery: can(plan, "recovery") ? !!s.recovery?.enabled : null,
      ownDomain: s.sendingDomain?.status === "verified",
      popup: can(plan, "popup") ? !!s.popup?.enabled : null,
    },
    storeHandle: session.shop.replace(".myshopify.com", ""),
  };
};

const KINDS = ["email", "phone", "name", "address", "name_address", "device"];

export default function Overview() {
  const data = useLoaderData<typeof loader>();
  const { days, total, added, shared, verdicts, attention, blocked, emailsSent, leads, usedChecks, shipCost, attr, status, storeHandle } = data;
  const tr = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const checked = verdicts.green + verdicts.yellow + verdicts.red;
  const LABEL = { green: tr("level.green"), yellow: tr("level.yellow"), red: tr("level.red") };
  const periodLabel = (d: number) => (d === 1 ? tr("ov.today") : tr("ov.days", { n: d }));
  const money = (v: number) => { try { return new Intl.NumberFormat(dateLocale(lang), { maximumFractionDigits: 0 }).format(v); } catch { return String(Math.round(v)); } };
  const saved = blocked && shipCost ? blocked.stopped * shipCost * 2 : null;
  const allOn = status.network && status.checkoutBlock;

  const reasonOf = (c: any) => {
    const m = ((c.matched as any[]) || [])[0];
    const parts: string[] = [];
    if (m) {
      if (m.kind === "device" || m.kind === "order") parts.push(trMsg(lang, m.normalized));
      else parts.push(`${KINDS.includes(m.kind) ? tr(`kind.${m.kind}` as TKey) : m.kind}: ${m.normalized}${m.reason ? ` · ${tr(`reason.${m.reason}` as TKey)}` : ""}`);
    }
    if (c.networkShops) parts.push(tr("ov.netShops", { n: c.networkShops }));
    return parts.join(" · ") || tr("ov.noDetails");
  };

  return (
    <Page fullWidth>
      <TitleBar title={tr("nav.overview")}>
        <button variant="primary" onClick={() => navigate("/app/blacklist?add=1")}>{tr("index.addCustomer")}</button>
        <button onClick={() => navigate("/app/import")}>{tr("nav.import")}</button>
        {/* Shopify shows only the first items of the app menu, so these stay reachable from here */}
        <button onClick={() => navigate("/app/settings")}>{tr("nav.settings")}</button>
        <button onClick={() => navigate("/app/plan")}>{tr("nav.plan")}</button>
      </TitleBar>
      <BlockStack gap="400">
        <TrialBanner trial={data.trial as any} onPlans={() => navigate("/app/plan")} />
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Text as="h1" variant="headingLg">{tr("nav.overview")}</Text>
          <ButtonGroup variant="segmented">
            {PERIODS.map((p) => <Button key={p} pressed={days === p} onClick={() => setParams(p === 30 ? {} : { d: String(p) }, { replace: true })}>{periodLabel(p)}</Button>)}
          </ButtonGroup>
        </InlineStack>

        {/* status */}
        <Card>
          <div className="sf-ov-hero">
            <span className="sf-lamp-v"><Lamp size="lg" level={allOn ? "green" : "yellow"} label={allOn ? tr("ov.protectOn") : tr("ov.protectPartial")} /></span>
            <BlockStack gap="150">
              <Text as="p" variant="bodySm" fontWeight="semibold" tone={allOn ? "success" : "caution"}>{allOn ? tr("ov.protectOn") : tr("ov.protectPartial")}</Text>
              <Text as="h2" variant="headingXl">{checked === 1 ? tr("ov.checked1", { period: periodLabel(days).toLowerCase() }) : tr("ov.checked", { n: checked, period: periodLabel(days).toLowerCase() })}</Text>
              <Text as="p" tone="subdued">{tr("ov.heroText", { n: total })}</Text>
              {usedChecks != null && <Text as="p" variant="bodySm" tone={usedChecks >= FREE_MONTHLY_CHECKS ? "critical" : "subdued"}>{tr("ov.freeQuota", { n: usedChecks, max: FREE_MONTHLY_CHECKS })} <Link to="/app/plan">{tr("ov.seePlans")}</Link></Text>}
            </BlockStack>
            <ul className="sf-ov-status">
              <li><Dot level="green" />{tr("ov.stChecks")}</li>
              <li><Dot level={status.checkoutBlock ? "green" : "none"} />{status.checkoutBlock ? tr("ov.stBlockOn") : <Link to="/app/plan">{tr("ov.stBlockLocked")}</Link>}</li>
              <li><Dot level={status.network ? "green" : "yellow"} />{status.network ? tr("ov.stNetOn") : <Link to="/app/settings">{tr("ov.stNetOff")}</Link>}</li>
              {status.recovery != null && <li><Dot level={status.recovery ? (status.ownDomain ? "green" : "yellow") : "none"} />{!status.recovery ? <Link to="/app/emails">{tr("ov.stMailOff")}</Link> : status.ownDomain ? tr("ov.stMailOn") : <Link to="/app/emails">{tr("ov.stMailNoDomain")}</Link>}</li>}
            </ul>
          </div>
        </Card>

        {/* numbers — each one opens its list */}
        <div className="sf-ov-kpis">
          <Link to="/app/blacklist" className="sf-ov-card">
            <Text as="span" variant="bodySm" tone="subdued">{tr("ov.kBlacklist")}</Text>
            <span className="sf-ov-num">{total}</span>
            <Text as="span" variant="bodySm" tone="subdued">{tr("ov.kAdded", { n: added })}</Text>
            <span className="sf-ov-go">{tr("ov.goList")} →</span>
          </Link>
          <Link to="/app/checks?level=red" className="sf-ov-card">
            <Text as="span" variant="bodySm" tone="subdued"><Dot level="red" /> {tr("ov.kRed")}</Text>
            <span className={`sf-ov-num${verdicts.red ? " red" : ""}`}>{verdicts.red}</span>
            <Text as="span" variant="bodySm" tone="subdued">{tr("ov.kOf", { n: checked })}</Text>
            <span className="sf-ov-go">{tr("ov.goOrders")} →</span>
          </Link>
          <Link to="/app/checks?level=yellow" className="sf-ov-card">
            <Text as="span" variant="bodySm" tone="subdued"><Dot level="yellow" /> {tr("ov.kYellow")}</Text>
            <span className={`sf-ov-num${verdicts.yellow ? " yellow" : ""}`}>{verdicts.yellow}</span>
            <Text as="span" variant="bodySm" tone="subdued">{tr("ov.kOf", { n: checked })}</Text>
            <span className="sf-ov-go">{tr("ov.goCheck")} →</span>
          </Link>
          <Link to={blocked ? "/app/blocked" + (days === 7 ? "" : `?d=${days}`) : "/app/plan"} className="sf-ov-card">
            <Text as="span" variant="bodySm" tone="subdued">{tr("ov.kStopped")}</Text>
            <span className="sf-ov-num">{blocked ? blocked.stopped : "—"}</span>
            <Text as="span" variant="bodySm" tone={blocked?.through ? "critical" : "subdued"}>{blocked ? (blocked.through ? tr("ov.kThrough", { n: blocked.through }) : tr("ov.kNoThrough")) : tr("ov.lockedBasic")}</Text>
            <span className="sf-ov-go">{blocked ? tr("ov.goWho") : tr("ov.seePlans")} →</span>
          </Link>
          <Link to="/app/blacklist?net=shared" className="sf-ov-card">
            <Text as="span" variant="bodySm" tone="subdued">{tr("ov.kShared")}</Text>
            <span className="sf-ov-num">{shared}</span>
            <Text as="span" variant="bodySm" tone="subdued">{tr("ov.kSharedOf", { n: total })}</Text>
            <span className="sf-ov-go">{tr("ov.goShow")} →</span>
          </Link>
          <Link to={blocked ? (shipCost ? "/app/blocked" : "/app/settings") : "/app/plan"} className="sf-ov-card">
            <Text as="span" variant="bodySm" tone="subdued">{tr("ov.kSaved")}</Text>
            <span className={`sf-ov-num${saved ? " green" : ""}`}>{saved != null ? `≈ ${money(saved)}` : "—"}</span>
            <Text as="span" variant="bodySm" tone="subdued">{!blocked ? tr("ov.lockedBasic") : shipCost ? tr("ov.kSavedHow", { n: blocked.stopped }) : tr("ov.kSavedSet")}</Text>
            <span className="sf-ov-go">{!blocked ? tr("ov.seePlans") : shipCost ? tr("ov.goWho") : tr("ov.goSetCost")} →</span>
          </Link>
        </div>

        {/* orders that need a decision */}
        <Card padding="0">
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center" gap="200">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">{tr("ov.attnTitle")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{tr("ov.attnHint")}</Text>
              </BlockStack>
              <Button variant="plain" url="/app/checks">{tr("ov.allChecks")}</Button>
            </InlineStack>
          </Box>
          {attention.length === 0 ? (
            <Box padding="400" paddingBlockStart="0"><Text as="p" tone="subdued">{tr("ov.attnEmpty")}</Text></Box>
          ) : (
            <ul className="sf-ov-attn">
              {(attention as any[]).map((c) => {
                const lv: Level = worst(c.level, c.networkLevel);
                const oid = String(c.orderId).split("/").pop();
                const acts = String(c.actionTaken || "").split("+").filter(Boolean);
                return (
                  <li key={c.id}>
                    <a href={`https://admin.shopify.com/store/${storeHandle}/orders/${oid}`} target="_top">
                      <Dot level={lv} />
                      <span className="sf-ov-order">{c.orderName || oid}</span>
                      <span className="sf-ov-why">{reasonOf(c)}</span>
                      <span className="sf-ov-when">{new Date(c.checkedAt).toLocaleString(dateLocale(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <Badge tone={lv === "red" ? "critical" : "warning"}>{acts.includes("cancel") ? tr("action.cancel") : lv === "red" ? tr("ov.doNotShip") : tr("ov.checkFirst")}</Badge>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* every feature */}
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">{tr("ov.modulesTitle")}</Text>
          <div className="sf-ov-tiles">
            <Tile to="/app/blacklist" title={tr("nav.blacklist")} badge={<Badge tone="success">{tr("ov.on")}</Badge>} text={tr("ov.mBlacklist")}
              line={tr("ov.mBlacklistLine", { n: total, s: shared })} />
            <Tile to="/app/checks" title={tr("nav.checks")} badge={<Badge tone="success">{tr("ov.on")}</Badge>} text={tr("ov.mChecks")}
              line={`${LABEL.green} ${verdicts.green} · ${LABEL.yellow} ${verdicts.yellow} · ${LABEL.red} ${verdicts.red}`} />
            <Tile to={blocked ? "/app/blocked" : "/app/plan"} title={tr("ov.mBlockTitle")} badge={blocked ? <Badge tone="success">{tr("ov.on")}</Badge> : <Badge>Basic</Badge>} text={tr("ov.mBlock")}
              line={blocked ? tr("ov.mBlockLine", { n: blocked.stopped, t: blocked.through }) : tr("ov.lockedBasic")} />
            <Tile to={can(data.plan, "checkout_stats") ? "/app/stats" : "/app/plan"} title={tr("nav.stats")} badge={can(data.plan, "checkout_stats") ? <Badge tone="success">{tr("ov.on")}</Badge> : <Badge>Pro</Badge>} text={tr("ov.mStats")}
              line={can(data.plan, "checkout_stats") ? tr("ov.open") : tr("ov.lockedPro")} />
            <Tile to={emailsSent != null ? "/app/emails" : "/app/plan"} title={tr("nav.emails")}
              badge={emailsSent == null ? <Badge>Pro</Badge> : status.recovery ? <Badge tone="success">{tr("ov.on")}</Badge> : <Badge>{tr("ov.off")}</Badge>} text={tr("ov.mEmails")}
              line={emailsSent != null ? tr("ov.mEmailsLine", { n: emailsSent, o: attr?.email ?? 0 }) : tr("ov.lockedPro")} />
            <Tile to={leads != null ? "/app/popup" : "/app/plan"} title={tr("nav.popup")}
              badge={leads == null ? <Badge>Basic</Badge> : status.popup ? <Badge tone="success">{tr("ov.on")}</Badge> : <Badge>{tr("ov.off")}</Badge>} text={tr("ov.mPopup")}
              line={leads != null ? tr("ov.mPopupLine", { n: leads, o: attr?.popup ?? 0 }) : tr("ov.lockedBasic")} />
          </div>
        </BlockStack>
      </BlockStack>
    </Page>
  );
}

function Tile({ to, title, badge, text, line }: { to: string; title: string; badge: ReactNode; text: string; line: string }) {
  return (
    <Link to={to} className="sf-ov-card sf-ov-tile">
      <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
        <Text as="span" variant="headingSm">{title}</Text>
        {badge}
      </InlineStack>
      <Text as="span" variant="bodySm" tone="subdued">{text}</Text>
      <Text as="span" variant="bodySm" fontWeight="semibold">{line}</Text>
    </Link>
  );
}
