import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: ReturnType<typeof createSupabaseClient<any>> | null = null;

export function createClient() {
  if (!client) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client = createSupabaseClient<any>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}
