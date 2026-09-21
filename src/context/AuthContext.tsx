import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { SITE_ORIGIN } from "../lib/navigation";
import { platformSessionRequest } from "../lib/platform-session";

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
  const [verificationError, setVerificationError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    let generation = 0;
    const verify = async (current: Session | null) => {
      const run = ++generation;
      if (signingOutRef.current) return;
      if (!current) {
        if (mounted) {
          setSession(null);
          setLoading(false);
          setVerificationError(false);
        }
        return;
      }
      try {
        const response = await platformSessionRequest(current, "session");
        if (!mounted || run !== generation || signingOutRef.current) return;
        if (response.status === 401 || response.status === 403) {
          setSession(null);
          setLoading(false);
          setVerificationError(false);
          void supabase.auth.signOut({ scope: "local" });
          return;
        }
        if (!response.ok) throw new Error("Session verification unavailable");
        setSession(current);
        setLoading(false);
        setVerificationError(false);
      } catch {
        if (mounted && run === generation) {
          setVerificationError(true);
          setLoading(false);
        }
      }
    };
    const restore = () =>
      void supabase.auth
        .getSession()
        .then(({ data }) => verify(data.session))
        .catch(() => {
          if (mounted) setVerificationError(true);
        });
    const visible = () => {
      if (document.visibilityState === "visible") restore();
    };
    restore();
    const timer = window.setInterval(visible, 15000);
    window.addEventListener("pageshow", visible);
    document.addEventListener("visibilitychange", visible);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, current) => {
      if (signingOutRef.current) {
        // Keep the retry control mounted until the local session is cleared.
        if (!current) {
          setSession(null);
          setLoading(true);
        }
        return;
      }
      // The callback does not await Auth calls, avoiding the SDK's session lock.
      void verify(current);
    });
    return () => {
      mounted = false;
      generation++;
      subscription.unsubscribe();
      clearInterval(timer);
      window.removeEventListener("pageshow", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [attempt]);

  const signOut = async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    try {
      const { data: current } = await supabase.auth.getSession();
      if (current.session) {
        const response = await platformSessionRequest(
          current.session,
          "logout",
        );
        if (!response.ok && response.status !== 401)
          throw new Error("Could not finish signing out. Please try again.");
      }
      const { error } = await supabase.auth.signOut({ scope: "local" });
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (data.session)
        throw error ?? new Error("The session could not be cleared.");
      // The SDK can clear this session even if remote revocation fails.
      // Replace the dashboard entry so Back does not reopen the signed-in view.
      window.location.replace(SITE_ORIGIN);
    } catch (error) {
      signingOutRef.current = false;
      setLoading(false);
      throw error;
    }
  };

  if (verificationError)
    return (
      <main className="min-h-screen bg-paper text-ink grid place-items-center p-6">
        <div className="max-w-md border-2 border-ink p-7">
          <h1 className="text-2xl font-bold">Connection interrupted</h1>
          <p className="my-4">
            We couldn't verify your Rovty account. Please try again.
          </p>
          <button
            className="border-2 border-ink px-5 py-3 font-bold"
            onClick={() => setAttempt((v) => v + 1)}
          >
            Try again
          </button>
        </div>
      </main>
    );

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, loading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
