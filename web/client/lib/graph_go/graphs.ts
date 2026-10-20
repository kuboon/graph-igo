/**
 * Boards to play on: a graph, plus where to draw each node.
 *
 * The engine only ever sees the graph. The positions are for the page, normalised so the board
 * fits the unit square with its aspect ratio kept.
 */

import type { GraphSpec } from "./types.ts";

export interface Point {
  x: number;
  y: number;
}

export interface BoardShape {
  graph: GraphSpec;
  points: Point[];
}

export type BoardKind =
  | "grid"
  | "strip"
  | "band"
  | "mobius"
  | "triangular"
  | "honeycomb"
  | "rings"
  | "random";

export const BOARD_KINDS: { kind: BoardKind; label: string; size: number }[] = [
  { kind: "grid", label: "碁盤 (正方格子)", size: 9 },
  { kind: "strip", label: "細長い盤 (2 列)", size: 9 },
  { kind: "band", label: "細長い盤 (3 列)", size: 8 },
  { kind: "mobius", label: "メビウスの帯", size: 10 },
  { kind: "triangular", label: "三角格子 (隣接 6)", size: 7 },
  { kind: "honeycomb", label: "蜂の巣 (隣接 3)", size: 5 },
  { kind: "rings", label: "同心円", size: 5 },
  { kind: "random", label: "ランダム (ガブリエルグラフ)", size: 60 },
];

/**
 * Builds a board. `size` is per kind: a side, a ring count, a strip's length, or for `random` the
 * node count.
 */
export function makeBoard(kind: BoardKind, size: number, seed = 1): BoardShape {
  switch (kind) {
    case "grid":
      return grid(clamp(size, 2, 19));
    case "strip":
      return rect(clamp(size, 2, 25), 2);
    case "band":
      return rect(clamp(size, 2, 25), 3);
    case "mobius":
      return mobius(clamp(size, 3, 24), 3);
    case "triangular":
      return triangular(clamp(size, 2, 15));
    case "honeycomb":
      return honeycomb(clamp(size, 1, 9));
    case "rings":
      return rings(clamp(size, 1, 9));
    case "random":
      return random(clamp(size, 4, 200), seed);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
}

/** Scales and centres the points into the unit square. */
function normalise(points: Point[]): Point[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const offX = (span - (maxX - minX)) / 2;
  const offY = (span - (maxY - minY)) / 2;
  return points.map((p) => ({
    x: (p.x - minX + offX) / span,
    y: (p.y - minY + offY) / span,
  }));
}

function shape(points: Point[], edges: [number, number][]): BoardShape {
  return {
    graph: { nodeCount: points.length, edges },
    points: normalise(points),
  };
}

/** The ordinary Go board: an `n` × `n` square lattice. */
export function grid(n: number): BoardShape {
  const points: Point[] = [];
  const edges: [number, number][] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = y * n + x;
      points.push({ x, y });
      if (x + 1 < n) edges.push([v, v + 1]);
      if (y + 1 < n) edges.push([v, v + n]);
    }
  }
  return shape(points, edges);
}

/** A `w` × `h` rectangle of the square lattice: on a long thin one, every stone is on the edge. */
export function rect(w: number, h: number): BoardShape {
  const points: Point[] = [];
  const edges: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = y * w + x;
      points.push({ x, y });
      if (x + 1 < w) edges.push([v, v + 1]);
      if (y + 1 < h) edges.push([v, v + w]);
    }
  }
  return shape(points, edges);
}

/**
 * A Möbius strip `width` nodes across and `n` along, drawn as a ring. Going once around brings you
 * back on the other side: the seam joins the inside of one end to the outside of the other, so
 * the strip has one edge and no inside.
 */
export function mobius(n: number, width: number): BoardShape {
  const points: Point[] = [];
  const edges: [number, number][] = [];
  const at = (i: number, j: number) => i * width + j;
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    for (let j = 0; j < width; j++) {
      const r = 2 + j;
      points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
      if (j + 1 < width) edges.push([at(i, j), at(i, j + 1)]);
      if (i + 1 < n) edges.push([at(i, j), at(i + 1, j)]);
      else edges.push([at(i, j), at(0, width - 1 - j)]); // The twist.
    }
  }
  return shape(points, edges);
}

