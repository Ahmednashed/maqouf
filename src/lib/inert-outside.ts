/**
 * inert-outside.ts
 *
 * Makes everything outside one element inert — not clickable, not focusable,
 * hidden from assistive technology — and returns the function that undoes it.
 * Used by the shared Modal, which renders in place rather than in a portal:
 * the siblings of the element and of each of its ancestors up to <body> are
 * marked, and only those this call marked are unmarked again, so an element
 * that was already inert stays inert.
 *
 * One exception, opted into by name: an element carrying KEEP_LIVE_ATTR is
 * left alone. Only the toast container carries it. Dialogs report the outcome
 * of their own save or delete as a toast; made inert, that toast would still
 * show but would not be announced to a screen reader, and its close button
 * would not respond. Being live is not enough to qualify — a live region on
 * the page behind the dialog is part of that page and goes inert with it.
 *
 * DOM-free in its types (only the members it touches), so it can be tested
 * without a browser.
 */

/** Opt-in marker for an element that stays usable while a dialog is open. */
export const KEEP_LIVE_ATTR = "data-modal-keep-live";

export interface InertNode {
  readonly tagName:       string;
  readonly parentElement: InertNode | null;
  readonly children:      ArrayLike<InertNode>;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function makeOutsideInert(root: InertNode): () => void {
  const marked: InertNode[] = [];
  for (let node = root; node.parentElement && node.tagName !== "BODY"; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute("inert") || sibling.tagName === "SCRIPT") continue;
      if (sibling.hasAttribute(KEEP_LIVE_ATTR)) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
  }
  return () => { marked.forEach((el) => el.removeAttribute("inert")); };
}
