import { useEffect } from 'react';
import { ArrowUpRight, Check, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AVAILABLE_PRODUCTS, type AvailableProduct } from '../lib/products';
import { useProductAccess } from '../hooks/useProductAccess';
import { useProductLaunch } from '../hooks/useProductLaunch';
import AppShell from '../components/AppShell';
import ProductArtwork from '../components/ProductArtwork';
import { Alert, Button, ButtonLink } from '../components/ui';

export default function DashboardPage() {
  const { user } = useAuth();
  const { state, retry } = useProductAccess(user?.id);
  const { opening, error: openError, open } = useProductLaunch();
  const activeProducts = state.kind === 'ready'
    ? AVAILABLE_PRODUCTS.filter((product) => state.access[product.slug] === 'active')
    : [];
  const otherProducts = state.kind === 'ready'
    ? AVAILABLE_PRODUCTS.filter((product) => state.access[product.slug] !== 'active')
    : [];

  useEffect(() => { document.title = 'Your workspace | Rovty'; }, []);
  const openProduct = (slug: string) => {
    if (state.kind === 'ready' && state.access[slug] === 'active') void open(slug);
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
