/**
 * What the helper knows, and how it decides a turn.
 *
 * On a deployment with a server this file would not exist: `@remix-kbn/helper-agent/agent/claude`
 * would be behind the controller, this text would be its system prompt, and the answers would be
 * written by a model. GitHub Pages has no server and so nowhere to keep an API key, so what runs
 * here is `agent/dummy` — the same `Agent` interface, answering from a script.
 *
 * Two kinds of turn. Questions are matched against the most recent user message, first hit wins,
 * so `replies` is ordered specific-first. A report is a short conversation of its own, read off
 * the transcript rather than kept anywhere: "報告" asks the page to let the player pick an element
 * (`pick_element`), whatever they write after that is what went wrong, and "送る" drafts the
 * report from those words and the element (`draft_report`). See `tools.ts`.
 */

import { dummyAgent } from "@remix-kbn/helper-agent/agent/dummy";
import type {
  Agent,
  AgentInput,
  DummyTurn,
} from "@remix-kbn/helper-agent/agent/dummy";

type Messages = AgentInput["messages"];

/** Canned answers, in the order they are tried. */
const replies: { match: RegExp; turn: DummyTurn }[] = [
  {
    match: /どこ|このページ|この画面|where am i|which page/i,
    turn: { toolCalls: [{ name: "where_am_i" }] },
  },
  {
    match: /詰碁|つめご|tsumego/i,
    turn: {
      text:
        "詰碁は、青で囲んだ白の連が取られるか、逃げ切るかの問題です。まず勝てると思う側" +
        "(黒 = 取る / 白 = 逃げる) を選んで、CPU と最後まで打ちます。手番の側が勝つとは限りません。" +
        "負けたら「反対側で挑戦」、決着後は「続きを検証」で読み筋を確かめられます。",
    },
  },
  {
    match: /共有|url|リンク|share/i,
    turn: {
      text:
        "詰碁は問題ごとにアドレスが変わります (例: /tsumego?p=strip-1)。問題名の横の" +
        "「この問題を共有」か、アドレスバーの URL をそのまま送ってください。",
    },
  },
  {
    match: /対局|ルール|打ち方|コウ|自殺|取り|地|終局|パス/i,
    turn: {
      text:
        "点が交点、線が隣どうしです。石のつながり・呼吸点・取り・コウ・自殺手禁止は普通の囲碁と同じで、" +
        "両者がパスすると終局し、CPU が空いた領域を黒白どちらの地か判定して数えます。" +
        "盤の種類と大きさ、どちらを CPU にするかは「新しい対局」で選べます。詳しくは「解説」へ。",
    },
  },
  {
    match: /実績|gamecenter|ゲームセンター|記録/i,
    turn: {
      text:
        "詰碁を解いたり CPU に勝ったりすると GameCenter の実績が解除されます。GameCenter から" +
        "起動していないときは端末に溜まり、画面に出る「GameCenter に実績を記録する」リンクで記録できます。",
    },
  },
  {
    match: /全画面|fullscreen/i,
    turn: {
      text:
        "ゲーム画面の「全画面」で盤を画面いっぱいにできます (Fullscreen API の無い iPhone Safari では、" +
        "もともと画面全体を使っています)。ヘルプを開くと全画面は解除されます。",
    },
  },
  {
    match: /あなた|ヘルパー|ai|bot|仕組み|how do you work/i,
    turn: {
      text:
        "私は `@remix-kbn/helper-agent` の台本エージェントで、モデルは入っていません。チャットの" +
        "やりとりも、画面の要素を選ぶのも、報告文を作るのも、すべてこのページの中で動いています。",
    },
  },
];

/** Starts a report: says what to do, and asks the page to let the player pick. */
const REPORT_WORDS = /報告|不具合|おかしい|バグ|壊れ|動かない|要望|bug|report/i;
/** Ends a report's description. */
const SEND_WORDS = /^(送る|送って|送信|報告して|これで|ok|はい|お願い)/i;
/** Gives up on a report. */
const CANCEL_WORDS = /やめ|中止|キャンセル|cancel/i;

