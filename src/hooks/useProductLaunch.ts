import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { findProduct } from '../lib/products';

export function useProductLaunch() {
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      pending.current?.abort();
      pending.current = null;
      setOpening(null);
    };
    window.addEventListener('pageshow', reset);
    return () => {
      pending.current?.abort();
      pending.current = null;
      window.removeEventListener('pageshow', reset);
    };
  }, []);

  const open = useCallback(async (slug: string, replace = false) => {
    if (pending.current || !findProduct(slug)) return;
    const controller = new AbortController();
    pending.current = controller;
    setOpening(slug);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      if (!session) throw new Error('Your session expired. Sign in again to open this app.');
      // Entitlements are rechecked by the Worker for every launch.
      const response = await fetch('/api/sso/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ product: slug }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !body.url) throw new Error(body.error || 'Could not open this app. Please try again.');
      // Direct /open links replace the interstitial, so Back never relaunches it.
      if (replace) window.location.replace(body.url);
      else window.location.assign(body.url);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error && failure.message !== 'Failed to fetch' ? failure.message : 'Couldn’t connect. Please try again.');
      setOpening(null);
      pending.current = null;
    }
  }, []);

  return { opening, error, open };
}
