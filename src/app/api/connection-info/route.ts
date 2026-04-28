import { NextResponse } from 'next/server';

// Returns the Supabase config the panel itself uses, so CLI / SDK clients can
// subscribe to Realtime postgres_changes directly (no more 5 s HTTP polling).
// Both values are already shipped to every browser that loads the panel
// (`NEXT_PUBLIC_*`), so exposing them here adds no new attack surface.
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: 'Supabase public config missing on server' },
      { status: 503 },
    );
  }

  return NextResponse.json({ supabaseUrl, supabaseAnonKey });
}
