import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui';

const MENU_ID = 'dash-account-menu';

// Authenticated application frame: fixed ink header with the account
// control, then a paper content area. On small screens the account details
// live in a dialog sheet below the header rather than being hidden entirely.
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-dvh bg-paper text-ink font-archivo">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:bg-paper focus:text-ink focus:px-4 focus:py-2 focus:text-sm focus:font-bold"
      >
        Skip to content
      </a>
      <header className="glass-ink sticky top-0 z-50 text-paper border-b-2">
        <div className="max-w-[1240px] mx-auto px-5 sm:px-8 flex items-center justify-between gap-6 h-[64px]">
          <a href="https://rovty.com" className="flex items-center gap-3 shrink-0" aria-label="Rovty home">
            <img src="/rovty-logo.png" alt="Rovty" width={110} height={24} className="h-6 w-auto brightness-0 invert" />
            <span className="hidden sm:inline text-[11px] font-extrabold uppercase tracking-[0.14em] text-line-500 border-l-2 border-line-700 pl-3">
              Dashboard
            </span>
          </a>

          <div className="hidden md:flex items-center gap-5">
            <span className="text-[12px] font-semibold text-line-300 truncate max-w-[28ch]" title={user?.email ?? ''}>
              {user?.email}
            </span>
            <Button variant="onInk" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>

          <button
            ref={toggleRef}
            type="button"
            className="md:hidden flex items-center justify-center w-11 h-11 border-2 border-line-700 hover:border-paper transition-colors"
            aria-expanded={open}
            aria-controls={MENU_ID}
            aria-label={open ? 'Close account menu' : 'Open account menu'}
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
              {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M2 5h16M2 10h16M2 15h16" />}
            </svg>
          </button>
        </div>

        <div
          id={MENU_ID}
          role="dialog"
          aria-modal="true"
          aria-label="Account"
          hidden={!open}
          className="glass-ink md:hidden border-t-2"
        >
          <div className="max-w-[1240px] mx-auto px-5 sm:px-8 py-5 flex flex-col gap-4">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-line-500 mb-1">Signed in as</p>
              <p className="text-sm font-semibold text-paper break-all">{user?.email}</p>
            </div>
            <Button variant="onInk" className="w-full" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="max-w-[1240px] mx-auto px-5 sm:px-8 py-10 sm:py-14">
        {children}
      </main>
    </div>
  );
}
