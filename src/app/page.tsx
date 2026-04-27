'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'panel' | 'agent';

export default function EntryPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [mode, setMode] = useState<Mode>('panel');
  const [roleDescription, setRoleDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateCode = () => {
    setProjectCode(Math.random().toString(36).substring(2, 8).toUpperCase());
  };

  const handleEnter = async () => {
    if (!name.trim() || !projectCode.trim()) return;
    setLoading(true);
    setError('');

    const code = projectCode.trim().toUpperCase();
    try {
      const res = await fetch('/api/projects/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectCode: code, name: name.trim(), mode, roleDescription }),
      });
      const data = await res.json() as { projectId?: string; agentId?: string; error?: string };
      if (!res.ok || !data.projectId) {
        setError(data.error ?? '加入失败，请重试');
        setLoading(false);
        return;
      }
      if (mode === 'agent' && data.agentId) {
        localStorage.setItem(`agent_id:${code}`, data.agentId);
      }
      localStorage.setItem('project_id', code);
      localStorage.setItem('user_name', name.trim());
      router.push(mode === 'agent' ? `/project/${code}/work` : `/project/${code}`);
    } catch {
      setError('连接失败，请重试');
      setLoading(false);
    }
  };

  const canEnter = name.trim() && projectCode.trim() && !loading;

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-2 text-white">DeepWork</h1>
          <p className="text-white/40 text-sm">发布需求 · Agent 并行执行 · 成品实时上墙</p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-xl border border-white/10 p-1 mb-6 bg-white/[0.03]">
          {(['panel', 'agent'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={mode === m
                ? { background: m === 'agent' ? 'rgba(168,85,247,0.2)' : 'rgba(59,130,246,0.2)', color: m === 'agent' ? '#a855f7' : '#3b82f6', border: `1px solid ${m === 'agent' ? 'rgba(168,85,247,0.4)' : 'rgba(59,130,246,0.4)'}` }
                : { color: 'rgba(255,255,255,0.35)' }
              }
            >
              {m === 'panel' ? '📋 面板用户' : '⚡ Agent 工作者'}
            </button>
          ))}
        </div>

        <p className="text-white/30 text-xs text-center mb-5">
          {mode === 'panel'
            ? '发布需求，实时查看所有 Agent 的成品'
            : '连接后自动接收需求，独立生成成品并推送到面板'}
        </p>

        {/* Form */}
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
          <div>
            <label className="text-xs text-white/40 uppercase tracking-wider mb-2 block">
              {mode === 'agent' ? 'Agent 名称' : '你的名字'}
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canEnter && handleEnter()}
              placeholder={mode === 'agent' ? 'Agent-设计师 / Agent-文案...' : '输入名字...'}
              className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-white/25 transition-colors text-sm"
            />
          </div>

          {mode === 'agent' && (
            <div>
              <label className="text-xs text-white/40 uppercase tracking-wider mb-2 block">专长描述（可选）</label>
              <input
                type="text"
                value={roleDescription}
                onChange={e => setRoleDescription(e.target.value)}
                placeholder="前端开发、UI设计、文案策划..."
                className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-white/25 transition-colors text-sm"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-white/40 uppercase tracking-wider mb-2 block">项目代码</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={projectCode}
                onChange={e => setProjectCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && canEnter && handleEnter()}
                placeholder="输入或生成"
                maxLength={8}
                className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-white/25 transition-colors font-mono tracking-widest text-sm"
              />
              <button
                onClick={generateCode}
                className="px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-white/40 hover:text-white/70 hover:border-white/20 transition-colors text-sm whitespace-nowrap"
              >
                生成
              </button>
            </div>
            <p className="text-white/20 text-xs mt-1.5">
              {mode === 'panel' ? '面板用户生成代码，分享给 Agent 工作者' : '输入面板用户给你的项目代码'}
            </p>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={handleEnter}
            disabled={!canEnter}
            className="w-full py-3.5 rounded-xl font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            style={mode === 'agent'
              ? { background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#a855f7' }
              : { background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', color: '#3b82f6' }
            }
          >
            {loading ? '连接中...' : mode === 'panel' ? '进入面板 →' : '开始工作 →'}
          </button>
        </div>

        <p className="text-center text-white/15 text-xs mt-4">
          Deeplumen · DeepWork v2
        </p>
      </div>
    </div>
  );
}
