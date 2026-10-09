import { render } from "preact";
import { useState } from "preact/hooks";
import { REASONS, api, tr, lang } from "./shared.js";

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
        await api("/api/order-block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, reason, note, lang: lang() }) });
        n++;
      } catch (e) { setErr(String(e.message || e)); }
    }
    setDone(n); setBusy(false);
  }

  return (
    <s-admin-action heading={tr("heading")}>
      <s-stack gap="base">
        {done > 0 && <s-banner tone="success">{done === 1 ? tr("addedOne") : tr("addedMany", { n: done })}</s-banner>}
        {err && <s-banner tone="critical">{err}</s-banner>}
        <s-text color="subdued">
          {ids.length > 1 ? tr("selected", { n: ids.length }) : ""}{tr("info")}
        </s-text>
        <s-select label={tr("reason")} value={reason} onChange={(e) => setReason(e.currentTarget.value)}>
          {REASONS.map((v) => <s-option key={v} value={v}>{tr(`reasons.${v}`)}</s-option>)}
        </s-select>
        <s-text-field label={tr("note")} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </s-stack>
      <s-button slot="primary-action" variant="primary" onClick={done ? () => shopify.close() : add} disabled={busy}>
        {done ? tr("done") : busy ? tr("adding") : tr("add")}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => shopify.close()}>{tr("cancel")}</s-button>
    </s-admin-action>
  );
}
