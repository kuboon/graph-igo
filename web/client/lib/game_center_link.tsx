/**
 * The claim link: what the player presses to record the achievements waiting in the queue.
 *
 * A plain function the islands place in their render; each subscribes with `onPendingChange` and
 * redraws. It renders nothing until there is something to record — and nothing until the island
 * has made the SDK client after hydrating (`madeGameCenter`) — and it is only ever a link — the
 * player follows it when they choose to.
 */

import { css, type RemixNode } from "@remix-run/component";

import { madeGameCenter } from "../game_center.ts";
import { color, radius } from "../tokens.ts";

export function claimLinkView(): RemixNode {
  const gc = madeGameCenter();
  const href = gc?.claimUrl();
  if (!gc || !href) return null;
  return (
    <p mix={claimStyle}>
      <a href={href} target="_blank" rel="noopener">
        🏆 GameCenter に実績を記録する ({gc.pending.length} 件)
      </a>
    </p>
  );
}

/**
 * Where a player sends a bug report or a request: GameCenter's feedback page for this game, which
 * the player signs in to and the author reads (SDK 0.5's `feedbackUrl()`). Always there once the
 * island has made the client. In a new tab, so the game in progress is not lost on the way.
 */
export function feedbackLinkView(): RemixNode {
  const href = madeGameCenter()?.feedbackUrl();
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener" mix={feedbackStyle}>
      不具合・要望を送る
    </a>
  );
}

const feedbackStyle = css({ fontSize: "0.85rem", color: color.muted });

const claimStyle = css({
  margin: 0,
  padding: "0.5rem 0.75rem",
  border: `1px solid ${color.accent}`,
  borderRadius: radius.md,
  fontWeight: 600,
});
