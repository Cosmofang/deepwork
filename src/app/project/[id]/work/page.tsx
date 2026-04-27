'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { Requirement, Submission, Agent } from '@/types';

type WorkStatus = 'connecting' | 'idle' | 'working' | 'done_waiting';

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function AgentWorkPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = id.toUpperCase();

  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('');
  const [status, setStatus] = useState<WorkStatus>('connecting');
  const [currentReq, setCurrentReq] = useState<Requirement | null>(null);
  const [mySubmissions, setMySubmissions] = useState<Submission[]>([]);
  const [allReqs, setAllReqs] = useState<Requirement[]>([]);
  const [error, setError] = useState('');
  const [viewingHtml, setViewingHtml] = useState<string | null>(null);
  const [autoMode, setAutoMode] = useState(true);
  const [, setTick] = useState(0);

  const processingRef = useRef(false);
  const agentIdRef = useRef<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  // Process a requirement: call /api/generate, track state
  const processRequirement = useCallback(async (req: Requirement, aId: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setStatus('working');
    setCurrentReq(req);
    setError('');

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, requirementId: req.id, agentId: aId }),
      });
      const data = await res.json() as { submission?: Submission; error?: string; submissionId?: string };

      if (res.status === 409) {
        // Already submitted for this requirement
        setStatus('done_waiting');
      } else if (!res.ok || !data.submission) {
        setError(data.error ?? '生成失败，等待下一条需求');
        setStatus('idle');
      } else {
        setMySubmissions(prev => [data.submission!, ...prev]);
        setStatus('done_waiting');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
      setStatus('idle');
    } finally {
      processingRef.current = false;
    }
  }, [projectId]);

  // Find the next unprocessed requirement
  const findUnprocessed = useCallback((reqs: Requirement[], subs: Submission[]) => {
    const submittedReqIds = new Set(subs.map(s => s.requirement_id));
    return reqs.find(r => !submittedReqIds.has(r.id)) ?? null;
  }, []);

  // Bootstrap: get agentId from localStorage, load pending work
  useEffect(() => {
    const stored = localStorage.getItem(`agent_id:${projectId}`);
    const name = localStorage.getItem('user_name') ?? 'Agent';
    setAgentName(name);

    if (!stored) {
      router.replace('/');
      return;
    }

    setAgentId(stored);
    agentIdRef.current = stored;

    const supabase = createClient();

    const init = async () => {
      const [reqRes, subRes, agentRes] = await Promise.all([
        fetch(`/api/requirements?projectId=${projectId}`),
        fetch(`/api/submissions?projectId=${projectId}`),
        supabase.from('agents').select('*').eq('id', stored).maybeSingle(),
      ]);

      const reqData = await reqRes.json() as { requirements: Requirement[] };
      const subData = await subRes.json() as { submissions: Submission[] };
      const reqs = reqData.requirements ?? [];
      const subs = (subData.submissions ?? []).filter((s: Submission) => s.agent_id === stored);

      setAllReqs(reqs);
      setMySubmissions(subs);

      const agent = agentRes.data as Agent | null;
      if (agent) setAgentName(agent.name);

      // If there's an unprocessed requirement and autoMode, start working immediately
      const unprocessed = findUnprocessed(reqs, subs);
      if (unprocessed && autoMode) {
        setStatus('idle');
        void processRequirement(unprocessed, stored);
      } else {
        setStatus('idle');
      }
    };

    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Subscribe to new requirements
  useEffect(() => {
    if (!agentId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`agent-work-${projectId}-${agentId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'requirements', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const req = payload.new as Requirement;
          setAllReqs(prev => [req, ...prev]);
          setCurrentReq(req);

          if (autoMode && !processingRef.current && agentIdRef.current) {
            void processRequirement(req, agentIdRef.current);
          } else {
            setStatus('idle');
          }
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [agentId, projectId, autoMode, processRequirement]);

  // Heartbeat: update last_seen_at every 30s
  useEffect(() => {
    if (!agentId) return;
    const supabase = createClient();
    const beat = setInterval(async () => {
      await supabase.from('agents').update({ last_seen_at: new Date().toISOString() }).eq('id', agentId);
    }, 30000);
    return () => clearInterval(beat);
  }, [agentId]);

  const statusColor = {
    connecting: 'text-white/30',
    idle: 'text-white/50',
    working: 'text-amber-400',
    done_waiting: 'text-green-400',
  }[status];

  const statusLabel = {
    connecting: '连接中...',
    idle: '等待需求...',
    working: '⚡ 生成中...',
    done_waiting: '✓ 已提交，等待下一条需求',
  }[status];

  return (
    <div className="min-h-screen bg-[#080808] text-white flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07]">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">DeepWork</span>
          <span className="text-white/20 text-xs">·</span>
          <span className="font-mono text-xs text-white/40 bg-white/[0.05] px-2 py-1 rounded">{projectId}</span>
          <span className="text-white/20 text-xs">·</span>
          <span className="text-xs text-purple-400/80">{agentName}</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Auto mode toggle */}
          <button
            onClick={() => setAutoMode(m => !m)}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-all border"
            style={autoMode
              ? { background: 'rgba(168,85,247,0.15)', borderColor: 'rgba(168,85,247,0.35)', color: '#a855f7' }
              : { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)' }
            }
          >
            <span>{autoMode ? '⚡' : '⏸'}</span>
            {autoMode ? '自动模式' : '手动模式'}
          </button>
          <a href={`/project/${projectId}`} className="text-xs text-white/30 hover:text-white/60 transition-colors">
            查看面板 →
          </a>
        </div>
      </div>

      <div className="flex-1 max-w-2xl mx-auto w-full px-5 py-8 flex flex-col gap-6">
        {/* Status card */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${status === 'working' ? 'bg-amber-400 animate-pulse' : status === 'done_waiting' ? 'bg-green-400' : 'bg-white/20'}`} />
            <span className={`text-sm font-medium ${statusColor}`}>{statusLabel}</span>
          </div>

          {status === 'working' && (
            <div className="mt-1">
              <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
              </div>
              <p className="text-white/25 text-xs mt-2">Claude 正在分析需求并生成落地页...</p>
            </div>
          )}

          {error && (
            <p className="text-red-400/70 text-xs mt-2">{error}</p>
          )}
        </div>

        {/* Current requirement */}
        {currentReq && (
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
            <p className="text-white/30 text-xs uppercase tracking-wider mb-3">当前需求</p>
            <p className="text-white/80 text-sm leading-relaxed">{currentReq.content}</p>
            <p className="text-white/20 text-xs mt-3">{timeAgo(currentReq.created_at)}</p>
          </div>
        )}

        {/* Manual trigger (when auto is off and there's a pending req) */}
        {!autoMode && status === 'idle' && agentId && (() => {
          const pending = findUnprocessed(allReqs, mySubmissions);
          return pending ? (
            <button
              onClick={() => void processRequirement(pending, agentId)}
              className="w-full py-3 rounded-xl text-sm font-medium transition-all"
              style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.35)', color: '#a855f7' }}
            >
              开始处理需求
            </button>
          ) : null;
        })()}

        {/* My submissions */}
        {mySubmissions.length > 0 && (
          <div>
            <p className="text-white/25 text-xs uppercase tracking-wider mb-3">我的提交记录</p>
            <div className="flex flex-col gap-3">
              {mySubmissions.map(s => {
                const req = allReqs.find(r => r.id === s.requirement_id);
                return (
                  <div key={s.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-green-400 text-xs">✓ 已提交</span>
                      <span className="text-white/20 text-[10px]">{timeAgo(s.created_at)}</span>
                    </div>
                    {req && <p className="text-white/40 text-xs mb-2 line-clamp-1">{req.content}</p>}
                    {s.summary && <p className="text-white/60 text-xs mb-3">{s.summary}</p>}

                    {/* Tiny preview */}
                    <div className="relative rounded-lg overflow-hidden border border-white/[0.05]" style={{ height: 120 }}>
                      <iframe
                        srcDoc={s.html_content}
                        sandbox="allow-scripts"
                        title={`my-sub-${s.id}`}
                        className="w-full h-full"
                        style={{ transform: 'scale(0.4)', transformOrigin: 'top left', width: '250%', height: '250%', pointerEvents: 'none' }}
                      />
                      <div className="absolute inset-0" />
                    </div>
                    <button
                      onClick={() => setViewingHtml(s.html_content)}
                      className="mt-2 w-full py-1.5 rounded-lg text-xs transition-all"
                      style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', color: '#a855f7' }}
                    >
                      查看完整成品
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {mySubmissions.length === 0 && status === 'idle' && allReqs.length === 0 && (
          <div className="text-center text-white/20 text-sm py-12">
            等待面板用户发布需求...
          </div>
        )}
      </div>

      {/* Full result modal */}
      {viewingHtml && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
            <button onClick={() => setViewingHtml(null)} className="text-white/50 hover:text-white transition-colors text-sm">
              ← 返回
            </button>
            <button
              onClick={() => {
                const blob = new Blob([viewingHtml], { type: 'text/html' });
                window.open(URL.createObjectURL(blob), '_blank');
              }}
              className="text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}
            >
              新窗口打开
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <iframe srcDoc={viewingHtml} sandbox="allow-scripts" title="full-result" className="w-full h-full border-0" />
          </div>
        </div>
      )}
    </div>
  );
}
