/**
 * GraphGo — Go on an arbitrary graph, played in the browser against the two wasm modules.
 *
 * Every rule decision is the engine's: a click asks `engine.play` what the move does and the board
 * becomes whatever it answers. The CPU plays a side when asked to (`cpu.genmove`), and the count
 * at the end is `engine.evaluate`, which cuts the empty regions of at least `minSize` nodes out as
 * subgraphs and has the CPU module's `judge` decide whose each one is (see `lib/graph_go/`).
 *
 * The board is an SVG drawn from the graph's own node positions, so the same component draws a
 * square lattice, a honeycomb, or a random planar graph. The server renders the empty board; the
 * modules load in the browser.
 */

import { clientEntry, css, type Handle, on } from "@remix-run/component";

import { base } from "../base.ts";
import { actionStyle, alertStyle, primaryStyle } from "../theme.ts";
import { color as token, radius } from "../tokens.ts";
import {
  BOARD_KINDS,
  type BoardKind,
  type BoardShape,
  makeBoard,
} from "../lib/graph_go/graphs.ts";
import {
  BLACK,
  type Color,
  EMPTY,
  type Evaluation,
  type IllegalReason,
  opponent,
  type Player,
  WHITE,
} from "../lib/graph_go/types.ts";
import { type GraphGo as Modules, loadGraphGo } from "../lib/graph_go/wasm.ts";

type Seat = "human" | "cpu";

/** What undo goes back to. */
interface Snapshot {
  stones: Color[];
  ko: number | null;
  toMove: Player;
  passes: number;
  captures: [number, number];
  lastMove: number | null;
}

const NAME: Record<Player, string> = { 1: "黒", 2: "白" };

const REASON: Record<IllegalReason, string> = {
  occupied: "そこには既に石があります。",
  ko: "コウです。すぐには取り返せません。",
  suicide: "自殺手になるので打てません。",
  outOfRange: "盤の外です。",
  invalidColor: "手番の色が不正です。",
};

/** The SVG's user units: the board fits 0..VIEW with a margin for the outer stones. */
const VIEW = 100;
const PAD = 6;

