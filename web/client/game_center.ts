/**
 * GameCenter (https://ga-cen.kbn.one): the manifest this game declares, and the achievements it
 * unlocks.
 *
 * The manifest is embedded in the top page's `<head>` as `application/gamecenter+json` (see
 * `layout.tsx`); GameCenter reads it from the published URL when the game is registered
 * (`.github/workflows/register.yaml`). The icon is relative, so it resolves against that page.
 *
 * Unlocking goes through `@kuboon/game-center-sdk`. Launched from the hub, a player carries a
 * token and unlocks are recorded at once; otherwise they wait in `localStorage`, and
 * `islands/game_center.tsx` offers the one link that records them all. Nothing is ever opened for
 * the player — the link is theirs to press.
 */

import { GameCenter } from "@kuboon/game-center-sdk";

export const AUTHOR = "7499d00d-fcff-4630-91a0-c034893c8d08";
export const GAME_SLUG = "graph-igo";
export const GAME_ID = `${AUTHOR}/${GAME_SLUG}`;

export const ACHIEVEMENTS = [
  {
    key: "tsumego_first",
    title: "はじめての詰碁",
    description: "詰碁を 1 問解く",
    points: 10,
    hidden: false,
  },
  {
    key: "tsumego_no_hint",
    title: "自力で読み切る",
    description: "ヒントを使わずに詰碁を解く",
    points: 15,
    hidden: false,
  },
  {
    key: "tsumego_every_board",
    title: "どの盤でも",
    description:
      "2 列・3 列の盤、メビウスの帯、三角格子、蜂の巣、同心円、ランダム、7 種類すべての盤で詰碁を解く",
    points: 30,
    hidden: false,
  },
  {
    key: "tsumego_all",
    title: "詰碁を制覇",
    description: "すべての詰碁を解く",
    points: 50,
    hidden: false,
  },
  {
    key: "win_cpu",
    title: "CPU に勝つ",
    description: "対局で CPU に勝つ",
    points: 20,
    hidden: false,
  },
  {
    key: "win_cpu_exotic",
    title: "見知らぬ盤で",
    description: "碁盤 (正方格子) 以外の盤で CPU に勝つ",
    points: 30,
    hidden: false,
  },
  {
    key: "win_cpu_strong",
    title: "読みの深い相手",
    description: "プレイアウト数 5000 以上の CPU に勝つ",
    points: 50,
    hidden: true,
  },
] as const;

export type AchievementKey = (typeof ACHIEVEMENTS)[number]["key"];

/** The manifest, as the `<head>` embeds it. */
export const MANIFEST = {
  $schema: "https://ga-cen.kbn.one/schema/gamecenter.json",
  id: GAME_SLUG,
  author: AUTHOR,
  title: "グラフ囲碁",
  description: "任意のグラフの上で打つ囲碁。詰碁と CPU 対局。",
  icon: "static/favicon.svg",
  achievements: ACHIEVEMENTS,
};

let client: GameCenter | null = null;
const listeners = new Set<() => void>();

/**
 * The SDK client, made on first use in the browser. Making it reads the launch token out of the
 * URL, so every page that may be a landing page from the hub asks for it once.
 */
export function gameCenter(): GameCenter | null {
  if (typeof document === "undefined") return null;
  client ??= GameCenter.init({ gameId: GAME_ID });
  return client;
}

/** Records an achievement (or queues it), then tells the claim link to redraw. */
export async function unlock(key: AchievementKey): Promise<void> {
  const gc = gameCenter();
  if (!gc) return;
  await gc.unlock(key);
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever the queue may have changed; returns the unsubscribe. */
export function onPendingChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- what the player has solved, for the achievements that count across visits -----------------

const SOLVED_KEY = "graph-igo:solved";

/** Problem ids solved on this device. A convenience: an empty set when storage is unavailable. */
export function solvedProblems(): Set<string> {
  try {
    return new Set(
      JSON.parse(localStorage.getItem(SOLVED_KEY) ?? "[]") as string[],
    );
  } catch {
    return new Set();
  }
}

export function rememberSolved(id: string): Set<string> {
  const solved = solvedProblems();
  solved.add(id);
  try {
    localStorage.setItem(SOLVED_KEY, JSON.stringify([...solved]));
  } catch {
    // Private mode: the achievements still unlock, they just do not count across visits.
  }
  return solved;
}