/** A hexagon of side `n` cut from the triangular lattice: inner points have six neighbours. */
export function triangular(n: number): BoardShape {
  const index = new Map<string, number>();
  const points: Point[] = [];
  const r = n - 1;
  // Axial coordinates (q, s) with |q|, |s|, |q + s| ≤ r.
  for (let s = -r; s <= r; s++) {
    for (let q = -r; q <= r; q++) {
      if (Math.abs(q + s) > r) continue;
      index.set(`${q},${s}`, points.length);
      points.push({ x: q + s / 2, y: (s * Math.sqrt(3)) / 2 });
    }
  }
  const edges: [number, number][] = [];
  for (const [key, v] of index) {
    const [q, s] = key.split(",").map(Number);
    for (const [dq, ds] of [[1, 0], [0, 1], [-1, 1]]) {
      const u = index.get(`${q + dq},${s + ds}`);
      if (u !== undefined) edges.push([v, u]);
    }
  }
  return shape(points, edges);
}

/** The corners of a hexagon of `n` cells a side, tiled: every node has two or three neighbours. */
export function honeycomb(n: number): BoardShape {
  const index = new Map<string, number>();
  const points: Point[] = [];
  const edgeKeys = new Set<string>();
  const edges: [number, number][] = [];
  const node = (x: number, y: number): number => {
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)}`;
    let v = index.get(key);
    if (v === undefined) {
      v = points.length;
      index.set(key, v);
      points.push({ x, y });
    }
    return v;
  };
  const r = n - 1;
  for (let s = -r; s <= r; s++) {
    for (let q = -r; q <= r; q++) {
      if (Math.abs(q + s) > r) continue;
      // Pointy-top cells of unit radius.
      const cx = Math.sqrt(3) * (q + s / 2);
      const cy = 1.5 * s;
      const corners = Array.from({ length: 6 }, (_, i) => {
        const angle = (Math.PI / 3) * i + Math.PI / 6;
        return node(cx + Math.cos(angle), cy + Math.sin(angle));
      });
      corners.forEach((a, i) => {
        const b = corners[(i + 1) % 6];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push([a, b]);
        }
      });
    }
  }
  return shape(points, edges);
}

/** `n` concentric rings of twelve nodes, joined around and across, with one node at the centre. */
export function rings(n: number): BoardShape {
  const perRing = 12;
  const points: Point[] = [{ x: 0, y: 0 }];
  const edges: [number, number][] = [];
  for (let ring = 0; ring < n; ring++) {
    for (let i = 0; i < perRing; i++) {
      const angle = (2 * Math.PI * i) / perRing;
      const v = 1 + ring * perRing + i;
      points.push({
        x: Math.cos(angle) * (ring + 1),
        y: Math.sin(angle) * (ring + 1),
      });
      edges.push([v, 1 + ring * perRing + ((i + 1) % perRing)]);
      if (ring === 0) {
        if (i % 3 === 0) edges.push([0, v]);
      } else edges.push([v, v - perRing]);
    }
  }
  return shape(points, edges);
}

/**
 * `n` scattered points joined into a Gabriel graph: two points are adjacent when no third point
 * lies inside the circle they are the diameter of. It is planar and connected, so it plays like a
 * board.
 */
export function random(n: number, seed: number): BoardShape {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  // Spread them out a little: keep a candidate only if it is not crowding an earlier point.
  const minDistance = 0.6 / Math.sqrt(n);
  const points: Point[] = [];
  for (let tries = 0; points.length < n && tries < n * 200; tries++) {
    const p = { x: next(), y: next() };
    if (points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= minDistance)) {
      points.push(p);
    }
  }
  const edges: [number, number][] = [];
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const mx = (points[a].x + points[b].x) / 2;
      const my = (points[a].y + points[b].y) / 2;
      const r2 =
        ((points[a].x - points[b].x) ** 2 + (points[a].y - points[b].y) ** 2) /
        4;
      const blocked = points.some((p, c) =>
        c !== a && c !== b && (p.x - mx) ** 2 + (p.y - my) ** 2 < r2
      );
      if (!blocked) edges.push([a, b]);
    }
  }
  return shape(points, edges);
}
