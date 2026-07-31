'use client';

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export interface DetailDrawerProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function DetailDrawer({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  closeLabel = 'Close details',
}: DetailDrawerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !drawerRef.current) return;

    const focusable = getFocusableElements(drawerRef.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="terminal-overlay-in fixed inset-0 z-50 flex justify-end bg-nav/55"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="terminal-drawer-in flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-xl"
        onKeyDown={trapFocus}
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-6">
          <div className="min-w-0 border-l-2 border-accent pl-4">
            <h2
              className="font-display text-2xl font-semibold leading-tight text-ink"
              id={titleId}
            >
              {title}
            </h2>
            {description ? (
              <p
                className="mt-1 text-sm leading-5 text-muted"
                id={descriptionId}
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            aria-label={closeLabel}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-2xl leading-none text-ink transition-colors hover:bg-app-bg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {children}
        </div>
        {footer ? (
          <footer className="border-t border-line bg-app-bg px-5 py-4 sm:px-6">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
