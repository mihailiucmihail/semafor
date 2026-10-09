// Temporary: serves App Store listing images (public/listing) with CORS so they can be uploaded to the Partner Dashboard. Remove after the listing is submitted.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const name = String(params.file || "");
  if (!/^[\w.-]+\.png$/.test(name)) return new Response("not found", { status: 404 });
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "listing", name));
    return new Response(buf, { headers: { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
};
