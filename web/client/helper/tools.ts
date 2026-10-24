/**
 * What the helper can do on this page.
 *
 * These are `ClientTool`s: they run in the browser, on the page the question is about. That is the
 * half of tool use a static site can actually have — there is no server behind GitHub Pages to run
 * anything, but there is a document right here, and it knows which screen is open and what is on
 * it.
 *
 * Reports go to GameCenter's feedback page (`gc.feedbackUrl()`), where the player signs in and the
 * author reads them. Nothing is sent from here: the page has no session to send with. So the
 * helper drafts the text — the player's words, plus the element they pointed at — and hands over
 * the link to paste it into.
 *
 * Pointing is `@kuboon/chat-element`'s picker, and what it gives back is a CSS path only; the
 * game's context for that path is added when the report is drafted (`context.ts`).
 */

import type { ClientTool } from "@kuboon/chat-element";
import { elementPath, pickElement } from "@kuboon/chat-element/picker";

import { gameCenter } from "../game_center.ts";
import { describeScreen, onPage } from "./context.ts";

/** What the tools need from the panel they are offered in. */
export interface PanelHooks {
  /** Gets the panel out of the way while the player picks, and brings it back after. */
  hide(): void;
  show(): void;
  /** The panel's own element, which is never picked. */
  element(): Element | null;
}

/** The page the person is looking at, read off the document. */
const whereAmI: ClientTool = {
  name: "where_am_i",
  description:
    "The page the person is looking at: its path, its heading and what the status line says. " +
    "Use it before explaining anything that depends on which screen they are on.",
  inputSchema: { type: "object", properties: {} },
  run: () => {
    const heading = onPage("h2, h1")?.textContent?.trim() ??
      "(なし)";
    const status = onPage("[aria-live]")?.textContent?.trim();
    return [
      `ページ: ${location.pathname}${location.search}`,
      `見出し: ${heading}`,
      `タイトル: ${document.title}`,
      ...(status ? [`状態表示: ${status}`] : []),
    ].join("\n");
  },
};

/**
 * The player taps the part of the screen the report is about.
 *
 * `chat-element`'s own `pickElementTool`, except that the panel steps aside while the player
 * picks: on a phone the corner panel covers most of the board. Throws when the pick is given up,
 * so the script can tell "did not pick" from a path.
 */
function pickTool(panel: PanelHooks): ClientTool {
  return {
    name: "pick_element",
    description:
      "Asks the person to tap the part of the screen they mean, and returns its CSS path. Use it " +
      "when they want to report something they can see.",
    inputSchema: { type: "object", properties: {} },
    run: async (_input, signal) => {
      panel.hide();
      try {
        const self = panel.element();
        const el = await pickElement({ ignore: self ? [self] : [], signal });
        if (el === null) throw new Error("選ぶのを取りやめました");
        return elementPath(el);
      } finally {
        panel.show();
      }
    },
  };
}

/** The longest report GameCenter's feedback form takes. */
const MAX_REPORT = 4000;

/**
 * Drafts the report and hands over where to send it.
 *
 * It copies the draft to the clipboard when the browser lets it — a tool runs after the reply has
 * streamed, so there may be no user gesture left and the copy can be refused — and returns the
 * text either way, with the feedback link. The link is returned rather than opened: the panel
 * renders `http(s)` URLs as links, and the player follows it when they choose to.
 */
const draftReport: ClientTool = {
  name: "draft_report",
  description:
    "Drafts a bug report or a request for this game from what the person said and the element " +
    "they picked, copies it if it can, and returns it with the link to GameCenter's feedback " +
    "page to paste it into. Use it only after they have described the problem and said to send " +
    "it. Nothing is sent until they paste it there and press send.",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description:
          "What they did, what happened, and what they expected, in their words",
      },
      element: {
        type: "string",
        description:
          "The CSS path of the element they pointed at, from pick_element or the ⌖ button",
      },
    },
    required: ["description"],
  },
  run: async (input) => {
    const { description, element } = input as {
      description?: unknown;
      element?: unknown;
    };
    if (typeof description !== "string" || description.trim() === "") {
      throw new Error("報告には内容が要ります");
    }
    const report = [
      description.trim(),
      "",
      "---",
      describeScreen(
        typeof element === "string" && element ? element : undefined,
      ),
      `ブラウザ: ${navigator.userAgent}`,
    ].join("\n").slice(0, MAX_REPORT);

    let copied = false;
    try {
      await navigator.clipboard.writeText(report);
      copied = true;
    } catch {
      // No gesture left, or no clipboard: the text below is there to copy by hand.
    }
    const url = gameCenter()?.feedbackUrl();
    const where = url
      ? `${url} を開いて、「内容」に貼り付けて送ってください (送るには id.kbn.one のサインインが要ります)。`
      : "GameCenter に繋がらないので、送り先を出せませんでした。";
    return [
      copied
        ? "報告文を作って、コピーしました。"
        : "報告文を作りました。下の文をコピーしてください。",
      where,
      "",
      report,
    ].join("\n");
  },
};

/** Everything this page offers the helper. */
export function pageTools(panel: PanelHooks): readonly ClientTool[] {
  return [whereAmI, pickTool(panel), draftReport];
}