/** The name of every tool call in the transcript, by id. */
function callNames(messages: Messages): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls ?? []) names.set(call.id, call.name);
  }
  return names;
}

/**
 * Where a report stands: the element picked (or `null` if picking was given up), and everything
 * the player has written since. `undefined` when no report is open — none started, or the last
 * one has been drafted or abandoned.
 */
function openReport(
  messages: Messages,
): { element: string | null; words: string[] } | undefined {
  const names = callNames(messages);
  let report: { element: string | null; words: string[] } | undefined;
  for (const message of messages) {
    if (message.role === "tool") {
      for (const result of message.results) {
        const name = names.get(result.id);
        if (name === "pick_element") {
          report = {
            element: result.isError ? null : result.content,
            words: [],
          };
        } else if (name === "draft_report") report = undefined;
      }
    } else if (message.role === "user" && report) {
      if (CANCEL_WORDS.test(message.content)) report = undefined;
      else if (!SEND_WORDS.test(message.content.trim())) {
        report.words.push(message.content.trim());
      }
    }
  }
  return report;
}

function latestUserText(messages: Messages): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user") return message.content;
  }
  return "";
}

function script(input: AgentInput): DummyTurn {
  const { messages } = input;
  const last = messages.at(-1);

  // After a tool the page ran.
  if (last?.role === "tool") {
    const names = callNames(messages);
    const result = last.results[0];
    const name = result ? names.get(result.id) : undefined;
    if (name === "pick_element") {
      return {
        text: result.isError
          ? "選ぶのを取りやめました。場所を選ばずに報告するなら、何が起きたかを書いて、" +
            "最後に「送る」と送ってください。やめるなら「やめる」。"
          : `選んだのはここです:\n\n${result.content}\n\n` +
            "何をしたら、どうなったか (どうなってほしかったか) を書いてください。" +
            "書き終えたら「送る」と送ってください。やめるなら「やめる」。",
      };
    }
    if (name === "draft_report") {
      return {
        text: result.isError
          ? `作れませんでした: ${result.content}`
          : result.content,
      };
    }
    return {
      text: `画面から読み取ったことです:\n\n${
        last.results.map((r) => r.content).join("\n")
      }`,
    };
  }

  const text = latestUserText(messages).trim();
  const report = openReport(messages);

  if (report) {
    if (CANCEL_WORDS.test(text)) {
      return {
        text: "報告はやめました。また何かあれば「報告」と送ってください。",
      };
    }
    if (SEND_WORDS.test(text)) {
      if (report.words.length === 0) {
        return {
          text: "先に、何が起きたかを書いてください。それから「送る」です。",
        };
      }
      return {
        text: "報告文を作ります。",
        toolCalls: [{
          name: "draft_report",
          input: {
            description: report.words.join("\n"),
            ...(report.element ? { element: report.element } : {}),
          },
        }],
      };
    }
    return {
      text:
        "書き足すことがあれば続けてください。終わったら「送る」と送ってください。",
    };
  }

  if (REPORT_WORDS.test(text)) {
    return {
      text:
        "報告したいところを、画面でタップして選んでください (Esc か「やめる」で選ばずに進めます)。",
      toolCalls: [{ name: "pick_element" }],
    };
  }

  for (const reply of replies) {
    if (reply.match.test(text)) return reply.turn;
  }

  return {
    text:
      "台本で答えているので、わかることは限られています。詰碁・対局のルール・問題の共有・" +
      "実績・全画面のことを聞いてみてください。「この画面は?」で今の画面を読み取り、" +
      "「報告」で画面の場所を選んで作者への報告文を作れます。",
  };
}

/**
 * The agent this site's controller serves.
 *
 * `wordDelay` is left at its default: the words arriving one at a time is not decoration here, it
 * is the streaming path being exercised.
 */
export function siteAgent(): Agent {
  return dummyAgent({ script });
}
