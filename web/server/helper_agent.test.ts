/**
 * The helper's report conversation, end to end through the package's own client and controller,
 * with stand-ins for the two tools that need a real page (`pick_element`, `draft_report`).
 */

import { assert, assertEquals } from "@std/assert";
import { createRouter } from "@remix-run/fetch-router";
import { helperAgentController } from "@remix-kbn/helper-agent/controller";
import {
  type ClientTool,
  HelperAgentSession,
} from "@remix-kbn/helper-agent/client";

import { siteAgent } from "../client/helper/agent.ts";

const PICKED = "ページ: /tsumego?p=strip-1\n盤の点: 3 番";

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
  return new HelperAgentSession({
    transport: {
      url: "http://localhost/helper-agent",
      fetch: (request) => router.fetch(request),
    },
    tools,
  });
}

const lastReply = (s: HelperAgentSession) => {
  const message = s.messages.at(-1);
  return message?.role === "assistant" ? message.content : "";
};

Deno.test("a report picks an element, takes the player's words, and drafts on 送る", async () => {
  const drafted: unknown[] = [];
  const s = session(drafted);

  await s.send("報告");
  assert(lastReply(s).includes("盤の点: 3 番"), lastReply(s));

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
  await s.send("送る");
  assertEquals(drafted, []);
});
