import type { Handle } from "@remix-run/component";

import { Tsumego } from "../islands/tsumego.tsx";

export const title = "詰碁 — グラフ囲碁";
export const description =
  "グラフの盤の上の詰碁。取るか逃げるかを打つと、CPU が読み切って応じる。";

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

export default function TsumegoPage(_handle: Handle) {
  return () => <Tsumego />;
}
