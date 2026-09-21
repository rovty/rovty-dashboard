import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SITE_ORIGIN } from '../lib/navigation';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** Hold route redirects while restoring a session or leaving after sign-out. */
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const signingOutRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const restoreSession = () => void supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) { setSession(session); setLoading(!session && signingOutRef.current); }
    }).catch(() => { if (mounted) { setSession(null); setLoading(signingOutRef.current); } });
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) restoreSession(); };
    restoreSession();
    window.addEventListener('pageshow', onPageShow);

    // Keeps state in sync for everything else too: token refresh, sign-out in
    // another tab, and the OAuth redirect flow landing back on the app.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      // Hold the route guard while an explicit sign-out leaves this app.
      // Expired sessions and sign-outs in another tab still go to sign-in.
      setLoading(!session && signingOutRef.current);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  const signOut = async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    try {
      const { error } = await supabase.auth.signOut();
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (data.session) throw error ?? new Error('The session could not be cleared.');
      // The SDK can clear this session even if remote revocation fails.
      // Replace the dashboard entry so Back does not reopen the signed-in view.
      window.location.replace(SITE_ORIGIN);
    } catch (error) {
      signingOutRef.current = false;
      setLoading(false);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
