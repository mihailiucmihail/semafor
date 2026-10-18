// Shared presentation pieces for the Semafor admin pages (Polaris + app/styles/semafor.css).
import { useEffect, type ReactNode } from "react";
import { BlockStack, Card, Icon, InlineStack, Text } from "@shopify/polaris";

export type Level = "green" | "yellow" | "red";
type IconSource = Parameters<typeof Icon>[0]["source"];
export type KpiTone = "critical" | "caution" | "success";

/** A small traffic-light housing; `level` lights one lamp (none = all dim). */
export function Lamp({ level, lit, size = "sm", label }: { level?: Level | null; lit?: Level[]; size?: "sm" | "lg"; label?: string }) {
  const on = (l: Level) => (lit ? lit.includes(l) : level === l) ? " on" : "";
  return (
    <span className={`sf-lamp${size === "lg" ? " sf-lamp--lg" : ""}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <i className={`r${on("red")}`} />
      <i className={`y${on("yellow")}`} />
      <i className={`g${on("green")}`} />
    </span>
  );
}

export function Dot({ level }: { level: Level | "none" }) {
  return <span className={`sf-dot ${level}`} aria-hidden="true" />;
}

/** Proportional green / yellow / red bar with a legend underneath. */
export function SignalStrip({ green, yellow, red, labels, emptyText }: { green: number; yellow: number; red: number; labels: { green: string; yellow: string; red: string }; emptyText?: string }) {
  const total = green + yellow + red;
  const pct = (n: number) => `${(n / (total || 1)) * 100}%`;
  return (
    <BlockStack gap="200">
      <div className="sf-strip" role="img" aria-label={`${labels.green} ${green}, ${labels.yellow} ${yellow}, ${labels.red} ${red}`}>
        {total > 0 && (
          <>
            {green > 0 && <span className="g" style={{ width: pct(green) }} />}
            {yellow > 0 && <span className="y" style={{ width: pct(yellow) }} />}
            {red > 0 && <span className="r" style={{ width: pct(red) }} />}
          </>
        )}
      </div>
      {total === 0 && emptyText ? (
        <Text as="p" variant="bodySm" tone="subdued">{emptyText}</Text>
      ) : (
        <div className="sf-legend">
          {(["green", "yellow", "red"] as const).map((k) => {
            const n = k === "green" ? green : k === "yellow" ? yellow : red;
            return (
              <span key={k}>
                <Dot level={k} />
                <Text as="span" variant="bodySm" tone="subdued">{labels[k]}</Text>
                <Text as="span" variant="bodySm" fontWeight="semibold"><span className="sf-num">{n}</span></Text>
                {total > 0 && <Text as="span" variant="bodySm" tone="subdued">({Math.round((n / total) * 100)}%)</Text>}
              </span>
            );
          })}
        </div>
      )}
    </BlockStack>
  );
}

/** Metric card: icon tile, label, big number, optional hint. */
export function Kpi({ icon, label, value, hint, tone, onClick, active }: { icon?: IconSource; label: string; value: ReactNode; hint?: ReactNode; tone?: KpiTone; onClick?: () => void; active?: boolean }) {
  const card = (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          {icon && <span className={`sf-kpi-icon${tone ? ` ${tone}` : ""}`}><Icon source={icon} /></span>}
          <Text as="p" variant="bodyMd" tone="subdued">{label}</Text>
        </InlineStack>
        <BlockStack gap="100">
          <span className={`sf-kpi-value${tone ? ` ${tone}` : ""}`}>{value}</span>
          {hint && <Text as="p" variant="bodySm" tone="subdued">{hint}</Text>}
        </BlockStack>
      </BlockStack>
    </Card>
  );
  if (!onClick) return card;
  return (
    <div role="button" tabIndex={0} className={`sf-kpi-click${active ? " active" : ""}`} onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}>{card}</div>
  );
}

/** Icon + value line used for customer identifiers in tables. */
export function IdLine({ icon, label, children }: { icon: IconSource; label: string; children: ReactNode }) {
  return (
    <span className="sf-id" title={label}>
      <Icon source={icon} accessibilityLabel={label} />
      <Text as="span" variant="bodySm"><span className="sf-break">{children}</span></Text>
    </span>
  );
}

/** Section heading with optional right-hand content. */
export function SectionHead({ title, children, description }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <InlineStack align="space-between" blockAlign="end" gap="300">
      <BlockStack gap="050">
        <Text as="h2" variant="headingMd">{title}</Text>
        {description && <Text as="p" variant="bodySm" tone="subdued">{description}</Text>}
      </BlockStack>
      {children}
    </InlineStack>
  );
}

export const LEVEL_RANK = { green: 0, yellow: 1, red: 2 } as const;
export const worst = (a: Level, b: Level): Level => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a);

/**
 * Phones: every `.sf-table` is drawn as a list of cards (see semafor.css). Each cell gets the text of its column
 * heading as `data-label`, so the card can show "Plată: Cash on Delivery". Hidden headings (actions) get no label.
 * Runs once in the app layout and follows every table the pages draw later.
 */
export function useTableLabels() {
  useEffect(() => {
    let raf = 0;
    const label = () => {
      raf = 0;
      document.querySelectorAll<HTMLTableElement>(".sf-table table").forEach((t) => {
        const heads = Array.from(t.querySelectorAll("thead tr:last-child th")).map((th) =>
          th.querySelector(".Polaris-Text--visuallyHidden") ? "" : (th.textContent || "").trim());
        t.querySelectorAll("tbody tr").forEach((tr) => {
          Array.from(tr.children).forEach((td, i) => {
            const l = heads[i] || "";
            if (td.getAttribute("data-label") !== l) td.setAttribute("data-label", l);
          });
        });
      });
    };
    label();
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(label); });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
}
