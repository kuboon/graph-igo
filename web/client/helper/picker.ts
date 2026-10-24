/**
 * Picking a part of the screen, for a report to point at.
 *
 * "This is wrong" is easier to show than to describe, so the helper can ask the player to tap the
 * thing they mean. While picking, the element under the pointer is outlined and a banner says what
 * is going on; the tap that chooses is swallowed in the capture phase, so it never reaches the
 * board underneath and plays a move. Escape (or the banner's button) gives up.
 *
 * What comes back is a description written for the person reading the report, not a selector to
 * run: the page, which element, its text, and — on the game screens — the status line and which
 * point of the board it was, since the board is the one thing a CSS path says nothing useful about.
 */

/** Why picking ended without an element. */
export class PickCancelled extends Error {
  constructor() {
    super("選ぶのを取りやめました");
  }
}

/**
 * Lets the player tap an element. Resolves with it, or rejects with {@link PickCancelled} on
 * Escape, the banner's button, or `signal`.
 *
 * @param ignore Elements that are never picked (the helper's own panel)
 */
export function pickElement(
  signal: AbortSignal,
  ignore: readonly Element[] = [],
): Promise<Element> {
  return new Promise((resolve, reject) => {
    const outline = document.createElement("div");
    outline.style.cssText = OUTLINE_STYLE;
    const banner = document.createElement("div");
    banner.style.cssText = BANNER_STYLE;
    banner.textContent = "報告したいところをタップしてください ";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "やめる";
    cancel.style.cssText = CANCEL_STYLE;
    banner.appendChild(cancel);
    // In the fullscreen element when there is one: anything outside it is not drawn.
    const host = document.fullscreenElement ?? document.body;
    host.append(outline, banner);

    const skip = [outline, banner, ...ignore];
    const candidate = (x: number, y: number): Element | null => {
      const hit = document.elementsFromPoint(x, y).find((el) =>
        !skip.some((s) => s.contains(el)) && el !== document.documentElement &&
        el !== document.body
      );
      return hit ?? null;
    };

    const show = (el: Element | null) => {
      if (!el) {
        outline.style.display = "none";
        return;
      }
      const r = el.getBoundingClientRect();
      Object.assign(outline.style, {
        display: "block",
        left: `${r.left - 2}px`,
        top: `${r.top - 2}px`,
        width: `${r.width + 4}px`,
        height: `${r.height + 4}px`,
      });
    };

    const onMove = (event: PointerEvent) => {
      show(candidate(event.clientX, event.clientY));
    };
    /** Everything a tap does on the page, stopped before the page sees it. */
    const swallow = (event: Event) => {
      if (banner.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onClick = (event: MouseEvent) => {
      if (banner.contains(event.target as Node)) return;
      swallow(event);
      const el = candidate(event.clientX, event.clientY);
      if (el) finish(() => resolve(el));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(() => reject(new PickCancelled()));
    };
    const onAbort = () => finish(() => reject(new PickCancelled()));

    const capture = { capture: true } as const;
    addEventListener("pointermove", onMove, capture);
    for (const type of SWALLOWED) addEventListener(type, swallow, capture);
    addEventListener("click", onClick, capture);
    addEventListener("keydown", onKey, capture);
    cancel.addEventListener("click", onAbort);
    signal.addEventListener("abort", onAbort);

    function finish(settle: () => void): void {
      removeEventListener("pointermove", onMove, capture);
      for (const type of SWALLOWED) removeEventListener(type, swallow, capture);
      removeEventListener("click", onClick, capture);
      removeEventListener("keydown", onKey, capture);
      signal.removeEventListener("abort", onAbort);
      outline.remove();
      banner.remove();
      settle();
    }
  });
}

/** The events of a tap other than the click itself, which the board or a button might act on. */
const SWALLOWED = ["pointerdown", "pointerup", "mousedown", "mouseup"] as const;

/**
 * The first element on the page matching `selector`, leaving out the helper's own panel (a
 * `<dialog>` with a heading and a live region of its own).
 */
export function onPage(selector: string): Element | null {
  return [...document.querySelectorAll(selector)].find((el) =>
    !el.closest("dialog")
  ) ?? null;
}

/** What a report says about the element, and about the screen it was on. */
export function describeElement(el: Element): string {
  const lines = [
    `ページ: ${location.href}`,
    `要素: ${path(el)}`,
  ];
  const label = el.getAttribute("aria-label") ??
    el.closest("[aria-label]")?.getAttribute("aria-label");
  if (label) lines.push(`ラベル: ${label}`);
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) {
    lines.push(`文字: ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`);
  }
  const node = boardPoint(el);
  if (node !== null) lines.push(`盤の点: ${node} 番`);
  const heading = onPage("h2")?.textContent?.trim();
  if (heading) lines.push(`見出し: ${heading}`);
  const status = onPage("[aria-live]")?.textContent?.trim();
  if (status) lines.push(`状態表示: ${status}`);
  return lines.join("\n");
}

/**
 * A readable path to the element: tag names, with the id or the position among same-tag siblings
 * where that tells them apart. The class names are generated hashes, so they are left out.
 */
function path(el: Element): string {
  const parts: string[] = [];
  for (
    let node: Element | null = el;
    node && node !== document.body && parts.length < 6;
    node = node.parentElement
  ) {
    const tag = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${tag}#${node.id}`);
      break;
    }
    const same = node.parentElement
      ? [...node.parentElement.children].filter((c) =>
        c.tagName === node!.tagName
      )
      : [];
    parts.unshift(
      same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag,
    );
  }
  return parts.join(" > ");
}

/** Which node of the board, when the element is one: each node is a `<g>` in the board's `<svg>`. */
function boardPoint(el: Element): number | null {
  const g = el.closest("svg g");
  const svg = g?.closest("svg");
  if (!g || !svg) return null;
  const index = [...svg.querySelectorAll("g")].indexOf(g as SVGGElement);
  return index === -1 ? null : index;
}

const OUTLINE_STYLE = [
  "position: fixed",
  "display: none",
  "pointer-events: none",
  "z-index: 2147483646",
  "border: 3px solid #e11d48",
  "border-radius: 4px",
  "background: rgba(225, 29, 72, 0.12)",
].join(";");

const BANNER_STYLE = [
  "position: fixed",
  "left: 50%",
  "top: max(0.5rem, env(safe-area-inset-top))",
  "transform: translateX(-50%)",
  "z-index: 2147483647",
  "padding: 0.5rem 0.75rem",
  "border-radius: 8px",
  "background: #e11d48",
  "color: #fff",
  "font: 600 0.9rem system-ui, sans-serif",
  "box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3)",
].join(";");

const CANCEL_STYLE = [
  "margin-left: 0.5rem",
  "font: inherit",
  "padding: 0.15rem 0.6rem",
  "border: 1px solid #fff",
  "border-radius: 6px",
  "background: transparent",
  "color: inherit",
].join(";");
