import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type Provider = 'google' | 'azure';
type Mode = 'sign-in' | 'sign-up' | 'reset';

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden="true">
    <path
      fill="#FFC107"
      d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
    />
    <path
      fill="#FF3D00"
      d="M6.3 14.7l6.6 4.8C14.5 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
    />
    <path
      fill="#4CAF50"
      d="M24 44c5.4 0 10.3-2.1 14-5.5l-6.5-5.5c-2 1.4-4.6 2.3-7.5 2.3-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.6 39.6 16.3 44 24 44z"
    />
    <path
      fill="#1976D2"
      d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.7l6.5 5.5C39.9 36.9 44 31 44 24c0-1.3-.1-2.7-.4-3.5z"
    />
  </svg>
);

const MicrosoftIcon = () => (
  <svg viewBox="0 0 21 21" className="h-[18px] w-[18px]" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

// Dark ("ink") scheme — matches Header/Footer rather than the lighter
// "paper" surfaces the rest of the Modernist system also uses.
const inputClass =
  'w-full px-4 py-3 bg-ink border-2 border-line-700 text-paper placeholder-line-600 text-sm focus:outline-none focus:border-paper transition-colors';

const primaryButtonClass =
  'w-full px-4 py-3.5 text-sm font-extrabold uppercase tracking-[0.04em] bg-paper text-ink hover:bg-line-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2';

const linkClass = 'text-line-400 underline underline-offset-[3px] hover:text-paper transition-colors';

const OAuthButtons = ({
  oauthLoading,
  onSelect,
}: {
  oauthLoading: Provider | null;
  onSelect: (provider: Provider) => void;
}) => (
  <div className="flex flex-col gap-3 mb-6">
    <button
      type="button"
      onClick={() => onSelect('google')}
      disabled={oauthLoading !== null}
      className="flex items-center justify-center gap-3 px-4 py-3 border-2 border-line-700 text-sm font-bold text-paper hover:bg-line-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {oauthLoading === 'google' ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <GoogleIcon />}
      Continue with Google
    </button>
    <button
      type="button"
      onClick={() => onSelect('azure')}
      disabled={oauthLoading !== null}
      className="flex items-center justify-center gap-3 px-4 py-3 border-2 border-line-700 text-sm font-bold text-paper hover:bg-line-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {oauthLoading === 'azure' ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <MicrosoftIcon />}
      Continue with Microsoft
    </button>
  </div>
);

const LoginPage = () => {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mode, setMode] = useState<Mode>('sign-in');
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [confirmEmailSent, setConfirmEmailSent] = useState(false);

  // Already signed in (or a session just resolved) — don't show the login
  // form, send them straight through to wherever they were headed.
  if (!authLoading && user) {
    return <Navigate to={from} replace />;
  }

  const resetTransientState = () => {
    setError(null);
    setResetSent(false);
    setConfirmEmailSent(false);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    resetTransientState();
  };

  const handleOAuth = async (provider: Provider) => {
    setError(null);
    setOauthLoading(provider);
    // Same call for sign-in and sign-up: Supabase creates the account on a
    // provider's first-ever login automatically, no separate flow needed.
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    // On success the browser navigates away to the provider immediately, so
    // there's nothing more to do here — only failure to even start the OAuth
    // redirect lands back in this component.
    if (error) {
      setError(error.message);
      setOauthLoading(null);
    }
  };

  const handlePasswordSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) setError(error.message);
    // On success, AuthContext's onAuthStateChange picks up the new session
    // and the Navigate above takes over on re-render.
  };

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords don’t match.');
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Whether this lands you in immediately or asks you to confirm your email
    // first depends on the project's Auth setting (Confirm email, on by
    // default) — signUp() returns a session only when confirmation isn't
    // required. Either way, this account only gets into the dashboard shell;
    // it has no product access until that's granted separately.
    if (data.session) {
      // AuthContext picks up the session; Navigate above takes over.
      return;
    }
    setConfirmEmailSent(true);
  };

  const handleResetRequest = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setSubmitting(false);
    if (error) setError(error.message);
    else setResetSent(true);
  };

  const heading = { 'sign-in': 'Sign in', 'sign-up': 'Create an account', reset: 'Reset your password' }[mode];
  const subheading = {
    'sign-in': 'Access the Rovty Dashboard.',
    'sign-up':
      'Signing up gets you into the dashboard. Access to a specific product still depends on having an active plan for it.',
    reset: "We'll email you a link to reset it.",
  }[mode];

  return (
    <div className="min-h-screen bg-ink text-paper font-archivo flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-[420px]">
        <a href="https://rovty.com" className="flex justify-center mb-10">
          <img src="/rovty-logo.png" alt="Rovty" className="h-7 w-auto brightness-0 invert" />
        </a>

        <div className="border-2 border-line-700 bg-ink px-7 py-9 sm:px-9 sm:py-10">
          <h1 className="text-2xl font-extrabold tracking-[-0.02em] mb-1.5 text-paper">{heading}</h1>
          <p className="text-sm text-line-400 mb-7">{subheading}</p>

          {error && (
            <p className="mb-5 text-sm text-red-400 bg-red-950/50 border-2 border-red-900 px-3.5 py-2.5">{error}</p>
          )}

          {mode === 'sign-in' && (
            <>
              <OAuthButtons oauthLoading={oauthLoading} onSelect={handleOAuth} />

              <div className="flex items-center gap-4 mb-6">
                <div className="h-px flex-1 bg-line-700" />
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-line-500">
                  Or continue with email
                </span>
                <div className="h-px flex-1 bg-line-700" />
              </div>

              <form onSubmit={handlePasswordSignIn} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-[0.04em] text-line-400 mb-2">
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@rovty.com"
                    className={inputClass}
                  />
                </div>
                <div>
                  <div className="flex items-baseline justify-between mb-2">
                    <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-[0.04em] text-line-400">
                      Password
                    </label>
                    <button type="button" onClick={() => switchMode('reset')} className={`text-xs ${linkClass}`}>
                      Forgot?
                    </button>
                  </div>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className={inputClass}
                  />
                </div>
                <button type="submit" disabled={submitting} className={primaryButtonClass}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Sign in
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-line-400">
                Don&rsquo;t have an account?{' '}
                <button type="button" onClick={() => switchMode('sign-up')} className={`font-semibold ${linkClass}`}>
                  Sign up
                </button>
              </p>
            </>
          )}

          {mode === 'sign-up' &&
            (confirmEmailSent ? (
              <p className="text-sm text-line-400">
                Check <span className="text-paper font-semibold">{email}</span> for a confirmation link to finish
                creating your account.
              </p>
            ) : (
              <>
                <OAuthButtons oauthLoading={oauthLoading} onSelect={handleOAuth} />

                <div className="flex items-center gap-4 mb-6">
                  <div className="h-px flex-1 bg-line-700" />
                  <span className="text-xs font-semibold uppercase tracking-[0.04em] text-line-500">
                    Or sign up with email
                  </span>
                  <div className="h-px flex-1 bg-line-700" />
                </div>

                <form onSubmit={handleSignUp} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="signup-email" className="block text-xs font-semibold uppercase tracking-[0.04em] text-line-400 mb-2">
                      Email
                    </label>
                    <input
                      id="signup-email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@rovty.com"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="signup-password" className="block text-xs font-semibold uppercase tracking-[0.04em] text-line-400 mb-2">
                      Password
                    </label>
                    <input
                      id="signup-password"
                      name="password"
                      type="password"
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="signup-confirm-password" className="block text-xs font-semibold uppercase tracking-[0.04em] text-line-400 mb-2">
                      Confirm password
                    </label>
                    <input
                      id="signup-confirm-password"
                      name="confirmPassword"
                      type="password"
                      required
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className={inputClass}
                    />
                  </div>
                  <button type="submit" disabled={submitting} className={primaryButtonClass}>
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Create account
                  </button>
                </form>

                <p className="mt-6 text-center text-sm text-line-400">
                  Already have an account?{' '}
                  <button type="button" onClick={() => switchMode('sign-in')} className={`font-semibold ${linkClass}`}>
                    Sign in
                  </button>
                </p>
              </>
            ))}

          {mode === 'reset' &&
            (resetSent ? (
              <p className="text-sm text-line-400">
                If an account exists for <span className="text-paper font-semibold">{email}</span>, a reset link is
                on its way.
              </p>
            ) : (
              <form onSubmit={handleResetRequest} className="space-y-4" noValidate>
                <div>
                  <label htmlFor="reset-email" className="block text-xs font-semibold uppercase tracking-[0.04em] text-line-400 mb-2">
                    Email
                  </label>
                  <input
                    id="reset-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@rovty.com"
                    className={inputClass}
                  />
                </div>
                <button type="submit" disabled={submitting} className={primaryButtonClass}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Send reset link
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('sign-in')}
                  className={`w-full text-center text-sm ${linkClass}`}
                >
                  Back to sign in
                </button>
              </form>
            ))}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
