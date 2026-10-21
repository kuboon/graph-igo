/**
 * Tsumego — capture fights on odd boards, where the player first has to guess who wins.
 *
 * Each problem is a position with a group (ringed in blue) and a side to move. Black wins by
 * taking the group, white by keeping it alive for good — "for good" meaning the CPU's reading
 * says black can no longer catch it within the problem's depth. The player picks the side they
 * think wins and plays it out against the CPU, which answers every move with the reading's best
 * (`cpu.solve`). Picking the losing side is not called wrong either: the CPU simply wins, and the
 * player can try the other side. The problems are in `lib/graph_go/problems.ts`, the rules in
 * `lib/graph_go/tsumego.ts`.
 *
 * Once a problem is over, "続きを検証" turns the board into a study board: the player moves for
 * both sides in turn, "CPU が打つ" plays the reading's best move for the side to move, "待った"
 * steps back, and after every move the panel says what the reading thinks of the position and
 * marks the move it would play — which is how to see *why* the fight went the way it did.
 */

import { clientEntry, css, type Handle, on } from "@remix-run/component";

import { base } from "../base.ts";
import { actionStyle, alertStyle, primaryStyle } from "../theme.ts";
import { color as token, radius } from "../tokens.ts";
import { boardView, stoneIcon } from "../lib/graph_go/board_view.tsx";
import { gameFrame } from "../lib/graph_go/game_frame.tsx";
import { onFullscreenChange } from "../lib/fullscreen.ts";
import { type BoardShape, makeBoard } from "../lib/graph_go/graphs.ts";
import {
  gameCenter,
  onPendingChange,
  rememberSolved,
  unlock,
} from "../game_center.ts";
import { claimLinkView } from "../lib/game_center_link.tsx";
import { type Problem, PROBLEMS } from "../lib/graph_go/problems.ts";
import {
  cpuMove as readingMove,
  hintMove,
  type TsumegoPosition,
  winnerNow,
  winnerWithBestPlay,
} from "../lib/graph_go/tsumego.ts";
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

/** `choosing`: the side is not picked yet. `won` / `lost`: from the player's side. */
type Status = "choosing" | "playing" | "won" | "lost";

const NAME: Record<Player, string> = { 1: "黒", 2: "白" };

/** What each side is after. */
const AIM: Record<Player, string> = { 1: "取る", 2: "逃げる" };

const REASON: Record<IllegalReason, string> = {
  occupied: "そこには既に石があります。",
  ko: "コウです。すぐには取り返せません。",
  suicide: "自殺手になるので打てません。",
  outOfRange: "盤の外です。",
  invalidColor: "手番の色が不正です。",
};

