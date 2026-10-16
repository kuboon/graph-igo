/**
 * The Fullscreen API, with the prefixed half Safari shipped.
 *
 * Game screens offer it as a button rather than demanding it: a desktop window is a fine place to
 * play, and `requestFullscreen()` is refused outside a user gesture anyway. Where the API does not
 * exist at all (iPhone Safari) the button is not shown, and the page — which already fills the
 * viewport — is as close as the browser lets it get.
 */

type LegacyElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type LegacyDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

const legacy = () => document as LegacyDocument;

export function canFullscreen(): boolean {
  return typeof document !== "undefined" &&
    Boolean(document.fullscreenEnabled || legacy().webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return typeof document !== "undefined" &&
    Boolean(document.fullscreenElement ?? legacy().webkitFullscreenElement);
}

/** Puts `element` fullscreen, or takes the document out of it. A refusal is not an error. */
export async function toggleFullscreen(
  element: HTMLElement | null,
): Promise<void> {
  try {
    if (isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else await legacy().webkitExitFullscreen?.();
    } else if (element) {
      const el = element as LegacyElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: "hide" });
      } else await el.webkitRequestFullscreen?.();
    }
  } catch {
    // Refused — an iframe without `allow="fullscreen"`, say. Play in the page instead.
  }
}

/** Calls `listener` whenever the document enters or leaves fullscreen, until `signal` aborts. */
export function onFullscreenChange(
  listener: () => void,
  signal: AbortSignal,
): void {
  for (const type of ["fullscreenchange", "webkitfullscreenchange"]) {
    document.addEventListener(type, listener, { signal });
  }
}
