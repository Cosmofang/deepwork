'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { Agent, Requirement, Submission } from '@/types';

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function truncate(str: string, n: number) {
  return str.length > n ? str.slice(0, n) + '...' : str;
}

export default function PanelPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = id.toUpperCase();

  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [submissions, setSubmissions] = useState<(Submission & { agent?: Agent })[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeReqId, setActiveReqId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [posting, setPosting] = useState(false);
  const [viewingHtml, setViewingHtml] = useState<string | null>(null);
  const [viewingSubmission, setViewingSubmission] = useState<Submission | null>(null);
  const [, setTick] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userName = typeof window !== 'undefined' ? localStorage.getItem('user_name') ?? 'Panel' : 'Panel';

  // Tick for relative timestamps
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  const loadData = useCallback(async () => {
    const [reqRes, subRes, agentRes] = await Promise.all([
      fetch(`/api/requirements?projectId=${projectId}`),
      fetch(`/api/submissions?projectId=${projectId}`),
      (async () => {
        const supabase = createClient();
        return supabase.from('agents').select('*').eq('project_id', projectId).order('created_at', { ascending: true });
      })(),
    ]);

    const reqData = await reqRes.json() as { requirements: Requirement[] };
    const subData = await subRes.json() as { submissions: (Submission & { agent?: Agent })[] };
    const reqs = reqData.requirements ?? [];
    const subs = subData.submissions ?? [];
    const agts = (agentRes.data ?? []) as Agent[];

    setRequirements(reqs);
    setSubmissions(subs);
    setAgents(agts);
    if (reqs.length > 0 && !activeReqId) setActiveReqId(reqs[0].id);
  }, [projectId, activeReqId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Realtime subscriptions
  useEffect(() => {
    const supabase = createClient();

    const reqChannel = supabase
      .channel(`panel-req-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'requirements', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const r = payload.new as Requirement;
          setRequirements(prev => [r, ...prev]);
          setActiveReqId(r.id);
        }
      )
      .subscribe();

    const subChannel = supabase
      .channel(`panel-sub-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions', filter: `project_id=eq.${projectId}` },
        async (payload) => {
          const s = payload.new as Submission;
          // Fetch agent data
          const { data: agent } = await supabase.from('agents').select('*').eq('id', s.agent_id).maybeSingle();
          setSubmissions(prev => [{ ...s, agent: agent ?? undefined }, ...prev]);
        }
      )
      .subscribe();

    const agentChannel = supabase
      .channel(`panel-agents-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agents', filter: `project_id=eq.${projectId}` },
        (payload) => setAgents(prev => [...prev, payload.new as Agent])
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agents', filter: `project_id=eq.${projectId}` },
        (payload) => setAgents(prev => prev.map(a => a.id === (payload.new as Agent).id ? payload.new as Agent : a))
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(reqChannel);
      void supabase.removeChannel(subChannel);
      void supabase.removeChannel(agentChannel);
    };
  }, [projectId]);

  const postRequirement = async () => {
    const content = input.trim();
    if (!content || posting) return;
    setPosting(true);
    await fetch('/api/requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, content, postedBy: userName }),
    });
    setInput('');
    setPosting(false);
    textareaRef.current?.focus();
  };

  const activeSubmissions = submissions.filter(s => s.requirement_id === activeReqId);
  const workingAgents = agents.filter(a => a.status === 'working');

  return (
    <div className="h-screen bg-[#080808] text-white flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">DeepWork</span>
          <span className="text-white/20 text-xs">·</span>
          <span className="font-mono text-xs text-white/40 bg-white/[0.05] px-2 py-1 rounded">{projectId}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-white/40">
          {workingAgents.length > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400/80">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {workingAgents.length} 个 agent 生成中
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            {agents.length} 个 agent
          </span>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: requirements */}
        <div className="w-72 flex-shrink-0 border-r border-white/[0.07] flex flex-col">
          {/* Post requirement */}
          <div className="p-4 border-b border-white/[0.07]">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postRequirement(); }}
              placeholder="描述你的需求，Agent 会立即开始执行..."
              rows={3}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-white/20 focus:outline-none focus:border-white/20 transition-colors text-sm resize-none"
            />
            <button
              onClick={() => void postRequirement()}
              disabled={!input.trim() || posting}
              className="mt-2 w-full py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', color: '#3b82f6' }}
            >
              {posting ? '发布中...' : '发布需求 ⌘↵'}
            </button>
          </div>

          {/* Requirements list */}
          <div className="flex-1 overflow-y-auto">
            {requirements.length === 0 ? (
              <div className="p-4 text-center text-white/20 text-xs mt-8">
                发布第一条需求<br />Agent 将立即开始执行
              </div>
            ) : (
              <div className="p-2">
                {requirements.map((r, i) => {
                  const subCount = submissions.filter(s => s.requirement_id === r.id).length;
                  const isActive = r.id === activeReqId;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setActiveReqId(r.id)}
                      className="w-full text-left p-3 rounded-xl mb-1 transition-all"
                      style={isActive
                        ? { background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)' }
                        : { border: '1px solid transparent' }
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-white/30 text-[10px] font-mono flex-shrink-0">
                          #{requirements.length - i}
                        </span>
                        {subCount > 0 && (
                          <span className="text-[10px] text-green-400/70 flex-shrink-0">{subCount} 份成品</span>
                        )}
                      </div>
                      <p className="text-xs text-white/70 mt-1 leading-relaxed line-clamp-2">{r.content}</p>
                      <p className="text-[10px] text-white/25 mt-1.5">{timeAgo(r.created_at)}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: submissions */}
        <div className="flex-1 overflow-y-auto">
          {/* Active requirement header */}
          {activeReqId && requirements.find(r => r.id === activeReqId) && (
            <div className="px-6 py-4 border-b border-white/[0.07] bg-white/[0.02]">
              <p className="text-white/40 text-xs mb-1">当前需求</p>
              <p className="text-white/85 text-sm leading-relaxed">
                {requirements.find(r => r.id === activeReqId)?.content}
              </p>
            </div>
          )}

          {/* Submissions grid */}
          <div className="p-5">
            {!activeReqId ? (
              <div className="flex flex-col items-center justify-center h-64 text-white/20 text-sm">
                <div className="text-4xl mb-3">📋</div>
                <p>发布一条需求，Agent 会并行执行</p>
              </div>
            ) : activeSubmissions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-white/20 text-sm">
                {workingAgents.length > 0 ? (
                  <>
                    <div className="w-8 h-8 border-2 border-white/20 border-t-purple-400 rounded-full animate-spin mb-4" />
                    <p>{workingAgents.length} 个 agent 生成中，稍候...</p>
                  </>
                ) : (
                  <>
                    <div className="text-4xl mb-3">⏳</div>
                    <p>等待 Agent 提交成品</p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {/* Working agents placeholder cards */}
                {workingAgents.map(a => (
                  <div key={a.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-sm font-medium text-white/80">{a.name}</span>
                        {a.role_description && <span className="text-xs text-white/30">{a.role_description}</span>}
                      </div>
                      <span className="text-xs text-amber-400/70">生成中...</span>
                    </div>
                    <div className="h-32 bg-black/20 rounded-xl flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-white/10 border-t-amber-400/60 rounded-full animate-spin" />
                    </div>
                  </div>
                ))}

                {/* Completed submissions */}
                {activeSubmissions.map(s => (
                  <div key={s.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 flex flex-col gap-3 hover:border-white/15 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400" />
                        <span className="text-sm font-medium text-white/80">{s.agent?.name ?? '未知 Agent'}</span>
                        {s.agent?.role_description && (
                          <span className="text-xs text-white/30">{s.agent.role_description}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-white/25">{timeAgo(s.created_at)}</span>
                    </div>

                    {s.summary && (
                      <p className="text-xs text-white/50 leading-relaxed">{s.summary}</p>
                    )}

                    {/* Mini preview */}
                    <div className="relative rounded-xl overflow-hidden border border-white/[0.05] bg-black/40" style={{ height: 200 }}>
                      <iframe
                        srcDoc={s.html_content}
                        sandbox="allow-scripts"
                        title={`submission-${s.id}`}
                        className="w-full h-full"
                        style={{ transform: 'scale(0.5)', transformOrigin: 'top left', width: '200%', height: '200%', pointerEvents: 'none' }}
                      />
                      <div className="absolute inset-0" />
                    </div>

                    <button
                      onClick={() => { setViewingHtml(s.html_content); setViewingSubmission(s); }}
                      className="w-full py-2 rounded-xl text-xs font-medium transition-all"
                      style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)', color: '#a855f7' }}
                    >
                      查看完整成品 →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full result modal */}
      {viewingHtml && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setViewingHtml(null); setViewingSubmission(null); }}
                className="text-white/50 hover:text-white transition-colors text-sm"
              >
                ← 返回
              </button>
              {viewingSubmission?.agent && (
                <span className="text-white/40 text-xs">
                  {viewingSubmission.agent.name}
                  {viewingSubmission.agent.role_description && ` · ${viewingSubmission.agent.role_description}`}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                const blob = new Blob([viewingHtml], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
              }}
              className="text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}
            >
              新窗口打开
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe
              srcDoc={viewingHtml}
              sandbox="allow-scripts"
              title="full-result"
              className="w-full h-full border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}
