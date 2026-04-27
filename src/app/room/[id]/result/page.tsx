'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { ROLES } from '@/lib/roles';
import { RoleId, SynthesisResult } from '@/types';
import type { DeepWorkRecommendedAction } from '@/types/deepwork-protocol';

const ROLE_DATA = Object.fromEntries(
  Object.entries(ROLES).map(([k, v]) => [k, { label: v.label, color: v.color }])
);

function injectAttribution(
  html: string,
  mode: 'hover' | 'always' = 'hover',
  roleIntentPreviews: Partial<Record<string, string>> = {}
): string {
  const clearOutlineOnLeave = mode === 'hover' ? "this.style.outline = '2px solid transparent';" : '';
  const baseScript = `
<style>
  [data-source] { transition: outline 0.2s; outline: 2px solid transparent; outline-offset: 3px; cursor: default; }
  [data-source]:hover { outline-width: 2px; }
</style>
<script>
(function() {
  const ROLES = ${JSON.stringify(ROLE_DATA)};
  const INTENTS = ${JSON.stringify(roleIntentPreviews)};
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.92);border:1px solid rgba(255,255,255,0.12);color:#fff;padding:10px 18px;border-radius:16px;font-size:13px;pointer-events:none;transition:opacity 0.15s;opacity:0;z-index:9999;max-width:480px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:0.01em;';
  document.body.appendChild(tip);
  document.querySelectorAll('[data-source]').forEach(function(el) {
    el.addEventListener('mouseenter', function() {
      var role = this.getAttribute('data-source');
      var r = ROLES[role];
      if (!r) return;
      this.style.outline = '2px solid ' + r.color + '60';
      this.style.outlineOffset = '4px';
      var preview = INTENTS[role] ? '<div style="font-size:11px;color:rgba(255,255,255,0.38);font-style:italic;margin-top:5px;padding-left:16px;line-height:1.4;">「' + INTENTS[role] + '」</div>' : '';
      tip.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span style="width:8px;height:8px;border-radius:50%;background:'+r.color+';display:inline-block;flex-shrink:0;"></span><span style="color:'+r.color+';font-weight:600;">'+r.label+'</span><span style="color:rgba(255,255,255,0.5);">贡献了这个区块</span></div>' + preview;
      tip.style.opacity = '1';
    });
    el.addEventListener('mouseleave', function() {
      ${clearOutlineOnLeave}
      tip.style.opacity = '0';
    });
  });
})();
<\/script>`;

  const alwaysOnScript = mode === 'always' ? `
<script>
(function() {
  var ROLES = ${JSON.stringify(ROLE_DATA)};
  document.querySelectorAll('[data-source]').forEach(function(el) {
    var role = el.getAttribute('data-source');
    var r = ROLES[role];
    if (!r) return;
    el.style.outline = '2px solid ' + r.color + '55';
    el.style.outlineOffset = '3px';
    if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var badge = document.createElement('div');
    badge.style.cssText = 'position:absolute;top:10px;left:10px;display:inline-flex;align-items:center;gap:5px;background:rgba(0,0,0,0.75);border:1px solid rgba(255,255,255,0.12);border-radius:999px;padding:3px 10px 3px 6px;font-size:11px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-weight:600;letter-spacing:0.02em;z-index:9998;pointer-events:none;';
    badge.style.color = r.color;
    var dot = document.createElement('span');
    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;flex-shrink:0;';
    dot.style.background = r.color;
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(r.label));
    el.appendChild(badge);
  });
})();
<\/script>` : '';

  const script = baseScript + alwaysOnScript;

  if (html.includes('</body>')) {
    return html.replace('</body>', script + '</body>');
  }
  return html + script;
}

interface AttributionChange {
  section: string;
  from: string | null;
  to: string;
}

