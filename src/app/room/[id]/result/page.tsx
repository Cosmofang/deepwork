'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { ROLES } from '@/lib/roles';
import { RoleId, SynthesisResult } from '@/types';
import type { DeepWorkRecommendedAction } from '@/types/deepwork-protocol';

const ROLE_DATA = Object.fromEntries(
  Object.entries(ROLES).map(([k, v]) => [k, { label: v.label, color: v.color }])
);

function injectAttribution(html: string): string {
  const script = `
<style>
  [data-source] { transition: outline 0.2s; outline: 2px solid transparent; outline-offset: 3px; cursor: default; }
  [data-source]:hover { outline-width: 2px; }
</style>
<script>
(function() {
  const ROLES = ${JSON.stringify(ROLE_DATA)};
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.92);border:1px solid rgba(255,255,255,0.12);color:#fff;padding:8px 20px;border-radius:999px;font-size:13px;pointer-events:none;transition:opacity 0.15s;opacity:0;z-index:9999;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:0.01em;display:flex;align-items:center;gap:8px;';
  document.body.appendChild(tip);
  document.querySelectorAll('[data-source]').forEach(function(el) {
    el.addEventListener('mouseenter', function() {
      var role = this.getAttribute('data-source');
      var r = ROLES[role];
      if (!r) return;
      this.style.outline = '2px solid ' + r.color + '60';
      this.style.outlineOffset = '4px';
      tip.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:'+r.color+';display:inline-block;flex-shrink:0;"></span><span style="color:'+r.color+';font-weight:600;">'+r.label+'</span><span style="color:rgba(255,255,255,0.5);">贡献了这个区块</span>';
      tip.style.opacity = '1';
    });
    el.addEventListener('mouseleave', function() {
      this.style.outline = '2px solid transparent';
      tip.style.opacity = '0';
    });
  });
})();
<\/script>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', script + '</body>');
  }
  return html + script;
}

function downloadHtml(html: string, round: number, roomId: string) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `deepwork-${roomId}-round${round}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [allResults, setAllResults] = useState<SynthesisResult[]>([]);
  const [activeRound, setActiveRound] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [recommendedActions, setRecommendedActions] = useState<DeepWorkRecommendedAction[]>([]);
  const supabase = createClient();

  const activeResult = allResults.find(r => r.round === activeRound) ?? allResults[allResults.length - 1] ?? null;

  const handleContinue = async () => {
    setResetting(true);
    await fetch('/api/rooms/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: id }),
    });
    router.push(`/room/${id}`);
  };

  useEffect(() => {
    supabase
      .from('synthesis_results')
      .select('*')
      .eq('room_id', id)
      .order('round', { ascending: true })
      .then(({ data }) => {
        const results = (data ?? []) as SynthesisResult[];
        setAllResults(results);
        if (results.length > 0) {
          setActiveRound(results[results.length - 1].round);
        }
        setLoading(false);
      });
  }, [id]);

  // subscribe to new synthesis results (when re-synthesis completes)
  useEffect(() => {
    const channel = supabase
      .channel(`synthesis:${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'synthesis_results',
        filter: `room_id=eq.${id}`,
      }, async (payload) => {
        const { data } = await supabase
          .from('synthesis_results')
          .select('*')
          .eq('id', payload.new.id)
          .single();
        if (!data) return;
        setAllResults(prev => {
          const next = [...prev, data as SynthesisResult].sort((a, b) => a.round - b.round);
          return next;
        });
        setActiveRound((data as SynthesisResult).round);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Fetch protocol-level recommended actions from the workspace snapshot.
  // Silently no-ops if .deepwork/ doesn't exist (Vercel / first run).
  useEffect(() => {
    if (!id) return;
    fetch(`/api/workspace?roomId=${encodeURIComponent(id)}`)
      .then(r => r.ok ? (r.json() as Promise<{ snapshot?: { recommendedNextActions?: DeepWorkRecommendedAction[] } }>) : null)
      .then(data => {
        const actions = data?.snapshot?.recommendedNextActions ?? [];
        setRecommendedActions(actions.filter(a => a.priority !== 'p2'));
      })
      .catch(() => null);
  }, [id, allResults.length]);

  if (loading) {
    return (
      <div className="h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  if (!activeResult) {
    return (
      <div className="h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">暂无合成结果</p>
          <button
            onClick={() => router.push(`/room/${id}`)}
            className="mt-4 text-sm text-gray-500 hover:text-white transition-colors"
          >
            ← 返回房间
          </button>
        </div>
      </div>
    );
  }

  const latestRound = allResults[allResults.length - 1]?.round ?? 1;

  return (
    <div className="h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleContinue}
            disabled={resetting}
            className="text-gray-500 hover:text-white transition-colors text-sm disabled:opacity-50"
          >
            {resetting ? '重置中...' : '← 继续迭代'}
          </button>
          <span className="text-gray-700">·</span>
          <span className="text-sm text-gray-400">
            合成结果 · Round {activeResult.round}
            {activeResult.round === latestRound && allResults.length > 1 && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/20">最新</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">悬停区块查看归因</span>
          <button
            onClick={() => downloadHtml(activeResult.html_content, activeResult.round, id)}
            className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors"
          >
            下载 HTML ↓
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* HTML preview */}
        <div className="flex-1">
          <iframe
            key={activeResult.id}
            srcDoc={injectAttribution(activeResult.html_content)}
            className="w-full h-full border-0"
            title="合成产物"
            sandbox="allow-scripts"
          />
        </div>

        {/* Right sidebar */}
        <div className="w-56 border-l border-white/10 overflow-y-auto flex-shrink-0 flex flex-col">
          {/* Round history */}
          {allResults.length > 1 && (
            <div className="p-4 border-b border-white/10">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">迭代历史</p>
              <div className="space-y-1.5">
                {allResults.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setActiveRound(r.round)}
                    className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
                    style={
                      activeRound === r.round
                        ? { backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }
                        : { border: '1px solid transparent' }
                    }
                  >
                    <span className="text-xs font-mono text-gray-400">R{r.round}</span>
                    <span className="text-xs text-gray-600 flex-1 text-right">
                      {new Date(r.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {r.round === latestRound && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recommended next actions — sourced from protocol snapshot */}
          {recommendedActions.length > 0 && (
            <div className="p-4 border-b border-white/10">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">下一步行动</p>
              <div className="space-y-2">
                {recommendedActions.map(action => (
                  <div
                    key={action.id}
                    className="rounded-xl border p-2.5"
                    style={
                      action.priority === 'p0'
                        ? { borderColor: 'rgba(239,68,68,0.25)', backgroundColor: 'rgba(239,68,68,0.05)' }
                        : { borderColor: 'rgba(245,158,11,0.25)', backgroundColor: 'rgba(245,158,11,0.05)' }
                    }
                  >
                    <span
                      className="inline-block text-[9px] font-mono font-bold px-1 py-0.5 rounded mb-1.5"
                      style={{
                        color: action.priority === 'p0' ? '#f87171' : '#fbbf24',
                        backgroundColor: action.priority === 'p0' ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                      }}
                    >
                      {action.priority.toUpperCase()}
                    </span>
                    <p className="text-[11px] text-gray-400 leading-snug">{action.summary}</p>
                    {action.affectedSections && action.affectedSections.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {action.affectedSections.map(s => (
                          <span key={s} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-600 border border-white/5">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attribution map */}
          <div className="p-4 flex-1">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">归因摘要</p>

            {activeResult.attribution_map && Object.entries(activeResult.attribution_map).map(([section, roleId]) => {
              const r = ROLES[roleId as RoleId];
              if (!r) return null;
              return (
                <div key={section} className="mb-3 flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: r.color }} />
                  <div>
                    <span className="text-xs font-medium" style={{ color: r.color }}>{r.label}</span>
                    <p className="text-xs text-gray-600 leading-snug">{section}</p>
                  </div>
                </div>
              );
            })}

            {activeResult.conflicts_resolved && activeResult.conflicts_resolved.length > 0 && (
              <div className="mt-5 pt-4 border-t border-white/10">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">冲突解决</p>
                {activeResult.conflicts_resolved.map((c, i) => (
                  <p key={i} className="text-xs text-gray-600 mb-2 leading-snug">{c}</p>
                ))}
              </div>
            )}

            {/* Role color legend */}
            <div className="mt-5 pt-4 border-t border-white/10">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">角色图例</p>
              <div className="space-y-1.5">
                {Object.entries(ROLES).map(([roleId, roleInfo]) => (
                  <div key={roleId} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: roleInfo.color }} />
                    <span className="text-xs text-gray-500">{roleInfo.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
