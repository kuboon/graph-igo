import { assertEquals } from "@std/assert";
import puppeteer from "puppeteer-core";
import { lightpanda } from "@lightpanda/browser";

import router from "../server/router.tsx";

function findFreePort(): number {
  const listener = Deno.listen({ port: 0, hostname: "127.0.0.1" });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

async function waitForCdp(cdpPort: number, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (res.ok) {
        const json = await res.json();
        return json.webSocketDebuggerUrl as string;
      }
      await res.body?.cancel();
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `lightpanda CDP :${cdpPort} didn't become ready: ${lastError}`,
  );
}

/**
 * `@lightpanda/browser` downloads its binary on first use and leaves it without the executable bit
 * on some hosts (GitHub's runners among them), so the first spawn fails with `EACCES`. Mark it
 * executable and spawn again.
 */
async function serveLightpanda(port: number) {
  try {
    return await lightpanda.serve({ host: "127.0.0.1", port });
  } catch (error) {
    if (!String(error).includes("EACCES")) throw error;
    const home = Deno.env.get("HOME") ?? "";
    await Deno.chmod(`${home}/.cache/lightpanda-node/lightpanda`, 0o755);
    return await lightpanda.serve({ host: "127.0.0.1", port });
  }
}

/** The text of the status line the island keeps up to date. */
const STATUS = "[aria-live]";

Deno.test({
  name: "lightpanda: /tsumego で勝つ側を選び、初手に CPU が応じる",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const { PROBLEMS } = await import("../client/lib/graph_go/problems.ts");
    // A problem whose winner moves first, so the player's move gets an answer.
    const first = PROBLEMS.find((p) => p.answer !== null)!;
    const at = PROBLEMS.indexOf(first);
    const cdpPort = findFreePort();
    const appPort = findFreePort();

    const lpProc = await serveLightpanda(cdpPort);

    const app = Deno.serve(
      { port: appPort, hostname: "127.0.0.1", onListen: () => {} },
      (req) => router.fetch(req),
    );

    try {
      const wsUrl = await waitForCdp(cdpPort);

      const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl });
      try {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();

        await page.goto(`http://127.0.0.1:${appPort}/tsumego`);
        await page.waitForFunction("globalThis.__rmxReady === true", {
          timeout: 10_000,
        });
        // The modules have loaded once the side buttons are enabled.
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("button")].some((b) =>
              b.textContent?.includes("黒を持つ") && !b.disabled
            ),
          { timeout: 10_000 },
        );
        await page.evaluate((i: number) => {
          const select = document.querySelector("select")!;
          select.value = String(i);
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }, at);
        await page.waitForFunction(
          (title: string) =>
            document.querySelector("h2")?.textContent === title,
          { timeout: 10_000 },
          first.title,
        );
        await page.evaluate((label: string) => {
          [...document.querySelectorAll("button")]
            .find((b) => b.textContent?.includes(label))!
            .click();
        }, first.winner === 1 ? "黒を持つ" : "白を持つ");
        await page.waitForFunction(
          (selector: string) =>
            document.querySelector(selector)?.textContent?.includes(
              "持ちました",
            ) ??
              false,
          { timeout: 10_000 },
          STATUS,
        );

        // Each node is a `<g>`; its last circle is the click target.
        await page.evaluate((node: number) => {
          const hits = document.querySelectorAll("svg g")[node]
            .querySelectorAll("circle");
          hits[hits.length - 1].dispatchEvent(
            new MouseEvent("click", { bubbles: true }),
          );
        }, first.answer as number);

        await page.waitForFunction(
          (selector: string) => {
            const text = document.querySelector(selector)?.textContent ?? "";
            return text.includes("あなたの番") || text.includes("正解");
          },
          { timeout: 10_000 },
          STATUS,
        );
        const status = await page.$eval(STATUS, (el) => el.textContent ?? "");
        // No problem is over in one move, so the CPU answers.
        assertEquals(status.includes("応じました"), true, status);

        await page.close();
        await context.close();
      } finally {
        await browser.disconnect();
      }
    } finally {
      try {
        lpProc.kill("SIGTERM");
      } catch { /* already gone */ }
      await app.shutdown();
    }
  },
});
