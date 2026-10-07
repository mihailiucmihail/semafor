import { render } from "preact";
import { useState } from "preact/hooks";
import { REASONS, api } from "./shared.js";

export default async () => { render(<Action />, document.body); };

function Action() {
  const ids = (shopify.data.selected || []).map((s) => s.id);
  const [reason, setReason] = useState("refuz_colet");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [err, setErr] = useState("");

  async function add() {
    setBusy(true); setErr("");
    let n = 0;
    for (const orderId of ids) {
      try {
        await api("/api/order-block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, reason, note }) });
        n++;
      } catch (e) { setErr(String(e.message || e)); }
    }
    setDone(n); setBusy(false);
  }

  return (
    <s-admin-action heading="Semafor: adaugă în lista neagră">
      <s-stack gap="base">
        {done > 0 && <s-banner tone="success">{done === 1 ? "Clientul a fost adăugat. Comanda e acum marcată roșu." : `${done} clienți adăugați.`}</s-banner>}
        {err && <s-banner tone="critical">{err}</s-banner>}
        <s-text color="subdued">
          {ids.length > 1 ? `${ids.length} comenzi selectate. ` : ""}Se salvează e-mailul, telefonul, numele și adresa din comandă. Clientul nu e anunțat.
        </s-text>
        <s-select label="Motiv" value={reason} onChange={(e) => setReason(e.currentTarget.value)}>
          {REASONS.map(([v, l]) => <s-option key={v} value={v}>{l}</s-option>)}
        </s-select>
        <s-text-field label="Notă (opțional)" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </s-stack>
      <s-button slot="primary-action" variant="primary" onClick={done ? () => shopify.close() : add} disabled={busy}>
        {done ? "Gata" : busy ? "Se adaugă…" : "Adaugă în lista neagră"}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => shopify.close()}>Renunță</s-button>
    </s-admin-action>
  );
}
