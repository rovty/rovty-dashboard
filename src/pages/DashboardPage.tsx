import { useEffect, useState } from 'react';
import { Lock, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { PRODUCTS } from '../lib/products';

type AccessStatus = 'active' | 'inactive';

// Starting shell for the authenticated app — real dashboard content replaces
// this; what matters for now is that ProtectedRoute is guarding it, sign-out
// works, and product access reads from product_access rather than just
// "is signed in" (see supabase/migrations/0001_product_access.sql).
const DashboardPage = () => {
  const { user, signOut } = useAuth();
  const [access, setAccess] = useState<Record<string, AccessStatus>>({});
  const [loadingAccess, setLoadingAccess] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // Cross-Worker SSO hand-off: rovty-wed runs in its own Worker with its own
  // Supabase project, so it can't see this session at all on its own. The
  // dashboard's own Worker (worker/index.ts, not this client code) re-checks
  // product_access server-side and mints a short-lived signed token only if
  // it's active — this call can't be used to reach a product you're not
  // entitled to, the check happens on the server that issues the token, not
  // here.
  const openProduct = async (slug: string) => {
    setOpenError(null);
    setOpening(slug);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setOpenError('Your session expired — refresh and sign in again.');
      setOpening(null);
      return;
    }
    try {
      const res = await fetch('/api/sso/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ product: slug }),
      });
      const body = await res.json();
      if (!res.ok) {
        setOpenError(body.error ?? 'Could not open that product.');
        setOpening(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setOpenError('Network error — try again.');
      setOpening(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    supabase
      .from('product_access')
      .select('product, status')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) {
          setAccess(Object.fromEntries(data.map((row) => [row.product, row.status as AccessStatus])));
        }
        setLoadingAccess(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <div className="min-h-screen bg-paper text-ink font-archivo">
      <header className="sticky top-0 z-50 bg-ink border-b-2 border-line-700">
        <div className="max-w-[1240px] mx-auto px-5 sm:px-8 flex items-center justify-between h-[72px]">
          <a href="https://rovty.com" className="flex items-center shrink-0">
            <img src="/rovty-logo.png" alt="Rovty" className="h-[26px] w-auto brightness-0 invert" />
          </a>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-[12px] font-semibold tracking-[0.04em] uppercase text-line-300">
              {user?.email}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-[12px] font-semibold tracking-[0.04em] uppercase whitespace-nowrap bg-paper text-ink px-[18px] py-[11px] hover:bg-line-300 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1240px] mx-auto px-5 sm:px-8 py-16">
        <h1 className="text-3xl font-extrabold tracking-[-0.02em] mb-2">Dashboard</h1>
        <p className="text-line-700 mb-12">
          Signed in as <span className="text-ink font-semibold">{user?.email}</span>.
        </p>

        <h2 className="text-xs font-semibold uppercase tracking-[0.04em] text-line-700 mb-4">Products</h2>

        {openError && (
          <p className="mb-4 text-sm text-red-700 bg-red-50 border-2 border-red-200 px-3.5 py-2.5">{openError}</p>
        )}

        {loadingAccess ? (
          <p className="flex items-center gap-2 text-sm text-line-700">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your access…
          </p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {PRODUCTS.map((product) => {
              const isActive = access[product.slug] === 'active';
              return (
                <div key={product.slug} className="border-2 border-ink p-6 flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-extrabold text-lg tracking-[-0.01em]">{product.name}</h3>
                      <p className="text-sm text-line-700 mt-1">{product.tagline}</p>
                    </div>
                    {isActive ? (
                      <CheckCircle2 className="h-5 w-5 text-green-700 shrink-0" aria-label="Active" />
                    ) : (
                      <Lock className="h-5 w-5 text-line-500 shrink-0" aria-label="Locked" />
                    )}
                  </div>
                  {isActive ? (
                    <button
                      type="button"
                      onClick={() => void openProduct(product.slug)}
                      disabled={opening === product.slug}
                      className="self-start flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold uppercase tracking-[0.04em] bg-ink text-paper hover:bg-line-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {opening === product.slug && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Open {product.name}
                    </button>
                  ) : (
                    <a
                      href={product.pricingUrl}
                      className="self-start px-4 py-2.5 text-xs font-extrabold uppercase tracking-[0.04em] bg-ink text-paper hover:bg-line-800 transition-colors"
                    >
                      Get {product.name}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default DashboardPage;