export const GraphGo = clientEntry(
  import.meta.url,
  function GraphGo(handle: Handle) {
    let modules: Modules | null = null;
    let loadError: string | null = null;

    let kind: BoardKind = "grid";
    let size = 9;
    let seed = 1;
    let shape: BoardShape = makeBoard(kind, size, seed);

    const seats: Record<Player, Seat> = { 1: "human", 2: "cpu" };
    let komi = 7.5;
    let minSize = 1;
    let playouts = 2000;

    let stones: Color[] = [];
    let ko: number | null = null;
    let toMove: Player = BLACK;
    let passes = 0;
    let captures: [number, number] = [0, 0];
    let lastMove: number | null = null;
    let atari: number[] = [];
    let history: Snapshot[] = [];
    let message = "黒番です。";
    let evaluation: Evaluation | null = null;
    let gameOver = false;
    let thinking = false;
    /** Bumped by every new game and undo, so a CPU move still in its timeout knows to drop. */
    let generation = 0;

    function reset(): void {
      shape = makeBoard(kind, size, seed);
      stones = Array(shape.graph.nodeCount).fill(EMPTY);
      ko = null;
      toMove = BLACK;
      passes = 0;
      captures = [0, 0];
      lastMove = null;
      atari = [];
      history = [];
      evaluation = null;
      gameOver = false;
      thinking = false;
      generation++;
      message =
        `新しい対局: ${shape.graph.nodeCount} 点、${shape.graph.edges.length} 辺。黒番です。`;
    }
    reset();

    function snapshot(): Snapshot {
      return {
        stones,
        ko,
        toMove,
        passes,
        captures: [...captures],
        lastMove,
      };
    }

    /** Asks the engine about the move, and takes the board it answers with if it is legal. */
    function apply(node: number | null): boolean {
      if (!modules) return false;
      const color = toMove;
      const result = modules.engine.play({
        graph: shape.graph,
        stones,
        ko,
        color,
        node,
      });
      if (!result.legal) {
        message = REASON[result.reason ?? "occupied"];
        return false;
      }
      history.push(snapshot());
      stones = result.stones;
      ko = result.ko;
      captures[color - 1] += result.captured.length;
      lastMove = node;
      atari = result.atari;
      passes = node === null ? passes + 1 : 0;
      toMove = opponent(color);
      evaluation = null;

      const parts = [
        node === null
          ? `${NAME[color]}はパス。`
          : `${NAME[color]}が打ちました。`,
      ];
      if (result.captured.length) {
        parts.push(`${result.captured.length} 子を取りました。`);
      }
      if (result.atari.length) parts.push("アタリ!");
      if (result.ko !== null) parts.push("コウが発生。");
      if (passes >= 2) {
        gameOver = true;
        parts.push("両者パスで終局。");
        judge();
      } else parts.push(`${NAME[toMove]}番です。`);
      message = parts.join(" ");
      return true;
    }

    function judge(): void {
      if (!modules) return;
      evaluation = modules.engine.evaluate({
        graph: shape.graph,
        stones,
        minSize,
        komi,
      });
    }

    /** Lets the CPU move if it is its turn; after a beat, so the board paints first. */
    function maybeCpu(): void {
      if (!modules || gameOver || seats[toMove] !== "cpu") return;
      thinking = true;
      const mine = generation;
      void handle.update();
      setTimeout(() => {
        if (mine !== generation || !modules) return;
        const move = modules.cpu.genmove({
          graph: shape.graph,
          stones,
          ko,
          color: toMove,
          komi,
          playouts,
          seed: Math.floor(Math.random() * 0xffff_ffff),
          opponentPassed: passes === 1,
        });
        thinking = false;
        apply(move.node);
        void handle.update();
        maybeCpu();
      }, 60);
    }

    function humanMove(node: number | null): void {
      if (!modules || thinking || gameOver || seats[toMove] !== "human") return;
      apply(node);
      void handle.update();
      maybeCpu();
    }

    function undo(): void {
      if (thinking && seats[toMove] === "cpu") generation++;
      // Back to the last position a person was to move in.
      while (history.length) {
        const last = history.pop()!;
        ({ stones, ko, toMove, passes, lastMove } = last);
        captures = last.captures;
        if (seats[toMove] === "human") break;
      }
      thinking = false;
      gameOver = false;
      evaluation = null;
      atari = [];
      generation++;
      message = `待った。${NAME[toMove]}番です。`;
      void handle.update();
    }

    function newGame(): void {
      reset();
      void handle.update();
      maybeCpu();
    }

    handle.queueTask(async () => {
      try {
        modules = await loadGraphGo(
          `${base}/static/wasm/engine.wasm`,
          `${base}/static/wasm/cpu.wasm`,
        );
      } catch (e) {
        loadError = e instanceof Error ? e.message : String(e);
      }
      void handle.update();
      maybeCpu();
    });

    const numberFrom = (event: Event, fallback: number): number => {
      const value = Number((event.currentTarget as HTMLInputElement).value);
      return Number.isFinite(value) ? value : fallback;
    };

    return () => {
      const { points, graph } = shape;
      const span = VIEW - 2 * PAD;
      const px = (i: number) => PAD + points[i].x * span;
      const py = (i: number) => PAD + points[i].y * span;
      const stoneR = stoneRadius(shape) * span;
      const owner = new Map<number, Color>();
      for (const region of evaluation?.regions ?? []) {
        for (const v of region.nodes) owner.set(v, region.owner);
      }
      const ready = modules !== null;
      const humanTurn = ready && !thinking && !gameOver &&
        seats[toMove] === "human";

      return (
        <div mix={layoutStyle}>
          <svg
            viewBox={`0 0 ${VIEW} ${VIEW}`}
            mix={boardStyle}
            role="img"
            aria-label={`${graph.nodeCount} 点のグラフ盤`}
          >
            {graph.edges.map(([a, b]) => (
              <line
                key={`e${a}-${b}`}
                x1={px(a)}
                y1={py(a)}
                x2={px(b)}
                y2={py(b)}
                mix={edgeStyle}
              />
            ))}
            {stones.map((c, v) => {
              const x = px(v);
              const y = py(v);
              const territory = c === EMPTY ? owner.get(v) : undefined;
              return (
                <g key={`n${v}`}>
                  {c === EMPTY
                    ? (
                      <circle
                        cx={x}
                        cy={y}
                        r={stoneR * 0.18}
                        mix={pointStyle}
                      />
                    )
                    : (
                      <circle
                        cx={x}
                        cy={y}
                        r={stoneR}
                        mix={[
                          c === BLACK ? blackStyle : whiteStyle,
                          atari.includes(v) ? atariStyle : null,
                        ]}
                      />
                    )}
                  {territory === BLACK || territory === WHITE
                    ? (
                      <rect
                        x={x - stoneR * 0.3}
                        y={y - stoneR * 0.3}
                        width={stoneR * 0.6}
                        height={stoneR * 0.6}
                        mix={[
                          territory === BLACK ? blackStyle : whiteStyle,
                          territoryStyle,
                        ]}
                      />
                    )
                    : null}
                  {lastMove === v
                    ? <circle cx={x} cy={y} r={stoneR * 0.35} mix={lastStyle} />
                    : null}
                  <circle
                    cx={x}
                    cy={y}
                    r={stoneR * 1.05}
                    mix={[
                      hitStyle,
                      humanTurn && c === EMPTY ? playableStyle : null,
                      on("click", () => humanMove(v)),
                    ]}
                  />
                </g>
              );
            })}
          </svg>

          <div mix={panelStyle}>
            <p
              mix={alertStyle}
              data-kind={loadError ? "error" : "info"}
              aria-live="polite"
            >
              {loadError
                ? `wasm の読み込みに失敗しました: ${loadError}`
                : !ready
                ? "wasm を読み込み中…"
                : thinking
                ? `CPU (${NAME[toMove]}) が考え中…`
                : message}
            </p>

            <dl mix={statsStyle}>
              <div>
                <dt>手番</dt>
                <dd>{gameOver ? "終局" : NAME[toMove]}</dd>
              </div>
              <div>
                <dt>アゲハマ 黒 / 白</dt>
                <dd>{captures[0]} / {captures[1]}</dd>
              </div>
              <div>
                <dt>手数</dt>
                <dd>{history.length}</dd>
              </div>
            </dl>

            <div mix={rowStyle}>
              <button
                type="button"
                disabled={!humanTurn}
                mix={[actionStyle, on("click", () => humanMove(null))]}
              >
                パス
              </button>
              <button
                type="button"
                disabled={!ready || history.length === 0 ||
                  (seats[BLACK] === "cpu" && seats[WHITE] === "cpu")}
                mix={[actionStyle, on("click", undo)]}
              >
                待った
              </button>
              <button
                type="button"
                disabled={!ready || thinking}
                mix={[
                  actionStyle,
                  on("click", () => {
                    judge();
                    void handle.update();
                  }),
                ]}
              >
                地を判定
              </button>
            </div>

            {evaluation
              ? (
                <section mix={resultStyle}>
                  <h3>
                    {evaluation.winner === EMPTY
                      ? "持碁"
                      : `${NAME[evaluation.winner as Player]}の ${
                        Math.abs(
                          evaluation.black.score - evaluation.white.score,
                        )
                      } 目勝ち`}
                    {gameOver ? "" : " (途中判定)"}
                  </h3>
                  <table>
                    <thead>
                      <tr>
                        <th></th>
                        <th>石</th>
                        <th>地</th>
                        <th>計</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th>黒</th>
                        <td>{evaluation.black.stones}</td>
                        <td>{evaluation.black.territory}</td>
                        <td>{evaluation.black.score}</td>
                      </tr>
                      <tr>
                        <th>白</th>
                        <td>{evaluation.white.stones}</td>
                        <td>{evaluation.white.territory}</td>
                        <td>
                          {evaluation.white.score} (コミ {evaluation.komi})
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p mix={mutedStyle}>
                    空き領域 {evaluation.regions.length} 個: CPU 判定{" "}
                    {evaluation.regions.filter((r) => r.judgedBy === "cpu")
                      .length}、 エンジン判定{" "}
                    {evaluation.regions.filter((r) => r.judgedBy === "engine")
                      .length}
                    、どちらの地でもない{" "}
                    {evaluation.regions.filter((r) => r.owner === EMPTY).length}
                  </p>
                </section>
              )
              : null}

            <fieldset mix={fieldsetStyle}>
              <legend>新しい対局</legend>
              <label mix={fieldStyle}>
                <span>盤</span>
                <select
                  mix={[
                    inputStyle,
                    on("change", (event) => {
                      kind = (event.currentTarget as HTMLSelectElement)
                        .value as BoardKind;
                      size = BOARD_KINDS.find((k) => k.kind === kind)?.size ??
                        size;
                      void handle.update();
                    }),
                  ]}
                >
                  {BOARD_KINDS.map((k) => (
                    <option
                      key={k.kind}
                      value={k.kind}
                      selected={k.kind === kind}
                    >
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label mix={fieldStyle}>
                <span>
                  {kind === "random"
                    ? "点の数"
                    : kind === "rings"
                    ? "輪の数"
                    : "大きさ"}
                </span>
                <input
                  key={`size-${kind}`}
                  type="number"
                  min="1"
                  defaultValue={String(size)}
                  mix={[
                    inputStyle,
                    on("change", (e) => void (size = numberFrom(e, size))),
                  ]}
                />
              </label>
              {kind === "random"
                ? (
                  <label mix={fieldStyle}>
                    <span>シード</span>
                    <input
                      type="number"
                      defaultValue={String(seed)}
                      mix={[
                        inputStyle,
                        on("change", (e) => void (seed = numberFrom(e, seed))),
                      ]}
                    />
                  </label>
                )
                : null}
              {([BLACK, WHITE] as const).map((p) => (
                <label key={`seat${p}`} mix={fieldStyle}>
                  <span>{NAME[p]}</span>
                  <select
                    mix={[
                      inputStyle,
                      on("change", (event) => {
                        seats[p] = (event.currentTarget as HTMLSelectElement)
                          .value as Seat;
                      }),
                    ]}
                  >
                    <option value="human" selected={seats[p] === "human"}>
                      人
                    </option>
                    <option value="cpu" selected={seats[p] === "cpu"}>
                      CPU
                    </option>
                  </select>
                </label>
              ))}
              <button
                type="button"
                disabled={!ready}
                mix={[actionStyle, primaryStyle, on("click", newGame)]}
              >
                対局開始
              </button>
            </fieldset>

            <fieldset mix={fieldsetStyle}>
              <legend>設定 (すぐ反映)</legend>
              <label mix={fieldStyle}>
                <span>コミ</span>
                <input
                  type="number"
                  step="0.5"
                  defaultValue={String(komi)}
                  mix={[
                    inputStyle,
                    on("change", (e) => void (komi = numberFrom(e, komi))),
                  ]}
                />
              </label>
              <label mix={fieldStyle}>
                <span>CPU に判定させる領域の最小サイズ n</span>
                <input
                  type="number"
                  min="1"
                  defaultValue={String(minSize)}
                  mix={[
                    inputStyle,
                    on(
                      "change",
                      (e) =>
                        void (minSize = Math.max(1, numberFrom(e, minSize))),
                    ),
                  ]}
                />
              </label>
              <label mix={fieldStyle}>
                <span>CPU の強さ (プレイアウト数)</span>
                <input
                  type="number"
                  min="10"
                  step="100"
                  defaultValue={String(playouts)}
                  mix={[
                    inputStyle,
                    on(
                      "change",
                      (e) =>
                        void (playouts = Math.max(10, numberFrom(e, playouts))),
                    ),
                  ]}
                />
              </label>
            </fieldset>
          </div>
        </div>
      );
    };
  },
);

/** A stone's radius, as a fraction of the board: just under half the shortest edge. */
function stoneRadius({ graph, points }: BoardShape): number {
  let shortest = Infinity;
  for (const [a, b] of graph.edges) {
    const d = Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
    if (d > 0) shortest = Math.min(shortest, d);
  }
  return Math.min(Number.isFinite(shortest) ? shortest * 0.46 : 0.05, 0.06);
}

// --- styles -----------------------------------------------------------------

const layoutStyle = css({
  display: "grid",
  gap: "1.25rem",
  gridTemplateColumns: "minmax(0, 1fr)",
  "@media (min-width: 56rem)": {
    gridTemplateColumns: "minmax(0, 3fr) minmax(16rem, 2fr)",
    alignItems: "start",
  },
});

const boardStyle = css({
  width: "100%",
  height: "auto",
  aspectRatio: "1",
  background: "#dcb35c",
  borderRadius: radius.lg,
  boxShadow: "0 1px 3px rgb(0 0 0 / 0.25)",
  touchAction: "manipulation",
  userSelect: "none",
});

const edgeStyle = css({ stroke: "#3b2a12", strokeWidth: 0.25 });
const pointStyle = css({ fill: "#3b2a12" });
const blackStyle = css({ fill: "#111", stroke: "#000", strokeWidth: 0.2 });
const whiteStyle = css({ fill: "#f8f8f8", stroke: "#444", strokeWidth: 0.2 });
const atariStyle = css({ stroke: "#dc2626", strokeWidth: 0.6 });
const lastStyle = css({ fill: "#dc2626" });
const territoryStyle = css({ opacity: 0.8 });
const hitStyle = css({ fill: "transparent", stroke: "none" });
const playableStyle = css({
  cursor: "pointer",
  "&:hover": { fill: "rgb(0 0 0 / 0.18)" },
});

const panelStyle = css({ display: "grid", gap: "0.75rem" });

const statsStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.25rem 1.5rem",
  margin: 0,
  "& > div": { display: "flex", gap: "0.5rem" },
  "& dt": { color: token.muted },
  "& dd": { margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
});

const rowStyle = css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" });

const resultStyle = css({
  padding: "0.75rem 1rem",
  border: `1px solid ${token.border}`,
  borderRadius: radius.md,
  background: token.card,
  "& h3": { margin: "0 0 0.5rem" },
  "& table": { borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" },
  "& th, & td": { padding: "0.2rem 0.6rem", textAlign: "left" },
});

const mutedStyle = css({
  color: token.muted,
  fontSize: "0.85rem",
  marginBottom: 0,
});

const fieldsetStyle = css({
  display: "grid",
  gap: "0.5rem",
  margin: 0,
  padding: "0.75rem 1rem",
  border: `1px solid ${token.border}`,
  borderRadius: radius.md,
  "& legend": { padding: "0 0.3rem", fontWeight: 600 },
});

const fieldStyle = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  fontSize: "0.9rem",
});

const inputStyle = css({
  font: "inherit",
  width: "11rem",
  maxWidth: "55%",
  padding: "0.3rem 0.5rem",
  border: `1px solid ${token.border}`,
  borderRadius: radius.md,
  background: token.bg,
  color: token.fg,
});
