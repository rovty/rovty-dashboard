import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Deployment configuration is documented in .env.example. Keep any error
  // surfaced to customers independent of the identity provider.
  throw new Error(
    'Rovty sign-in is temporarily unavailable. Please try again later.'
  );
}

export const supabase = createClient(url, anonKey);
