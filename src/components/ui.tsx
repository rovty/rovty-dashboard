import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

// Rovty Dashboard design primitives — the same "Modernist" system as
// rovty.com (ink/paper/line, Archivo, hard 2px rules) applied to an
// application surface. Keep everything here small and composable; pages
// should not invent their own button/field/card styles.

export const kickerClass = 'text-[11px] font-extrabold uppercase tracking-[0.14em] text-line-600';

const buttonBase =
  'inline-flex items-center justify-center gap-2 min-h-11 px-5 text-[12px] font-extrabold uppercase tracking-[0.06em] ' +
  'transition-colors disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation whitespace-nowrap';

const variants = {
  primary: `${buttonBase} bg-ink text-paper hover:bg-line-800`,
  secondary: `${buttonBase} border-2 border-ink text-ink hover:bg-ink hover:text-paper`,
  ghost: `${buttonBase} text-line-700 hover:text-ink`,
  onInk: `${buttonBase} bg-paper text-ink hover:bg-line-300`,
} as const;

export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={`${variants[variant]} ${className}`}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  className = '',
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: keyof typeof variants }) {
  return <a {...rest} className={`${variants[variant]} ${className}`} />;
}

/** Hard-ruled panel; the dashboard's replacement for rounded cards. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`border-2 border-ink bg-paper ${className}`}>{children}</section>;
}

export function PanelHeader({ title, kicker, actions }: { title: string; kicker?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink px-5 py-4 sm:px-6">
      <div>
        {kicker && <p className={`${kickerClass} mb-1`}>{kicker}</p>}
        <h2 className="text-lg font-extrabold tracking-[-0.01em]">{title}</h2>
      </div>
      {actions}
    </header>
  );
}

export function Badge({ tone, children }: { tone: 'active' | 'locked' | 'neutral'; children: ReactNode }) {
  const cls = {
    active: 'bg-ink text-paper',
    locked: 'border-2 border-line-400 text-line-700',
    neutral: 'border-2 border-line-300 text-line-700',
  }[tone];
  return <span className={`inline-flex items-center px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${cls}`}>{children}</span>;
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'info'; children: ReactNode }) {
  const cls = tone === 'error' ? 'border-red-800 bg-red-50 text-red-900' : 'border-ink bg-paper text-ink';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`border-2 px-4 py-3 text-sm font-semibold ${cls}`}>
      {children}
    </p>
  );
}

/** Skeleton row used while entitlements load — avoids "Loading…" text. */
export function SkeletonRows({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y-2 divide-line-300">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-5 py-6 sm:px-6 animate-pulse">
          <div className="h-4 w-40 bg-line-300 mb-3" />
          <div className="h-3 w-72 max-w-full bg-line-200" />
        </div>
      ))}
    </div>
  );
}
