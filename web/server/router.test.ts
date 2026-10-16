import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import router from "./router.tsx";

Deno.test("GET / returns the shell with nav links and the runtime script", async () => {
  const res = await router.fetch(new Request("http://x/"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const html = await res.text();
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "graph-igo");
  assertStringIncludes(html, 'href="/play"');
  assertStringIncludes(html, 'href="/tsumego"');
  assertStringIncludes(html, 'href="/docs"');
  assertStringIncludes(html, '<script type="module" src="/assets/hydration');
  // Soft navigation is the runtime's default now; no frame target attributes.
  assert(!html.includes("rmx-target"));
});

Deno.test("the game's wasm modules are served and crawled", async () => {
  const { entryPoints } = await import("./router.tsx");
  for (const name of ["engine", "cpu"]) {
    const path = `/static/wasm/${name}.wasm`;
    assert(entryPoints.includes(path), path);
    const res = await router.fetch(new Request(`http://x${path}`));
    assertEquals(res.status, 200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert(WebAssembly.validate(bytes), path);
  }
});

Deno.test("GET /my embeds idp-origin meta", async () => {
  const res = await router.fetch(new Request("http://x/my"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, '<meta name="idp-origin"');
  assertStringIncludes(html, "https://id.kbn.one");
});

Deno.test("GET /sw.js serves the worker with a root scope", async () => {
  const res = await router.fetch(new Request("http://x/sw.js"));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "javascript");
  assertEquals(res.headers.get("service-worker-allowed"), "/");
  assertStringIncludes(await res.text(), "addEventListener");
});

for (
  const [path, needle] of [
    ["/docs", "詰碁のしくみ"],
    ["/docs/how-it-works", "cpu.judge"],
    ["/docs/rules", "面積計算"],
  ] as const
) {
  Deno.test(`GET ${path} renders inside the shell`, async () => {
    const res = await router.fetch(new Request(`http://x${path}`));
    assertEquals(res.status, 200);
    const html = await res.text();
    assertStringIncludes(html, "<main");
    assertStringIncludes(html, needle);
  });
}

for (const [path, island] of [["/play", "graph_go"], ["/tsumego", "tsumego"]]) {
  Deno.test(`GET ${path} is a bare game screen`, async () => {
    const res = await router.fetch(new Request(`http://x${path}`));
    assertEquals(res.status, 200);
    const html = await res.text();
    assert(!html.includes("<main"));
    assertStringIncludes(html, "viewport-fit=cover");
    assertStringIncludes(html, `/assets/islands/${island}`);
  });
}

Deno.test("GET /docs/unknown is a 404", async () => {
  const res = await router.fetch(new Request("http://x/docs/nope"));
  assertEquals(res.status, 404);
  await res.body?.cancel();
});

Deno.test("GET / embeds the GameCenter manifest", async () => {
  const res = await router.fetch(new Request("http://x/"));
  const html = await res.text();
  const m = html.match(
    /<script type="application\/gamecenter\+json">([\s\S]*?)<\/script>/,
  );
  assert(m, "no manifest");
  const manifest = JSON.parse(m[1]);
  assertEquals(manifest.author, "7499d00d-fcff-4630-91a0-c034893c8d08");
  assertEquals(manifest.id, "graph-igo");
  // Relative, so it resolves against the page and not the origin.
  assertEquals(manifest.icon, "static/favicon.svg");
  assert(manifest.achievements.length > 0);
});
