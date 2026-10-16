/**
 * Where the client runtime was compiled to, resolved once.
 *
 * The shell writes one `<script>` — `run()`, which hydrates whatever islands a page placed — and
 * this is the URL it needs, plus the chunks to preload behind it. It is resolved here because the
 * bundle does not change while the server runs, and because a page in `client/` cannot ask.
 *
 * One call rather than two, and the same one the renderer makes for each island: `getScriptEntry`
 * is what an asset server answers as of `remix@3.0.0-rc.2`.
 *
 * It sits in a file of its own rather than in `router.ts` because two modules need it and one of
 * them is imported by the other: `router.ts` hands it to every page module that sets `hydrate`,
 * and `docs/mod.tsx` — which builds its own `Layout` calls, being a controller rather than a page —
 * hands it to the article screen. Exporting it from `router.ts` would have `docs/mod.tsx` import
 * the module that imports it.
 */

import { assets } from "./assets.ts";
import type { ClientRuntime } from "../client/layout.tsx";

const entry = await assets.getScriptEntry("hydration.ts");

/**
 * Where the chat's chunk is.
 *
 * Its URL and nothing else: preloading it would download fifty kilobytes on every hydrated page
 * for a panel most visits never open, which is the whole reason it is a separate entrypoint. The
 * shell writes it onto the help button and the browser imports it on the first click — see
 * `client/helper/install.ts`.
 */
const helper = (await assets.getScriptEntry("helper/panel.ts")).href;

/** The `<script type="module">` a hydrating page loads, and the chunks to preload behind it. */
export const clientRuntime: ClientRuntime = {
  src: entry.href,
  preloads: entry.preloads,
  helper,
};
