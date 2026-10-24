/**
 * The helper's report conversation, end to end through the real client (`@kuboon/chat-element`'s
 * session) and controller (`@remix-kbn/helper-agent`'s), with stand-ins for the two tools that
 * need a real page (`pick_element`, `draft_report`).
 */

import { assert, assertEquals } from "@std/assert";
import { createRouter } from "@remix-run/fetch-router";
import { helperAgentController } from "@remix-kbn/helper-agent/controller";
import { ChatSession, type ClientTool } from "@kuboon/chat-element/session";

import { siteAgent } from "../client/helper/agent.ts";

const PICKED = "body > div > svg > g:nth-of-type(4) > circle:nth-of-type(2)";

function session(drafted: unknown[]) {
  const router = createRouter();
  router.post("/helper-agent", helperAgentController(siteAgent()));
  const tools: ClientTool[] = [
    {
      name: "pick_element",
      description: "",
      inputSchema: { type: "object", properties: {} },
      run: () => PICKED,
    },
    {
      name: "draft_report",
      description: "",
      inputSchema: { type: "object", properties: {} },
      run: (input) => {
        drafted.push(input);
        return "報告文を作りました。";
      },
    },
  ];
  return new ChatSession({
    transport: {
      url: "http://localhost/helper-agent",
      fetch: (request) => router.fetch(request),
    },
    tools,
  });
}

const lastReply = (s: ChatSession) => {
  const message = s.messages.at(-1);
  return message?.role === "assistant" ? message.content : "";
};

Deno.test("a report picks an element, takes the player's words, and drafts on 送る", async () => {
  const drafted: unknown[] = [];
  const s = session(drafted);

  await s.send("報告");
  assert(lastReply(s).includes(PICKED), lastReply(s));

  await s.send("この点に打てなかった");
  assertEquals(drafted, []);

  await s.send("送る");
  assertEquals(drafted, [{
    description: "この点に打てなかった",
    element: PICKED,
  }]);
  assertEquals(lastReply(s), "報告文を作りました。");

  // The report is closed: the next 送る is not a second draft.
  await s.send("送る");
  assertEquals(drafted.length, 1);
});

Deno.test("やめる abandons a report", async () => {
  const drafted: unknown[] = [];
  const s = session(drafted);
  await s.send("おかしい");
  await s.send("やめる");
  assert(lastReply(s).includes("やめました"), lastReply(s));
  await s.send("送る");
  assertEquals(drafted, []);
});

Deno.test("a path from the ⌖ button opens a report without asking to pick", async () => {
  const drafted: unknown[] = [];
  const s = session(drafted);
  // As the ⌖ button leaves it in the composer.
  await s.send(`\`${PICKED}\` ここに打てない`);
  assert(lastReply(s).includes("添えます"), lastReply(s));
  await s.send("送る");
  assertEquals(drafted, [{ description: "ここに打てない", element: PICKED }]);
});
