import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getSupabaseServerConfigStatus() {
  return {
    hasUrl: Boolean(SUPABASE_URL),
    hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    ready: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
  };
}

export function createClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase server environment is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.'
    );
  }

  return createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}
