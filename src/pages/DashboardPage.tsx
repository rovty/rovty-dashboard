import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Heart, MessageSquare, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { PRODUCTS, findProduct, type Product } from '../lib/products';
import { useProductAccess, type AccessState } from '../hooks/useProductAccess';
import AppShell from '../components/AppShell';
import ProductArtwork from '../components/ProductArtwork';
import { Alert, Button, ButtonLink } from '../components/ui';

type ProductFilter = 'all' | 'access' | 'planned';
const plannedCount = PRODUCTS.filter((product) => product.availability === 'planned').length;

export default function DashboardPage() {
  const { user } = useAuth();
  const { state, retry } = useProductAccess(user?.id);
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [opening, setOpening] = useState<string | null>(null);
  const openingRef = useRef(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const displayName: unknown = user?.user_metadata?.full_name ?? user?.user_metadata?.name;
  const firstName = typeof displayName === 'string' ? displayName.trim().split(/\s+/)[0] : '';
  const activeProducts = state.kind === 'ready'
    ? PRODUCTS.filter((product) => product.availability === 'available' && state.access[product.slug] === 'active')
    : [];
  const visibleProducts = PRODUCTS.filter((product) => filter === 'all' || (filter === 'planned' ? product.availability === 'planned' : activeProducts.includes(product)));

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
      <section id="overview" className="dashboard-intro">
        <div>
          <p className="eyebrow intro-greeting">{firstName ? `Welcome back, ${firstName}` : 'Welcome to your workspace'}</p>
          <h1>Your Rovty.<br /><span>All in one place.</span></h1>
          <p className="intro-description">Pick up where you left off.<br className="sm:hidden" /> Discover what comes next.</p>
        </div>
        <div className="workspace-summary">
          <div className="summary-row">
            <span className="summary-number" aria-hidden="true">{state.kind === 'ready' ? String(activeProducts.length).padStart(2, '0') : '—'}</span>
            <span aria-live="polite">{state.kind === 'ready' ? `${activeProducts.length} ${activeProducts.length === 1 ? 'product' : 'products'} available to you` : state.kind === 'loading' ? 'Checking your access' : 'Access unavailable'}</span>
          </div>
          <div className="summary-row"><span className="summary-number muted" aria-hidden="true">{String(plannedCount).padStart(2, '0')}</span><span>{plannedCount} {plannedCount === 1 ? 'product' : 'products'} in development</span></div>
          {activeProducts[0] ? (
            <Button variant="onInk" className="summary-launch" loading={opening === activeProducts[0].slug} disabled={opening !== null} onClick={() => void openProduct(activeProducts[0].slug)}>
              {opening === activeProducts[0].slug ? 'Opening product…' : `Continue in ${activeProducts[0].name}`}<ArrowUpRight size={15} aria-hidden="true" />
            </Button>
          ) : <a href="#products" className="summary-link">Explore your products<ArrowDown size={15} aria-hidden="true" /></a>}
        </div>
      </section>

      <section id="products" className="dashboard-products" aria-labelledby="products-heading">
        <div className="section-heading">
          <div><p className="eyebrow">The Rovty collection</p><h2 id="products-heading">Your products</h2></div>
          <p>One account. Everything connected.</p>
        </div>
        <div className="product-filters" role="group" aria-label="Filter products">
          {([
            { value: 'all', label: 'All products', count: PRODUCTS.length },
            { value: 'access', label: 'Your access', count: state.kind === 'ready' ? activeProducts.length : '—' },
            { value: 'planned', label: 'Coming next', count: plannedCount },
          ] as const).map(({ value, label, count }) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>
          ))}
        </div>

        {state.kind === 'error' && (
          <div className="access-error" role="alert"><div><strong>We couldn’t check your product access.</strong><p>Your products are still here. Try reconnecting to open them.</p></div><button type="button" onClick={retry}><RefreshCw size={15} aria-hidden="true" />Try again</button></div>
        )}
        {openError && <div className="mb-5"><Alert>{openError}</Alert></div>}

        {filter === 'access' && state.kind === 'loading' ? (
          <div className="product-loading" role="status" aria-label="Loading your products"><div className="animate-pulse"><div /><div /><div /></div></div>
        ) : filter === 'access' && state.kind === 'error' ? (
          <div className="product-empty"><RefreshCw size={28} strokeWidth={1.2} aria-hidden="true" /><h3>Your access will appear here.</h3><p>Reconnect using “Try again” above.</p></div>
        ) : visibleProducts.length === 0 ? (
          <div className="product-empty"><Heart size={30} strokeWidth={1.2} aria-hidden="true" /><h3>Your next chapter starts here.</h3><p>You don’t have an active product yet. Explore Rovty Wed to get started.</p><Button variant="onInk" onClick={() => setFilter('all')}>Explore products<ArrowRight size={16} aria-hidden="true" /></Button></div>
        ) : (
          <div className="product-grid">
            {visibleProducts.map((product) => <ProductPanel key={product.slug} product={product} access={state} opening={opening === product.slug} disabled={opening !== null} onOpen={() => void openProduct(product.slug)} />)}
          </div>
        )}
        <p className="collection-note"><span className="collection-note-rule" />A growing family of products. Always one Rovty account.</p>
      </section>

      <section id="account" className="dashboard-account" aria-labelledby="account-heading">
        <div className="account-details"><p className="eyebrow">Made for you</p><h2 id="account-heading">Your account</h2><p className="account-email">{user?.email}</p><p className="account-description">Your sign-in connects you to every Rovty product you have access to.</p><a href="https://rovty.com/security" className="text-link">Account security<ArrowUpRight size={15} aria-hidden="true" /></a></div>
        <div className="account-support"><p className="eyebrow">A little help goes a long way</p><h3>We’re here for you.</h3><p>Need a hand with your access or choosing a product? Talk to the people building Rovty.</p><a href="mailto:hello@rovty.com" className="text-link">hello@rovty.com<ArrowUpRight size={16} aria-hidden="true" /></a></div>
      </section>
    </AppShell>
  );
}

