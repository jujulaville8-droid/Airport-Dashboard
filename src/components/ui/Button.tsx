import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-accent bg-accent text-nav hover:border-nav hover:bg-nav hover:text-surface',
  secondary:
    'border-line bg-surface text-ink hover:border-muted hover:bg-app-bg',
  ghost:
    'border-transparent bg-transparent text-ink hover:border-line hover:bg-surface',
  danger:
    'border-danger bg-nav text-surface hover:bg-ink',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3.5 text-xs',
  md: 'min-h-11 px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className = '',
      type = 'button',
      variant = 'primary',
      size = 'md',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={[
          'terminal-focus inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-semibold leading-none transition-colors duration-150',
          'disabled:cursor-not-allowed disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          className,
        ].join(' ')}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
