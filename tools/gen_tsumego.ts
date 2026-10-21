/**
 * Finds tsumego for `web/client/lib/graph_go/problems.ts`.
 *
 * Every problem is a capture fight on a board that is not the ordinary grid. The position says
 * whose move it is, and the player has to pick the side that wins — so per board one problem has
 * the side to move winning and one has it losing anyway. The CPU's reading decides who wins; a
 * candidate is kept only when:
 *
 * - it goes against the eye: black takes a group with three or more liberties, or white saves one
 *   with one or two;
 * - when the side to move wins, it wins only because it moves (a pass would hand the fight over)
 *   and it has at most two winning first moves;
 * - when black wins, the capture takes at least three black moves;
 * - played out the way the screen plays it (`playOut`), the winning side following the hints beats
 *   the CPU, and the losing side playing its most stubborn moves still loses.
 *
 * ```sh
 * deno task build:wasm
 * deno run -R tools/gen_tsumego.ts > web/client/lib/graph_go/problems.ts && deno fmt web/client
 * ```
 */

import { loadGraphGo } from "../web/client/lib/graph_go/wasm.ts";
import {
  type BoardKind,
  makeBoard,
} from "../web/client/lib/graph_go/graphs.ts";
import {
  playOut,
  startOf,
  winnerWithBestPlay,
  winningMoves,
} from "../web/client/lib/graph_go/tsumego.ts";
import type { Problem } from "../web/client/lib/graph_go/problems.ts";
import {
  BLACK,
  type Color,
  EMPTY,
  type GraphSpec,
  opponent,
  type Player,
  WHITE,
} from "../web/client/lib/graph_go/types.ts";

const dir = new URL("../web/client/static/wasm/", import.meta.url);
const { engine, cpu } = await loadGraphGo(
  await Deno.readFile(new URL("engine.wasm", dir)),
  await Deno.readFile(new URL("cpu.wasm", dir)),
);

const DEPTH = 9;

let state = 20261020;
const rand = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x1_0000_0000;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

function adjacency(graph: GraphSpec): number[][] {
  const adj: number[][] = Array.from({ length: graph.nodeCount }, () => []);
  for (const [a, b] of graph.edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
}

function near(adj: number[][], from: number, radius: number): number[] {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const v = queue.shift()!;
    for (const u of adj[v]) {
      if (!dist.has(u) && dist.get(v)! < radius) {
        dist.set(u, dist.get(v)! + 1);
        queue.push(u);
      }
    }
  }
  return [...dist.keys()].filter((v) => v !== from);
}

/** Every group has a liberty. Returns the target group's liberty count, or 0 if one has none. */
function liberties(adj: number[][], stones: Color[], target: number): number {
  const seen = new Set<number>();
  let targetLibs = 0;
  for (let s = 0; s < stones.length; s++) {
    if (stones[s] === EMPTY || seen.has(s)) continue;
    const group = [s];
    const libs = new Set<number>();
    seen.add(s);
    for (let i = 0; i < group.length; i++) {
      for (const u of adj[group[i]]) {
        if (stones[u] === EMPTY) libs.add(u);
        else if (stones[u] === stones[s] && !seen.has(u)) {
          seen.add(u);
          group.push(u);
        }
      }
    }
    if (libs.size === 0) return 0;
    if (group.includes(target)) targetLibs = libs.size;
  }
  return targetLibs;
}

interface Want {
  kind: BoardKind;
  size: number;
  seed?: number;
}

const wanted: Want[] = [
  { kind: "strip", size: 8 },
  { kind: "band", size: 7 },
  { kind: "mobius", size: 8 },
  { kind: "triangular", size: 3 },
  { kind: "honeycomb", size: 2 },
  { kind: "rings", size: 2 },
  { kind: "random", size: 24, seed: 7 },
];