/** How long the CPU's move waits, so the player sees their own move land first. */
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
    let status: Status = "choosing";
    /** The player's side, once picked. */
    let side: Player = BLACK;
    let toMove: Player = BLACK;
    let thinking = false;
    let hint: number | null = null;
    let message = "";
    /** Bumped on every reset, so a CPU move still in its timeout knows to drop. */
    let generation = 0;

    /** Whether the hint was shown during this attempt, for the "no hint" achievement. */
    let hintUsed = false;

    /** Whether the problem's address was just copied, for the share button to say so. */
    let shared = false;

    /** The study board after a problem is over: both sides by hand, with the reading alongside. */
    let verifying = false;
    /** Every move since the problem started, for "待った" on the study board. */
    let history: {
      stones: Color[];
      ko: number | null;
      lastMove: number | null;
      toMove: Player;
    }[] = [];

    function question(p: Problem): string {
      return `${
        NAME[p.toMove]
      }番です。青で囲んだ白は、取られる? 逃げ切る? 勝てると思う側を選んでください。`;
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
      status = "choosing";
      toMove = problem.toMove;
      thinking = false;
      hint = null;
      message = question(problem);
      generation++;
      verifying = false;
      history = [];
      hintUsed = false;
      shared = false;
    }
    load(0);

    const position = (): TsumegoPosition => ({
      graph: shape.graph,
      stones,
      ko,
    });

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
      const result = modules!.engine.play({ ...position(), color, node });
      if (!result.legal) {
        message = REASON[result.reason ?? "occupied"];
        return false;
      }
      history.push({ stones, ko, lastMove, toMove });
      stones = result.stones;
      ko = result.ko;
      lastMove = node;
      toMove = opponent(color);
      moves++;
      return true;
    }

    const captured = () => stones[problem.target] === EMPTY;

    function choose(s: Player): void {
      if (!modules) return;
      side = s;
      status = "playing";
      message = `${NAME[side]}を持ちました (${AIM[side]}側)。`;
      if (toMove === side) {
        message += "どうぞ。";
        void handle.update();
      } else cpuTurn();
    }

    /** Plays the other side of a problem started over with the side switched. */
    function tryOtherSide(): void {
      const other = opponent(side);
      load(index);
      choose(other);
    }

    function onPlay(node: number): void {
      if (verifying) return verifyMove(node);
      if (!modules || thinking || status !== "playing" || toMove !== side) {
        return;
      }
      if (!play(side, node)) {
        void handle.update();
        return;
      }
      hint = null;
      if (finished()) return;
      cpuTurn();
    }

    /** The CPU's move, after a short pause: the reading's best, winning or holding out. */
    function cpuTurn(): void {
      thinking = true;
      message = "CPU が読んでいます…";
      void handle.update();
      const mine = generation;
      setTimeout(() => {
        if (mine !== generation || !modules) return;
        const cpu = opponent(side);
        const move = readingMove(modules.cpu, problem, position(), cpu);
        play(cpu, move);
        thinking = false;
        if (finished()) return;
        message = `${NAME[cpu]}は${
          move === null ? "パスしました" : "応じました"
        }。あなたの番です。`;
        void handle.update();
      }, REPLY_DELAY);
    }

    /** Ends the problem if someone has won, and says so. */
    function finished(): boolean {
      const winner = winnerNow(modules!.cpu, problem, position(), toMove);
      if (winner === null) return false;
      const how = winner === BLACK
        ? "黒が取りました"
        : `白が逃げ切りました (黒はもう ${problem.depth} 手以内には取れません)`;
      if (winner === side) {
        status = "won";
        awardSolved();
        message = `正解! ${how}。`;
      } else {
        status = "lost";
        message = side === problem.winner
          ? `${how}。${
            NAME[side]
          }を選んだ読みは合っています。手順を変えて、もう一度。`
          : `${how}。この問題は、どう打っても${NAME[winner]}が勝ちます。`;
      }
      void handle.update();
      return true;
    }

    function showHint(): void {
      if (!modules || thinking || status !== "playing" || toMove !== side) {
        return;
      }
      // Checked the way the screen checks a move, so the hint never disagrees with it.
      hintUsed = true;
      hint = hintMove(modules.engine, modules.cpu, problem, position(), side);
      message = hint === null
        ? `読みでは、ここから${
          NAME[side]
        }に勝ち筋はありません。反対側を試してみては?`
        : "青い印のところが読みの答えです。";
      void handle.update();
    }

    /** The achievements a solved problem can bring. */
    function awardSolved(): void {
      const solved = rememberSolved(problem.id);
      void unlock("tsumego_first");
      if (!hintUsed) void unlock("tsumego_no_hint");
      const kinds = new Set(
        PROBLEMS.filter((p) => solved.has(p.id)).map((p) => p.board.kind),
      );
      if (PROBLEMS.every((p) => kinds.has(p.board.kind))) {
        void unlock("tsumego_every_board");
      }
      if (PROBLEMS.every((p) => solved.has(p.id))) void unlock("tsumego_all");
    }

    // --- the study board ---------------------------------------------------------------

    function startVerifying(): void {
      verifying = true;
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
      const winner = winnerWithBestPlay(
        modules.cpu,
        problem,
        position(),
        toMove,
      );
      hint = readingMove(modules.cpu, problem, position(), toMove);
      const verdict = winner === BLACK
        ? `黒は ${problem.depth} 手以内に取れます`
        : `黒は ${problem.depth} 手以内には取れません`;
      const best = hint === null ? "最善はパス" : "青い印が最善手";
      message = `${NAME[toMove]}番。読みでは、${verdict} (${best})。`;
    }

    function verifyMove(node: number | null): void {
      if (!modules) return;
      if (!play(toMove, node)) {
        void handle.update();
        return;
      }
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
      const before = index;
      load(i);
      if (index !== before) {
        globalThis.history.pushState(null, "", urlOf(problem));
      }
      void handle.update();
    }

    /** Opens the problem the address names, if it names one. */
    function loadFromUrl(): void {
      const id = new URL(globalThis.location.href).searchParams.get(PARAM);
      const i = PROBLEMS.findIndex((p) => p.id === id);
      load(i === -1 ? 0 : i);
    }

    /** Hands the problem's address to the share sheet, or copies it. */
    async function share(): Promise<void> {
      const url = urlOf(problem);
      try {
        if (navigator.share) {
          await navigator.share({ title: `詰碁 ${problem.title}`, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        shared = true;
        void handle.update();
      } catch {
        // Dismissed, or the clipboard is not allowed: the address bar still has it.
      }
    }

    handle.queueTask(async () => {
      onFullscreenChange(() => void handle.update(), handle.signal);
      handle.signal.addEventListener(
        "abort",
        onPendingChange(() => void handle.update()),
      );
      gameCenter();
      loadFromUrl();
      globalThis.addEventListener("popstate", () => {
        loadFromUrl();
        void handle.update();
      }, { signal: handle.signal });
      void handle.update();
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
        (verifying ||
          (!thinking && status === "playing" && toMove === side));
      const over = status === "won" || status === "lost";
      const kind = loadError
        ? "error"
        : status === "won" && !verifying
        ? "success"
        : "info";
      const badge: Player = verifying || status === "choosing" ? toMove : side;

      return gameFrame({
        title: "詰碁",
        onFullscreenToggled: () => void handle.update(),
        board: boardView({
          shape,
          stones,
          onPlay,
          playable,
          ghost: verifying ? toMove : side,
          lastMove,
          marked: targetGroup(),
          hint,
        }),
        panel: (
          <div mix={panelStyle}>
            {claimLinkView()}
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

            <div mix={headingStyle}>
              <h2 mix={titleStyle}>{problem.title}</h2>
              <button
                type="button"
                mix={[actionStyle, on("click", () => void share())]}
              >
                {shared ? "コピーしました" : "この問題を共有"}
              </button>
            </div>
            <p mix={youStyle}>
              {stoneIcon(badge)}
              <span>
                {verifying
                  ? `検証中: ${NAME[toMove]}番`
                  : status === "choosing"
                  ? `${NAME[toMove]}番から`
                  : `あなたは${NAME[side]} (${AIM[side]}側)`}
              </span>
            </p>
            <p mix={alertStyle} data-kind={kind} aria-live="polite">
              {loadError
                ? `wasm の読み込みに失敗しました: ${loadError}`
                : !ready
                ? "wasm を読み込み中…"
                : message}
            </p>

            {status === "choosing"
              ? (
                <div mix={rowStyle}>
                  <button
                    type="button"
                    disabled={!ready}
                    mix={[actionStyle, on("click", () => choose(BLACK))]}
                  >
                    {stoneIcon(BLACK)} 黒を持つ (取る)
                  </button>
                  <button
                    type="button"
                    disabled={!ready}
                    mix={[actionStyle, on("click", () => choose(WHITE))]}
                  >
                    {stoneIcon(WHITE)} 白を持つ (逃げる)
                  </button>
                </div>
              )
              : null}

            <dl mix={statsStyle}>
              <div>
                <dt>手数</dt>
                <dd>{moves}</dd>
              </div>
              <div>
                <dt>読みの深さ</dt>
                <dd>{problem.depth} 手</dd>
              </div>
            </dl>

            {status === "choosing" ? null : (
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
                  : over
                  ? null
                  : (
                    <button
                      type="button"
                      disabled={!playable}
                      mix={[actionStyle, on("click", showHint)]}
                    >
                      ヒント
                    </button>
                  )}
                {status === "lost" && !verifying
                  ? (
                    <button
                      type="button"
                      mix={[
                        actionStyle,
                        primaryStyle,
                        on("click", tryOtherSide),
                      ]}
                    >
                      {NAME[opponent(side)]}で挑戦
                    </button>
                  )
                  : null}
                {over && !verifying
                  ? (
                    <button
                      type="button"
                      mix={[actionStyle, on("click", startVerifying)]}
                    >
                      続きを検証
                    </button>
                  )
                  : null}
                {status === "won"
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
            )}

            <p mix={mutedStyle}>
              黒は青で囲んだ白を取れば勝ち、白は逃げ切れば勝ちです。見慣れない盤では、普通の碁の感覚が当てになりません。勝てると思う側を選んで、CPU
              と打ってください。
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

/** The query parameter that names a problem, as in `/tsumego?p=strip-1`. */
const PARAM = "p";

/** The address of a problem, on whatever page and base path this is. */
function urlOf(problem: Problem): string {
  const url = new URL(globalThis.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(PARAM, problem.id);
  return url.href;
}

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

const headingStyle = css({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.5rem",
});

const titleStyle = css({ margin: 0, fontSize: "1.2rem" });

/** Whose side the player is on, big enough not to be missed. */
const youStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  margin: 0,
  fontSize: "1.1rem",
  fontWeight: 600,
  "& svg": { width: "1.6em", height: "1.6em" },
});

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
