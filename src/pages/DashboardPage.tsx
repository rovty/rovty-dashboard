import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { AVAILABLE_PRODUCTS, findProduct, type AvailableProduct } from '../lib/products';
import { useProductAccess } from '../hooks/useProductAccess';
import AppShell from '../components/AppShell';
import ProductArtwork from '../components/ProductArtwork';
import { Alert, Button, ButtonLink } from '../components/ui';

export default function DashboardPage() {
  const { user } = useAuth();
  const { state, retry } = useProductAccess(user?.id);
  const [opening, setOpening] = useState<string | null>(null);
  const openingRef = useRef(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const activeProducts = state.kind === 'ready'
    ? AVAILABLE_PRODUCTS.filter((product) => state.access[product.slug] === 'active')
    : [];
  const otherProducts = state.kind === 'ready'
    ? AVAILABLE_PRODUCTS.filter((product) => state.access[product.slug] !== 'active')
    : [];

  useEffect(() => {
    document.title = 'Your workspace | Rovty';
    const resetOpening = () => {
      openingRef.current = false;
      setOpening(null);
    };
    // Returning from a product via browser Back can restore a bfcache page.
    window.addEventListener('pageshow', resetOpening);
    return () => window.removeEventListener('pageshow', resetOpening);
  }, []);

  // Keep the existing server-verified SSO hand-off. Catalog visibility is
  // independent from entitlement; planned products can never be launched.
  const openProduct = async (slug: string) => {
    if (openingRef.current || !findProduct(slug) || state.kind !== 'ready' || state.access[slug] !== 'active') return;
    openingRef.current = true;
    setOpenError(null);
    setOpening(slug);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Your session expired. Refresh and sign in again.');
      const res = await fetch('/api/sso/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ product: slug }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? 'Could not open that product. Please try again.');
      window.location.assign(body.url);
    } catch (error) {
      setOpenError(error instanceof Error && error.message !== 'Failed to fetch' ? error.message : 'Couldn’t connect. Check your connection and try again.');
      setOpening(null);
      openingRef.current = false;
    }
  };

  return (
    <AppShell>
      <section id="apps" className="dashboard-apps" aria-labelledby="apps-heading">
        <header className="apps-heading">
          <div>
            <p className="eyebrow">Your Rovty workspace</p>
            <h1 id="apps-heading">Your apps</h1>
            <p className="apps-description">{state.kind === 'ready' && activeProducts.length === 0 ? 'Choose an app to get started.' : 'Open an app and pick up where you left off.'}</p>
          </div>
          {state.kind === 'ready' && activeProducts.length > 0 && <span className="apps-count">{activeProducts.length} {activeProducts.length === 1 ? 'app' : 'apps'} ready to open</span>}
        </header>

        {openError && <div className="launch-error"><Alert>{openError}</Alert></div>}
        {state.kind === 'loading' && (
          <div className="app-loading" role="status" aria-label="Loading your apps" aria-busy="true">
            <div className="app-loading-art animate-pulse" />
            <div className="app-loading-content animate-pulse"><div /><div /><div /></div>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="access-error" role="alert">
            <div><strong>We couldn’t load your apps.</strong><p>Check your connection and try again.</p></div>
            <button type="button" onClick={retry}><RefreshCw size={16} aria-hidden="true" />Try again</button>
          </div>
        )}
        {state.kind === 'ready' && (
          <>
            {activeProducts.length > 0 && (
              <div className={`product-grid ${activeProducts.length === 1 ? 'single-app' : ''}`}>
                {activeProducts.map((product) => <ProductPanel key={product.slug} product={product} active opening={opening === product.slug} disabled={opening !== null} onOpen={() => void openProduct(product.slug)} />)}
              </div>
            )}
            {otherProducts.length > 0 && (
              <section className={activeProducts.length > 0 ? 'explore-apps' : ''} aria-label="Available apps">
                {activeProducts.length > 0 && <h2>Explore apps</h2>}
                <div className={`product-grid ${otherProducts.length === 1 ? 'single-app' : ''}`}>
                  {otherProducts.map((product) => <ProductPanel key={product.slug} product={product} active={false} opening={false} disabled={opening !== null} onOpen={() => void openProduct(product.slug)} />)}
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}

function ProductPanel({ product, active, opening, disabled, onOpen }: { product: AvailableProduct; active: boolean; opening: boolean; disabled: boolean; onOpen: () => void }) {
  return (
    <article className="product-panel" aria-labelledby={`product-${product.slug}`}>
      <ProductArtwork product={product.slug} />
      <div className="product-panel-content">
        <span className={`product-status ${active ? 'status-active' : ''}`}>{active && <Check size={13} aria-hidden="true" />}{active ? 'You have access' : 'Available now'}</span>
        <h2 id={`product-${product.slug}`}>{product.name}</h2>
        <p className="product-description">{product.description}</p>
        <div className="product-actions">
          {active ? (
            <Button onClick={onOpen} loading={opening} disabled={disabled} className="product-launch">{opening ? `Opening ${product.name}…` : `Open ${product.name}`}<ArrowUpRight size={17} aria-hidden="true" /></Button>
          ) : (
            <><ButtonLink href={product.pricingUrl} className="product-launch">Get {product.name}<ArrowUpRight size={17} aria-hidden="true" /></ButtonLink><a href={product.productUrl} className="text-link">Learn more<ArrowUpRight size={15} aria-hidden="true" /></a></>
          )}
        </div>
      </div>
    </article>
  );
}
