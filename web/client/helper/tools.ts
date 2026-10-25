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
 * a link that opens the form with it filled in.
 *
 * Pointing is `@kuboon/chat-element`'s picker, and what it gives back is a CSS path only; the
 * game's context for that path is added when the report is drafted (`context.ts`).
 */

import type { ClientTool } from "@kuboon/chat-element";
import { elementPath, pickElement } from "@kuboon/chat-element/picker";

import { MAX_FEEDBACK_LENGTH } from "@kuboon/game-center-sdk";

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

/**
 * Drafts the report and hands over the link that sends it.
 *
 * SDK 0.5.1's `feedbackUrl({ kind, message })` opens GameCenter's feedback form with the draft
 * already filled in (it rides in the fragment, so no server sees it before the player sends it).
 * The player reads it there, signs in, and presses send. The link is returned rather than opened:
 * the panel renders `http(s)` URLs as links, and the player follows it when they choose to.
 */
const draftReport: ClientTool = {
  name: "draft_report",
  description:
    "Drafts a bug report or a request for this game from what the person said and the element " +
    "they pointed at, and returns a link to GameCenter's feedback form with the draft filled in. " +
    "Use it only after they have described the problem and said to send it. Nothing is sent " +
    "until they press send on that form.",
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
  run: (input) => {
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
    ].join("\n").slice(0, MAX_FEEDBACK_LENGTH);
    const kind = REQUEST_WORDS.test(description) ? "request" : "bug";

    const url = gameCenter()?.feedbackUrl({ kind, message: report });
    if (!url) {
      throw new Error("GameCenter に繋がらないので、送り先を出せませんでした");
    }
    return [
      "報告文を作りました。下のリンクで GameCenter のフォームが記入済みで開きます。" +
      "内容を確かめて「送る」を押してください (送るには id.kbn.one のサインインが要ります)。",
      "",
      url,
      "",
      report,
    ].join("\n");
  },
};

/** A report that asks for something rather than says something is broken. */
const REQUEST_WORDS = /要望|ほしい|欲しい|してほしい|できるように/;

/** Everything this page offers the helper. */
export function pageTools(panel: PanelHooks): readonly ClientTool[] {
  return [whereAmI, pickTool(panel), draftReport];
}
