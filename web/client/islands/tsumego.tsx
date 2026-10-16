/**
 * Tsumego — capture-or-escape problems on graph boards, answered by the CPU's reading.
 *
 * The player moves; the engine says what the move does; the CPU module's `solve` reads the fight
 * out from there and plays the other side's best reply. A capture problem is solved when the
 * target group comes off the board; an escape problem is solved the moment the reading says black
 * can no longer catch it within the problem's depth. A wrong move is never called wrong: the CPU
 * just answers it, and the player keeps going — or starts over. The only end other than solving
 * is an escape problem's group being captured. The problems are in `lib/graph_go/problems.ts`.
 *
 * Once a problem is over, "続きを検証" turns the board into a study board: the player moves for
 * both sides in turn, "CPU が打つ" plays the reading's best move for the side to move, "待った"
 * steps back, and after every move the panel says what the reading thinks of the position and
 * marks the move it would play — which is how to see *why* an answer worked.
 */

import { clientEntry, css, type Handle, on } from "@remix-run/component";

import { base } from "../base.ts";
import { actionStyle, alertStyle, primaryStyle } from "../theme.ts";
import { color as token, radius } from "../tokens.ts";
import { boardView } from "../lib/graph_go/board_view.tsx";
import { gameFrame } from "../lib/graph_go/game_frame.tsx";
import { onFullscreenChange } from "../lib/fullscreen.ts";
import { type BoardShape, makeBoard } from "../lib/graph_go/graphs.ts";
import { type Problem, PROBLEMS } from "../lib/graph_go/problems.ts";
import { cpuReply, hintMove } from "../lib/graph_go/tsumego.ts";
import {
  BLACK,
  type Color,
  EMPTY,
  type IllegalReason,
  opponent,
  type Player,
  WHITE,
} from "../lib/graph_go/types.ts";
import { type GraphGo as Modules, loadGraphGo } from "../lib/graph_go/wasm.ts";

/** `over`: the group of an escape problem was captured, so there is nothing left to save. */
type Status = "playing" | "solved" | "over";

const NAME: Record<Player, string> = { 1: "黒", 2: "白" };

const REASON: Record<IllegalReason, string> = {
  occupied: "そこには既に石があります。",
  ko: "コウです。すぐには取り返せません。",
  suicide: "自殺手になるので打てません。",
  outOfRange: "盤の外です。",
  invalidColor: "手番の色が不正です。",
};

/** How long the CPU's reply waits, so the player sees their own move land first. */
const REPLY_DELAY = 350;

