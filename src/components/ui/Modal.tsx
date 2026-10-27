"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { makeOutsideInert } from "@/lib/inert-outside";

/**
 * The one modal shell.
 *
 * Every dialog in the app used to hand-roll this markup, which meant the
 * accessibility and dismissal behaviour drifted per file: most were invisible
 * to screen readers and none of them closed on Escape. The visual result here
 * is byte-for-byte what those copies rendered — same backdrop, radius, shadow
 * and animations — so migrating a modal changes only its behaviour.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface ModalProps {
  /** Dismiss request: Escape, backdrop click, or the header close button. */
  onClose: () => void;
  /** Accessible name for the dialog. Rendered as the visible heading. */
  title: string;
  /** Optional glyph shown in the tinted square beside the title. */
  icon?: React.ReactNode;
  /**
   * Background colour for the icon square, as a CSS colour. Only needed by
   * dialogs that tint it from user data (a chain's brand colour); otherwise
   * the square uses the standard brand tint.
   */
  iconBg?: string;
  /** Panel width: `sm` = 24rem, `md` = 28rem, `lg` = 32rem, `xl` = 42rem. */
  size?: "sm" | "md" | "lg" | "xl";
  /**
   * A mutation is in flight. Escape, the backdrop and the close button all
   * go inert so a half-written save can't be dismissed out from under the
   * user; the caller is still responsible for disabling its own submit.
   */
  busy?: boolean;
  /**
   * Cap the panel at 90vh and lay it out as a column, for dialogs that
   * manage their own scrolling body and pinned footer.
   */
  scrollable?: boolean;
  children: React.ReactNode;
}

export function Modal({
  onClose,
  title,
  icon,
  iconBg,
  size = "md",
  busy = false,
  scrollable = false,
  children,
}: ModalProps) {
  const rootRef  = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId  = useId();

  // A dismissal is only honoured when nothing is pending. Read through a ref
  // so the Escape listener never closes over a stale `busy`.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  function requestClose() {
    if (!busyRef.current) onClose();
  }

  /** Escape to close, captured at the document so focus position is irrelevant. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || busyRef.current) return;
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /**
   * Everything outside the dialog is inert while it is open: not clickable,
   * not focusable, hidden from assistive technology.
   *
   * Declared before the focus effect so its cleanup runs first: the opener
   * that focus is handed back to is inside one of these inert subtrees.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return makeOutsideInert(root);
  }, []);

  /**
   * Focus the dialog on open, keep it inside while open, and hand it back to
   * the opener on close.
   *
   * Focus that lands outside the panel — Tab from a control that has just
   * been disabled, which leaves focus on the page body — is brought back, so
   * the page behind can never be reached from the keyboard. The listener is
   * removed before focus is handed back, or it would pull it in again.
   */
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const opener = document.activeElement as HTMLElement | null;
    const first  = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus();

    function onFocusIn(e: FocusEvent) {
      if (panel && e.target instanceof Node && !panel.contains(e.target)) panel.focus();
    }
    document.addEventListener("focusin", onFocusIn);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      // The opener is often unmounted by now (a row that got filtered away),
      // so only restore focus if it is still in the document.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  /**
   * Going busy disables the control that started it, and a disabled control
   * drops focus to the page body. Keep it on the dialog instead.
   */
  useEffect(() => {
    const panel = panelRef.current;
    if (!busy || !panel) return;
    const active = document.activeElement as (HTMLElement & { disabled?: boolean }) | null;
    if (!active || !panel.contains(active) || active.disabled) panel.focus();
  }, [busy]);

  /** Keep Tab inside the dialog. */
  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      // Everything is disabled (busy): stay on the panel.
      e.preventDefault();
      return;
    }

    const first = items[0];
    const last  = items[items.length - 1];

    if (document.activeElement === panel) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** Prevent the page behind from scrolling while the dialog is up. */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={requestClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-full bg-white rounded-2xl shadow-modal border border-ink-100",
          "animate-slide-up outline-none",
          size === "xl" ? "max-w-2xl" : size === "lg" ? "max-w-lg" : size === "sm" ? "max-w-sm" : "max-w-md",
          scrollable && "flex flex-col max-h-[90vh]"
        )}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3">
            {icon && (
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  !iconBg && "bg-brand-50"
                )}
                style={iconBg ? { backgroundColor: iconBg } : undefined}
              >
                {icon}
              </div>
            )}
            <h2 id={titleId} className="text-[16px] font-bold text-ink-900">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label="close"
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
              "text-ink-400 hover:text-ink-700 hover:bg-ink-100",
              "disabled:opacity-40 disabled:pointer-events-none"
            )}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
