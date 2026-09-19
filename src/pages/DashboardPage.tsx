import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { PRODUCTS, type Product } from '../lib/products';
import AppShell from '../components/AppShell';
import { Alert, Badge, Button, ButtonLink, Panel, PanelHeader, SkeletonRows, kickerClass } from '../components/ui';

type AccessStatus = 'active' | 'inactive';
type AccessState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; access: Record<string, AccessStatus> };

const DashboardPage = () => {
  const { user } = useAuth();
  const [state, setState] = useState<AccessState>({ kind: 'loading' });
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const loadAccess = async (userId: string) => {
    const { data, error } = await supabase.from('product_access').select('product, status').eq('user_id', userId);
    if (error) {
      setState({ kind: 'error', message: error.message });
      return;
    }
    setState({ kind: 'ready', access: Object.fromEntries((data ?? []).map((r) => [r.product, r.status as AccessStatus])) });
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    void loadAccess(user.id).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Cross-Worker SSO hand-off: the dashboard Worker re-checks product_access
  // server-side and mints a short-lived signed token only if it's active —
  // this call can't be used to reach a product you're not entitled to.
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
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setOpenError(body.error ?? 'Could not open that product.');
        setOpening(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setOpenError('Network error — please try again.');
      setOpening(null);
    }
  };

  const activeCount = state.kind === 'ready' ? Object.values(state.access).filter((s) => s === 'active').length : 0;

  return (
    <AppShell>
      <header className="mb-8 sm:mb-10">
        <p className={`${kickerClass} mb-2`}>Your account</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-[-0.02em]">Products</h1>
        <p className="mt-2 text-line-700 max-w-[56ch]">
          Everything Rovty makes runs on this one account. Open a product you own, or learn about the ones you don't yet.
        </p>
      </header>

      {openError && (
        <div className="mb-6">
          <Alert>{openError}</Alert>
        </div>
      )}

      <Panel>
        <PanelHeader
          kicker={state.kind === 'ready' ? `${activeCount} of ${PRODUCTS.length} active` : undefined}
          title="Rovty products"
        />
        {state.kind === 'loading' && <SkeletonRows rows={PRODUCTS.length} />}
        {state.kind === 'error' && (
          <div className="px-5 py-6 sm:px-6 space-y-4">
            <Alert>We couldn't load your product access: {state.message}</Alert>
            <Button variant="secondary" onClick={() => user && void loadAccess(user.id)}>
              Try again
            </Button>
          </div>
        )}
        {state.kind === 'ready' && (
          <ul className="divide-y-2 divide-line-300">
            {PRODUCTS.map((product) => (
              <ProductRow
                key={product.slug}
                product={product}
                active={state.access[product.slug] === 'active'}
                opening={opening === product.slug}
                onOpen={() => void openProduct(product.slug)}
              />
            ))}
          </ul>
        )}
      </Panel>

      <section className="mt-10 grid sm:grid-cols-2 gap-6">
        <div className="border-t-2 border-line-300 pt-4">
          <p className={`${kickerClass} mb-2`}>Signed in as</p>
          <p className="font-semibold break-all">{user?.email}</p>
        </div>
        <div className="border-t-2 border-line-300 pt-4">
          <p className={`${kickerClass} mb-2`}>Need help?</p>
          <p className="text-sm text-line-700 leading-relaxed">
            Email{' '}
            <a href="mailto:hello@rovty.com" className="text-ink font-semibold underline underline-offset-[3px]">
              hello@rovty.com
            </a>{' '}
            — we reply within one business day.
          </p>
        </div>
      </section>
    </AppShell>
  );
};

function ProductRow({
  product,
  active,
  opening,
  onOpen,
}: {
  product: Product;
  active: boolean;
  opening: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="px-5 py-6 sm:px-6 flex flex-col sm:flex-row sm:items-center gap-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-extrabold tracking-[-0.01em]">{product.name}</h3>
          <Badge tone={active ? 'active' : 'locked'}>{active ? 'Active' : 'Not active'}</Badge>
        </div>
        <p className="mt-1.5 text-sm text-line-700 leading-relaxed max-w-[60ch]">{product.description}</p>
      </div>
      <div className="flex flex-wrap gap-3 sm:shrink-0">
        {active ? (
          <Button onClick={onOpen} loading={opening} className="w-full sm:w-auto">
            Open {product.name}
          </Button>
        ) : (
          <>
            <ButtonLink href={product.pricingUrl} className="w-full sm:w-auto">
              Get {product.name}
            </ButtonLink>
            <ButtonLink href={product.productUrl} variant="ghost" className="w-full sm:w-auto">
              Learn more <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </ButtonLink>
          </>
        )}
      </div>
    </li>
  );
}

export default DashboardPage;
