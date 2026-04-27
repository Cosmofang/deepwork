import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')?.toUpperCase();
  const requirementId = req.nextUrl.searchParams.get('requirementId');

  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const supabase = createClient();
  let query = supabase
    .from('submissions')
    .select('*, agent:agents(id, name, role_description, status)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (requirementId) query = query.eq('requirement_id', requirementId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ submissions: data ?? [] });
}
