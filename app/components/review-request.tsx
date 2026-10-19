// Shows Shopify's own, neutral review modal (App Bridge Reviews API) when the loader says it is a good moment.
// Waits a few seconds so it never interrupts the merchant the instant the page opens, asks at most once per page view,
// and reports Shopify's answer code back so we keep our own 60-day pause.
import { useEffect, useRef } from "react";
import { useFetcher } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";

const DELAY_MS = 6000;

export function useReviewRequest(ask: boolean) {
  const app = useAppBridge() as any;
  const fetcher = useFetcher();
  const done = useRef(false);

  useEffect(() => {
    if (!ask || done.current) return;
    const timer = setTimeout(async () => {
      if (done.current || document.visibilityState !== "visible") return;
      done.current = true;
      let code = "error";
      try {
        const res = await app?.reviews?.request?.();
        code = res ? (res.success ? "success" : String(res.code || "declined")) : "unsupported";
      } catch (e) {
        console.error("[semafor] review request", e);
      }
      if (code === "unsupported" || code === "error") return; // App Bridge without the API — try on a later visit
      fetcher.submit({ code }, { method: "post", action: "/app/review-asked" });
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
}
