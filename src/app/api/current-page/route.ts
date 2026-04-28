import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')?.toUpperCase();
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const supabase = createClient();

  const { count } = await supabase
    .from('synthesis_results')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', projectId);

  const { data, error } = await supabase
    .from('synthesis_results')
    .select('id, html_content, attribution_map, created_at')
    .eq('room_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) return NextResponse.json({ current: null, versionCount: 0 });

  const meta = (data.attribution_map ?? {}) as Record<string, string>;
  return NextResponse.json({
    current: {
      id: data.id,
      html: data.html_content,
      summary: meta.summary ?? '',
      requirementId: meta.requirement_id ?? '',
      agentName: meta.agent_name ?? '',
      createdAt: data.created_at,
      versionNumber: count ?? 1,
    },
    versionCount: count ?? 0,
  });
}