export const Tsumego = clientEntry(
  import.meta.url,
  function Tsumego(handle: Handle) {
    let modules: Modules | null = null;
    let loadError: string | null = null;

    let index = 0;
    let problem: Problem = PROBLEMS[0];
    let shape: BoardShape = makeBoard("grid", 2);
    let stones: Color[] = [];
    let ko: number | null = null;
    let lastMove: number | null = null;
    let moves = 0;
    let status: Status = "playing";
    let thinking = false;
    let hint: number | null = null;
    let message = "";
    /** Bumped on every reset, so a reply still in its timeout knows to drop. */
    let generation = 0;

    /** The study board after a problem is over: both sides by hand, with the reading alongside. */
    let verifying = false;
    let toMove: Player = BLACK;
    /** Every move since the problem started, the problem's own moves included, for "待った". */
    let history: {
      stones: Color[];
      ko: number | null;
      lastMove: number | null;
      toMove: Player;
    }[] = [];

    function goal(p: Problem): string {
      return p.goal === "capture"
        ? "黒先。青で囲んだ白を取ってください。"
        : "白先。青で囲んだ白を逃がしてください。";
    }

    function load(i: number): void {
      index = (i + PROBLEMS.length) % PROBLEMS.length;
      problem = PROBLEMS[index];
      const { kind, size, seed } = problem.board;
      shape = makeBoard(kind, size, seed);
      stones = Array(shape.graph.nodeCount).fill(EMPTY);
      for (const v of problem.black) stones[v] = BLACK;
      for (const v of problem.white) stones[v] = WHITE;
      ko = null;
      lastMove = null;
      moves = 0;
      status = "playing";
      thinking = false;
      hint = null;
      message = goal(problem);
      generation++;
      verifying = false;
      history = [];
    }
    load(0);

    const player = (): Player => problem.toPlay;

    /** The group the problem is about, for the board to ring. */
    function targetGroup(): number[] {
      if (stones[problem.target] === EMPTY) return [];
      const color = stones[problem.target];
      const group = [problem.target];
      const seen = new Set(group);
      const adjacency = neighbours(shape);
      for (let i = 0; i < group.length; i++) {
        for (const u of adjacency[group[i]]) {
          if (!seen.has(u) && stones[u] === color) {
            seen.add(u);
            group.push(u);
          }
        }
      }
      return group;
    }

    function play(color: Player, node: number | null): boolean {
      const result = modules!.engine.play({
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
      history.push({ stones, ko, lastMove, toMove: color });
      stones = result.stones;
      ko = result.ko;
      lastMove = node;
      moves++;
      return true;
    }

    const captured = () => stones[problem.target] === EMPTY;

    function onPlay(node: number): void {
      if (verifying) return verifyMove(node);
      if (!modules || thinking || status !== "playing") return;
      if (!play(player(), node)) {
        void handle.update();
        return;
      }
      hint = null;
      if (problem.goal === "capture" && captured()) {
        status = "solved";
        message = "正解! 取れました。";
        void handle.update();
        return;
      }
      thinking = true;
      message = "CPU が読んでいます…";
      void handle.update();

      const mine = generation;
      setTimeout(() => {
        if (mine !== generation || !modules) return;
        reply();
        thinking = false;
        void handle.update();
      }, REPLY_DELAY);
    }

    /** The CPU's side of the fight, after the player's move: its best reply, whatever it is. */
    function reply(): void {
      const cpu = opponent(player());
      const answer = cpuReply(modules!.cpu, problem, {
        graph: shape.graph,
        stones,
        ko,
      });
      if (answer.kind === "escaped") {
        status = "solved";
        message = "正解! 逃げ切りました。";
        return;
      }
      play(cpu, answer.move);
      if (problem.goal === "capture") {
        message = answer.move === null
          ? "白はパスしました。続けてください。"
          : "白が応じました。続けてください。";
      } else if (captured()) {
        status = "over";
        message = "白が取られました。「やり直す」で最初から試せます。";
      } else message = "黒が追ってきます。続けてください。";
    }

    function showHint(): void {
      if (!modules || thinking || status !== "playing") return;
      // Checked the way the screen checks a move, so the hint never disagrees with it.
      hint = hintMove(modules.engine, modules.cpu, problem, {
        graph: shape.graph,
        stones,
        ko,
      });
      message = hint === null
        ? "この局面からは、読みで確実な手が見つかりません。続けるか、やり直してください。"
        : "青い印のところが読みの答えです。";
      void handle.update();
    }

    // --- the study board ---------------------------------------------------------------

    function startVerifying(): void {
      verifying = true;
      // Whoever did not make the last move: black after white escaped, white after a capture.
      toMove = problem.goal === "escape" && status === "solved" ? BLACK : WHITE;
      explain();
      void handle.update();
    }

    /** Says what the reading thinks of the position, and marks the move it would play. */
    function explain(): void {
      if (!modules) return;
      if (captured()) {
        hint = null;
        message = `白は取られています。${
          NAME[toMove]
        }番。「待った」で戻れます。`;
        return;
      }
      const reading = modules.cpu.solve({
        graph: shape.graph,
        stones,
        ko,
        toMove,
        target: problem.target,
        maxDepth: problem.depth,
      });
      hint = reading.move;
      const verdict = reading.attackerWins
        ? `黒は ${problem.depth} 手以内に取れます`
        : `黒は ${problem.depth} 手以内には取れません`;
      const best = reading.move === null ? "最善はパス" : "青い印が最善手";
      message = `${NAME[toMove]}番。読みでは、${verdict} (${best})。`;
    }

    function verifyMove(node: number | null): void {
      if (!modules) return;
      if (!play(toMove, node)) {
        void handle.update();
        return;
      }
      toMove = opponent(toMove);
      explain();
      void handle.update();
    }

    function cpuMove(): void {
      if (!modules || captured()) return;
      explain();
      verifyMove(hint);
    }

    function undo(): void {
      const last = history.pop();
      if (!last) return;
      ({ stones, ko, lastMove, toMove } = last);
      moves--;
      explain();
      void handle.update();
    }

    function goTo(i: number): void {
      load(i);
      void handle.update();
    }

    handle.queueTask(async () => {
      onFullscreenChange(() => void handle.update(), handle.signal);
      try {
        modules = await loadGraphGo(
          `${base}/static/wasm/engine.wasm`,
          `${base}/static/wasm/cpu.wasm`,
        );
      } catch (e) {
        loadError = e instanceof Error ? e.message : String(e);
      }
      void handle.update();
    });

    return () => {
      const ready = modules !== null;
      const playable = ready &&
        (verifying || (!thinking && status === "playing"));
      const kind = loadError
        ? "error"
        : status === "solved" && !verifying
        ? "success"
        : "info";

      return gameFrame({
        title: "詰碁",
        onFullscreenToggled: () => void handle.update(),
        board: boardView({
          shape,
          stones,
          onPlay,
          playable,
          lastMove,
          marked: targetGroup(),
          hint,
        }),
        panel: (
          <div mix={panelStyle}>
            <div mix={rowStyle}>
              <button
                type="button"
                aria-label="前の問題"
                mix={[actionStyle, on("click", () => goTo(index - 1))]}
              >
                ←
              </button>
              <select
                aria-label="問題"
                mix={[
                  selectStyle,
                  on("change", (event) => {
                    goTo(
                      Number((event.currentTarget as HTMLSelectElement).value),
                    );
                  }),
                ]}
              >
                {PROBLEMS.map((p, i) => (
                  <option key={p.id} value={String(i)} selected={i === index}>
                    {i + 1}. {p.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="次の問題"
                mix={[actionStyle, on("click", () => goTo(index + 1))]}
              >
                →
              </button>
            </div>

            <h2 mix={titleStyle}>{problem.title}</h2>
            <p mix={alertStyle} data-kind={kind} aria-live="polite">
              {loadError
                ? `wasm の読み込みに失敗しました: ${loadError}`
                : !ready
                ? "wasm を読み込み中…"
                : message}
            </p>

            <dl mix={statsStyle}>
              {verifying
                ? (
                  <div>
                    <dt>手番</dt>
                    <dd>{NAME[toMove]}</dd>
                  </div>
                )
                : (
                  <div>
                    <dt>あなた</dt>
                    <dd>{NAME[player()]}</dd>
                  </div>
                )}
              <div>
                <dt>手数</dt>
                <dd>{moves}</dd>
              </div>
              <div>
                <dt>読みの深さ</dt>
                <dd>{problem.depth} 手</dd>
              </div>
            </dl>

            <div mix={rowStyle}>
              <button
                type="button"
                disabled={!ready}
                mix={[actionStyle, on("click", () => goTo(index))]}
              >
                やり直す
              </button>
              {verifying
                ? (
                  <>
                    <button
                      type="button"
                      disabled={captured()}
                      mix={[actionStyle, primaryStyle, on("click", cpuMove)]}
                    >
                      CPU が打つ
                    </button>
                    <button
                      type="button"
                      mix={[actionStyle, on("click", () => verifyMove(null))]}
                    >
                      パス
                    </button>
                    <button
                      type="button"
                      disabled={history.length === 0}
                      mix={[actionStyle, on("click", undo)]}
                    >
                      待った
                    </button>
                  </>
                )
                : (
                  <button
                    type="button"
                    disabled={!playable}
                    mix={[actionStyle, on("click", showHint)]}
                  >
                    ヒント
                  </button>
                )}
              {status !== "playing" && !verifying
                ? (
                  <button
                    type="button"
                    mix={[actionStyle, on("click", startVerifying)]}
                  >
                    続きを検証
                  </button>
                )
                : null}
              {status === "solved"
                ? (
                  <button
                    type="button"
                    mix={[
                      actionStyle,
                      verifying ? null : primaryStyle,
                      on("click", () => goTo(index + 1)),
                    ]}
                  >
                    次の問題へ
                  </button>
                )
                : null}
            </div>

            <p mix={mutedStyle}>
              青で囲んだ白を、黒なら取る、白なら逃がす問題です。打つと CPU
              が読んで最善の応手を返します。間違えても続けられます。
            </p>
            {verifying
              ? (
                <p mix={mutedStyle}>
                  検証中: 黒白どちらの手も打てます。「CPU
                  が打つ」で手番側の読みの最善手を打ち、
                  「待った」で戻ります。「やり直す」で問題の最初に戻ります。
                </p>
              )
              : null}
            <p mix={mutedStyle}>
              「逃げ切り」は、黒がもう {problem.depth}{" "}
              手以内には取れないと CPU が読み切った状態です。
            </p>
          </div>
        ),
      });
    };
  },
);

/** Each node's neighbours, for following the target's group. */
function neighbours({ graph }: BoardShape): number[][] {
  const adjacency: number[][] = Array.from(
    { length: graph.nodeCount },
    () => [],
  );
  for (const [a, b] of graph.edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return adjacency;
}

// --- styles -----------------------------------------------------------------

const panelStyle = css({ display: "grid", gap: "0.75rem" });

const rowStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "0.5rem",
});

const titleStyle = css({ margin: 0, fontSize: "1.2rem" });

const statsStyle = css({
  display: "flex",
  flexWrap: "wrap",
  gap: "0.25rem 1.5rem",
  margin: 0,
  "& > div": { display: "flex", gap: "0.5rem" },
  "& dt": { color: token.muted },
  "& dd": { margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
});

const mutedStyle = css({ color: token.muted, fontSize: "0.85rem", margin: 0 });

const selectStyle = css({
  font: "inherit",
  flex: "1 1 10rem",
  minWidth: 0,
  padding: "0.35rem 0.5rem",
  border: `1px solid ${token.border}`,
  borderRadius: radius.md,
  background: token.bg,
  color: token.fg,
});
