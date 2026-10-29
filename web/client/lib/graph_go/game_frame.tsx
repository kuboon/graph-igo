/**
 * The frame of a game screen: the whole viewport, a thin bar on top, the board as large as the
 * screen allows, and the controls beside it (landscape) or under it (portrait).
 *
 * Game pages are `bare` — no site header or footer — and set `viewport-fit=cover`, so the frame
 * pads itself by the safe-area insets. The bar's "全画面" button takes the frame fullscreen where
 * the Fullscreen API exists (`lib/fullscreen.ts`); "ヘルプ" opens the in-page helper
 * (`client/helper/`), where a player can also pick the part of the screen they want to report.
 *
 * A component, so that what it keeps outlives a render: the frame's element, from a `ref` (which
 * fires once, when the element is inserted), and whether it is fullscreen, which it follows
 * itself. The islands hand it the board and the panel and re-render them as they like.
 */

import {
  css,
  type Handle,
  on,
  ref,
  type RemixNode,
} from "@remix-run/component";

import { HELPER_BUTTON_ID } from "../../helper/button.ts";
import { routes } from "../../routes.ts";
import { color, radius } from "../../tokens.ts";
import {
  canFullscreen,
  isFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from "../fullscreen.ts";

export interface GameFrameProps {
  title: string;
  board: RemixNode;
  panel: RemixNode;
}

export function GameFrame(handle: Handle<GameFrameProps>) {
  let stage: HTMLElement | null = null;

  handle.queueTask(() => {
    // Entering or leaving fullscreen by any route — the button, Escape, the helper — redraws the
    // button's label.
    onFullscreenChange(() => void handle.update(), handle.signal);
  });

  return () => {
    const offerFullscreen = canFullscreen();
    const fullscreen = isFullscreen();

    return (
      <div mix={[stageStyle, ref((node) => (stage = node as HTMLElement))]}>
        <header mix={barStyle}>
          <a href={routes.home.href()} mix={barLinkStyle}>← グラフ囲碁</a>
          <strong mix={titleStyle}>{handle.props.title}</strong>
          <a href={routes.docs.index.href()} mix={barLinkStyle}>解説</a>
          {
            /* The helper's button: `client/helper/install.ts` listens for it on the document. */
          }
          <button type="button" id={HELPER_BUTTON_ID} mix={barButtonStyle}>
            ヘルプ
          </button>
          {offerFullscreen
            ? (
              <button
                type="button"
                mix={[
                  barButtonStyle,
                  on("click", () => void toggleFullscreen(stage)),
                ]}
              >
                {fullscreen ? "全画面を終了" : "全画面"}
              </button>
            )
            : null}
        </header>
        <div mix={bodyStyle}>
          <div mix={boardAreaStyle}>{handle.props.board}</div>
          <div mix={panelStyle}>{handle.props.panel}</div>
        </div>
      </div>
    );
  };
}

// --- styles -----------------------------------------------------------------

const stageStyle = css({
  position: "fixed",
  inset: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  boxSizing: "border-box",
  paddingTop: "env(safe-area-inset-top)",
  paddingBottom: "env(safe-area-inset-bottom)",
  paddingLeft: "env(safe-area-inset-left)",
  paddingRight: "env(safe-area-inset-right)",
  background: color.bg,
  color: color.fg,
  overflow: "hidden",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  WebkitTapHighlightColor: "transparent",
  "&::backdrop": { background: color.bg },
});

const barStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  padding: "0.4rem 0.75rem",
  borderBottom: `1px solid ${color.border}`,
  fontSize: "0.9rem",
});

const titleStyle = css({ flex: "1 1 auto", textAlign: "center" });

const barLinkStyle = css({ textDecoration: "none", whiteSpace: "nowrap" });

const barButtonStyle = css({
  font: "inherit",
  cursor: "pointer",
  padding: "0.15rem 0.6rem",
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  background: "transparent",
  color: color.fg,
  whiteSpace: "nowrap",
  "&:hover": { borderColor: color.accent, color: color.accent },
});

/** Portrait: the board on top, the controls under it. Landscape: side by side. */
const bodyStyle = css({
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  "@media (min-aspect-ratio: 1/1)": {
    display: "grid",
    // An explicit row, or it grows to the board's own height and pushes it off the screen.
    gridTemplateRows: "minmax(0, 1fr)",
    gridTemplateColumns: "minmax(0, 1fr) minmax(17rem, 24rem)",
  },
});

const boardAreaStyle = css({
  flex: "0 0 auto",
  height: "min(100vw, 62dvh)",
  minHeight: 0,
  overflow: "hidden",
  padding: "0.5rem",
  boxSizing: "border-box",
  "@media (min-aspect-ratio: 1/1)": { height: "100%" },
});

const panelStyle = css({
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  padding: "0.75rem 1rem 1rem",
  borderTop: `1px solid ${color.border}`,
  userSelect: "text",
  WebkitUserSelect: "text",
  "@media (min-aspect-ratio: 1/1)": {
    borderTop: "none",
    borderLeft: `1px solid ${color.border}`,
  },
});