function ProductPanel({ product, access, opening, disabled, onOpen }: { product: Product; access: AccessState; opening: boolean; disabled: boolean; onOpen: () => void }) {
  const planned = product.availability === 'planned';
  const active = !planned && access.kind === 'ready' && access.access[product.slug] === 'active';
  const Icon = product.slug === 'wed' ? Heart : MessageSquare;
  return (
    <article className={`product-panel ${planned ? 'product-planned' : 'product-available'}`} aria-labelledby={`product-${product.slug}`}>
      <ProductArtwork product={product.slug} />
      <div className="product-panel-content">
        <div className="product-meta"><span><Icon size={15} strokeWidth={1.7} aria-hidden="true" />{planned ? 'Conversations & automation' : 'Invitations & celebrations'}</span><span className={`product-status ${active ? 'status-active' : ''}`}>{active && <Check size={12} aria-hidden="true" />}{planned ? 'In development' : access.kind === 'loading' ? 'Checking access…' : access.kind === 'error' ? 'Access unavailable' : active ? 'You have access' : 'Available now'}</span></div>
        <h3 id={`product-${product.slug}`}>{product.name}</h3>
        <p className="product-tagline">{product.tagline}</p>
        <p className="product-description">{product.description}</p>
        <div className="product-actions">
          {product.availability === 'planned' ? (
            <a href={product.productUrl} className="text-link">Preview {product.name}<ArrowUpRight size={17} aria-hidden="true" /></a>
          ) : access.kind !== 'ready' ? (
            <Button disabled className="product-launch">{access.kind === 'loading' ? 'Checking your access…' : 'Reconnect to check access'}</Button>
          ) : active ? (
            <Button onClick={onOpen} loading={opening} disabled={disabled} className="product-launch">{opening ? `Opening ${product.name}…` : `Open ${product.name}`}<ArrowUpRight size={17} aria-hidden="true" /></Button>
          ) : (
            <><ButtonLink href={product.pricingUrl} className="product-launch">Get {product.name}<ArrowUpRight size={17} aria-hidden="true" /></ButtonLink><a href={product.productUrl} className="text-link">Learn more<ArrowUpRight size={15} aria-hidden="true" /></a></>
          )}
        </div>
      </div>
    </article>
  );
}
