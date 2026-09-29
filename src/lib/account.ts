import type { User } from '@supabase/supabase-js';

/** Keep email inside the account menu when no profile name is available. */
export function accountName(user: User | null): string {
  for (const value of [user?.user_metadata?.full_name, user?.user_metadata?.name, user?.user_metadata?.display_name]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'Your account';
}

/** Identify the signed-in account by its email for every sign-in provider. */
export function accountEmail(user: User | null): string {
  return user?.email?.trim() || 'Signed in';
}
