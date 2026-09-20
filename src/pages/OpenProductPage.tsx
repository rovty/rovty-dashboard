import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { findProduct } from '../lib/products';
import { useAuth } from '../context/AuthContext';
import { useProductAccess } from '../hooks/useProductAccess';
import { useProductLaunch } from '../hooks/useProductLaunch';
import { Alert, Button, ButtonLink } from '../components/ui';

export default function OpenProductPage() {
  const { product: slug = '' } = useParams();
  const product = findProduct(slug);
  const { user } = useAuth();
  const { state, retry } = useProductAccess(user?.id);
  const { open, opening, error } = useProductLaunch();
  const attempted = useRef(false);
  const active = state.kind === 'ready' && state.access[slug] === 'active';

  useEffect(() => {
    if (!product || !active || attempted.current) return;
    // Defer until effects settle: React StrictMode must not mint twice.
    const timer = window.setTimeout(() => {
      attempted.current = true;
      void open(slug, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, product, slug, open]);

  return (
    <main className="min-h-dvh bg-ink text-paper grid place-items-center p-6">
      <div className="w-full max-w-md">
        <p className="text-xs uppercase tracking-[.18em] text-line-400 mb-5">Rovty</p>
        <h1 className="text-3xl font-semibold tracking-tight mb-4">{product ? product.name : 'App unavailable'}</h1>
        {!product ? <p>This app isn’t available yet.</p> : state.kind === 'error' ? (
          <><Alert>We couldn’t check your access.</Alert><Button variant="onInk" onClick={retry} className="mt-4">Try again</Button></>
        ) : error ? (
          <><Alert>{error}</Alert><Button variant="onInk" onClick={() => void open(slug, true)} className="mt-4">Try again</Button></>
        ) : state.kind === 'ready' && !active ? (
          <><p className="text-line-300 mb-5">This account doesn’t have access to {product.name} yet.</p><ButtonLink href={product.pricingUrl} variant="onInk">See plans</ButtonLink></>
        ) : active && attempted.current && !opening ? (
          <Button variant="onInk" onClick={() => void open(slug, true)}>Continue to {product.name}</Button>
        ) : (
          <p role="status" className="flex items-center gap-3 text-line-300"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{opening ? 'Opening your app…' : 'Checking your access…'}</p>
        )}
        <Link to="/" replace className="inline-flex items-center gap-2 min-h-11 mt-6 text-sm text-line-300 hover:text-paper"><ArrowLeft size={16} aria-hidden="true" />All apps</Link>
      </div>
    </main>
  );
}
