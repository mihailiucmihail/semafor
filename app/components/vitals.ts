// Measures the admin page in the merchant's browser and sends one beacon per page view to /api/vitals.
// LCP = when the main content appeared; INP = the slowest click / key press until the screen updated.
const desc = (el: Element | null | undefined) => {
  if (!el) return null;
  const id = el.id ? "#" + el.id : "";
  const cls = typeof el.className === "string" ? "." + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
  const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
  return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ""}`;
};

let firstPage = true;
export function startVitals() {
  if (typeof window === "undefined" || !("PerformanceObserver" in window)) return () => {};
  const full = firstPage; firstPage = false;
  const t0 = performance.now();
  let sent = false;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const v: Record<string, unknown> = { path: location.pathname, nav: full ? "load" : "in-app", ttfb: full && nav ? nav.responseStart : null, longTasks: 0, longest: 0 };
  const obs: PerformanceObserver[] = [];
  const watch = (type: string, cb: (e: any) => void, extra: Record<string, unknown> = {}) => {
    try { const o = new PerformanceObserver((l) => l.getEntries().forEach(cb)); o.observe({ type, buffered: true, ...extra } as any); obs.push(o); } catch { /* unsupported */ }
  };
  if (full) {
    watch("paint", (e) => { if (e.name === "first-contentful-paint") v.fcp = e.startTime; });
    watch("largest-contentful-paint", (e) => { v.lcp = e.startTime; v.lcpEl = desc(e.element); });
  }
  watch("longtask", (e) => { if (!full && e.startTime < t0) return; v.longTasks = (v.longTasks as number) + 1; v.longest = Math.max(v.longest as number, e.duration); });
  watch("event", (e) => {
    if (!e.interactionId || (!full && e.startTime < t0 - 50) || e.duration <= ((v.inp as number) || 0)) return;
    v.inp = e.duration; v.inpType = e.name; v.inpEl = desc(e.target);
    v.inDelay = e.processingStart - e.startTime; v.proc = e.processingEnd - e.processingStart; v.pres = e.startTime + e.duration - e.processingEnd;
  }, { durationThreshold: 16 });
  const send = () => {
    if (sent) return; sent = true;
    try { navigator.sendBeacon("/api/vitals", new Blob([JSON.stringify(v)], { type: "text/plain" })); } catch { /* ignore */ }
  };
  const onHide = () => { if (document.visibilityState === "hidden") send(); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", send);
  return () => { send(); obs.forEach((o) => o.disconnect()); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", send); };
}
