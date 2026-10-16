/**
 * The one judgement both the tsumego screen and its test make: which moves keep the player on
 * track from a position.
 *
 * A move is on track when, right after it, the reading the screen itself runs agrees: for a capture
 * problem the target is gone or black can still force the capture; for an escape problem black can
 * no longer force it. Asking `solve` with the player to move is not the same question — it reads
 * the reply one move shallower than the screen does afterwards — so the hint asks this instead.
 */

import type { Problem } from "./problems.ts";
import {
  type Color,
  type Cpu,
  EMPTY,
  type Engine,
  type GraphSpec,
  opponent,
} from "./types.ts";

export interface TsumegoPosition {
  graph: GraphSpec;
  stones: Color[];
  ko: number | null;
}

/** Whether the problem is solved, or still solvable, after the player's move led to `stones`. */
export function onTrack(
  cpu: Cpu,
  problem: Problem,
  { graph, stones, ko }: TsumegoPosition,
): boolean {
  if (stones[problem.target] === EMPTY) return problem.goal === "capture";
  const attackerWins = cpu.solve({
    graph,
    stones,
    ko,
    toMove: opponent(problem.toPlay),
    target: problem.target,
    maxDepth: problem.depth,
  }).attackerWins;
  return attackerWins === (problem.goal === "capture");
}

/** Every legal move for the player that keeps them on track, ascending. */
export function workingMoves(
  engine: Engine,
  cpu: Cpu,
  problem: Problem,
  position: TsumegoPosition,
): number[] {
  const moves: number[] = [];
  for (let v = 0; v < position.graph.nodeCount; v++) {
    if (position.stones[v] !== EMPTY) continue;
    const r = engine.play({ ...position, color: problem.toPlay, node: v });
    if (
      r.legal &&
      onTrack(cpu, problem, {
        graph: position.graph,
        stones: r.stones,
        ko: r.ko,
      })
    ) {
      moves.push(v);
    }
  }
  return moves;
}

/** What the CPU does after the player's move. */
export type Reply =
  /** Plays `move` (`null` passes). */
  | { kind: "move"; move: number | null }
  /** Nothing to play: black can no longer catch the group, so the escape problem is solved. */
  | { kind: "escaped" };

/**
 * The other side's best reply, whatever the player played: white's most stubborn defence (or its
 * escape) in a capture problem, black's best chase in an escape problem.
 */
export function cpuReply(
  cpu: Cpu,
  problem: Problem,
  { graph, stones, ko }: TsumegoPosition,
): Reply {
  const reading = cpu.solve({
    graph,
    stones,
    ko,
    toMove: opponent(problem.toPlay),
    target: problem.target,
    maxDepth: problem.depth,
  });
  if (problem.goal === "escape" && !reading.attackerWins) {
    return { kind: "escaped" };
  }
  return { kind: "move", move: reading.move };
}

/**
 * The move to suggest: one that keeps the player on track and, in a capture problem, takes the
 * group soonest. Any winning move would do for the screen's check, but one that merely keeps the
 * win in hand can be followed forever without the group ever coming off the board.
 */
export function hintMove(
  engine: Engine,
  cpu: Cpu,
  problem: Problem,
  position: TsumegoPosition,
): number | null {
  const moves = workingMoves(engine, cpu, problem, position);
  if (problem.goal === "escape" || moves.length <= 1) return moves[0] ?? null;
  let best: number | null = null;
  let fastest = Infinity;
  for (const v of moves) {
    const r = engine.play({ ...position, color: problem.toPlay, node: v });
    if (r.stones[problem.target] === EMPTY) return v;
    // The shallowest reading in which black still takes the group after this move.
    for (let depth = 1; depth < fastest && depth <= problem.depth; depth++) {
      const wins = cpu.solve({
        graph: position.graph,
        stones: r.stones,
        ko: r.ko,
        toMove: opponent(problem.toPlay),
        target: problem.target,
        maxDepth: depth,
      }).attackerWins;
      if (wins) {
        fastest = depth;
        best = v;
        break;
      }
    }
  }
  return best ?? moves[0];
}
