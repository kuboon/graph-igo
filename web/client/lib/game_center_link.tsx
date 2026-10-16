/**
 * The claim link: what the player presses to record the achievements waiting in the queue.
 *
 * A plain function the islands place in their render; each subscribes with `onPendingChange` and
 * redraws. It renders nothing until there is something to record, and it is only ever a link —
 * the player follows it when they choose to.
 */

import { css, type RemixNode } from "@remix-run/component";

import { gameCenter } from "../game_center.ts";
import { color, radius } from "../tokens.ts";

export function claimLinkView(): RemixNode {
  const gc = gameCenter();
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

const claimStyle = css({
  margin: 0,
  padding: "0.5rem 0.75rem",
  border: `1px solid ${color.accent}`,
  borderRadius: radius.md,
  fontWeight: 600,
});
