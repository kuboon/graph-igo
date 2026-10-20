/**
 * The rules of a tsumego, shared by the screen, its test and the problem generator.
 *
 * A problem is a capture fight: black wins by taking the group holding `target`, white wins once
 * black can no longer force that within the problem's depth (both sides counted). The position
 * says whose move it is; the player picks the side they think wins, and plays it out against the
 * CPU's reading (`cpu.solve`).
 *
 * Every judgement here is the one the screen makes after a move, so a hint can never disagree
 * with the verdict that follows it.
 */

import type { Problem } from "./problems.ts";
import {
  BLACK,
  type Color,
  type Cpu,
  EMPTY,
  type Engine,
  type GraphSpec,
  opponent,
  type Player,
  WHITE,
} from "./types.ts";

export interface TsumegoPosition {
  graph: GraphSpec;
  stones: Color[];
  ko: number | null;
}

/** The starting position of a problem. */
export function startOf(problem: Problem, graph: GraphSpec): TsumegoPosition {
  const stones: Color[] = Array(graph.nodeCount).fill(EMPTY);
  for (const v of problem.black) stones[v] = BLACK;
  for (const v of problem.white) stones[v] = WHITE;
  return { graph, stones, ko: null };
}

function attackerWins(
  cpu: Cpu,
  problem: Problem,
  { graph, stones, ko }: TsumegoPosition,
  toMove: Player,
): boolean {
  return cpu.solve({
    graph,
    stones,
    ko,
    toMove,
    target: problem.target,
    maxDepth: problem.depth,
  }).attackerWins;
}

/**
 * Who has won, if anyone, with `toMove` to play: black once the group is off the board, white once
 * it is black's move and black can no longer force the capture. `null` while the fight is on.
 */
export function winnerNow(
  cpu: Cpu,
  problem: Problem,
  position: TsumegoPosition,
  toMove: Player,
): Player | null {
  if (position.stones[problem.target] === EMPTY) return BLACK;
  if (toMove === BLACK && !attackerWins(cpu, problem, position, BLACK)) {
    return WHITE;
  }
  return null;
}

/** Who wins from here with best play, `toMove` to play. */
export function winnerWithBestPlay(
  cpu: Cpu,
  problem: Problem,
  position: TsumegoPosition,
  toMove: Player,
): Player {
  if (position.stones[problem.target] === EMPTY) return BLACK;
  return attackerWins(cpu, problem, position, toMove) ? BLACK : WHITE;
}

/** The CPU's move for `color`: the reading's best, whether it is winning or holding out. */
export function cpuMove(
  cpu: Cpu,
  problem: Problem,
  { graph, stones, ko }: TsumegoPosition,
  color: Player,
): number | null {
  return cpu.solve({
    graph,
    stones,
    ko,
    toMove: color,
    target: problem.target,
    maxDepth: problem.depth,
  }).move;
}

/** Every legal move for `color` after which `color` still wins with best play, ascending. */
export function winningMoves(
  engine: Engine,
  cpu: Cpu,
  problem: Problem,
  position: TsumegoPosition,
  color: Player,
): number[] {
  const moves: number[] = [];
  for (let v = 0; v < position.graph.nodeCount; v++) {
    if (position.stones[v] !== EMPTY) continue;
    const r = engine.play({ ...position, color, node: v });
    if (!r.legal) continue;
    const after = { graph: position.graph, stones: r.stones, ko: r.ko };
    if (winnerWithBestPlay(cpu, problem, after, opponent(color)) === color) {
      moves.push(v);
    }
  }
  return moves;
}

/**
 * The move to suggest to `color`, or `null` when it has no winning move. For black it is the one
 * that takes the group soonest: a move that merely keeps the win in hand can be followed forever
 * without the group ever coming off the board.
 */
export function hintMove(
  engine: Engine,
  cpu: Cpu,
  problem: Problem,
  position: TsumegoPosition,
  color: Player,
): number | null {
  const moves = winningMoves(engine, cpu, problem, position, color);
  if (color === WHITE || moves.length <= 1) return moves[0] ?? null;
  let best: number | null = null;
  let fastest = Infinity;
  for (const v of moves) {
    const r = engine.play({ ...position, color, node: v });
    if (r.stones[problem.target] === EMPTY) return v;
    for (let depth = 1; depth < fastest && depth <= problem.depth; depth++) {
      const wins = cpu.solve({
        graph: position.graph,
        stones: r.stones,
        ko: r.ko,
        toMove: WHITE,
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

/**
 * Plays the problem out as the screen would, with the player on `side` against the CPU. The
 * player follows the hints (`"hint"`), or — on the side that cannot win — the CPU's own most
 * stubborn moves (`"cpu"`). Returns the winner, or `null` if neither has won in time.
 */
export function playOut(
  engine: Engine,
  cpu: Cpu,
  problem: Problem,
  graph: GraphSpec,
  side: Player,
  policy: "hint" | "cpu",
): Player | null {
  let position = startOf(problem, graph);
  let toMove = problem.toMove;
  for (let ply = 0; ply < problem.depth * 2 + 2; ply++) {
    const done = winnerNow(cpu, problem, position, toMove);
    if (done) return done;
    const move = toMove === side && policy === "hint"
      ? hintMove(engine, cpu, problem, position, toMove) ??
        cpuMove(cpu, problem, position, toMove)
      : cpuMove(cpu, problem, position, toMove);
    const r = engine.play({ ...position, color: toMove, node: move });
    if (!r.legal) return null;
    position = { graph, stones: r.stones, ko: r.ko };
    toMove = opponent(toMove);
  }
  return winnerNow(cpu, problem, position, toMove);
}
