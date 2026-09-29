import type { User } from '@supabase/supabase-js';

/** Identify the signed-in account by its email for every sign-in provider. */
export function accountEmail(user: User | null): string {
  return user?.email?.trim() || 'Signed in';
}
