/**
 * Every URL the app answers, in one place.
 *
 * `server/router.tsx` maps these to the controllers that answer them, and everything that links
 * reads `routes.my.href()` rather than rebuilding `${base}/my` at each call site.
 *
 * The map is built with the deploy prefix as its base, so hrefs are correct under a GitHub Pages
 * repo sub-path or a PR preview URL without anyone prepending anything. On Cloudflare `base` is
 * empty.
 *
 * Two kinds of route live here and they are deployed differently:
 *
 * - **Pages** (`home`, `play`, `tsumego`, `my`, `docs`) are rendered to static HTML by the GitHub Pages build as
 *   well as served from the static build by Cloudflare.
 * - **Server routes** (`jwks` and everything under `api`) only exist on the live server. Nothing
 *   links to them, so the static build's crawl never reaches them, and they are not in
 *   `entryPoints`. The client may still name them (`routes.api.notify.href()`), which is why the
 *   shapes are stated here — a static deploy simply has no server to answer them.
 */

import { get, route } from "@remix-run/fetch-router/routes";

import { base } from "./base.ts";

export const routes = route(base, {
  home: get("/"),
  /** A game on a board of your choosing, against a person or the CPU. */
  play: get("/play"),
  /** Capture-or-escape problems, answered by the CPU's reading. */
  tsumego: get("/tsumego"),
  // [feature:signin] (the push card on this page is [feature:push])
  my: get("/my"),
  /** The explanations. Articles are Markdown files; `server/docs/` answers these by reading them. */
  docs: route("docs", {
    index: get("/"),
    show: get("/:slug"),
  }),
});
