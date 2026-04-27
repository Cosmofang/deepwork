import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseServerConfigStatus } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    projectId?: string;
    content?: string;
    postedBy?: string;
  };

  const projectId = body.projectId?.trim().toUpperCase();
  const content = body.content?.trim();
  const postedBy = body.postedBy?.trim() || 'Panel';

  if (!projectId || !content) {
    return NextResponse.json({ error: 'projectId and content are required' }, { status: 400 });
  }

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createClient();

  const { data: requirement, error } = await supabase
    .from('requirements')
    .insert({ project_id: projectId, content, posted_by: postedBy })
    .select()
    .single();

  if (error || !requirement) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
  }

  return NextResponse.json({ requirement });
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')?.toUpperCase();
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const configStatus = getSupabaseServerConfigStatus();
  if (!configStatus.ready) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('requirements')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requirements: data ?? [] });
}
