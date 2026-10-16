import type { Handle } from "@remix-run/component";

import { Tsumego } from "../islands/tsumego.tsx";
import { routes } from "../routes.ts";

export const title = "詰碁 — グラフ囲碁";
export const description =
  "グラフの盤の上の詰碁。取るか逃げるかを打つと、CPU が読み切って応じる。";

/** The board is an island. */
export const hydrate = true;

export default function TsumegoPage(_handle: Handle) {
  return () => (
    <>
      <h1>詰碁</h1>
      <p>
        青で囲んだ白の石を、黒なら取る、白なら逃がす問題です。打つと CPU
        が読んで最善の応手を返します。どの問題も正解の初手は 1 つだけ (
        <a href={routes.docs.show.href({ slug: "tsumego" })}>詰碁のしくみ</a>)。
      </p>
      <Tsumego />
    </>
  );
}
