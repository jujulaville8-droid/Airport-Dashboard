'use client';

import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
}

const focusableSelector = [
  'a[href]',
  'area[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]',
].join(', ');

function isTabbableAndVisible(
  element: HTMLElement,
  container: HTMLElement,
): boolean {
  if (element.matches(':disabled') || element.tabIndex < 0) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;

  let current: HTMLElement | null = element;
  while (current && container.contains(current)) {
    const style = window.getComputedStyle(current);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
    if (current === container) break;
    current = current.parentElement;
  }

  return true;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((element) => isTabbableAndVisible(element, container));
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  busy = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
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
    cancelRef.current?.focus();

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

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = getFocusableElements(dialogRef.current);
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
      className="terminal-overlay-in fixed inset-0 z-50 flex items-end justify-center bg-nav/55 p-0 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        aria-busy={busy || undefined}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="terminal-dialog-in w-full rounded-t-xl border border-line bg-surface p-5 shadow-xl sm:max-w-md sm:rounded-xl sm:p-6"
        onKeyDown={trapFocus}
        role="dialog"
      >
        <div className="border-l-2 border-danger pl-4">
          <h2
            className="font-display text-2xl font-semibold leading-tight text-ink"
            id={titleId}
          >
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted" id={descriptionId}>
            {description}
          </p>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            ref={cancelRef}
            disabled={busy}
            onClick={onClose}
            variant="secondary"
          >
            {cancelLabel}
          </Button>
          <Button
            aria-disabled={busy || undefined}
            disabled={busy}
            onClick={onConfirm}
            variant="danger"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
