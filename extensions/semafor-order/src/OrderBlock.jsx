import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { APP, LEVELS, KINDS, api, tr, lang } from "./shared.js";

export default async () => { render(<Block />, document.body); };

const title = (level) => (LEVELS.includes(level) ? tr(`title.${level}`) : level);
const kind = (k) => (KINDS.includes(k) ? tr(`kind.${k}`) : k);

function Block() {
  const orderId = shopify.data.selected?.[0]?.id;
  const [st, setSt] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!orderId) return;
    api(`/api/order-block?orderId=${encodeURIComponent(orderId)}&lang=${lang()}`).then(setSt).catch((e) => setErr(String(e.message || e)));
  }, [orderId]);

  return (
    <s-admin-block heading="Semafor">
      {err && <s-banner tone="critical">{err}</s-banner>}
      {!st && !err && <s-spinner accessibilityLabel={tr("checking")} />}
      {st && (
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-box inlineSize="64px">
            <s-image src={`${APP}/light/${st.level}`} alt={title(st.level)} aspectRatio="100/260" objectFit="contain" />
          </s-box>
          <s-stack gap="small-200">
            <s-heading>{title(st.level)}</s-heading>
            {(st.matches || []).map((m, i) => (
              <s-text key={i} color="subdued">{m.kind === "device" || m.kind === "order" ? m.normalized : `${kind(m.kind)}: ${m.normalized} (${m.reason})`}</s-text>
            ))}
            {st.networkShops > 0 && <s-text color="subdued">{tr("network", { n: st.networkShops })}</s-text>}
            {st.inList
              ? <s-text>{tr("inList")}</s-text>
              : <s-text color="subdued">{tr("howToAdd")}</s-text>}
          </s-stack>
        </s-stack>
      )}
    </s-admin-block>
  );
}
