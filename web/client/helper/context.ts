/**
 * What a report says about the screen it came from.
 *
 * Picking is `@kuboon/chat-element`'s: the ⌖ button beside the composer and the `pick_element`
 * tool both hand back an element's CSS path and nothing else. This adds the game's own context
 * when the report is drafted — the page, which point of the board the path lands on (a CSS path
 * says nothing useful about the board), the heading and the status line. That is game state, not
 * anything the player typed or signed in to.
 */

/**
 * The first element on the page matching `selector`, leaving out the chat's own panel (a
 * `<dialog>` with a heading and a live region of its own).
 */
export function onPage(selector: string): Element | null {
  return [...document.querySelectorAll(selector)].find((el) =>
    !el.closest("dialog")
  ) ?? null;
}

/** The screen, and the element at `path` if there is one. */
export function describeScreen(path?: string): string {
  const lines = [`ページ: ${location.href}`];
  if (path) {
    lines.push(`要素: ${path}`);
    const node = boardPoint(find(path));
    if (node !== null) lines.push(`盤の点: ${node} 番`);
  }
  const heading = onPage("h2")?.textContent?.trim();
  if (heading) lines.push(`見出し: ${heading}`);
  const status = onPage("[aria-live]")?.textContent?.trim();
  if (status) lines.push(`状態表示: ${status}`);
  return lines.join("\n");
}

/** The element a path names, or `null` if it is not a selector or no longer matches. */
function find(path: string): Element | null {
  try {
    return document.querySelector(path);
  } catch {
    return null;
  }
}

/** Which node of the board, when the element is one: each node is a `<g>` in the board's `<svg>`. */
function boardPoint(el: Element | null): number | null {
  const g = el?.closest("svg g");
  const svg = g?.closest("svg");
  if (!g || !svg) return null;
  const index = [...svg.querySelectorAll("g")].indexOf(g as SVGGElement);
  return index === -1 ? null : index;
}

/**
 * A CSS path in what the player sent, as the ⌖ button puts it in the composer (`elementPath`:
 * `#id`, or tag names joined by ` > `), or `null`.
 */
export function pathIn(text: string): string | null {
  const step = String
    .raw`(?:#[A-Za-z][\w-]*|[a-z][\w-]*(?::nth-of-type\(\d+\))?)`;
  const match = text.match(new RegExp(`${step}(?: > ${step})+`));
  return match?.[0] ?? null;
}
