// Daily retention run (core/retention.ts), started from the 5-minute app scheduler.
import db from "../db.server";
import { runRetention, retentionKey } from "../../core/retention";

let running = false;
export async function retentionDaily() {
  if (running) return;
  const key = retentionKey();
  // the first process to create today's key does the work (two deployments share one database)
  const mine = await db.appKv.create({ data: { key, value: "running" } }).then(() => true, () => false);
  if (!mine) return;
  running = true;
  try {
    const r = await runRetention(db);
    await db.appKv.update({ where: { key }, data: { value: JSON.stringify(r) } }).catch(() => {});
    console.log("[semafor] retention", JSON.stringify(r));
  } catch (e: any) {
    console.error("[semafor] retention", e?.message || e);
    await db.appKv.delete({ where: { key } }).catch(() => {}); // try again on the next tick
  } finally { running = false; }
}
