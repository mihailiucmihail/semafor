// Tiny in-process cache for heavy read-only pages (Statistici): one computation per key per `ttl`.
// Parallel requests for the same key share the running computation. Lost on restart — that's fine.
const store = new Map<string, { at: number; value: Promise<unknown> }>();

export function memo<T>(key: string, ttl: number, fn: () => Promise<T>, fresh = false): Promise<T> {
  const hit = store.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = fn();
  store.set(key, { at: Date.now(), value });
  value.catch(() => { if (store.get(key)?.value === value) store.delete(key); });
  if (store.size > 500) { const old = [...store.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100); for (const [k] of old) store.delete(k); }
  return value;
}
