/**
 * GraphGo — Go on an arbitrary graph, played in the browser against the two wasm modules.
 *
 * Every rule decision is the engine's: a click asks `engine.play` what the move does and the board
 * becomes whatever it answers. The CPU plays a side when asked to (`cpu.genmove`), and the count
 * at the end is `engine.evaluate`, which cuts the empty regions of at least `minSize` nodes out as
 * subgraphs and has the CPU module's `judge` decide whose each one is (see `lib/graph_go/`).
 *
 * The board is drawn by `lib/graph_go/board_view.tsx`. The server renders the empty board; the
 * modules load in the browser.
 */

import { clientEntry, css, type Handle, on } from "@remix-run/component";

import { base } from "../base.ts";
import { actionStyle, alertStyle, primaryStyle } from "../theme.ts";
import { color as token, radius } from "../tokens.ts";
import { boardView } from "../lib/graph_go/board_view.tsx";
import { gameFrame } from "../lib/graph_go/game_frame.tsx";
import { onFullscreenChange } from "../lib/fullscreen.ts";
import { gameCenter, onPendingChange, unlock } from "../game_center.ts";
import { claimLinkView } from "../lib/game_center_link.tsx";
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

    // For the achievements: who actually played each colour this game, how strong the CPU was at
    // its weakest, and the board the game started on (the settings can change mid-game).
    let gameKind: BoardKind = kind;
    let movedBy: Record<Player, Set<Seat>> = { 1: new Set(), 2: new Set() };
    let weakestCpu = Infinity;

    function reset(): void {
      shape = makeBoard(kind, size, seed);
      gameKind = kind;
      movedBy = { 1: new Set(), 2: new Set() };
      weakestCpu = Infinity;
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
        awardWin();
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

    /** A person beat the CPU: the winner's colour was only ever played by hand, the loser's only by the CPU. */
    function awardWin(): void {
      const winner = evaluation?.winner;
      if (winner !== BLACK && winner !== WHITE) return;
      const loser = opponent(winner);
      const byHand = (p: Player) =>
        movedBy[p].has("human") && !movedBy[p].has("cpu");
      const byCpu = (p: Player) =>
        movedBy[p].has("cpu") && !movedBy[p].has("human");
      if (!byHand(winner) || !byCpu(loser)) return;
      void unlock("win_cpu");
      if (gameKind !== "grid") void unlock("win_cpu_exotic");
      if (weakestCpu >= 5000) void unlock("win_cpu_strong");
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
        movedBy[toMove].add("cpu");
        weakestCpu = Math.min(weakestCpu, playouts);
        apply(move.node);
        void handle.update();
        maybeCpu();
      }, 60);
    }

    function humanMove(node: number | null): void {
      if (!modules || thinking || gameOver || seats[toMove] !== "human") return;
      const color = toMove;
      if (apply(node)) movedBy[color].add("human");
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
      onFullscreenChange(() => void handle.update(), handle.signal);
      handle.signal.addEventListener(
        "abort",
        onPendingChange(() => void handle.update()),
      );
      gameCenter();
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
      const owner = new Map<number, Color>();
      for (const region of evaluation?.regions ?? []) {
        for (const v of region.nodes) owner.set(v, region.owner);
      }
      const ready = modules !== null;
      const humanTurn = ready && !thinking && !gameOver &&
        seats[toMove] === "human";

      return gameFrame({
        title: "対局",
        onFullscreenToggled: () => void handle.update(),
        board: boardView({
          shape,
          stones,
          onPlay: humanMove,
          playable: humanTurn,
          ghost: toMove,
          lastMove,
          atari,
          territory: owner,
        }),
        panel: (
          <div mix={panelStyle}>
            {claimLinkView()}
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

            <p mix={mutedStyle}>
              点をクリックすると着手、両者パスで終局して CPU が地を数えます。
            </p>

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
        ),
      });
    };
  },
);

// --- styles -----------------------------------------------------------------

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