const out: Problem[] = [];
for (const want of wanted) {
  const { graph } = makeBoard(want.kind, want.size, want.seed);
  const adj = adjacency(graph);
  /** One problem where the side to move wins, one where it loses anyway. */
  const found = { moverWins: 0, moverLoses: 0 };
  for (
    let tries = 0;
    tries < 60000 && (found.moverWins < 1 || found.moverLoses < 1);
    tries++
  ) {
    const target = Math.floor(rand() * graph.nodeCount);
    const around = near(adj, target, 2);
    const stones: Color[] = Array(graph.nodeCount).fill(EMPTY);
    const blacks = 2 + Math.floor(rand() * 4);
    const whites = Math.floor(rand() * 3);
    for (let i = 0; i < blacks; i++) stones[pick(around)] = BLACK;
    for (let i = 0; i < whites; i++) stones[pick(around)] = WHITE;
    stones[target] = WHITE;
    const libs = liberties(adj, stones, target);
    if (libs === 0) continue;

    const toMove: Player = rand() < 0.5 ? BLACK : WHITE;
    const problem: Problem = {
      id: "candidate",
      title: "",
      board: want.seed === undefined
        ? { kind: want.kind, size: want.size }
        : { kind: want.kind, size: want.size, seed: want.seed },
      black: stones.flatMap((c, v) => (c === BLACK ? [v] : [])),
      white: stones.flatMap((c, v) => (c === WHITE ? [v] : [])),
      toMove,
      target,
      depth: DEPTH,
      winner: BLACK,
      answer: null,
    };
    const start = startOf(problem, graph);
    const winner = winnerWithBestPlay(cpu, problem, start, toMove);
    problem.winner = winner;
    const moverWins = winner === toMove;
    if (moverWins ? found.moverWins >= 1 : found.moverLoses >= 1) continue;

    // Against the eye.
    if (winner === BLACK ? libs < 3 : libs > 2) continue;

    if (moverWins) {
      // Only because it is to move, and with few ways to do it.
      if (
        winnerWithBestPlay(cpu, problem, start, opponent(toMove)) === winner
      ) {
        continue;
      }
      const moves = winningMoves(engine, cpu, problem, start, toMove);
      if (moves.length === 0 || moves.length > 2) continue;
      problem.answer = moves[0];
    }

    if (winner === BLACK) {
      const quickest = [1, 3, 5, 7, 9].find((d) =>
        cpu.solve({ graph, ...start, toMove, target, maxDepth: d }).attackerWins
      );
      if (quickest === undefined || quickest < 5) continue;
    }

    // Sound when played the way the screen plays it.
    if (playOut(engine, cpu, problem, graph, winner, "hint") !== winner) {
      continue;
    }
    if (
      playOut(engine, cpu, problem, graph, opponent(winner), "cpu") !== winner
    ) {
      continue;
    }

    if (moverWins) found.moverWins++;
    else found.moverLoses++;
    out.push(problem);
  }
  console.error(want.kind, found);
}

/** What a problem's title calls its board. */
const NAME: Record<BoardKind, string> = {
  grid: "碁盤",
  strip: "2 列の盤",
  band: "3 列の盤",
  mobius: "メビウスの帯",
  triangular: "三角格子",
  honeycomb: "蜂の巣",
  rings: "同心円",
  random: "ランダム",
};
const numbering = new Map<BoardKind, number>();
const problems = out.map((p) => {
  const n = (numbering.get(p.board.kind) ?? 0) + 1;
  numbering.set(p.board.kind, n);
  return {
    ...p,
    id: `${p.board.kind}-${n}`,
    title: `${NAME[p.board.kind]} ${n} — ${
      p.toMove === BLACK ? "黒番" : "白番"
    }`,
  };
});

console.log(`/**
 * The tsumego: capture fights on boards that are not the ordinary grid.
 *
 * Black wins by taking the group holding \`target\`; white wins once black can no longer force that
 * within \`depth\` moves, both sides counted. \`toMove\` is whose move it is, and \`winner\` is who wins
 * with best play — which the player has to work out, by picking the side they think it is.
 * \`answer\` is the winner's first move when the winner is to move.
 *
 * Generated by \`tools/gen_tsumego.ts\`; \`wasm/graph_go_test.ts\` checks every problem still plays out
 * the way it says.
 */

import type { BoardKind } from "./graphs.ts";
import type { Player } from "./types.ts";

export interface Problem {
  id: string;
  title: string;
  board: { kind: BoardKind; size: number; seed?: number };
  black: number[];
  white: number[];
  toMove: Player;
  /** A stone of the group being fought over. */
  target: number;
  depth: number;
  winner: Player;
  answer: number | null;
}

export const PROBLEMS: Problem[] = ${JSON.stringify(problems, null, 2)};`);