function computeAttributionDiff(
  prev: Record<string, string>,
  curr: Record<string, string>
): AttributionChange[] {
  const changes: AttributionChange[] = [];
  for (const [section, role] of Object.entries(curr)) {
    if (prev[section] !== role) {
      changes.push({ section, from: prev[section] ?? null, to: role });
    }
  }
  return changes;
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
  const [linkCopied, setLinkCopied] = useState(false);
  const [recommendedActions, setRecommendedActions] = useState<DeepWorkRecommendedAction[]>([]);
  const [attributionMode, setAttributionMode] = useState<'hover' | 'always'>('always');
  const [roleIntentPreviews, setRoleIntentPreviews] = useState<Partial<Record<string, string>>>({});
  const [compareMode, setCompareMode] = useState(false);
  const [sectionIntents, setSectionIntents] = useState<Record<string, Array<{ role: string; content: string }>>>({});
  const [expandedDiffSections, setExpandedDiffSections] = useState<Set<string>>(new Set());
  const [roomStatus, setRoomStatus] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const synthesisStartRef = useRef<number | null>(null);
  const supabase = createClient();

  const activeResult = allResults.find(r => r.round === activeRound) ?? allResults[allResults.length - 1] ?? null;

  const handleContinue = async () => {
    setResetting(true);
    await fetch('/api/rooms/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: id }),
    });
    localStorage.setItem(`after_round:${id}`, String(latestRound));
    router.push(`/room/${id}`);
  };

  useEffect(() => {
    Promise.all([
      supabase
        .from('synthesis_results')
        .select('*')
        .eq('room_id', id)
        .order('round', { ascending: true }),
      supabase
        .from('rooms')
        .select('status')
        .eq('id', id)
        .single(),
    ]).then(([{ data: resultData }, { data: roomData }]) => {
      const results = (resultData ?? []) as SynthesisResult[];
      setAllResults(results);
      if (results.length > 0) {
        setActiveRound(results[results.length - 1].round);
      }
      if (roomData) {
        setRoomStatus(roomData.status as string);
        if (roomData.status === 'synthesizing') synthesisStartRef.current = Date.now();
      }
      setLoading(false);
    });
  }, [id]);

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
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${id}`,
      }, (payload) => {
        const newStatus = (payload.new as { status?: string }).status;
        if (newStatus) {
          setRoomStatus(newStatus);
          if (newStatus === 'synthesizing') {
            synthesisStartRef.current = Date.now();
            setElapsedSec(0);
          } else {
            synthesisStartRef.current = null;
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  useEffect(() => {
    if (roomStatus !== 'synthesizing') return;
    const id = setInterval(() => {
      if (synthesisStartRef.current !== null) {
        setElapsedSec(Math.floor((Date.now() - synthesisStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [roomStatus]);

  useEffect(() => {
    supabase
      .from('intents')
      .select('content, section, participant:participants!inner(role)')
      .eq('room_id', id)
      .then(({ data }) => {
        if (!data) return;
        const previews: Partial<Record<string, string>> = {};
        const bySection: Record<string, Array<{ role: string; content: string }>> = {};
        for (const intent of data as Array<{ content: string; section: string; participant: { role: string }[] }>) {
          const role = intent.participant[0]?.role;
          if (!role) continue;
          if (!previews[role] || intent.content.length > previews[role]!.length) {
            previews[role] = intent.content.length > 70
              ? intent.content.slice(0, 70) + '…'
              : intent.content;
          }
          const sec = intent.section ?? '';
          if (!bySection[sec]) bySection[sec] = [];
          bySection[sec].push({ role, content: intent.content });
        }
        setRoleIntentPreviews(previews);
        setSectionIntents(bySection);
      });
  }, [id]);

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
      <div className="h-screen bg-[#faf7f2] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-black/[0.06] border-t-black/30 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#a8a29e] text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  if (!activeResult) {
    const isSynthesizing = roomStatus === 'synthesizing';
    const isSynthesisFailed = roomStatus === 'collecting' && !isSynthesizing;
    return (
      <div className="h-screen bg-[#faf7f2] flex items-center justify-center">
        <div className="text-center max-w-xs mx-auto px-6">
          {isSynthesizing ? (
            <>
              <div className="w-14 h-14 mx-auto mb-7 relative flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-purple-500/25 animate-ping" />
                <div className="absolute inset-0 rounded-full border border-purple-500/10 scale-110 animate-ping [animation-delay:0.3s]" />
                <div className="w-14 h-14 rounded-full border-2 border-black/[0.06] border-t-purple-500/70 animate-spin" />
              </div>
              <p className="text-[#1c1917] text-sm font-medium mb-1">合成进行中</p>
              <p className="text-purple-600/70 text-[11px] mb-5">
                {elapsedSec < 15 && '分析角色意图分布...'}
                {elapsedSec >= 15 && elapsedSec < 35 && '整合多角色视角...'}
                {elapsedSec >= 35 && elapsedSec < 60 && '生成 HTML 结构与样式...'}
                {elapsedSec >= 60 && elapsedSec < 80 && '归因标注与冲突检测...'}
                {elapsedSec >= 80 && '即将完成...'}
              </p>
              <div className="w-full h-0.5 bg-black/[0.05] rounded-full mb-5 overflow-hidden">
                <div
                  className="h-full bg-purple-500/50 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((elapsedSec / 90) * 100, 98)}%` }}
                />
              </div>
              <p className="text-[#c4bcb4] text-[11px] font-mono">
                {elapsedSec > 0 ? `已用时 ${elapsedSec}s · 预计 30–90s` : '等待结果中...'}
              </p>
            </>
          ) : isSynthesisFailed ? (
            <>
              <div
                className="w-14 h-14 mx-auto mb-7 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(239,68,68,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <p className="text-red-500/80 text-sm font-medium mb-2">合成失败</p>
              <p className="text-[#78716c] text-xs leading-relaxed mb-7">
                Claude 合成超时或遇到错误，房间已重置为收集状态。<br />
                可返回房间重新触发合成。
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => router.push(`/room/${id}`)}
                  className="w-full py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'rgba(220,38,38,0.85)' }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(239,68,68,0.13)'; }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(239,68,68,0.08)'; }}
                >
                  ← 返回房间重新合成
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full py-2 rounded-xl text-xs transition-colors"
                  style={{ color: '#a8a29e', border: '1px solid transparent' }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.color = '#78716c'; }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.color = '#a8a29e'; }}
                >
                  刷新页面
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                className="w-14 h-14 mx-auto mb-7 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3L3 8.5V15.5L12 21L21 15.5V8.5L12 3Z"/>
                  <path d="M12 12L3 8.5M12 12V21M12 12L21 8.5"/>
                </svg>
              </div>
              <p className="text-[#1c1917]/70 text-sm font-medium mb-2">尚无合成结果</p>
              <p className="text-[#78716c] text-xs leading-relaxed mb-7">
                各角色提交意图后，房主可在房间页面点击「开始合成」，<br />
                Claude 将整合所有意图生成产品落地页。
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => router.push(`/room/${id}`)}
                  className="w-full py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ backgroundColor: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', color: '#57534e' }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0,0,0,0.07)'; }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.backgroundColor = 'rgba(0,0,0,0.04)'; }}
                >
                  ← 返回房间采集意图
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full py-2 rounded-xl text-xs transition-colors"
                  style={{ color: '#a8a29e', border: '1px solid transparent' }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.color = '#78716c'; }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.color = '#a8a29e'; }}
                >
                  刷新页面
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const latestRound = allResults[allResults.length - 1]?.round ?? 1;

  const attributionDiffs = new Map<number, AttributionChange[]>();
  allResults.forEach((r, i) => {
    if (i === 0) return;
    const prev = allResults[i - 1];
    if (prev.attribution_map && r.attribution_map) {
      attributionDiffs.set(r.round, computeAttributionDiff(prev.attribution_map, r.attribution_map));
    }
  });

  const activeIndex = allResults.findIndex(r => r.round === activeRound);
  const compareResult = compareMode && activeIndex > 0 ? allResults[activeIndex - 1] : null;

  return (
    <div className="h-screen bg-[#faf7f2] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-black/[0.07] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleContinue}
            disabled={resetting}
            className="text-[#78716c] hover:text-[#1c1917] transition-colors text-sm disabled:opacity-50"
          >
            {resetting ? '重置中...' : `← 继续迭代 · Round ${latestRound + 1}`}
          </button>
          <span className="text-[#d6d3d1]">·</span>
          <span className="text-sm text-[#78716c]">
            {compareMode && compareResult
              ? `对比 · R${compareResult.round} → R${activeResult.round}`
              : `合成结果 · Round ${activeResult.round}`}
            {!compareMode && activeResult.round === latestRound && allResults.length > 1 && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 border border-emerald-500/20">最新</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {allResults.length > 1 && (
            <button
              onClick={() => {
                const turningOn = !compareMode;
                setCompareMode(m => !m);
                if (turningOn && activeIndex === 0) {
                  setActiveRound(allResults[allResults.length - 1].round);
                }
              }}
              className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
              style={
                compareMode
                  ? { borderColor: 'rgba(59,130,246,0.35)', color: '#2563eb', backgroundColor: 'rgba(59,130,246,0.06)' }
                  : { borderColor: 'rgba(0,0,0,0.08)', color: '#78716c', backgroundColor: 'transparent' }
              }
            >
              {compareMode ? '对比模式 ✓' : '版本对比'}
            </button>
          )}
          <button
            onClick={() => setAttributionMode(m => m === 'hover' ? 'always' : 'hover')}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={
              attributionMode === 'always'
                ? { borderColor: 'rgba(168,85,247,0.35)', color: '#7c3aed', backgroundColor: 'rgba(168,85,247,0.06)' }
                : { borderColor: 'rgba(0,0,0,0.08)', color: '#78716c', backgroundColor: 'transparent' }
            }
          >
            {attributionMode === 'always' ? '归因常亮 ✓' : '归因: 悬停'}
          </button>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href).then(() => {
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 1800);
              });
            }}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
            style={
              linkCopied
                ? { borderColor: 'rgba(5,150,105,0.35)', color: '#059669', backgroundColor: 'rgba(5,150,105,0.06)' }
                : { borderColor: 'rgba(0,0,0,0.08)', color: '#78716c', backgroundColor: 'transparent' }
            }
          >
            {linkCopied ? '链接已复制 ✓' : '复制链接 ↗'}
          </button>
          <button
            onClick={() => downloadHtml(activeResult.html_content, activeResult.round, id)}
            className="text-xs px-3 py-1.5 rounded-lg border border-black/[0.08] text-[#78716c] hover:text-[#1c1917] hover:border-black/[0.15] transition-colors"
          >
            下载 HTML ↓
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* HTML preview — single or split-compare */}
        <div className="flex-1 flex overflow-hidden">
          {compareResult && (
            <div className="flex-1 relative border-r border-black/[0.07] overflow-hidden">
              <div
                className="absolute top-3 left-1/2 -translate-x-1/2 z-10 text-[10px] font-mono px-2.5 py-0.5 rounded-full pointer-events-none select-none"
                style={{ background: 'rgba(255,255,255,0.92)', color: '#a8a29e', border: '1px solid rgba(0,0,0,0.08)' }}
              >
                R{compareResult.round}
              </div>
              <iframe
                key={compareResult.id + attributionMode + 'prev'}
                srcDoc={injectAttribution(compareResult.html_content, attributionMode, roleIntentPreviews)}
                className="w-full h-full border-0"
                title={`Round ${compareResult.round}`}
                sandbox="allow-scripts"
              />
            </div>
          )}
          <div className="flex-1 relative overflow-hidden">
            {compareResult && (
              <div
                className="absolute top-3 left-1/2 -translate-x-1/2 z-10 text-[10px] font-mono px-2.5 py-0.5 rounded-full pointer-events-none select-none"
                style={{ background: 'rgba(255,255,255,0.92)', color: 'rgba(5,150,105,0.85)', border: '1px solid rgba(5,150,105,0.2)' }}
              >
                R{activeResult.round} ✦
              </div>
            )}
            <iframe
              key={activeResult.id + attributionMode + (compareResult ? 'cmp' : '')}
              srcDoc={injectAttribution(activeResult.html_content, attributionMode, roleIntentPreviews)}
              className="w-full h-full border-0"
              title="合成产物"
              sandbox="allow-scripts"
            />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-56 bg-[#f5f0e8] border-l border-black/[0.07] overflow-y-auto flex-shrink-0 flex flex-col">
          {/* Round history */}
          {allResults.length > 1 && (
            <div className="p-4 border-b border-black/[0.06]">
              <p className="text-xs text-[#a8a29e] uppercase tracking-wider mb-3">迭代历史</p>
              <div className="space-y-1.5">
                {allResults.map(r => {
                  const diff = attributionDiffs.get(r.round);
                  return (
                    <button
                      key={r.id}
                      onClick={() => setActiveRound(r.round)}
                      className="w-full flex flex-col rounded-lg px-3 py-2 text-left transition-colors"
                      style={
                        activeRound === r.round
                          ? { backgroundColor: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.1)' }
                          : compareResult && r.round === compareResult.round
                            ? { backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.18)' }
                            : { border: '1px solid transparent' }
                      }
                    >
                      <div className="flex items-center gap-1.5 w-full">
                        <span className="text-xs font-mono text-[#78716c]">R{r.round}</span>
                        {r.attribution_map && Object.keys(r.attribution_map).length > 0 && (
                          <span className="text-[9px] font-mono text-[#c4bcb4]">{Object.keys(r.attribution_map).length}板</span>
                        )}
                        {compareResult && r.round === compareResult.round && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-600/70 font-medium">base</span>
                        )}
                        {diff && diff.length > 0 && (
                          <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/12 text-amber-700/80 font-medium">
                            {diff.length} 变
                          </span>
                        )}
                        <span className="text-xs text-[#c4bcb4] flex-1 text-right">
                          {new Date(r.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {r.round === latestRound && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Recommended next actions */}
          {recommendedActions.length > 0 && (
            <div className="p-4 border-b border-black/[0.06]">
              <p className="text-xs text-[#a8a29e] uppercase tracking-wider mb-3">下一步行动</p>
              <div className="space-y-2">
                {recommendedActions.map(action => (
                  <div
                    key={action.id}
                    className="rounded-xl border p-2.5"
                    style={
                      action.priority === 'p0'
                        ? { borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.04)' }
                        : { borderColor: 'rgba(245,158,11,0.2)', backgroundColor: 'rgba(245,158,11,0.04)' }
                    }
                  >
                    <span
                      className="inline-block text-[9px] font-mono font-bold px-1 py-0.5 rounded mb-1.5"
                      style={{
                        color: action.priority === 'p0' ? '#dc2626' : '#d97706',
                        backgroundColor: action.priority === 'p0' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                      }}
                    >
                      {action.priority.toUpperCase()}
                    </span>
                    <p className="text-[11px] text-[#57534e] leading-snug">{action.summary}</p>
                    {action.affectedSections && action.affectedSections.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {action.affectedSections.map(s => (
                          <span key={s} className="text-[9px] px-1.5 py-0.5 rounded-full bg-black/[0.04] text-[#a8a29e] border border-black/[0.06]">{s}</span>
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
            <p className="text-xs text-[#a8a29e] uppercase tracking-wider mb-4">归因摘要</p>

            {activeResult.attribution_map && Object.entries(activeResult.attribution_map).map(([section, roleId]) => {
              const r = ROLES[roleId as RoleId];
              if (!r) return null;
              const intentCount = sectionIntents[section]?.length ?? 0;
              return (
                <div key={section} className="mb-3 flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: r.color }} />
                  <div>
                    <span className="text-xs font-medium" style={{ color: r.color }}>{r.label}</span>
                    <p className="text-xs text-[#78716c] leading-snug">
                      {section}
                      {intentCount > 0 && (
                        <span className="ml-1.5 text-[9px] text-[#c4bcb4] font-mono">{intentCount} 条</span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Attribution diff */}
            {activeResult.round > 1 && attributionDiffs.has(activeResult.round) && (
              <div className="mt-5 pt-4 border-t border-black/[0.06]">
                <p className="text-xs text-[#a8a29e] uppercase tracking-wider mb-3">本轮变化</p>
                {attributionDiffs.get(activeResult.round)!.length === 0 ? (
                  <p className="text-xs text-[#c4bcb4]">归因无变化</p>
                ) : (
                  attributionDiffs.get(activeResult.round)!.map(d => {
                    const fromRole = d.from ? ROLES[d.from as RoleId] : null;
                    const toRole = ROLES[d.to as RoleId];
                    if (!toRole) return null;
                    const hasIntents = (sectionIntents[d.section]?.length ?? 0) > 0;
                    const isExpanded = expandedDiffSections.has(d.section);
                    return (
                      <div key={d.section} className="mb-3">
                        <button
                          className="w-full text-left group"
                          onClick={() => {
                            if (!hasIntents) return;
                            setExpandedDiffSections(s => {
                              const next = new Set(s);
                              if (next.has(d.section)) next.delete(d.section); else next.add(d.section);
                              return next;
                            });
                          }}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] text-[#78716c] leading-snug">{d.section}</p>
                            {hasIntents && (
                              <span className="text-[9px] text-[#c4bcb4] group-hover:text-[#78716c] transition-colors">
                                {isExpanded ? '▲' : '▼'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {fromRole ? (
                              <span className="text-[10px] font-medium" style={{ color: fromRole.color }}>{fromRole.label}</span>
                            ) : (
                              <span className="text-[10px] text-[#c4bcb4]">新增</span>
                            )}
                            <span className="text-[#c4bcb4] text-[10px]">→</span>
                            <span className="text-[10px] font-semibold" style={{ color: toRole.color }}>{toRole.label}</span>
                          </div>
                        </button>
                        {isExpanded && hasIntents && (
                          <div className="mt-2 pl-2 border-l border-black/[0.06] space-y-1.5">
                            {sectionIntents[d.section].map((intent, idx) => {
                              const r = ROLES[intent.role as RoleId];
                              return (
                                <div key={idx}>
                                  <span className="text-[9px] font-semibold" style={{ color: r?.color ?? '#a8a29e' }}>
                                    {r?.label ?? intent.role}
                                  </span>
                                  <p className="text-[9px] text-[#78716c] leading-snug mt-0.5">
                                    {intent.content.length > 65 ? intent.content.slice(0, 65) + '…' : intent.content}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {activeResult.conflicts_resolved && activeResult.conflicts_resolved.length > 0 && (
              <div className="mt-5 pt-4 border-t border-black/[0.06]">
                <p className="text-xs text-[#a8a29e] uppercase tracking-wider mb-3">冲突解决</p>
                {activeResult.conflicts_resolved.map((c, i) => (
                  <p key={i} className="text-xs text-[#78716c] mb-2 leading-snug">{c}</p>
                ))}
              </div>
            )}

            {/* Role color legend */}
            <div className="mt-5 pt-4 border-t border-black/[0.06]">
              <p className="text-xs text-[#a8a29e] uppercase tracking-wider mb-3">角色图例</p>
              <div className="space-y-1.5">
                {Object.entries(ROLES).map(([roleId, roleInfo]) => (
                  <div key={roleId} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: roleInfo.color }} />
                    <span className="text-xs text-[#78716c]">{roleInfo.label}</span>
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
