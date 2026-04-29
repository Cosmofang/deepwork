'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { Agent, Requirement, Submission, Priority, UserStatus, PresenceData } from '@/types';
import { useTheme, type ThemeMode, type FontSize } from '@/hooks/useTheme';

// ── helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const COLORS = ['#f59e0b', '#3b82f6', '#ec4899', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16'];
function getUserColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function displayName(raw: string): string {
  const m = raw.match(/^\[([^\]]+)\]\s*(.*)/);
  if (m) return m[2] ? `${m[2]} (${m[1]})` : m[1];
  return raw;
}

const REQ_SECTIONS = ['__REQ__', '__REQ_H__', '__REQ_U__'];
const REQ_SECTION_MAP: Record<string, Priority> = {
  __REQ__: 'normal', __REQ_H__: 'important', __REQ_U__: 'urgent',
};
const WEIGHT_MAP: Record<string, number> = { __REQ__: 50, __REQ_H__: 75, __REQ_U__: 100 };

const AGENT_TOOL_CMDS = [
  { name: 'Claude Code', color: '#8b5cf6', agent: 'claude'   },
  { name: 'OpenClaw',    color: '#f59e0b', agent: 'openclaw' },
  { name: 'Hermes',      color: '#10b981', agent: 'hermes'   },
];
const buildConnectCmd = (code: string, baseUrl: string, agent: string) =>
  `deeploop connect ${code} --name ${agent} --url ${baseUrl}`;

const PRIORITY_CFG: Record<Priority, { label: string; color: string; bg: string; border: string }> = {
  normal:    { label: '普通', color: 'var(--c-text-4)',  bg: 'var(--c-overlay-md)',       border: 'var(--c-border-3)' },
  important: { label: '重要', color: '#3b82f6',           bg: 'rgba(59,130,246,0.12)',     border: 'rgba(59,130,246,0.35)' },
  urgent:    { label: '紧急', color: '#ef4444',           bg: 'rgba(239,68,68,0.12)',      border: 'rgba(239,68,68,0.35)' },
};

const APPEARANCE_MODES: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light',  label: '日间',     icon: '☀' },
  { value: 'dark',   label: '夜览',     icon: '☽' },
  { value: 'system', label: '跟随系统', icon: '◎' },
];
const APPEARANCE_FONTS: { value: FontSize; label: string }[] = [
  { value: 's', label: '小' },
  { value: 'm', label: '中' },
  { value: 'l', label: '大' },
];

type ModelChoice = 'haiku' | 'sonnet' | 'opus';
// Currently available Claude models (proxied via ANTHROPIC_BASE_URL). Each
// has a single-letter glyph used for the compact circle button inside the
// requirement textarea, plus a long label shown in the expanded popup.
const MODEL_CFG: Record<ModelChoice, { letter: string; full: string; desc: string; color: string }> = {
  haiku:  { letter: 'H', full: 'Haiku 4.5',  desc: '快速  ·  适合简单文字调整',         color: '#22c55e' },
  sonnet: { letter: 'S', full: 'Sonnet 4.6', desc: '平衡  ·  默认推荐，速度与质量兼顾', color: '#3b82f6' },
  opus:   { letter: 'O', full: 'Opus 4.7',   desc: '强力  ·  深度改版、复杂推理',       color: '#a855f7' },
};

const STATUS_CFG: Record<UserStatus, { label: string; color: string; pulse?: boolean }> = {
  idle:    { label: '静默',     color: 'var(--c-text-5)' },
  typing:  { label: '输入中…', color: '#3b82f6', pulse: true },
  waiting: { label: '等待执行', color: '#f59e0b', pulse: true },
  done:    { label: '已完成',   color: '#4ade80' },
  working: { label: '生成中',   color: '#f59e0b', pulse: true },
};

// ── presence user row ──────────────────────────────────────────────────────

