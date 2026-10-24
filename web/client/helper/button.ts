/**
 * The two names the shell and the browser have to agree on for the help button.
 *
 * A file of its own, and nothing in it but strings, because the shell is rendered on the server:
 * `install.ts` reads the document at module load, and a module that touches `document` cannot be
 * imported by `layout.tsx`.
 */

/** The button's id — the one thing that lets the browser find what the shell rendered. */
export const HELPER_BUTTON_ID = "site-helper";

/**
 * The `<meta>` carrying the chat's chunk URL.
 *
 * The page carries it because the browser cannot work it out: the deploy prefix and the
 * bundler's output naming are both the server's knowledge, which is the same reason
 * `layout.tsx` is handed `script` rather than building it. A `<meta>` in `<head>` rather than an
 * attribute on the button, because the game screens draw their help button inside an island
 * (`lib/graph_go/game_frame.tsx`), which the server's knowledge does not reach. See `install.ts`
 * for why the import that uses it is written the way it is.
 */
export const HELPER_META_NAME = "helper-src";
