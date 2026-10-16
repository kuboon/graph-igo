import type { Handle } from "@remix-run/component";

import { GraphGo } from "../islands/graph_go.tsx";

export const title = "対局 — グラフ囲碁";
export const description =
  "好きなグラフの盤を選んで、人同士か CPU と対局する。終局すると CPU が地を判定して数える。";

/** The board is an island. */
export const hydrate = true;

/** A game screen: the island's frame is the whole of `<body>` — see `lib/graph_go/game_frame.tsx`. */
export const bare = true;

/**
 * `viewport-fit=cover` so the frame can reach the screen's edges and pad by the safe-area insets;
 * no zoom, since a pinch on the board is never meant as one.
 */
export const viewport =
  "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

export default function Play(_handle: Handle) {
  return () => <GraphGo />;
}
