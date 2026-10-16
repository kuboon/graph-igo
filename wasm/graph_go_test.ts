/**
 * The two wasm modules through the page's own loader: the engine's rules, the regions it cuts
 * out, and an evaluation in which the engine calls the CPU's judge across the import bridge.
 *
 * Needs `deno task build:wasm` first (`deno task test` runs it).
 */

import { assert, assertEquals, assertThrows } from "@std/assert";

import { loadGraphGo } from "../web/client/lib/graph_go/wasm.ts";
import { grid, makeBoard } from "../web/client/lib/graph_go/graphs.ts";
import { BLACK, type Color, WHITE } from "../web/client/lib/graph_go/types.ts";

const dir = new URL("../web/client/static/wasm/", import.meta.url);
const { engine, cpu } = await loadGraphGo(
  await Deno.readFile(new URL("engine.wasm", dir)),
  await Deno.readFile(new URL("cpu.wasm", dir)),
);

const board3 = grid(3).graph;

Deno.test("play captures and reports the new position", () => {
  // . B .
  // B W B
  // . . .
  const stones: Color[] = [0, 1, 0, 1, 2, 1, 0, 0, 0];
  const r = engine.play({ graph: board3, stones, color: BLACK, node: 7 });
  assert(r.legal);
  assertEquals(r.captured, [4]);
  assertEquals(r.stones[4], 0);
  assertEquals(r.stones[7], BLACK);
});

Deno.test("play refuses suicide and leaves the board alone", () => {
  const stones: Color[] = [0, 1, 0, 1, 0, 0, 0, 0, 0];
  const r = engine.play({ graph: board3, stones, color: WHITE, node: 0 });
  assertEquals(r.legal, false);
  assertEquals(r.reason, "suicide");
  assertEquals(r.stones, stones);
});

Deno.test("regions honours minSize and cuts out a subgraph", () => {
  const stones: Color[] = [0, 1, 0, 1, 0, 0, 0, 0, 0];
  const all = engine.regions({ graph: board3, stones, minSize: 1 }).regions;
  assertEquals(all.map((r) => r.nodes), [[0], [2, 4, 5, 6, 7, 8]]);
  const big = engine.regions({ graph: board3, stones, minSize: 2 }).regions;
  assertEquals(big.length, 1);
  assertEquals(big[0].boundary, [1, 3]);
  assertEquals(big[0].subgraph.origin, [2, 4, 5, 6, 7, 8, 1, 3]);
});

Deno.test("evaluate asks the CPU through the engine's import", () => {
  // B B B / . . . / W W W: the middle row is contested, so the judge calls it nobody's.
  const stones: Color[] = [1, 1, 1, 0, 0, 0, 2, 2, 2];
  const e = engine.evaluate({ graph: board3, stones, minSize: 1, komi: 0.5 });
  assertEquals(e.regions.length, 1);
  assertEquals(e.regions[0].judgedBy, "cpu");
  assertEquals(e.regions[0].owner, 0);
  assertEquals(e.black.score, 3);
  assertEquals(e.white.score, 3.5);
  assertEquals(e.winner, WHITE);

  // The same region straight from the CPU agrees.
  const [region] =
    engine.regions({ graph: board3, stones, minSize: 1 }).regions;
  assertEquals(cpu.judge(region.subgraph).owner, 0);
});

Deno.test("evaluate settles regions under minSize in the engine", () => {
  const stones: Color[] = [0, 1, 0, 1, 1, 1, 0, 0, 0];
  const e = engine.evaluate({ graph: board3, stones, minSize: 2, komi: 0 });
  assertEquals(
    e.regions.map((r) => [r.nodes.length, r.judgedBy, r.owner]),
    [[1, "engine", BLACK], [1, "engine", BLACK], [3, "cpu", BLACK]],
  );
  assertEquals(e.black.score, 9);
});

Deno.test("genmove returns a legal move on every preset", () => {
  for (
    const kind of [
      "grid",
      "triangular",
      "honeycomb",
      "rings",
      "random",
    ] as const
  ) {
    const { graph } = makeBoard(kind, kind === "random" ? 30 : 3);
    const stones: Color[] = Array(graph.nodeCount).fill(0);
    const m = cpu.genmove({
      graph,
      stones,
      color: BLACK,
      komi: 0.5,
      playouts: 200,
      seed: 3,
    });
    assert(m.node !== null, kind);
    assert(
      engine.play({ graph, stones, color: BLACK, node: m.node }).legal,
      kind,
    );
  }
});

Deno.test("errors come back as exceptions, not traps", () => {
  assertThrows(() =>
    engine.play({
      graph: { nodeCount: 2, edges: [[0, 5]] },
      stones: [0, 0],
      color: 1,
      node: 0,
    })
  );
  // The instance is still usable afterwards.
  assert(
    engine.play({ graph: board3, stones: Array(9).fill(0), color: 1, node: 4 })
      .legal,
  );
});
