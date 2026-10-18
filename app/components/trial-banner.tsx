import { Banner, BlockStack, Text } from "@shopify/polaris";
import { useT } from "../i18n";

export type TrialInfo = { active: boolean; daysLeft: number; endsAt: string; checked: number; risky: number; sent: number; blocked: number } | null;

/** Free Pro trial: days left + what Semafor did so far, or — once it ended — what the store lost on Free. */
export function TrialBanner({ trial, onPlans }: { trial: TrialInfo; onPlans?: () => void }) {
  const tr = useT();
  if (!trial) return null;
  const stats = tr("trial.stats", { checked: trial.checked, risky: trial.risky, blocked: trial.blocked, sent: trial.sent });
  const action = onPlans ? { content: tr("trial.cta"), onAction: onPlans } : undefined;
  if (!trial.active) {
    return (
      <Banner tone="warning" title={tr("trial.endedTitle")} action={action}>
        <BlockStack gap="100">
          <Text as="p">{tr("trial.endedBody")}</Text>
          <Text as="p" tone="subdued">{tr("trial.endedStats", { stats })}</Text>
        </BlockStack>
      </Banner>
    );
  }
  const last = trial.daysLeft <= 3;
  return (
    <Banner tone={last ? "warning" : "info"} title={trial.daysLeft <= 1 ? tr("trial.titleLast") : tr("trial.title", { n: trial.daysLeft })} action={action}>
      <BlockStack gap="100">
        <Text as="p">{tr("trial.body")}</Text>
        {trial.checked > 0 && <Text as="p" tone="subdued">{tr("trial.soFar", { stats })}</Text>}
      </BlockStack>
    </Banner>
  );
}
