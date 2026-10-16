import { assert, assertEquals } from "@std/assert";
import worker from "./worker.ts";

const get = (path: string) => worker.fetch(new Request(`http://x${path}`));

Deno.test("worker serves the RP JWKS", async () => {
  const res = await get("/.well-known/jwks.json");
  assertEquals(res.status, 200);
  const body = await res.json() as { keys: { kty: string }[] };
  assertEquals(body.keys[0].kty, "EC");
});

Deno.test("worker /api/turso degrades to 503 without Turso env", async () => {
  const res = await get("/api/turso");
  assertEquals(res.status, 503);
  await res.body?.cancel();
});

Deno.test("worker /api/protected rejects a request without a DPoP proof", async () => {
  const res = await get("/api/protected");
  assert(res.status === 400 || res.status === 401, `got ${res.status}`);
  await res.body?.cancel();
});

Deno.test("worker does not render pages (static assets answer those)", async () => {
  const res = await get("/hydration");
  assertEquals(res.status, 404);
  await res.body?.cancel();
});
