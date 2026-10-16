import { css, type Handle } from "@remix-run/component";

import { GraphGo } from "../islands/graph_go.tsx";
import { cardStyle } from "../theme.ts";

export const title = "グラフ囲碁 — graph-igo";
export const description =
  "任意のグラフの上で打つ囲碁。ルールエンジンと CPU はそれぞれ Rust 製の wasm モジュールで、ブラウザだけで動きます。";

/** The board is an island. */
export const hydrate = true;

export default function Home(_handle: Handle) {
  return () => (
    <>
      <h1>グラフ囲碁</h1>
      <p mix={leadStyle}>
        碁盤の目の代わりに、任意のグラフの上で打つ囲碁です。点が交点、辺が隣接。
        石のつながり・呼吸点・取り・コウ・自殺手禁止は普通の囲碁と同じです。
      </p>

      <GraphGo />

      <section mix={cardStyle}>
        <h2>しくみ</h2>
        <p>
          どちらも <code>wasm/</code>{" "}
          の Rust を wasm32 にビルドしたもので、JSON を受け取って JSON
          を返します (<code>web/client/lib/graph_go/</code>{" "}
          が読み込みと接続を担当)。
        </p>
        <ul mix={listStyle}>
          <li>
            <strong>エンジン</strong> (<code>engine.wasm</code>)
            <ul>
              <li>
                <code>play</code>{" "}
                — 現在の盤面に次の 1 手を置いたとき何が起きるか
                (合法か、取られる石、コウ、アタリ、次の盤面)
              </li>
              <li>
                <code>regions</code>{" "}
                — 空点が n
                個以上つながった部分を、周りの石ごと部分グラフとして取り出す
              </li>
              <li>
                <code>evaluate</code> — 部分グラフをそれぞれ CPU モジュールの
                {" "}
                <code>judge</code>{" "}
                に投げ、黒白どちらの地かを判定させて数える (n
                未満の領域はエンジンが「片方の色だけに囲まれていればその色」で決める)
              </li>
            </ul>
          </li>
          <li>
            <strong>CPU</strong> (<code>cpu.wasm</code>)
            <ul>
              <li>
                <code>judge</code>{" "}
                — 部分グラフの空点ごとに近い方の色を数え、6
                割以上を占めた色の地とする
              </li>
              <li>
                <code>genmove</code>{" "}
                —
                原始モンテカルロ。候補手ごとにランダムな終局まで打ち切り、勝率の最も高い手を選ぶ
              </li>
            </ul>
          </li>
        </ul>
        <p>
          エンジンは <code>cpu.judge</code>{" "}
          を import していて、ページがそれを CPU モジュールの export
          につなぎます。数え方は中国ルール (石 + 地、白にコミ)。
        </p>
      </section>
    </>
  );
}

const leadStyle = css({ marginBottom: "1.5rem" });

const listStyle = css({
  paddingLeft: "1.1rem",
  "& li": { marginBlock: "0.4rem" },
});
