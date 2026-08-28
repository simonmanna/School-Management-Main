import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The portal's primitives.
 *
 * Written rather than copied from the admin app's `components/ui/*`. Those are
 * eighteen Radix-backed files built for dense desktop tables; the portal needs
 * about six, sized for a thumb. Copying them would have brought eleven Radix
 * packages along for components this app never renders.
 */

/* ── Button ── */

type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-muted text-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-card hover:bg-muted text-foreground',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: 'h-11 px-4 text-sm',
  sm: 'h-10 px-3 text-sm',
  lg: 'h-12 px-6 text-base',
  icon: 'h-11 w-11',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

/* ── Card ── */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 px-4 pt-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-semibold leading-tight tracking-tight', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

/* ── Input ── */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        // 16px minimum: anything smaller makes iOS Safari zoom the whole page on
        // focus, which on a login form looks like the app breaking.
        'flex h-12 w-full rounded-lg border border-input bg-card px-3 text-base',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/* ── Badge ── */

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning';

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'border border-border text-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-accent text-accent-foreground',
};

export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        BADGE_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

/* ── Loading + empty states ── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-muted', className)} />;
}

/**
 * The blank state. Named rather than inlined because a portal is mostly empty
 * states — no results published yet, nothing owing, no homework due — and each
 * one needs to read as "nothing to do" rather than "something is broken".
 */
export function Empty({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icon && <div className="text-muted-foreground">{icon}</div>}
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-xs text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A labelled figure — the portal's most repeated unit. */
export function Stat({
  label,
  value,
  tone = 'default',
  sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'good' | 'bad';
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          'pt-1 text-2xl font-bold tabular-nums',
          tone === 'good' && 'text-[hsl(var(--success))]',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </div>
      {sub && <div className="pt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Page heading used at the top of every screen. */
export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="pb-1">
      <h1 className="text-xl font-bold tracking-tight">{children}</h1>
      {sub && <p className="pt-0.5 text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}
