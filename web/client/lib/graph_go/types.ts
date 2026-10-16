/**
 * The JSON the two wasm modules speak — the TypeScript side of `wasm/core/src/wire.rs`.
 *
 * Colours are numbers: `0` empty, `1` black, `2` white. A node is its index, and `null` where a
 * node is expected is a pass.
 */

export type Color = 0 | 1 | 2;
export type Player = 1 | 2;

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export const opponent = (
  color: Player,
): Player => (color === BLACK ? WHITE : BLACK);

export interface GraphSpec {
  nodeCount: number;
  edges: [number, number][];
}

export interface Position {
  graph: GraphSpec;
  stones: Color[];
  ko?: number | null;
}

export type IllegalReason =
  | "occupied"
  | "ko"
  | "suicide"
  | "outOfRange"
  | "invalidColor";

export interface PlayResult {
  legal: boolean;
  reason: IllegalReason | null;
  stones: Color[];
  ko: number | null;
  captured: number[];
  group: number[];
  liberties: number;
  atari: number[];
}

/** An empty region and its boundary stones, as a graph of their own numbered from zero. */
export interface Subgraph {
  nodeCount: number;
  edges: [number, number][];
  stones: Color[];
  /** The board node each local node came from: the region's nodes first, then the boundary. */
  origin: number[];
}

export interface Region {
  nodes: number[];
  boundary: number[];
  subgraph: Subgraph;
}

export interface Tally {
  stones: number;
  territory: number;
  score: number;
}

export interface JudgedRegion {
  nodes: number[];
  owner: Color;
  confidence: number;
  judgedBy: "cpu" | "engine";
}

export interface Evaluation {
  black: Tally;
  white: Tally;
  komi: number;
  winner: Color;
  regions: JudgedRegion[];
}

export interface Judgement {
  owner: Color;
  confidence: number;
  nodeOwners: Color[];
}

export interface Genmove {
  node: number | null;
  winRate: number;
  candidates: { node: number; winRate: number }[];
}

export interface Solution {
  /** The colour trying to capture. */
  attacker: Color;
  /** Whether the attacker can force the capture within the depth, whoever is to move. */
  attackerWins: boolean;
  /** The recommended move for the side to move; `null` passes. */
  move: number | null;
  /** The target is already gone. */
  captured: boolean;
  /** Positions the reading visited. */
  visited: number;
}

export interface Engine {
  /** What happens when `color` plays `node` (`null` passes) on the position. */
  play(position: Position & { color: Player; node: number | null }): PlayResult;
  /** The empty regions of at least `minSize` nodes. */
  regions(request: { graph: GraphSpec; stones: Color[]; minSize: number }): {
    regions: Region[];
  };
  /** Scores the position, asking the CPU's `judge` about every region of `minSize` or more. */
  evaluate(request: {
    graph: GraphSpec;
    stones: Color[];
    minSize: number;
    komi: number;
  }): Evaluation;
}

export interface Cpu {
  judge(subgraph: Subgraph): Judgement;
  genmove(
    request: Position & {
      color: Player;
      komi: number;
      playouts?: number;
      seed?: number;
      opponentPassed?: boolean;
    },
  ): Genmove;
  /** Reads out whether the group at `target` can be captured, with `toMove` to play. */
  solve(
    request: Position & { toMove: Player; target: number; maxDepth?: number },
  ): Solution;
}