function UserRow({ user }: { user: PresenceData }) {
  const cfg = STATUS_CFG[user.status];
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <div className="w-5 h-5 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
        style={{ background: user.color, color: '#000' }}>
        {user.name[0]?.toUpperCase()}
      </div>
      <span className="text-sm truncate flex-1 min-w-0" style={{ color: 'var(--c-text-3)' }}>{user.name}</span>
      {user.isAgent && <span className="text-sm text-purple-400 flex-shrink-0">AI</span>}
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.pulse ? 'animate-pulse' : ''}`}
        style={{ background: cfg.color }} />
    </div>
  );
}

// ── copy block ─────────────────────────────────────────────────────────────

function CopyBlock({ text, id, copied, onCopy }: { text: string; id: string; copied: string | null; onCopy: (t: string, k: string) => void }) {
  const isCopied = copied === id;
  return (
    <div className="group relative">
      <code className="block text-sm px-4 py-2.5 rounded-xl font-mono pr-16 break-all"
        style={{ background: 'var(--c-input)', color: 'var(--c-text-2)', border: '1px solid var(--c-border-2)', lineHeight: '1.6' }}>
        {text}
      </code>
      <button onClick={() => onCopy(text, id)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg text-sm transition-all"
        style={{
          background: isCopied ? 'rgba(74,222,128,0.15)' : 'var(--c-overlay-md)',
          color: isCopied ? '#4ade80' : 'var(--c-text-5)',
          border: `1px solid ${isCopied ? 'rgba(74,222,128,0.3)' : 'var(--c-border-3)'}`,
        }}>
        {isCopied ? '✓' : '复制'}
      </button>
    </div>
  );
}

// ── agent connect modal ────────────────────────────────────────────────────

function AgentConnectModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'cli' | 'api'>('cli');
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  const apiExample = `fetch("${baseUrl}/api/projects/join", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    projectCode: "${projectId}",
    name: "my-agent",
    mode: "agent",
    roleDescription: "自定义 Agent"
  })
})
// → { agentId, panelParticipantId }`;

  const submitExample = `fetch("${baseUrl}/api/submit-result", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    projectId: "${projectId}",
    agentId: "<agentId>",
    requirementId: "<requirementId>",
    html: "<!DOCTYPE html>...",
    summary: "页面摘要"
  })
})`;

  const tabs = [
    { id: 'cli' as const, label: '🖥 CLI 接入', desc: '只连接任务面板，不修改 DeepLoop' },
    { id: 'api' as const, label: '🔗 直接 API 接入', desc: '只提交当前项目需求/结果' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="w-full rounded-2xl flex flex-col overflow-hidden glass-strong"
        style={{ maxHeight: '90vh', maxWidth: '850px' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--c-border-2)' }}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
            <span className="font-semibold text-sm" style={{ color: 'var(--c-text-1)' }}>接入 Agent · {projectId}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all"
            style={{ background: 'var(--c-overlay-md)', color: 'var(--c-text-4)' }}>✕</button>
        </div>
        <div className="flex px-5 pt-4 gap-2 flex-shrink-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 py-2.5 px-3 rounded-xl text-sm font-medium text-left transition-all"
              style={tab === t.id
                ? { background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#a855f7' }
                : { background: 'var(--c-overlay-md)', border: '1px solid var(--c-border-2)', color: 'var(--c-text-5)' }}>
              <div>{t.label}</div>
              <div className="text-sm mt-0.5 font-normal" style={{ color: tab === t.id ? 'rgba(168,85,247,0.7)' : 'var(--c-text-6)' }}>{t.desc}</div>
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {tab === 'cli' ? (
            <>
              <div className="p-3 rounded-xl text-sm leading-relaxed" style={{ background: 'var(--c-overlay)', border: '1px solid var(--c-border-2)', color: 'var(--c-text-4)' }}>
                CLI 只负责接入任务面板（同步需求、广播状态）。Agent 应在目标项目目录中工作，把当前项目的内容提交回面板。
              </div>
              {/* Warn when the panel is being viewed at localhost — the
                  --url argument copies whatever origin you're on, so commands
                  copied from a localhost panel won't reach other machines. */}
              {/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(baseUrl) && (
                <div className="p-3 rounded-xl text-sm leading-relaxed flex items-start gap-2"
                  style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#b45309' }}>
                  <span className="flex-shrink-0" aria-hidden>⚠️</span>
                  <span>
                    当前面板地址是 <code className="font-mono px-1 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.12)' }}>{baseUrl}</code>，
                    下面命令里的 <code>--url</code> 也是这个值。<b>只有你这台机器能跑通</b>。
                    要分享给协作者的话，先把面板挂到公网域名（如 cloudflared tunnel）再来复制命令。
                  </span>
                </div>
              )}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-sm font-bold bg-purple-500 text-white flex-shrink-0">1</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--c-text-3)' }}>安装 deeploop CLI（仅首次）</span>
                </div>
                <CopyBlock text="npm install -g dwcosmo" id="cli-install" copied={copied} onCopy={copy} />
                <p className="text-sm mt-1.5" style={{ color: 'var(--c-text-6)' }}>安装后 <code style={{ color: 'var(--c-text-4)' }}>deeploop</code> 命令即可全局使用。</p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-sm font-bold bg-purple-500 text-white flex-shrink-0">2</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--c-text-3)' }}>连接项目（选择你的 Agent 工具）</span>
                </div>
              </div>
              {AGENT_TOOL_CMDS.map(cmd => (
                <div key={cmd.name}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cmd.color }} />
                    <span className="text-sm font-medium" style={{ color: 'var(--c-text-3)' }}>{cmd.name}</span>
                  </div>
                  <CopyBlock text={buildConnectCmd(projectId, baseUrl, cmd.agent)} id={`cli-${cmd.name}`} copied={copied} onCopy={copy} />
                </div>
              ))}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-sm font-bold bg-blue-500 text-white flex-shrink-0">→</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--c-text-3)' }}>获取当前页面 HTML（用于迭代）</span>
                </div>
                <CopyBlock text={`deeploop current --out current.html`} id="cli-current" copied={copied} onCopy={copy} />
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-sm font-bold bg-blue-500 text-white flex-shrink-0">1</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--c-text-3)' }}>加入项目</span>
                </div>
                <CopyBlock text={apiExample} id="api-join" copied={copied} onCopy={copy} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-sm font-bold bg-blue-500 text-white flex-shrink-0">2</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--c-text-3)' }}>拉取需求列表</span>
                </div>
                <CopyBlock text={`GET ${baseUrl}/api/requirements?projectId=${projectId}`} id="api-reqs" copied={copied} onCopy={copy} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-sm font-bold bg-blue-500 text-white flex-shrink-0">3</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--c-text-3)' }}>获取当前页面（迭代基础）</span>
                </div>
                <CopyBlock text={`GET ${baseUrl}/api/current-page?projectId=${projectId}`} id="api-current" copied={copied} onCopy={copy} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-sm font-bold bg-blue-500 text-white flex-shrink-0">4</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--c-text-3)' }}>提交迭代后的 HTML</span>
                </div>
                <CopyBlock text={submitExample} id="api-submit" copied={copied} onCopy={copy} />
              </div>
              <div className="p-3 rounded-xl text-sm leading-relaxed" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.35)', color: '#3b82f6' }}>
                💡 每次提交都会创建新版本。面板通过 Supabase Realtime 实时更新，无需刷新。
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-3 flex-shrink-0 glass-faint" style={{ borderTop: '1px solid var(--c-border-2)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-6)' }}>
            接入后 Agent 出现在左侧列表。Agent 每次处理需求后都会产生新版本，面板保存所有历史版本可随时回查。
          </p>
        </div>
      </div>
    </div>
  );
}

// ── main page ──────────────────────────────────────────────────────────────

export default function PanelPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = id.toUpperCase();

  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [submissions, setSubmissions] = useState<(Submission & { agent?: Agent })[]>([]);
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<PresenceData[]>([]);
  const [input, setInput] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  // Which Claude model to use for generation. Marker is prepended to the
  // requirement content so /api/generate can pick the right model id.
  const [selectedModel, setSelectedModel] = useState<ModelChoice>('sonnet');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [panelParticipantId, setPanelParticipantId] = useState('');
  const [userName, setUserName] = useState('');
  const [myAgentId, setMyAgentId] = useState('');
  const [showAgentConnect, setShowAgentConnect] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [centerHtml, setCenterHtml] = useState<string | null>(null);
  const [centerBlobUrl, setCenterBlobUrl] = useState<string | null>(null);
  // Which version is pinned to the center panel. null = auto-follow the latest version.
  const [centerVersionId, setCenterVersionId] = useState<string | null>(null);
  // Inline edit mode for the center panel iframe.
  const [isEditing, setIsEditing] = useState(false);
  const [editBlobUrl, setEditBlobUrl] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [shareUrlCopied, setShareUrlCopied] = useState(false);
  // SSR-safe: starts empty so server-rendered HTML matches the client's first
  // render. Filled in on mount via the effect below — avoids a hydration mismatch.
  const [shareUrl, setShareUrl] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') setShareUrl(window.location.href);
  }, []);
  // Inline appearance menu (replaces the floating bottom-right ThemeToggle for
  // this page — the floating one stays mounted globally for other routes).
  const { mode: themeMode, fontSize: themeFont, changeMode: setThemeMode, changeFontSize: setThemeFont } = useTheme();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // Small delay before closing the appearance menu so the cursor can travel
  // from the button to the popup (or vice versa) without the popup vanishing
  // mid-move. mouseEnter on either part cancels any pending close.
  const appearanceCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openAppearanceMenu = useCallback(() => {
    if (appearanceCloseTimer.current) { clearTimeout(appearanceCloseTimer.current); appearanceCloseTimer.current = null; }
    setAppearanceOpen(true);
  }, []);
  const scheduleAppearanceClose = useCallback(() => {
    if (appearanceCloseTimer.current) clearTimeout(appearanceCloseTimer.current);
    appearanceCloseTimer.current = setTimeout(() => setAppearanceOpen(false), 140);
  }, []);
  // The version "pinned" as the basis for the next requirement. When set, the
  // post-requirement flow prepends e.g. 「基于 v3」 to the content so the agent
  // knows which page to iterate on rather than always starting from latest.
  const [attachedVersionId, setAttachedVersionId] = useState<string | null>(null);
  // Submissions whose thinking trace is currently expanded in the feed.
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const toggleThinking = useCallback((submissionId: string) => {
    setExpandedThinking(prev => {
      const next = new Set(prev);
      if (next.has(submissionId)) next.delete(submissionId); else next.add(submissionId);
      return next;
    });
  }, []);
  const [tick, setTick] = useState(0);
  const [lastActiveAt, setLastActiveAt] = useState(() => Date.now());

  const bumpActive = useCallback(() => setLastActiveAt(Date.now()), []);

  // Copy the current page URL so the user can paste it into chat / email
  // and invite teammates to the same project. Shown as a chip in the top bar.
  const copyShareUrl = useCallback(() => {
    if (typeof window === 'undefined') return;
    bumpActive();
    const url = window.location.href;
    void navigator.clipboard.writeText(url)
      .then(() => {
        setShareUrlCopied(true);
        setTimeout(() => setShareUrlCopied(false), 2000);
      })
      .catch(() => {
        // Clipboard unavailable (e.g. http page or denied permission) — fall back
        // to a prompt so the user can still grab the URL manually.
        try { window.prompt('复制下面的链接发给协作者', url); } catch { /* swallow */ }
      });
  }, [bumpActive]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const feedBottomRef = useRef<HTMLDivElement>(null);
  const presenceRef = useRef<((data: PresenceData) => void) | null>(null);
  const editIframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setPanelParticipantId(localStorage.getItem(`panel_participant_id:${projectId}`) ?? '');
    setUserName(localStorage.getItem('user_name') ?? '');
    setMyAgentId(localStorage.getItem(`agent_id:${projectId}`) ?? '');
  }, [projectId]);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10000);
    return () => clearInterval(t);
  }, []);
  void tick;

  // ── preview blob url ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!previewHtml) { setPreviewBlobUrl(null); return; }
    const blob = new Blob([previewHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setPreviewBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewHtml]);

  useEffect(() => {
    if (!centerHtml) { setCenterBlobUrl(null); return; }
    const blob = new Blob([centerHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setCenterBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [centerHtml]);

  // ── presence ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!panelParticipantId) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`dw-prs-${projectId}`, { config: { presence: { key: panelParticipantId } } })
      .on('presence', { event: 'sync' }, () => {
        const raw = ch.presenceState<PresenceData>();
        const flat = Object.values(raw).flat();
        const seen = new Map<string, PresenceData>();
        for (const u of flat) seen.set(u.userId, u);
        setOnlineUsers(Array.from(seen.values()));
      });

    ch.subscribe(async (s) => {
      if (s !== 'SUBSCRIBED') return;
      presenceRef.current = (data) => void ch.track(data);
      presenceRef.current({
        userId: panelParticipantId,
        name: userName || '用户',
        status: 'idle',
        isAgent: false,
        roleDescription: '',
        color: getUserColor(panelParticipantId),
        lastActiveAt: Date.now(),
      });
    });

    return () => { presenceRef.current = null; void supabase.removeChannel(ch); };
  }, [panelParticipantId, projectId, userName]);

  const myPendingReq = requirements.find(r =>
    r.posted_by === panelParticipantId &&
    !submissions.some(s => s.requirement_id === r.id) &&
    (Date.now() - new Date(r.created_at).getTime()) < 300_000,
  );
  const myHasDone = requirements.some(r =>
    r.posted_by === panelParticipantId && submissions.some(s => s.requirement_id === r.id),
  );
  const presenceStatus: UserStatus =
    input.length > 0 ? 'typing' :
    myPendingReq ? 'waiting' :
    myHasDone ? 'done' :
    'idle';

  useEffect(() => {
    if (!panelParticipantId || !userName) return;
    presenceRef.current?.({
      userId: panelParticipantId,
      name: userName,
      status: presenceStatus,
      isAgent: false,
      roleDescription: '',
      color: getUserColor(panelParticipantId),
      lastActiveAt,
    });
  }, [presenceStatus, panelParticipantId, userName, lastActiveAt]);

  // ── data loading ─────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    const supabase = createClient();
    const [reqRes, subRes, agentRows, humanRows] = await Promise.all([
      fetch(`/api/requirements?projectId=${projectId}`),
      fetch(`/api/submissions?projectId=${projectId}&lite=1`),
      supabase.from('participants').select('*').eq('room_id', projectId).eq('role', 'employee').order('joined_at', { ascending: true }),
      supabase.from('participants').select('id, name').eq('room_id', projectId).eq('role', 'product'),
    ]);

    const reqData = reqRes.ok ? await reqRes.json() as { requirements: Requirement[] } : { requirements: [] };
    const subData = subRes.ok ? await subRes.json() as { submissions: (Submission & { agent?: Agent })[] } : { submissions: [] };
    const reqs = reqData.requirements ?? [];
    const subs = subData.submissions ?? [];

    const agtsRaw = ((agentRows.data ?? []) as Array<Record<string, unknown>>).map(p => ({
      id: p.id as string,
      name: (p.name as string).split('｜')[0],
      role_description: (p.name as string).split('｜')[1] ?? '',
      status: 'idle' as const,
      project_id: projectId,
      last_seen_at: p.joined_at as string,
      created_at: p.joined_at as string,
    }));
    const seenNames = new Map<string, typeof agtsRaw[0]>();
    for (const a of agtsRaw) {
      const prev = seenNames.get(a.name);
      if (!prev || a.created_at > prev.created_at) seenNames.set(a.name, a);
    }

    const names: Record<string, string> = {};
    for (const row of ((humanRows.data ?? []) as Array<{ id: string; name: string }>)) {
      names[row.id] = row.name;
    }

    setRequirements(reqs);
    setSubmissions(subs);
    setAgents(Array.from(seenNames.values()));
    setParticipantNames(names);
  }, [projectId]);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── realtime subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    const supabase = createClient();

    const reqChannel = supabase
      .channel(`panel-req-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'intents', filter: `room_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const sec = row.section as string;
          const isPending = sec === '__REQ_PENDING__';
          if (!REQ_SECTIONS.includes(sec) && !isPending) return;
          const r: Requirement = {
            id: row.id as string,
            project_id: row.room_id as string,
            content: row.content as string,
            posted_by: row.participant_id as string,
            created_at: row.created_at as string,
            priority: REQ_SECTION_MAP[sec] ?? 'normal',
            weight: WEIGHT_MAP[sec] ?? 50,
            pending: isPending || undefined,
          };
          setRequirements(prev => prev.some(p => p.id === r.id) ? prev : [...prev, r]);
        }
      )
      .subscribe();

    const subChannel = supabase
      .channel(`panel-sub-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'synthesis_results', filter: `room_id=eq.${projectId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const meta = (row.attribution_map ?? {}) as Record<string, string>;
          const s: Submission & { agent?: Agent } = {
            id: row.id as string,
            project_id: row.room_id as string,
            requirement_id: meta.requirement_id ?? '',
            agent_id: meta.agent_id ?? '',
            html_content: row.html_content as string,
            summary: meta.summary ?? '',
            created_at: row.created_at as string,
            agent: {
              id: meta.agent_id ?? '',
              name: meta.agent_name ?? '未知 Agent',
              role_description: meta.role_description ?? '',
              status: 'idle',
              project_id: projectId,
              last_seen_at: row.created_at as string,
              created_at: row.created_at as string,
            },
          };
          setSubmissions(prev => prev.some(p => p.id === s.id) ? prev : [...prev, s]);
        }
      )
      .subscribe();

    const agentChannel = supabase
      .channel(`panel-agents-${projectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: `room_id=eq.${projectId}` },
        (payload) => {
          const p = payload.new as Record<string, unknown>;
          if (p.role !== 'employee') return;
          const newAgent = {
            id: p.id as string,
            name: (p.name as string).split('｜')[0],
            role_description: (p.name as string).split('｜')[1] ?? '',
            status: 'idle' as const,
            project_id: projectId,
            last_seen_at: p.joined_at as string,
            created_at: p.joined_at as string,
          };
          setAgents(prev => {
            const idx = prev.findIndex(a => a.name === newAgent.name);
            if (idx >= 0) { const next = [...prev]; next[idx] = newAgent; return next; }
            return [...prev, newAgent];
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(reqChannel);
      void supabase.removeChannel(subChannel);
      void supabase.removeChannel(agentChannel);
    };
  }, [projectId]);

  // ── post requirement ──────────────────────────────────────────────────────

  const postRequirement = async () => {
    const content = input.trim();
    if (!content || posting || !panelParticipantId) return;
    setPosting(true);
    bumpActive();
    // Prepend markers so the agent can pick up:
    //   - which model the user wants
    //   - which version (if any) to iterate on
    // Format is human-readable; /api/generate strips the markers before
    // building the prompt so they don't pollute the model context.
    let finalContent = content;
    if (attachedVersionId) {
      const sub = submissions.find(s => s.id === attachedVersionId);
      const vNum = sub ? versionNumberOf(sub.id) : null;
      if (vNum !== null) {
        finalContent = `（基于 v${vNum}）${finalContent}`;
      }
    }
    if (selectedModel !== 'sonnet') {
      // sonnet is the default — only mark explicitly when user picked otherwise
      finalContent = `（模型: ${selectedModel}）${finalContent}`;
    }
    await fetch('/api/requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, content: finalContent, participantId: panelParticipantId, priority }),
    });
    setInput('');
    setPriority('normal');
    setAttachedVersionId(null);
    setPosting(false);
    textareaRef.current?.focus();
  };

  // ── confirm / dismiss / delete ────────────────────────────────────────────

  const confirmReq = async (id: string, p: Priority = 'normal') => {
    if (!panelParticipantId) return;
    bumpActive();
    await fetch('/api/requirements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, projectId, participantId: panelParticipantId, priority: p }),
    });
    setRequirements(prev => prev.map(r => r.id === id ? { ...r, pending: false, weight: 50 } : r));
  };

  const dismissReq = async (id: string) => {
    if (!panelParticipantId) return;
    bumpActive();
    await fetch(`/api/requirements?id=${id}&projectId=${projectId}&participantId=${panelParticipantId}`, { method: 'DELETE' });
    setRequirements(prev => prev.filter(r => r.id !== id));
  };

  const deleteMyReq = async (id: string) => {
    if (!panelParticipantId) return;
    bumpActive();
    await fetch(`/api/requirements?id=${id}&projectId=${projectId}&participantId=${panelParticipantId}`, { method: 'DELETE' });
    setRequirements(prev => prev.filter(r => r.id !== id));
  };

  // ── version preview ───────────────────────────────────────────────────────

  const openPreview = async (sub: Submission & { agent?: Agent }) => {
    if (sub.html_content) {
      setPreviewVersionId(sub.id);
      setPreviewHtml(sub.html_content);
      return;
    }
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/submissions?projectId=${projectId}&requirementId=${sub.requirement_id}`);
      const data = await res.json() as { submissions: (Submission & { agent?: Agent })[] };
      const full = data.submissions.find(s => s.id === sub.id);
      if (full?.html_content) {
        setSubmissions(prev => prev.map(s => s.id === full.id ? { ...s, html_content: full.html_content } : s));
        setPreviewVersionId(sub.id);
        setPreviewHtml(full.html_content);
      }
    } finally {
      setLoadingPreview(false);
    }
  };

  const closePreview = () => {
    setPreviewVersionId(null);
    setPreviewHtml(null);
  };

  // ── auto-scroll feed ──────────────────────────────────────────────────────

  const feedReqCount = requirements.filter(r => !r.pending).length;
  useEffect(() => {
    feedBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feedReqCount]);

  // ── derived state ─────────────────────────────────────────────────────────

  const versions = useMemo(() =>
    [...submissions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
  [submissions]);

  const currentVersion = versions.length > 0 ? versions[versions.length - 1] : null;

  const versionNumberOf = useCallback((subId: string) => {
    const idx = versions.findIndex(v => v.id === subId);
    return idx >= 0 ? idx + 1 : null;
  }, [versions]);

  // ── countdown estimate ──────────────────────────────────────────────────
  // For each pending requirement, show a countdown based on the median
  // completion time of past requirements (median is more robust to outliers
  // than mean — one stuck job won't blow up the estimate).
  const medianCompletionSec = useMemo(() => {
    const samples: number[] = [];
    for (const r of requirements) {
      const sub = submissions.find(s => s.requirement_id === r.id);
      if (!sub) continue;
      const sec = (new Date(sub.created_at).getTime() - new Date(r.created_at).getTime()) / 1000;
      // Reject obvious noise: negative time, or anything over an hour
      if (sec > 0 && sec < 3600) samples.push(sec);
    }
    if (samples.length === 0) return null;
    samples.sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    return samples.length % 2 === 1 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;
  }, [requirements, submissions]);

  // "预计还需 1m 23s" / "已超时 0m 30s" — accuracy ±10s (tick interval),
  // well within the user's ±1min requirement.
  const formatRemaining = useCallback((elapsedSec: number, expectedSec: number) => {
    const remaining = expectedSec - elapsedSec;
    const abs = Math.max(0, Math.abs(Math.floor(remaining)));
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    const time = m > 0 ? `${m}m ${s}s` : `${s}s`;
    return remaining > 0 ? `预计还需 ${time}` : `已超时 ${time}`;
  }, []);

  const pendingReqs = requirements.filter(r => r.pending);
  const feedReqs = useMemo(() =>
    [...requirements]
      .filter(r => !r.pending)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
  [requirements]);

  const subForReq = useCallback((reqId: string) =>
    submissions.find(s => s.requirement_id === reqId),
  [submissions]);

  // ── center panel: pinned version overrides auto-follow-latest ────────────
  // If centerVersionId is set, render that version's html in the center panel.
  // Otherwise auto-follow the latest version.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (centerVersionId) {
      const pinned = submissions.find(s => s.id === centerVersionId);
      if (pinned?.html_content) setCenterHtml(pinned.html_content);
      return;
    }
    if (!currentVersion) { setCenterHtml(null); return; }
    if (currentVersion.html_content) { setCenterHtml(currentVersion.html_content); return; }
    fetch(`/api/current-page?projectId=${projectId}`)
      .then(r => r.json())
      .then((d: { current: { html: string } | null }) => { if (d.current?.html) setCenterHtml(d.current.html); })
      .catch(() => {});
  }, [currentVersion?.id, projectId, centerVersionId, submissions]);

  // ── view a specific version in the center panel ──────────────────────────
  // Triggered by the "查看" button next to a completed requirement. Keeps the
  // center panel pinned to that version (no longer auto-following the latest)
  // until the user explicitly clicks "回到最新".
  const viewInCenter = useCallback(async (sub: Submission & { agent?: Agent }) => {
    bumpActive();
    if (sub.html_content) {
      setCenterVersionId(sub.id);
      setCenterHtml(sub.html_content);
      return;
    }
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/submissions?projectId=${projectId}&requirementId=${sub.requirement_id}`);
      const data = await res.json() as { submissions: (Submission & { agent?: Agent })[] };
      const full = data.submissions.find(s => s.id === sub.id);
      if (full?.html_content) {
        setSubmissions(prev => prev.map(s => s.id === full.id ? { ...s, html_content: full.html_content } : s));
        setCenterVersionId(sub.id);
        setCenterHtml(full.html_content);
      }
    } finally {
      setLoadingPreview(false);
    }
  }, [bumpActive, projectId]);

  const followLatest = useCallback(() => {
    bumpActive();
    setCenterVersionId(null);
  }, [bumpActive]);

  // ── inline edit mode ─────────────────────────────────────────────────────
  // Injected into the iframe so the user can click any text to edit it.
  // Marker id lets us strip the script back out before saving.
  const EDIT_INJECT_MARKER = '__deeploop_edit_inject__';
  const buildEditableHtml = useCallback((html: string) => {
    // The injected script also listens for Ctrl/Cmd+S inside the iframe and
    // pings the parent via postMessage — keydown events from the iframe don't
    // bubble to the parent window, so without this the parent shortcut handler
    // wouldn't catch saves while the iframe has focus.
    const inject = `<script id="${EDIT_INJECT_MARKER}">(function(){try{document.body.contentEditable='true';document.designMode='on';document.body.spellcheck=false;document.body.style.outline='none';document.body.style.cursor='text';document.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();});});document.querySelectorAll('button,input[type=submit],input[type=button]').forEach(function(b){b.addEventListener('click',function(e){e.preventDefault();});});document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&(e.key==='s'||e.key==='S')){e.preventDefault();try{window.parent.postMessage({type:'deeploop-edit-save'},'*');}catch(err){}}},true);}catch(e){console.error('edit inject failed',e);}})();</script>`;
    if (html.includes('</body>')) return html.replace('</body>', inject + '</body>');
    return html + inject;
  }, []);

  const stripInjectedScript = useCallback((html: string) => {
    return html.replace(new RegExp(`<script id="${EDIT_INJECT_MARKER}"[\\s\\S]*?<\\/script>`, 'g'), '');
  }, []);

  const enterEditMode = useCallback(() => {
    if (!centerHtml) return;
    bumpActive();
    const editable = buildEditableHtml(centerHtml);
    const blob = new Blob([editable], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    setEditBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    setIsEditing(true);
  }, [centerHtml, bumpActive, buildEditableHtml]);

  const cancelEdit = useCallback(() => {
    bumpActive();
    setIsEditing(false);
    setEditBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
  }, [bumpActive]);

  const saveEdit = useCallback(async () => {
    if (!panelParticipantId) return;
    const doc = editIframeRef.current?.contentDocument;
    if (!doc) return;
    bumpActive();
    setSavingEdit(true);
    try {
      const raw = doc.documentElement.outerHTML;
      const cleaned = stripInjectedScript(raw);
      const finalHtml = cleaned.startsWith('<!') || cleaned.startsWith('<html')
        ? cleaned
        : `<!DOCTYPE html>\n${cleaned}`;
      const basedOnSubmissionId = centerVersionId
        ?? (versions.length > 0 ? versions[versions.length - 1].id : null);
      const res = await fetch('/api/edit-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          panelParticipantId,
          html: finalHtml,
          summary: '人工编辑',
          basedOnSubmissionId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        console.error('saveEdit failed', data.error);
        return;
      }
      // Exit edit mode and snap the center panel back to following the latest
      // version — which will be the just-saved edit, arriving via Realtime.
      setIsEditing(false);
      setEditBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
      setCenterVersionId(null);
      void loadData();
    } finally {
      setSavingEdit(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelParticipantId, projectId, centerVersionId, bumpActive, stripInjectedScript]);

  // Ctrl/Cmd+S to save while in edit mode. Two paths cover both focus states:
  //   - Parent document keydown: fires when focus is on the panel (sidebars,
  //     textarea, etc.) but not inside the editable iframe.
  //   - 'deeploop-edit-save' postMessage: fired from the iframe's own keydown
  //     handler (see buildEditableHtml) since iframe events don't bubble out.
  useEffect(() => {
    if (!isEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!savingEdit) void saveEdit();
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (e.data && typeof e.data === 'object' && (e.data as { type?: string }).type === 'deeploop-edit-save') {
        if (!savingEdit) void saveEdit();
      }
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('message', onMessage);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('message', onMessage);
    };
  }, [isEditing, savingEdit, saveEdit]);

  const onlineAgents = onlineUsers.filter(u => u.isAgent);
  const onlinePanelUsers = onlineUsers.filter(u => !u.isAgent);
  // Always surface DB-registered agents that aren't currently on the realtime
  // presence channel — the CLI (deeploop connect/work) doesn't track presence,
  // so without this fallback CLI agents would never appear at all.
  // We treat them as "just connected" (lastActiveAt = joined_at) so a freshly
  // connected agent shows up in the online group; it'll naturally fade to the
  // offline group after 100 s without a presence ping.
  const dbOnlyAgents: PresenceData[] = agents
    .filter(a => !onlineAgents.some(o => o.userId === a.id))
    .map(a => ({
      userId: a.id,
      name: a.name,
      status: 'idle' as UserStatus,
      isAgent: true,
      roleDescription: a.role_description,
      color: getUserColor(a.id),
      lastActiveAt: a.last_seen_at ? new Date(a.last_seen_at).getTime() : Date.now(),
    }));

  const allUsers = [...onlinePanelUsers, ...onlineAgents, ...dbOnlyAgents];

  // 100s inactivity threshold — anyone whose last activity is older goes to the offline group.
  // void tick is referenced above; this expression re-evaluates every 10 s.
  const ACTIVE_THRESHOLD_MS = 100_000;
  const now = Date.now();
  const isActive = (u: PresenceData) =>
    typeof u.lastActiveAt === 'number' && (now - u.lastActiveAt) <= ACTIVE_THRESHOLD_MS;

  const activeUsers = allUsers.filter(isActive);
  const offlineUsers = allUsers.filter(u => !isActive(u));
  const totalOnline = activeUsers.length;
  const totalOffline = offlineUsers.length;

  void myAgentId;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden liquid-bg" style={{ color: 'var(--c-text-1)' }}>
      {showAgentConnect && <AgentConnectModal projectId={projectId} onClose={() => setShowAgentConnect(false)} />}

      {/* Version preview modal */}
      {previewVersionId && previewBlobUrl && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#000' }}>
          <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0 glass-faint" style={{ borderBottom: '1px solid var(--c-border-2)' }}>
            <button onClick={closePreview} className="text-sm px-3 py-1.5 rounded-lg transition-all"
              style={{ color: 'var(--c-text-4)', border: '1px solid var(--c-border-3)' }}>
              ← 关闭预览
            </button>
            {(() => {
              const sub = versions.find(v => v.id === previewVersionId);
              const num = versionNumberOf(previewVersionId);
              return (
                <>
                  <span className="font-mono text-sm px-2 py-0.5 rounded"
                    style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                    v{num}
                  </span>
                  <span className="text-sm truncate max-w-xs" style={{ color: 'var(--c-text-3)' }}>{sub?.summary}</span>
                  <span className="text-sm" style={{ color: 'var(--c-text-6)' }}>{sub && timeAgo(sub.created_at)}</span>
                </>
              );
            })()}
            <button onClick={() => window.open(previewBlobUrl, '_blank')}
              className="ml-auto text-sm px-3 py-1.5 rounded-lg transition-all"
              style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', color: '#3b82f6' }}>
              在新窗口打开
            </button>
          </div>
          <iframe src={previewBlobUrl} className="flex-1 w-full border-0" title="版本预览" />
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 glass-panel relative z-40" style={{ borderBottom: '1px solid var(--c-border-2)' }}>
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm">DeepLoop</span>
          <span className="text-sm" style={{ color: 'var(--c-text-6)' }}>·</span>
          <span className="font-mono text-sm px-2 py-1 rounded" style={{ color: 'var(--c-text-5)', background: 'var(--c-overlay-md)' }}>
            {projectId}
          </span>
          <div className="flex items-center gap-1.5 text-sm pl-2.5 pr-1 py-0.5 rounded-lg"
            style={{ background: 'var(--c-overlay-md)', border: '1px solid var(--c-border-3)', color: 'var(--c-text-4)' }}>
            <span aria-hidden>🔗</span>
            <span className="truncate max-w-[280px] select-all" title="本项目链接，发给协作者邀请加入">
              {shareUrl || `/project/${projectId}`}
            </span>
            <button onClick={copyShareUrl}
              title={shareUrlCopied ? '已复制' : '复制本项目链接'}
              aria-label={shareUrlCopied ? '已复制' : '复制本项目链接'}
              className="flex items-center justify-center w-7 h-7 rounded-md transition-all"
              style={shareUrlCopied
                ? { background: 'rgba(34,197,94,0.18)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }
                : { background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.25)' }}>
              {shareUrlCopied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
          {currentVersion && (
            <button onClick={() => void openPreview(currentVersion)}
              disabled={loadingPreview}
              className="flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-lg transition-all disabled:opacity-50"
              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              全屏预览 v{versionNumberOf(currentVersion.id)}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowAgentConnect(true)}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg font-medium transition-all"
            style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.4)', color: '#a855f7' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            接入 Agent
          </button>
          <a href="/" className="text-sm px-3 py-1.5 rounded-lg transition-all"
            style={{ color: 'var(--c-text-5)', border: '1px solid var(--c-border-3)' }}>← 返回</a>
          {/* Appearance menu — hover to open. Popup is flush against the
              button (no gap) and shares hover handlers, so the cursor can
              travel from button to popup without the popup vanishing. */}
          <div className="relative"
            onMouseEnter={openAppearanceMenu}
            onMouseLeave={scheduleAppearanceClose}>
            <button
              type="button"
              aria-label="外观设置"
              title="外观设置"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
              style={{
                color: appearanceOpen ? '#a855f7' : 'var(--c-text-5)',
                border: `1px solid ${appearanceOpen ? 'rgba(168,85,247,0.4)' : 'var(--c-border-3)'}`,
                background: appearanceOpen ? 'rgba(168,85,247,0.10)' : 'transparent',
              }}>
              <span style={{ fontSize: '16px', lineHeight: 1 }} aria-hidden>⚙</span>
            </button>
            {appearanceOpen && (
              <div className="absolute top-full right-0 z-50 rounded-2xl glass-strong p-3 flex flex-col gap-3"
                onMouseEnter={openAppearanceMenu}
                onMouseLeave={scheduleAppearanceClose}
                style={{ minWidth: '208px', borderWidth: '1px', borderStyle: 'solid' }}>
                <div>
                  <p className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-6)' }}>主题</p>
                  <div className="flex flex-col gap-1">
                    {APPEARANCE_MODES.map(o => {
                      const active = themeMode === o.value;
                      return (
                        <button key={o.value} onClick={() => setThemeMode(o.value)}
                          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left"
                          style={active
                            ? { background: 'rgba(168,85,247,0.10)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.30)' }
                            : { background: 'transparent', color: 'var(--c-text-3)', border: '1px solid transparent' }}>
                          <span className="w-4 text-center" aria-hidden>{o.icon}</span>
                          <span>{o.label}</span>
                          {active && <span className="ml-auto text-sm">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--c-text-6)' }}>字号</p>
                  <div className="flex gap-1.5">
                    {APPEARANCE_FONTS.map(o => {
                      const active = themeFont === o.value;
                      return (
                        <button key={o.value} onClick={() => setThemeFont(o.value)}
                          className="flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors"
                          style={active
                            ? { background: 'rgba(168,85,247,0.10)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.30)' }
                            : { background: 'transparent', color: 'var(--c-text-4)', border: '1px solid var(--c-border-3)' }}>
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          {!panelParticipantId && <span className="text-amber-500 text-sm">会话已过期，请重新加入</span>}
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Users + Version History ── */}
        <div className="w-56 flex-shrink-0 flex flex-col glass-panel" style={{ borderRight: '1px solid var(--c-border-2)' }}>

          {/* Users (compact) */}
          <div className="px-3 pt-3 pb-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--c-border-2)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm uppercase tracking-wider" style={{ color: 'var(--c-text-6)' }}>在线 · {totalOnline}</p>
              <button onClick={() => setShowAgentConnect(true)}
                className="text-sm px-1.5 py-0.5 rounded transition-all"
                style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', color: '#a855f7' }}>
                + Agent
              </button>
            </div>
            {totalOnline === 0 ? (
              <p className="text-sm" style={{ color: 'var(--c-text-6)' }}>暂无在线用户</p>
            ) : (
              <div className="space-y-0.5">
                {activeUsers.map(u => <UserRow key={u.userId} user={u} />)}
              </div>
            )}
            {totalOffline > 0 && (
              <>
                <div className="mt-3 mb-1.5">
                  <p className="text-sm uppercase tracking-wider" style={{ color: 'var(--c-text-6)' }}>
                    下线 · {totalOffline}
                  </p>
                </div>
                <div className="space-y-0.5" style={{ opacity: 0.6 }}>
                  {offlineUsers.map(u => <UserRow key={u.userId} user={u} />)}
                </div>
              </>
            )}
          </div>

          {/* Version history */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 pt-2 pb-3">
              <p className="text-sm uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-6)' }}>
                版本历史 · {versions.length}
              </p>
              {versions.length === 0 ? (
                <p className="text-sm mt-6 text-center leading-relaxed" style={{ color: 'var(--c-text-6)' }}>
                  发布需求后<br />Agent 生成版本
                </p>
              ) : (
                [...versions].reverse().map((v, i) => {
                  const num = versions.length - i;
                  const isLatest = i === 0;
                  // What's currently in the center panel — could be the latest
                  // (auto-follow) or a manually pinned older version.
                  const isInCenter = centerVersionId
                    ? centerVersionId === v.id
                    : (currentVersion?.id === v.id);
                  // Container styling: in-center gets the bright highlight;
                  // others fade unless they're the latest.
                  const containerStyle = isInCenter
                    ? { background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.35)' }
                    : isLatest
                      ? { background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.18)' }
                      : { border: '1px solid transparent', opacity: 0.65 };
                  // Tag colors track in-center / latest priorities
                  const tagBg = isInCenter
                    ? 'rgba(59,130,246,0.18)'
                    : isLatest ? 'rgba(34,197,94,0.15)' : 'var(--c-overlay-md)';
                  const tagFg = isInCenter
                    ? '#3b82f6'
                    : isLatest ? '#22c55e' : 'var(--c-text-5)';
                  return (
                    <button key={v.id} onClick={() => void viewInCenter(v)}
                      disabled={loadingPreview}
                      title="在中间面板查看这个版本（可直接编辑，保存后成为最新）"
                      className="w-full text-left p-2.5 rounded-xl mb-1 transition-all disabled:opacity-50"
                      style={containerStyle}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-mono text-sm px-1.5 py-0.5 rounded"
                          style={{ background: tagBg, color: tagFg }}>
                          v{num}
                        </span>
                        {isLatest && <span className="text-sm" style={{ color: '#22c55e' }}>最新</span>}
                        {isInCenter && !isLatest && <span className="text-sm" style={{ color: '#3b82f6' }}>正在显示</span>}
                      </div>
                      <p className="text-sm leading-snug line-clamp-2" style={{ color: 'var(--c-text-3)' }}>
                        {v.summary || `版本 ${num}`}
                      </p>
                      <p className="text-sm mt-0.5" style={{ color: 'var(--c-text-6)' }}>{timeAgo(v.created_at)}</p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── Center: Live page preview ── */}
        <div className="flex-1 flex flex-col overflow-hidden relative" style={{ borderRight: '1px solid var(--c-border-2)' }}>
          {/* Edit-mode top toolbar */}
          {isEditing && (
            <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
              style={{ borderBottom: '1px solid rgba(168,85,247,0.25)', background: 'rgba(168,85,247,0.06)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              <span className="text-sm font-medium" style={{ color: '#a855f7' }}>编辑模式</span>
              <span className="text-sm" style={{ color: 'var(--c-text-5)' }}>
                直接点击页面上的文字即可修改，确定后会作为新版本提交（⌘S / Ctrl+S 快捷保存）
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={cancelEdit} disabled={savingEdit}
                  className="text-sm px-3 py-1 rounded transition-all disabled:opacity-50"
                  style={{ color: 'var(--c-text-4)', border: '1px solid var(--c-border-3)' }}>
                  取消
                </button>
                <button onClick={() => void saveEdit()} disabled={savingEdit || !panelParticipantId}
                  className="text-sm px-3 py-1 rounded font-medium transition-all disabled:opacity-50"
                  style={{ background: 'rgba(34,197,94,0.18)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.4)' }}>
                  {savingEdit ? '保存中...' : '确定'}
                </button>
              </div>
            </div>
          )}

          {/* Iframe — switches src when edit mode toggles */}
          {isEditing && editBlobUrl ? (
            <iframe ref={editIframeRef} src={editBlobUrl} className="flex-1 w-full border-0" title="编辑当前页面" sandbox="allow-scripts allow-same-origin" />
          ) : centerBlobUrl ? (
            <iframe src={centerBlobUrl} className="flex-1 w-full border-0" title="当前页面预览" sandbox="allow-scripts allow-same-origin" />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: 'var(--c-text-6)' }}>
              <span className="text-4xl">🎨</span>
              <p className="text-sm" style={{ color: 'var(--c-text-5)' }}>等待 Agent 生成第一个版本</p>
              <p className="text-sm opacity-60">发布需求后 Agent 将自动迭代页面</p>
            </div>
          )}

          {/* Floating glass control panel — top right of center area.
              Hidden in edit mode (the top edit toolbar takes its place). */}
          {!isEditing && (() => {
            const centerSub = centerVersionId
              ? submissions.find(s => s.id === centerVersionId)
              : currentVersion;
            if (!centerSub) return null;
            const isLatest = !centerVersionId || (currentVersion && centerVersionId === currentVersion.id);
            const tagBg = isLatest ? 'rgba(34,197,94,0.14)' : 'rgba(59,130,246,0.14)';
            const tagFg = isLatest ? '#22c55e' : '#3b82f6';
            const isAttached = attachedVersionId === centerSub.id;
            return (
              <div
                className="absolute top-4 right-4 z-10 rounded-2xl flex flex-col gap-2 p-2.5 glass-strong"
                style={{
                  width: '188px',
                }}>
                {/* Version badge row */}
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm px-2 py-0.5 rounded-md"
                    style={{ background: tagBg, color: tagFg }}>
                    v{versionNumberOf(centerSub.id)}
                  </span>
                  {!isLatest && (
                    <span className="text-sm px-1.5 py-0.5 rounded-md"
                      style={{ background: 'rgba(59,130,246,0.10)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.25)' }}>
                      历史
                    </span>
                  )}
                  <span className="text-sm ml-auto" style={{ color: 'var(--c-text-6)' }}>
                    {timeAgo(centerSub.created_at)}
                  </span>
                </div>

                {/* Summary */}
                <p className="text-sm leading-snug line-clamp-2" style={{ color: 'var(--c-text-4)' }}>
                  {centerSub.summary || '当前页面'}
                </p>

                {/* Actions — vertical stack, full-width buttons */}
                <div className="flex flex-col gap-1.5 pt-2"
                  style={{ borderTop: '1px solid var(--glass-edge)' }}>
                  <button onClick={() => { bumpActive(); setAttachedVersionId(isAttached ? null : centerSub.id); }}
                    disabled={!panelParticipantId}
                    className="text-sm px-3 py-1.5 rounded-xl transition-all disabled:opacity-40 text-left"
                    title={isAttached
                      ? '已选中此页作为下一条需求的基础，再点一次取消'
                      : '把这个版本设为下一条需求的修改基础，Agent 会基于它迭代'}
                    style={isAttached
                      ? { background: 'rgba(59,130,246,0.20)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.45)' }
                      : { background: 'rgba(59,130,246,0.08)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.25)' }}>
                    {isAttached ? '✓ 已选此页为基础' : '📎 选此页为基础'}
                  </button>
                  <button onClick={enterEditMode} disabled={!centerHtml || !panelParticipantId}
                    className="text-sm px-3 py-1.5 rounded-xl transition-all disabled:opacity-40 text-left"
                    title={panelParticipantId ? '在中间面板直接编辑这个版本的文字' : '请先重新加入项目'}
                    style={{ background: 'rgba(168,85,247,0.10)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.30)' }}>
                    ✎ 编辑文字
                  </button>
                  {!isLatest && currentVersion && (
                    <button onClick={followLatest}
                      className="text-sm px-3 py-1.5 rounded-xl transition-all text-left"
                      style={{ background: 'rgba(34,197,94,0.10)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.30)' }}>
                      ↩ 回到最新 v{versionNumberOf(currentVersion.id)}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Right: Feed + Input ── */}
        <div className="w-96 flex-shrink-0 flex flex-col overflow-hidden glass-panel">

          {/* Pending confirmation bar */}
          {pendingReqs.length > 0 && (
            <div className="flex-shrink-0 px-4 pt-3 pb-2.5" style={{ borderBottom: '1px solid rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.04)' }}>
              <p className="text-sm uppercase tracking-wider mb-2" style={{ color: '#f59e0b' }}>待确认 · {pendingReqs.length}</p>
              <div className="flex flex-col gap-1.5">
                {pendingReqs.map(r => (
                  <div key={r.id} className="flex items-start gap-2 px-3 py-2 rounded-xl"
                    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <p className="text-sm flex-1 leading-relaxed line-clamp-2" style={{ color: 'var(--c-text-3)' }}>{r.content}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => void confirmReq(r.id)}
                        className="text-sm px-2 py-0.5 rounded font-medium"
                        style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
                        确认
                      </button>
                      <button onClick={() => void dismissReq(r.id)}
                        className="text-sm px-2 py-0.5 rounded"
                        style={{ color: 'var(--c-text-6)', border: '1px solid var(--c-border-3)' }}>
                        忽略
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Requirements feed */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {feedReqs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--c-text-6)' }}>
                <span className="text-3xl">💬</span>
                <p className="text-sm">在下方描述你的需求</p>
                <p className="text-sm opacity-70">Agent 将迭代改进同一份页面</p>
              </div>
            ) : (
              feedReqs.map(r => {
                const sub = subForReq(r.id);
                const rawPoster = participantNames[r.posted_by] ?? r.posted_by.slice(0, 8);
                const posterName = displayName(rawPoster);
                const posterColor = getUserColor(r.posted_by);
                const isMine = r.posted_by === panelParticipantId;
                const pCfg = PRIORITY_CFG[r.priority];
                const reqElapsed = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 1000);
                const isProcessing = !sub && reqElapsed < 600;
                const vNum = sub ? versionNumberOf(sub.id) : null;

                return (
                  <div key={r.id} className="group">
                    {/* Header row */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{ background: posterColor, color: '#000' }}>
                        {posterName[0]?.toUpperCase()}
                      </div>
                      <span className="text-sm font-medium" style={{ color: 'var(--c-text-3)' }}>{posterName}</span>
                      {r.priority !== 'normal' && (
                        <span className="text-sm px-1.5 py-0.5 rounded"
                          style={{ background: pCfg.bg, color: pCfg.color, border: `1px solid ${pCfg.border}` }}>
                          {pCfg.label}
                        </span>
                      )}
                      <span className="text-sm ml-auto" style={{ color: 'var(--c-text-6)' }}>{timeAgo(r.created_at)}</span>
                      {isMine && (
                        <button onClick={() => void deleteMyReq(r.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-sm px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                          删除
                        </button>
                      )}
                    </div>

                    {/* Message bubble */}
                    <div className="ml-8">
                      <div className="inline-block px-3 py-2 rounded-2xl rounded-tl-sm text-sm leading-relaxed"
                        style={{ background: 'var(--c-overlay)', border: '1px solid var(--c-border-2)', color: 'var(--c-text-2)', maxWidth: '85%', wordBreak: 'break-word' }}>
                        {r.content}
                      </div>

                      {/* Version result */}
                      {sub ? (
                        <>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                            <span className="font-mono text-sm px-1.5 py-0.5 rounded"
                              style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
                              v{vNum}
                            </span>
                            <span className="text-sm" style={{ color: 'var(--c-text-4)' }}>{sub.agent?.name ?? 'Agent'} — {sub.summary}</span>
                            <span className="text-sm ml-auto" style={{ color: 'var(--c-text-6)' }}>{timeAgo(sub.created_at)}</span>
                            {centerVersionId === sub.id ? (
                              <span className="text-sm px-2 py-0.5 rounded"
                                style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
                                当前显示
                              </span>
                            ) : (
                              <button onClick={() => void viewInCenter(sub)} disabled={loadingPreview}
                                className="text-sm px-2 py-0.5 rounded transition-all disabled:opacity-50"
                                style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.25)' }}>
                                查看
                              </button>
                            )}
                          </div>
                          {/* Thinking trace — collapsible chain-of-thought from the agent */}
                          {sub.thinking && (() => {
                            const expanded = expandedThinking.has(sub.id);
                            const teaser = sub.thinking.length > 80
                              ? sub.thinking.slice(0, 80).replace(/\s+/g, ' ').trim() + '…'
                              : sub.thinking;
                            return (
                              <div className="mt-1.5 ml-3 pl-2.5 rounded-lg"
                                style={{ borderLeft: '2px solid rgba(168,85,247,0.35)', background: 'rgba(168,85,247,0.04)' }}>
                                <button onClick={() => toggleThinking(sub.id)}
                                  className="flex items-start gap-1.5 w-full text-left py-1.5 pr-2"
                                  title={expanded ? '收起思考过程' : '展开思考过程'}>
                                  <span className="text-sm flex-shrink-0" style={{ color: '#a855f7' }} aria-hidden>💭</span>
                                  <span className="text-sm flex-1 min-w-0 whitespace-pre-wrap break-words" style={{ color: 'var(--c-text-5)' }}>
                                    {expanded ? sub.thinking : teaser}
                                  </span>
                                  <span className="text-sm flex-shrink-0 self-center" style={{ color: 'var(--c-text-6)' }}>
                                    {expanded ? '收起' : '展开'}
                                  </span>
                                </button>
                              </div>
                            );
                          })()}
                        </>
                      ) : isProcessing ? (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                          <span className="text-sm text-amber-500">处理中...</span>
                          {medianCompletionSec !== null && (
                            <span className="text-sm" style={{ color: 'var(--c-text-5)' }}>
                              · {formatRemaining(reqElapsed, medianCompletionSec)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--c-text-6)' }} />
                          <span className="text-sm" style={{ color: 'var(--c-text-6)' }}>等待处理</span>
                          {medianCompletionSec !== null && (
                            <span className="text-sm" style={{ color: 'var(--c-text-5)' }}>
                              · {formatRemaining(reqElapsed, medianCompletionSec)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={feedBottomRef} />
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 p-4 glass-faint" style={{ borderTop: '1px solid var(--c-border-2)' }}>
            {/* Attached-version chip — shown when user has selected a base
                version via the center panel's 📎 button. Prepends 「基于 vN」
                to the post content so the agent knows which page to iterate. */}
            {attachedVersionId && (() => {
              const sub = submissions.find(s => s.id === attachedVersionId);
              if (!sub) return null;
              const vNum = versionNumberOf(sub.id);
              return (
                <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 rounded-lg"
                  style={{ background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.3)' }}>
                  <span className="text-sm flex-shrink-0" aria-hidden>📎</span>
                  <span className="text-sm flex-shrink-0 font-mono px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(59,130,246,0.18)', color: '#3b82f6' }}>
                    v{vNum}
                  </span>
                  <span className="text-sm truncate flex-1" style={{ color: 'var(--c-text-4)' }}>
                    基于此版本修改 — {sub.summary || '当前页面'}
                  </span>
                  <button onClick={() => { bumpActive(); setAttachedVersionId(null); }}
                    title="取消基于此版本"
                    aria-label="取消基于此版本"
                    className="flex items-center justify-center w-5 h-5 rounded-full transition-all flex-shrink-0"
                    style={{ background: 'rgba(59,130,246,0.18)', color: '#3b82f6' }}>
                    ×
                  </button>
                </div>
              );
            })()}
            {/* Textarea with embedded model picker bottom-right.
                Wrapped in a relative container so the circle button can sit
                inside the textarea visually. Padding-right reserves space for
                the floating circle so user typing doesn't run under it. */}
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); bumpActive(); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void postRequirement();
                  if (e.key === 'Escape') setModelMenuOpen(false);
                }}
                placeholder={panelParticipantId ? '描述你的需求，Agent 将在现有页面基础上迭代...' : '请重新加入获取权限'}
                rows={6}
                disabled={!panelParticipantId}
                className="app-input w-full rounded-xl px-3 py-2.5 pr-10 text-sm resize-none leading-relaxed"
                style={{ minHeight: '128px' }}
              />
              {/* Model picker: circular icon, click to expand menu */}
              <div className="absolute" style={{ bottom: '12px', right: '12px' }}>
                {modelMenuOpen && (
                  <>
                    {/* click-outside scrim */}
                    <div className="fixed inset-0 z-10" onClick={() => setModelMenuOpen(false)} />
                    <div className="absolute bottom-full right-0 mb-1.5 z-20 rounded-xl glass-strong p-1 flex flex-col gap-0.5"
                      style={{ minWidth: '208px', borderWidth: '1px', borderStyle: 'solid' }}>
                      <p className="text-sm uppercase tracking-wider px-2 pt-1.5 pb-1" style={{ color: 'var(--c-text-6)' }}>
                        当前可用模型
                      </p>
                      {(Object.keys(MODEL_CFG) as ModelChoice[]).map(m => {
                        const cfg = MODEL_CFG[m];
                        const active = selectedModel === m;
                        return (
                          <button key={m}
                            onClick={() => { setSelectedModel(m); setModelMenuOpen(false); bumpActive(); }}
                            className="flex items-start gap-2 px-2 py-1.5 rounded-lg text-left transition-all"
                            style={active
                              ? { background: `${cfg.color}26`, border: `1px solid ${cfg.color}66` }
                              : { background: 'transparent', border: '1px solid transparent' }}>
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0"
                              style={{ background: `${cfg.color}26`, color: cfg.color }}>
                              {cfg.letter}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-medium" style={{ color: active ? cfg.color : 'var(--c-text-2)' }}>
                                {cfg.full}
                              </span>
                              <span className="block text-sm leading-snug" style={{ color: 'var(--c-text-5)' }}>
                                {cfg.desc}
                              </span>
                            </span>
                            {active && <span className="text-sm flex-shrink-0" style={{ color: cfg.color }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                <button
                  onClick={() => { setModelMenuOpen(o => !o); bumpActive(); }}
                  type="button"
                  disabled={!panelParticipantId}
                  title={`当前模型: ${MODEL_CFG[selectedModel].full} — 点击切换`}
                  aria-label={`选择模型，当前: ${MODEL_CFG[selectedModel].full}`}
                  className="relative z-30 w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold transition-all disabled:opacity-30"
                  style={{
                    background: `${MODEL_CFG[selectedModel].color}26`,
                    color: MODEL_CFG[selectedModel].color,
                    border: `1px solid ${MODEL_CFG[selectedModel].color}59`,
                  }}>
                  {MODEL_CFG[selectedModel].letter}
                </button>
              </div>
            </div>
            <div className="flex gap-1.5 mt-2 mb-2">
              {(['normal', 'important', 'urgent'] as Priority[]).map(p => {
                const cfg = PRIORITY_CFG[p];
                const active = priority === p;
                return (
                  <button key={p} onClick={() => setPriority(p)}
                    className="flex-1 py-1 rounded-lg text-sm font-medium transition-all"
                    style={active
                      ? { background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }
                      : { background: 'transparent', border: '1px solid var(--c-border-2)', color: 'var(--c-text-5)' }}>
                    {cfg.label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => void postRequirement()}
              disabled={!input.trim() || posting || !panelParticipantId}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)', color: '#3b82f6' }}>
              {posting ? '发布中...' : '发布需求 ⌘↵'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
