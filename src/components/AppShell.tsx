import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronUp, Grid2X2, LifeBuoy, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { accountName } from '../lib/account';
import { SITE_ORIGIN } from '../lib/navigation';

const SUPPORT_URL = `${SITE_ORIGIN}/contact`;
const SIDEBAR_PREFERENCE = 'rovty-sidebar-collapsed';

export default function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_PREFERENCE) === 'true'; }
    catch { return false; }
  });

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(SIDEBAR_PREFERENCE, String(next)); }
    catch { /* The menu still works when browser storage is unavailable. */ }
  };

  const helpLink = (
    <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" title="Get help">
      <LifeBuoy size={18} strokeWidth={1.7} aria-hidden="true" /><span className="sidebar-text">Get help</span><ArrowUpRight className="sidebar-external" size={14} aria-hidden="true" /><span className="sr-only"> (contact form, opens in a new tab)</span>
    </a>
  );

  const nav = (mobile = false) => (
    <nav aria-label={mobile ? 'Mobile navigation' : 'Main navigation'} className={mobile ? 'workspace-mobile-nav workspace-glass' : 'workspace-nav'}>
      <a href="#apps" aria-current="page" title="Apps"><Grid2X2 size={18} strokeWidth={1.7} aria-hidden="true" /><span className="sidebar-text">Apps</span></a>
      {mobile && <>{helpLink}<AccountMenu /></>}
    </nav>
  );

  return (
    <div className={`workspace${collapsed ? ' workspace--collapsed' : ''}`}>
      <a href="#main" className="workspace-skip">Skip to content</a>
      <aside id="dashboard-sidebar" className="workspace-sidebar workspace-glass">
        <div className="sidebar-top">
          <a href={SITE_ORIGIN} className="workspace-logo" aria-label="Rovty home"><img src="/rovty-logo.png" alt="Rovty" width={110} height={24} /></a>
          <button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-expanded={!collapsed} aria-controls="dashboard-sidebar" aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
            {collapsed ? <PanelLeftOpen size={20} aria-hidden="true" /> : <PanelLeftClose size={20} aria-hidden="true" />}
          </button>
        </div>
        {nav()}
        <div className="sidebar-bottom">
          <nav aria-label="Support">{helpLink}</nav>
          <AccountMenu />
        </div>
      </aside>

      <div className="workspace-body">
        <header className="workspace-header workspace-glass">
          <a href={SITE_ORIGIN} className="mobile-logo" aria-label="Rovty home"><img src="/rovty-logo.png" alt="Rovty" width={92} height={20} /></a>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        {nav(true)}
      </div>
    </div>
  );
}

function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const signOutRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const name = accountName(user);

  useEffect(() => {
    if (!open) return;
    signOutRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    // A desktop menu must not stay open when navigation switches on resize.
    const breakpoint = window.matchMedia('(max-width: 899px)');
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    breakpoint.addEventListener('change', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      breakpoint.removeEventListener('change', close);
    };
  }, [open]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError(false);
    try { await signOut(); }
    catch { setError(true); setSigningOut(false); }
  };

  return (
    <div className="account-control" ref={containerRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button ref={triggerRef} type="button" className="account-trigger" aria-label={`Account options for ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} title={name} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}>
        <span className="account-avatar" aria-hidden="true">{Array.from(name)[0].toUpperCase()}</span>
        <span className="account-name sidebar-text">{name}</span>
        <ChevronUp className="account-chevron" size={14} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} className="account-menu workspace-glass" role="menu" aria-label="Account options" onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); signOutRef.current?.focus(); }
        }}>
          <p className="account-menu-name">{name}</p>
          <button ref={signOutRef} role="menuitem" className="sign-out-button" type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
            <LogOut size={16} aria-hidden="true" /><span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </button>
          {error && <p role="alert" className="sign-out-error">Couldn’t sign out. Please try again.</p>}
        </div>
      )}
    </div>
  );
}
