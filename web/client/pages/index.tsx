import { css, type Handle, unsafeHTML } from "@remix-run/component";

import { MANIFEST } from "../game_center.ts";
import { GameCenterLink } from "../islands/game_center.tsx";

import { routes } from "../routes.ts";
import { color, radius } from "../tokens.ts";

export const title = "グラフ囲碁 — graph-igo";
export const description =
  "任意のグラフの上で打つ囲碁。詰碁と対局を、Rust 製の wasm エンジンと CPU でブラウザだけで遊べる。";

/** The shell places the sign-in island, so every page boots the runtime. */
export const hydrate = true;

/**
 * The GameCenter manifest (https://ga-cen.kbn.one). This page is the game's registered URL, so it
 * is the one that carries it. `<` is escaped so the JSON cannot close the script early.
 */
export const head = (
  <script
    type="application/gamecenter+json"
    innerHTML={unsafeHTML(
      JSON.stringify(MANIFEST, null, 2).replaceAll("<", "\\u003c"),
    )}
  />
);

export default function Home(_handle: Handle) {
  return () => (
    <>
      <h1>グラフ囲碁</h1>
      <p mix={leadStyle}>
        碁盤の目の代わりに、任意のグラフの上で打つ囲碁です。点が交点、辺が隣接。
        石のつながり・呼吸点・取り・コウ・自殺手禁止は普通の囲碁と同じです。
      </p>

      <div mix={menuStyle}>
        <a href={routes.tsumego.href()} mix={cardStyle}>
          <strong>詰碁</strong>
          <span>
            蜂の巣や同心円の盤で、白を取る・逃がす。CPU が読み切って応じます。
          </span>
        </a>
        <a href={routes.play.href()} mix={cardStyle}>
          <strong>対局</strong>
          <span>
            正方格子・三角格子・蜂の巣・同心円・ランダムな盤で、人や CPU
            と一局。
          </span>
        </a>
      </div>

      <GameCenterLink />

      <p>
        ルールと、エンジン・CPU の wasm モジュールのしくみは{" "}
        <a href={routes.docs.index.href()}>解説</a>に。
      </p>
    </>
  );
}

const leadStyle = css({ marginBottom: "1.5rem" });

const menuStyle = css({
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
  marginBlock: "1.5rem 2rem",
});

const cardStyle = css({
  display: "grid",
  gap: "0.5rem",
  padding: "1.5rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  background: color.card,
  color: color.fg,
  textDecoration: "none",
  transition: "border-color 120ms ease",
  "& strong": { fontSize: "1.5rem", color: color.accent },
  "& span": { color: color.muted },
  "&:hover": { borderColor: color.accent },
});
