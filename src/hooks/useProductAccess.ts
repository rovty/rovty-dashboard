import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type AccessState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; access: Record<string, 'active' | 'inactive'> };

export function useProductAccess(userId: string | undefined) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ userId: string; state: AccessState } | null>(null);
  const retry = useCallback(() => {
    setResult(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setAttempt((value) => value + 1);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();

    async function load() {
      try {
        const { data, error } = await supabase
          .from('product_access')
          .select('product, status, expires_at')
          .eq('user_id', userId!)
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        const state: AccessState = error
          ? { kind: 'error' }
          : {
              kind: 'ready',
              access: Object.fromEntries((data ?? []).map((row) => [row.product, row.status === 'active' && (!row.expires_at || Date.parse(row.expires_at) > Date.now()) ? 'active' : 'inactive'])),
            };
        setResult({ userId: userId!, state });
      } catch {
        if (!controller.signal.aborted) setResult({ userId: userId!, state: { kind: 'error' } });
      }
    }

    void load();
    return () => controller.abort();
  }, [userId, attempt]);

  // Never show the previous account's entitlements during a session change.
  const state: AccessState = result?.userId === userId && result ? result.state : { kind: 'loading' };
  return { state, retry };
}
