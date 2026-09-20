import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Grid2X2, LifeBuoy, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { accountName } from '../lib/account';

const SUPPORT_URL = 'https://rovty.com/contact';

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const name = accountName(user);
  const initial = Array.from(name)[0].toUpperCase();

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
    <nav aria-label={mobile ? 'Mobile workspace' : 'Workspace'} className={mobile ? 'workspace-mobile-nav workspace-glass' : 'workspace-nav'}>
      <a href="#apps" aria-current="page"><Grid2X2 size={18} strokeWidth={1.7} aria-hidden="true" />Apps</a>
      <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
        <LifeBuoy size={18} strokeWidth={1.7} aria-hidden="true" />Get help<ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only"> (contact form, opens in a new tab)</span>
      </a>
    </nav>
  );

  return (
    <div className="workspace">
      <a href="#main" className="workspace-skip">Skip to content</a>
      <aside className="workspace-sidebar workspace-glass">
        <a href="https://rovty.com" className="workspace-logo" aria-label="Rovty home"><img src="/rovty-logo.png" alt="Rovty" width={110} height={24} /></a>
        <p className="eyebrow workspace-label">Workspace</p>
        {nav()}
        <div className="sidebar-bottom"><a href="https://rovty.com">Explore Rovty<ArrowUpRight size={15} aria-hidden="true" /></a></div>
      </aside>

      <div className="workspace-body">
        <header className="workspace-header workspace-glass">
          <a href="https://rovty.com" className="mobile-logo" aria-label="Rovty home"><img src="/rovty-logo.png" alt="Rovty" width={92} height={20} /></a>
          <span className="workspace-header-label">Workspace</span>
          <div className="header-account">
            <div className="account-identity" title={user?.email ? `${name} · ${user.email}` : name}>
              <span className="account-avatar" aria-hidden="true">{initial}</span>
              <span className="account-name">{name}</span>
              <span className="sr-only"> (signed in)</span>
            </div>
            <button className="sign-out-button" type="button" disabled={signingOut} onClick={() => void handleSignOut()} title="Sign out">
              <LogOut size={16} aria-hidden="true" /><span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </header>
        {nav(true)}
        <main id="main" tabIndex={-1}>
          {signOutError && <p role="alert" className="sign-out-error">Couldn’t sign out. Please try again using Sign out above.</p>}
          {children}
        </main>
        <footer className="workspace-footer"><span>© {new Date().getFullYear()} Rovty</span><div><a href="https://rovty.com/privacy">Privacy</a><a href="https://rovty.com/terms">Terms</a></div></footer>
      </div>
    </div>
  );
}
