import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, Grid2X2, LayoutDashboard, LogOut, Mail, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'products', label: 'Products', icon: Grid2X2 },
  { id: 'account', label: 'Account', icon: UserRound },
] as const;

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [section, setSection] = useState(() => window.location.hash.slice(1) || 'overview');
  const accountRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const current = navigation.find((item) => item.id === section) ?? navigation[0];
  const initial = (user?.email?.[0] || 'R').toUpperCase();

  useEffect(() => {
    const onHashChange = () => setSection(window.location.hash.slice(1) || 'overview');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(false);
    try {
      await signOut();
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  };

  const nav = (mobile = false) => (
    <nav aria-label={mobile ? 'Mobile workspace' : 'Workspace'} className={mobile ? 'workspace-mobile-nav' : 'workspace-nav'}>
      {navigation.map(({ id, label, icon: Icon }) => (
        <a key={id} href={`#${id}`} aria-current={current.id === id ? 'location' : undefined}>
          <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
          <span>{label}</span>
          {!mobile && current.id === id && <span className="nav-indicator" aria-hidden="true" />}
        </a>
      ))}
    </nav>
  );

  return (
    <div className="workspace">
      <a href="#main" className="workspace-skip">Skip to content</a>
      <aside className="workspace-sidebar">
        <a href="https://rovty.com" className="workspace-logo" aria-label="Rovty home">
          <img src="/rovty-logo.png" alt="Rovty" width={110} height={24} />
        </a>
        <div className="workspace-label"><span className="eyebrow">Personal workspace</span><span className="workspace-label-rule" /></div>
        {nav()}
        <div className="sidebar-bottom">
          <p className="sidebar-note">One account.<br /><span>More possibilities.</span></p>
          <a href="mailto:hello@rovty.com"><Mail size={16} aria-hidden="true" />Get help<ArrowUpRight size={15} aria-hidden="true" /></a>
          <a href="https://rovty.com">Explore Rovty<ArrowUpRight size={15} aria-hidden="true" /></a>
          <div className="sidebar-signature"><span>ROVTY</span><span>YOUR NEXT STARTS HERE.</span></div>
        </div>
      </aside>

      <div className="workspace-body">
        <header className="workspace-header">
          <a href="https://rovty.com" className="mobile-logo" aria-label="Rovty home">
            <img src="/rovty-logo.png" alt="Rovty" width={92} height={20} />
          </a>
          <p className="workspace-breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span>{current.label}</p>
          <div
            className="account-control"
            ref={accountRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
          >
            <button ref={toggleRef} className="account-toggle" type="button" aria-expanded={open} aria-controls="account-popover" aria-label="Your account menu" onClick={() => setOpen((value) => !value)}>
              <span className="account-avatar" aria-hidden="true">{initial}</span>
              <span className="account-toggle-label">Your account</span>
              <ChevronDown size={14} className={open ? 'rotate-180' : ''} aria-hidden="true" />
            </button>
            {open && (
              <div id="account-popover" className="account-popover">
                <p className="eyebrow">Signed in as</p>
                <p className="account-menu-email">{user?.email}</p>
                <a href="#account" onClick={() => setOpen(false)}><UserRound size={16} aria-hidden="true" />View account<ArrowUpRight size={15} aria-hidden="true" /></a>
                <button type="button" disabled={signingOut} onClick={() => void handleSignOut()}><LogOut size={16} aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}</button>
                {signOutError && <p role="alert" className="account-menu-error">Couldn’t sign out. Please try again.</p>}
              </div>
            )}
          </div>
        </header>
        {nav(true)}
        <main id="main" tabIndex={-1}>{children}</main>
        <footer className="workspace-footer"><span>© {new Date().getFullYear()} Rovty</span><div><a href="https://rovty.com/privacy">Privacy</a><a href="https://rovty.com/terms">Terms</a></div></footer>
      </div>
    </div>
  );
}
