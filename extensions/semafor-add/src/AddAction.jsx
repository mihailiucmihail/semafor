import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { REASONS, api, tr, lang } from "./shared.js";

export default async () => { render(<Action />, document.body); };

const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(lang() === "ro" ? "ro-RO" : "en-GB"); } catch { return ""; } };

/** One line per earlier entry: "12.10.2026 · #4021 · Refused COD parcel — matches: phone, e-mail". */
function ExistingLine({ e }) {
  const kinds = [...new Set((e.matched || []).map((m) => tr(`kinds.${m.kind}`)))].join(", ");
  const parts = [fmtDate(e.createdAt), e.orderName, tr(`reasons.${e.reason}`)].filter(Boolean).join(" · ");
  return <s-text>{parts}{kinds ? ` — ${tr("matches", { kinds })}` : ""}</s-text>;
}

function Action() {
  const ids = (shopify.data.selected || []).map((s) => s.id);
  const single = ids.length === 1;
  const [reason, setReason] = useState("refuz_colet");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { added, already, repeat }
  const [err, setErr] = useState("");
  const [existing, setExisting] = useState(null); // single order: earlier entries of the same customer

  // single order: look the customer up before anything is added
  useEffect(() => {
    if (!single) return;
    api(`/api/order-block?orderId=${encodeURIComponent(ids[0])}&lang=${lang()}`)
      .then((r) => setExisting(r.existing || []))
      .catch(() => setExisting([]));
  }, []);

  const sameOrder = !!existing?.some((e) => e.sameOrder);
  const others = (existing || []).filter((e) => !e.sameOrder);

  async function add() {
    setBusy(true); setErr("");
    let added = 0, already = 0, repeat = 0;
    for (const orderId of ids) {
      try {
        const r = await api("/api/order-block", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, reason, note, lang: lang() }) });
        if (r.already) already++;
        else { added++; if ((r.existing || []).length) repeat++; }
      } catch (e) { setErr(String(e.message || e)); }
    }
    setDone({ added, already, repeat }); setBusy(false);
  }

  const result = done && [
    done.added === 1 && ids.length === 1 ? tr("addedOne") : done.added > 0 ? tr("addedMany", { n: done.added }) : "",
    done.repeat > 0 ? tr("repeatDone", { n: done.repeat }) : "",
    done.already > 0 ? tr("alreadyDone", { n: done.already }) : "",
  ].filter(Boolean).join(" ");

  return (
    <s-admin-action heading={tr("heading")}>
      <s-stack gap="base">
        {done && <s-banner tone={done.added ? "success" : "info"}>{result}</s-banner>}
        {err && <s-banner tone="critical">{err}</s-banner>}

        {!done && sameOrder && (
          <s-banner tone="info" heading={tr("sameOrderTitle")}>
            {existing.filter((e) => e.sameOrder).map((e, k) => <ExistingLine key={k} e={e} />)}
          </s-banner>
        )}
        {!done && !sameOrder && others.length > 0 && (
          <s-banner tone="warning" heading={tr("existsTitle", { n: others.length })}>
            <s-stack gap="small-200">
              {others.slice(0, 5).map((e, k) => <ExistingLine key={k} e={e} />)}
              <s-text color="subdued">{tr("existsHint")}</s-text>
            </s-stack>
          </s-banner>
        )}

        {single && existing === null && <s-text color="subdued">{tr("checking")}</s-text>}
        {!sameOrder && (
          <>
            <s-text color="subdued">
              {ids.length > 1 ? tr("selected", { n: ids.length }) : ""}{tr("info")}
            </s-text>
            <s-select label={tr("reason")} value={reason} onChange={(e) => setReason(e.currentTarget.value)}>
              {REASONS.map((v) => <s-option key={v} value={v}>{tr(`reasons.${v}`)}</s-option>)}
            </s-select>
            <s-text-field label={tr("note")} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
          </>
        )}
      </s-stack>
      <s-button slot="primary-action" variant="primary"
        onClick={done || sameOrder ? () => shopify.close() : add}
        disabled={busy || (single && existing === null)}>
        {done || sameOrder ? tr("done") : busy ? tr("adding") : others.length ? tr("addAgain") : tr("add")}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => shopify.close()}>{tr("cancel")}</s-button>
    </s-admin-action>
  );
}
