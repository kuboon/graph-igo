/**
 * Finds tsumego for `web/client/lib/graph_go/problems.ts` by trying random positions and keeping
 * the ones the CPU's reading says are real problems:
 *
 * - **capture** (黒先・白を取る): black to play can take the target, but if black passes white
 *   gets away, and exactly one first move works;
 * - **escape** (白先・逃げる): black could take the target if it were black's move, and exactly
 *   one white move saves it.
 *
 * Capture problems must also take at least three black moves, so a plain atari does not count.
 *
 * The page reads every reply at the problem's full depth, so the checks here do too.
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
  BLACK,
  type Color,
  EMPTY,
  type GraphSpec,
  WHITE,
} from "../web/client/lib/graph_go/types.ts";

const dir = new URL("../web/client/static/wasm/", import.meta.url);
const { engine, cpu } = await loadGraphGo(
  await Deno.readFile(new URL("engine.wasm", dir)),
  await Deno.readFile(new URL("cpu.wasm", dir)),
);

const DEPTH = 9;

let state = 12345;
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

/** Every group has a liberty, and the target's group has at least two. */
function sane(adj: number[][], stones: Color[], target: number): boolean {
  const seen = new Set<number>();
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
    if (libs.size === 0) return false;
    if (group.includes(target) && libs.size < 2) return false;
  }
  return true;
}

function solves(
  graph: GraphSpec,
  stones: Color[],
  toMove: 1 | 2,
  target: number,
  depth = DEPTH,
) {
  return cpu.solve({ graph, stones, toMove, target, maxDepth: depth })
    .attackerWins;
}

/** First moves for `color` after which the reading goes `color`'s way. */
function winningMoves(
  graph: GraphSpec,
  stones: Color[],
  color: 1 | 2,
  target: number,
): number[] {
  const wins: number[] = [];
  for (let v = 0; v < stones.length; v++) {
    if (stones[v] !== EMPTY) continue;
    const r = engine.play({ graph, stones, color, node: v });
    if (!r.legal) continue;
    const attackerWins = solves(
      graph,
      r.stones,
      color === BLACK ? WHITE : BLACK,
      target,
    );
    if ((color === BLACK) === attackerWins) wins.push(v);
    if (wins.length > 1) break;
  }
  return wins;
}

interface Want {
  kind: BoardKind;
  size: number;
  seed?: number;
  capture: number;
  escape: number;
}

interface Found extends Want {
  goal: "capture" | "escape";
  toPlay: 1 | 2;
  target: number;
  stones: Color[];
  answer: number;
}

const wanted: Want[] = [
  { kind: "grid", size: 6, capture: 2, escape: 1 },
  { kind: "triangular", size: 4, capture: 1, escape: 1 },
  { kind: "honeycomb", size: 2, capture: 1, escape: 1 },
  { kind: "rings", size: 3, capture: 1, escape: 1 },
  { kind: "random", size: 30, seed: 5, capture: 1, escape: 1 },
];

const out: Found[] = [];
for (const want of wanted) {
  const { graph } = makeBoard(want.kind, want.size, want.seed);
  const adj = adjacency(graph);
  let capture = 0;
  let escape = 0;
  for (
    let tries = 0;
    tries < 20000 && (capture < want.capture || escape < want.escape);
    tries++
  ) {
    const target = Math.floor(rand() * graph.nodeCount);
    const around = near(adj, target, 2);
    const stones: Color[] = Array(graph.nodeCount).fill(EMPTY);
    stones[target] = WHITE;
    const blacks = 2 + Math.floor(rand() * 4);
    const whites = Math.floor(rand() * 3);
    for (let i = 0; i < blacks; i++) stones[pick(around)] = BLACK;
    for (let i = 0; i < whites; i++) stones[pick(around)] = WHITE;
    stones[target] = WHITE;
    if (!sane(adj, stones, target)) continue;

    const blackFirst = solves(graph, stones, BLACK, target);
    const whiteFirst = solves(graph, stones, WHITE, target);
    if (!blackFirst || whiteFirst) continue; // Not urgent for both sides: not a problem.

    const minDepth = [1, 3, 5, 7, 9].find((d) =>
      solves(graph, stones, BLACK, target, d)
    )!;
    if (capture < want.capture && minDepth >= 5) {
      const moves = winningMoves(graph, stones, BLACK, target);
      if (moves.length === 1) {
        capture++;
        out.push({
          ...want,
          goal: "capture",
          toPlay: BLACK,
          target,
          stones,
          answer: moves[0],
        });
        continue;
      }
    }
    if (escape < want.escape) {
      const moves = winningMoves(graph, stones, WHITE, target);
      if (moves.length === 1) {
        escape++;
        out.push({
          ...want,
          goal: "escape",
          toPlay: WHITE,
          target,
          stones,
          answer: moves[0],
        });
      }
    }
  }
  console.error(want.kind, "capture", capture, "escape", escape);
}
const LABEL: Record<BoardKind, string> = {
  grid: "碁盤",
  triangular: "三角格子",
  honeycomb: "蜂の巣",
  rings: "同心円",
  random: "ランダム",
};
const numbering = new Map<BoardKind, number>();
const problems = out.map((p) => {
  const n = (numbering.get(p.kind) ?? 0) + 1;
  numbering.set(p.kind, n);
  const board = p.seed === undefined
    ? { kind: p.kind, size: p.size }
    : { kind: p.kind, size: p.size, seed: p.seed };
  const black = p.stones.flatMap((c, v) => (c === BLACK ? [v] : []));
  const white = p.stones.flatMap((c, v) => (c === WHITE ? [v] : []));
  return {
    id: `${p.kind}-${n}`,
    title: `${LABEL[p.kind]} ${n} — ${
      p.goal === "capture" ? "黒先、白を取る" : "白先、逃げる"
    }`,
    board,
    black,
    white,
    toPlay: p.toPlay,
    goal: p.goal,
    target: p.target,
    depth: DEPTH,
    answer: p.answer,
  };
});

console.log(`/**
 * The tsumego. Each is a capture fight read out by the CPU's \`solve\`:
 *
 * - \`capture\` — black to play takes the group holding \`target\`;
 * - \`escape\` — white to play saves it.
 *
 * "Saved" means black can no longer force the capture within \`depth\` moves, both sides counted.
 * Every problem here has exactly one right first move (\`answer\`), checked by
 * \`wasm/graph_go_test.ts\`. Generated by \`tools/gen_tsumego.ts\`; edit by hand freely, the test
 * says if a problem breaks.
 */

import type { BoardKind } from "./graphs.ts";
import type { Player } from "./types.ts";

export interface Problem {
  id: string;
  title: string;
  board: { kind: BoardKind; size: number; seed?: number };
  black: number[];
  white: number[];
  toPlay: Player;
  goal: "capture" | "escape";
  /** A stone of the group being fought over. */
  target: number;
  depth: number;
  /** The one first move that works. */
  answer: number;
}

export const PROBLEMS: Problem[] = ${JSON.stringify(problems, null, 2)};`);
