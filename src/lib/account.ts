import type { User } from '@supabase/supabase-js';

/** OAuth providers use different name fields; email is an honest fallback. */
export function accountName(user: User | null): string {
  for (const value of [user?.user_metadata?.full_name, user?.user_metadata?.name, user?.user_metadata?.display_name]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return user?.email || 'Signed in';
}
