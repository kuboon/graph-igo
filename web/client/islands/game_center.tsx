/**
 * GameCenterLink — the claim link on pages that are not game screens.
 *
 * The top page is what GameCenter launches, with the player's token in the URL. Making the SDK
 * client here is what reads that token (and stores it for the game screens), so this island is
 * placed on the top page even when it has nothing to show.
 */

import { clientEntry, type Handle } from "@remix-run/component";

import { gameCenter, onPendingChange } from "../game_center.ts";
import { claimLinkView } from "../lib/game_center_link.tsx";

export const GameCenterLink = clientEntry(
  import.meta.url,
  function GameCenterLink(handle: Handle) {
    handle.queueTask(async () => {
      const gc = gameCenter();
      const off = onPendingChange(() => void handle.update());
      handle.signal.addEventListener("abort", off);
      void handle.update();
      // Sending a queue a token turned up for empties it; redraw once that has happened.
      await gc?.ready;
      void handle.update();
    });
    return () => claimLinkView();
  },
);
