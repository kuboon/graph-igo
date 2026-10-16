import type { Handle } from "@remix-run/component";

import { GraphGo } from "../islands/graph_go.tsx";
import { routes } from "../routes.ts";

export const title = "対局 — グラフ囲碁";
export const description =
  "好きなグラフの盤を選んで、人同士か CPU と対局する。終局すると CPU が地を判定して数える。";

/** The board is an island. */
export const hydrate = true;

export default function Play(_handle: Handle) {
  return () => (
    <>
      <h1>対局</h1>
      <p>
        盤を選んで「対局開始」。点をクリックすると着手、両者パスで終局して地を数えます。
        ルールとしくみは<a href={routes.docs.index.href()}>解説</a>へ。
      </p>
      <GraphGo />
    </>
  );
}
