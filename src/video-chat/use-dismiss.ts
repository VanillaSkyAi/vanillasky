import { useEffect, type RefObject } from "react";

/**
 * Escape, and a click anywhere else.
 *
 * Every popover and sheet a person meets closes both ways, and one that does
 * not reads as stuck rather than as open. Keyboard users have no other exit at
 * all: without Escape the only way out of the settings popover was to tab back
 * to the button that opened it.
 *
 * `pointerdown` rather than `click`, because a click that begins inside the
 * popover and ends outside it - a drag on a label, a text selection that runs
 * past the edge - is not someone dismissing anything.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  surfaces: readonly RefObject<HTMLElement | null>[],
): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (surfaces.some((surface) => surface.current?.contains(target))) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close, surfaces]);
}

/**
 * Keep the tab key inside a modal surface, and give focus back afterwards.
 *
 * The full-response sheet covers the page, so tabbing out of it lands on
 * controls nobody can see behind a scrim - the classic way a modal is
 * unusable by keyboard while looking finished. Returning focus to whatever
 * opened it is the other half: without it the next Tab starts from the top of
 * the document.
 */
export function useFocusTrap(active: boolean, surface: RefObject<HTMLElement | null>, trigger?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    // Safari does not focus buttons on pointer activation. Keep the actual
    // opener when supplied so Escape restores a useful keyboard position.
    const returnTo = trigger?.current ?? document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(
      surface.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((node) => node.offsetParent !== null);

    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !surface.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTo?.focus?.();
    };
  }, [active, surface, trigger]);
}
