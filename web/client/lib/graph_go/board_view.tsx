/**
 * The board, drawn: an SVG from the graph's own node positions, so one drawing serves a square
 * lattice, a honeycomb or a random planar graph alike.
 *
 * A plain function rather than a component: it holds no state, and both islands that use it
 * (`islands/graph_go.tsx`, `islands/tsumego.tsx`) re-render it whole on every update. It fills
 * the box it is placed in; the board is drawn square and centred within it.
 */

import { css, on, type RemixNode } from "@remix-run/component";

import type { BoardShape } from "./graphs.ts";
import { BLACK, type Color, EMPTY, WHITE } from "./types.ts";

export interface BoardViewProps {
  shape: BoardShape;
  stones: Color[];
  /** Called with the node clicked; only while `playable`. */
  onPlay(node: number): void;
  playable: boolean;
  /**
   * Whose stone a click would place. Hovering (or pressing) a playable point shows a see-through
   * stone of this colour there, so it is obvious which side is to play.
   */
  ghost?: Color;
  lastMove?: number | null;
  /** Stones to ring in red: left in atari by the last move. */
  atari?: readonly number[];
  /** Stones to ring in the accent: the group a problem is about. */
  marked?: readonly number[];
  /** An empty node to show as a suggestion. */
  hint?: number | null;
  /** Empty nodes judged someone's territory. */
  territory?: ReadonlyMap<number, Color>;
}

/** The SVG's user units: the board fits 0..VIEW with a margin for the outer stones. */
const VIEW = 100;
const PAD = 6;

export function boardView(props: BoardViewProps): RemixNode {
  const { shape, stones } = props;
  const { points, graph } = shape;
  const span = VIEW - 2 * PAD;
  const px = (i: number) => PAD + points[i].x * span;
  const py = (i: number) => PAD + points[i].y * span;
  const r = stoneRadius(shape) * span;

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      mix={boardStyle}
      role="img"
      aria-label={`${graph.nodeCount} 点のグラフ盤`}
    >
      {/* The wood, as a shape: the SVG fills its box and keeps the board square inside it. */}
      <rect x={0} y={0} width={VIEW} height={VIEW} rx={2} mix={woodStyle} />
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
        const owner = c === EMPTY ? props.territory?.get(v) : undefined;
        return (
          <g key={`n${v}`}>
            {c === EMPTY
              ? <circle cx={x} cy={y} r={r * 0.18} mix={pointStyle} />
              : (
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  mix={[
                    c === BLACK ? blackStyle : whiteStyle,
                    props.atari?.includes(v) ? atariStyle : null,
                    props.marked?.includes(v) ? markedStyle : null,
                  ]}
                />
              )}
            {owner === BLACK || owner === WHITE
              ? (
                <rect
                  x={x - r * 0.3}
                  y={y - r * 0.3}
                  width={r * 0.6}
                  height={r * 0.6}
                  mix={[
                    owner === BLACK ? blackStyle : whiteStyle,
                    territoryStyle,
                  ]}
                />
              )
              : null}
            {props.hint === v
              ? <circle cx={x} cy={y} r={r * 0.75} mix={hintStyle} />
              : null}
            {props.lastMove === v
              ? <circle cx={x} cy={y} r={r * 0.35} mix={lastStyle} />
              : null}
            <circle
              cx={x}
              cy={y}
              r={r * 1.05}
              mix={[
                hitStyle,
                props.playable && c === EMPTY
                  ? props.ghost === BLACK
                    ? ghostBlackStyle
                    : props.ghost === WHITE
                    ? ghostWhiteStyle
                    : playableStyle
                  : null,
                on("click", () => {
                  if (props.playable) props.onPlay(v);
                }),
              ]}
            />
          </g>
        );
      })}
    </svg>
  );
}

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

const boardStyle = css({
  display: "block",
  width: "100%",
  height: "100%",
  touchAction: "manipulation",
  userSelect: "none",
});

const woodStyle = css({ fill: "#dcb35c" });

const edgeStyle = css({ stroke: "#3b2a12", strokeWidth: 0.25 });
const pointStyle = css({ fill: "#3b2a12" });
const blackStyle = css({ fill: "#111", stroke: "#000", strokeWidth: 0.2 });
const whiteStyle = css({ fill: "#f8f8f8", stroke: "#444", strokeWidth: 0.2 });
const atariStyle = css({ stroke: "#dc2626", strokeWidth: 0.6 });
const markedStyle = css({ stroke: "#2563eb", strokeWidth: 0.7 });
const lastStyle = css({ fill: "#dc2626" });
const territoryStyle = css({ opacity: 0.8 });
const hintStyle = css({
  fill: "rgb(37 99 235 / 0.35)",
  stroke: "#2563eb",
  strokeWidth: 0.3,
});
const hitStyle = css({ fill: "transparent", stroke: "none" });
const playableStyle = css({
  cursor: "pointer",
  "&:hover": { fill: "rgb(0 0 0 / 0.18)" },
});

/** A see-through stone of the colour to play, on the point under the pointer or finger. */
const ghostBlackStyle = css({
  cursor: "pointer",
  "&:hover, &:active": { fill: "rgb(17 17 17 / 0.5)" },
});
const ghostWhiteStyle = css({
  cursor: "pointer",
  "&:hover, &:active": {
    fill: "rgb(248 248 248 / 0.75)",
    stroke: "#444",
    strokeWidth: 0.2,
  },
});

/** A stone the size of the text around it, for saying "you are white" next to a title. */
export function stoneIcon(color: Color): RemixNode {
  return (
    <svg viewBox="0 0 10 10" mix={iconStyle} aria-hidden="true">
      <circle
        cx={5}
        cy={5}
        r={4.4}
        mix={color === BLACK ? blackStyle : whiteStyle}
      />
    </svg>
  );
}

const iconStyle = css({
  display: "inline-block",
  width: "1em",
  height: "1em",
  verticalAlign: "-0.125em",
  // Outlined in the text's muted colour, so a black stone still shows on a dark page.
  "& circle": { strokeWidth: 0.6, stroke: "var(--muted)" },
});
