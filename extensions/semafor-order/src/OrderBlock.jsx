import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Block />, document.body);
};

const LABEL = { green: "🟢 Verde — nu e în lista neagră", yellow: "🟡 Galben — atenție", red: "🔴 Roșu — client din lista neagră" };
const TONE = { green: "success", yellow: "warning", red: "critical" };
const KIND = { email: "e-mail", phone: "telefon", name: "nume", address: "adresă", name_address: "nume + adresă", device: "dispozitiv" };
const REASONS = [
  ["refuz_colet", "Refuz colet"],
  ["chargeback", "Chargeback"],
  ["return_fraud", "Retur fraudulos"],
  ["abuse", "Abuz / amenințări"],
  ["other", "Altul"],
];

function Block() {
  const orderId = shopify.data.selected?.[0]?.id;
  const [st, setSt] = useState(null);
  const [err, setErr] = useState("");
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState("refuz_colet");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr("");
    try {
      const r = await fetch(`/api/order-block?orderId=${encodeURIComponent(orderId)}`);
      const j = await r.json();
      if (j.error) setErr(j.error); else setSt(j);
    } catch (e) { setErr(String(e)); }
  }
  useEffect(() => { if (orderId) load(); }, [orderId]);

  async function add() {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/order-block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, reason, note }) });
      const j = await r.json();
      if (j.error) setErr(j.error); else { setSt(j); setAdding(false); setNote(""); }
    } catch (e) { setErr(String(e)); }
    setBusy(false);
  }

  return (
    <s-admin-block heading="Semafor">
      <s-stack gap="base">
        {err && <s-banner tone="critical">{err}</s-banner>}
        {!st && !err && <s-spinner accessibilityLabel="Se verifică" />}
        {st && (
          <s-stack gap="small">
            <s-badge tone={TONE[st.level]}>{LABEL[st.level]}</s-badge>
            {(st.matches || []).map((m, i) => (
              <s-text key={i} color="subdued">
                {m.kind === "device" ? m.normalized : `${KIND[m.kind] || m.kind}: ${m.normalized} (${m.reason})`}
              </s-text>
            ))}
            {st.networkShops > 0 && <s-text color="subdued">Raportat de {st.networkShops} magazin(e) din rețea</s-text>}
          </s-stack>
        )}
        {st && st.inList && <s-text>Clientul acestei comenzi este deja în lista neagră.</s-text>}
        {st && !st.inList && !adding && (
          <s-button onClick={() => setAdding(true)}>Adaugă clientul în lista neagră</s-button>
        )}
        {adding && (
          <s-stack gap="small">
            <s-select label="Motiv" value={reason} onChange={(e) => setReason(e.currentTarget.value)}>
              {REASONS.map(([v, l]) => <s-option key={v} value={v}>{l}</s-option>)}
            </s-select>
            <s-text-field label="Notă (opțional)" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
            <s-stack direction="inline" gap="small">
              <s-button variant="primary" onClick={add} disabled={busy}>{busy ? "Se adaugă…" : "Adaugă"}</s-button>
              <s-button onClick={() => setAdding(false)}>Renunță</s-button>
            </s-stack>
            <s-text color="subdued">Se salvează e-mailul, telefonul, numele și adresa din comandă.</s-text>
          </s-stack>
        )}
      </s-stack>
    </s-admin-block>
  );
}
