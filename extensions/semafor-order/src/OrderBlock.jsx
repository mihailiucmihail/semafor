import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { APP, TITLE, KIND, api } from "./shared.js";

export default async () => { render(<Block />, document.body); };

function Block() {
  const orderId = shopify.data.selected?.[0]?.id;
  const [st, setSt] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!orderId) return;
    api(`/api/order-block?orderId=${encodeURIComponent(orderId)}`).then(setSt).catch((e) => setErr(String(e.message || e)));
  }, [orderId]);

  return (
    <s-admin-block heading="Semafor">
      {err && <s-banner tone="critical">{err}</s-banner>}
      {!st && !err && <s-spinner accessibilityLabel="Se verifică" />}
      {st && (
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-box inlineSize="64px">
            <s-image src={`${APP}/light/${st.level}`} alt={TITLE[st.level]} aspectRatio="100/260" objectFit="contain" />
          </s-box>
          <s-stack gap="small-200">
            <s-heading>{TITLE[st.level]}</s-heading>
            {(st.matches || []).map((m, i) => (
              <s-text key={i} color="subdued">{m.kind === "device" || m.kind === "order" ? m.normalized : `${KIND[m.kind] || m.kind}: ${m.normalized} (${m.reason})`}</s-text>
            ))}
            {st.networkShops > 0 && <s-text color="subdued">Raportat de {st.networkShops} magazin(e) din rețea</s-text>}
            {st.inList
              ? <s-text>Clientul este în lista neagră.</s-text>
              : <s-text color="subdued">Ca să-l adaugi în lista neagră: „Mai multe acțiuni” → „Semafor: adaugă în lista neagră”.</s-text>}
          </s-stack>
        </s-stack>
      )}
    </s-admin-block>
  );
}
