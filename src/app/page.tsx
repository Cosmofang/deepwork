'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

const DEMO_PROJECTS = [
  { code: 'WEB001', name: '官网设计', desc: '官网页面、品牌表达、落地页与转化路径' },
  { code: 'SHOPAP', name: 'shopify app', desc: 'Shopify 应用功能、后台流程、插件体验' },
  { code: 'SEO001', name: 'shopify seo', desc: 'SEO 内容、商品页优化、搜索流量增长' },
];

const USER_PROJECTS_KEY = 'deeploop_user_projects';

interface UserProject {
  code: string;
  name: string;
  desc: string;
  createdAt: string;
}

interface ListedProject {
  code: string;
  name: string;
  desc: string;
  isUser: boolean;
}

export default function EntryPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [selectedProject, setSelectedProject] = useState<{ code: string; name: string; desc: string }>(DEMO_PROJECTS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Persisted user-created projects (localStorage). Keeping them out of the
  // database avoids a schema migration and is fine for "show me my projects on
  // this browser" — joining a project still upserts a row in the rooms table.
  const [userProjects, setUserProjects] = useState<UserProject[]>([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');

  useEffect(() => {
    const savedName = localStorage.getItem('user_name');
    if (savedName) setName(savedName);

    try {
      const raw = localStorage.getItem(USER_PROJECTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const projs = parsed
            .filter((p): p is UserProject =>
              typeof p === 'object' && p !== null
              && typeof (p as UserProject).code === 'string'
              && typeof (p as UserProject).name === 'string',
            );
          setUserProjects(projs);
          if (projs.length > 0) {
            setSelectedProject({ code: projs[0].code, name: projs[0].name, desc: projs[0].desc });
          }
        }
      }
    } catch {
      // corrupt JSON — ignore, keep defaults
    }
  }, []);

  const generateProjectCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

  const persistUserProjects = (next: UserProject[]) => {
    setUserProjects(next);
    try { localStorage.setItem(USER_PROJECTS_KEY, JSON.stringify(next)); } catch { /* quota or disabled */ }
  };

  const handleSubmitNewProject = () => {
    const trimmedName = newProjName.trim();
    if (!trimmedName) return;
    const code = generateProjectCode();
    const proj: UserProject = {
      code,
      name: trimmedName,
      desc: newProjDesc.trim() || '由你创建的 DeepLoop 项目',
      createdAt: new Date().toISOString(),
    };
    persistUserProjects([proj, ...userProjects]);
    setSelectedProject({ code, name: proj.name, desc: proj.desc });
    setNewProjName('');
    setNewProjDesc('');
    setShowNewForm(false);
  };

  const handleCancelNewProject = () => {
    setNewProjName('');
    setNewProjDesc('');
    setShowNewForm(false);
  };

  const handleDeleteUserProject = (code: string) => {
    if (typeof window !== 'undefined' && !window.confirm('确定从本机移除这个项目？\n\n（只会从你这台机器的列表里去掉，已加入的协作者和数据库里的内容不受影响。）')) return;
    const next = userProjects.filter(p => p.code !== code);
    persistUserProjects(next);
    if (selectedProject.code === code) {
      const fallback = next[0] ?? DEMO_PROJECTS[0];
      setSelectedProject({ code: fallback.code, name: fallback.name, desc: fallback.desc });
    }
  };

  // Merge user-created + demo. User ones first, demo ones filtered to avoid
  // duplicate codes if a user-created project ever collides.
  const allProjects = useMemo<ListedProject[]>(() => {
    const userList: ListedProject[] = userProjects.map(p => ({
      code: p.code, name: p.name, desc: p.desc, isUser: true,
    }));
    const userCodes = new Set(userList.map(p => p.code));
    const demoList: ListedProject[] = DEMO_PROJECTS
      .filter(d => !userCodes.has(d.code))
      .map(d => ({ ...d, isUser: false }));
    return [...userList, ...demoList];
  }, [userProjects]);

  const handleEnter = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError('');

    const code = selectedProject.code;
    try {
      const res = await fetch('/api/projects/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectCode: code, name: name.trim(), mode: 'panel' }),
      });
      const data = await res.json() as { projectId?: string; panelParticipantId?: string; error?: string };
      if (!res.ok || !data.projectId) {
        setError(data.error ?? '进入项目失败，请重试');
        setLoading(false);
        return;
      }
      if (data.panelParticipantId) localStorage.setItem(`panel_participant_id:${code}`, data.panelParticipantId);
      localStorage.setItem('project_id', code);
      localStorage.setItem('user_name', name.trim());
      router.push(`/project/${code}`);
    } catch {
      setError('连接失败，请重试');
      setLoading(false);
    }
  };

  const canEnter = name.trim() && selectedProject && !loading;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--c-bg)' }}>
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight mb-2" style={{ color: 'var(--c-text-1)' }}>DeepLoop</h1>
          <p className="text-sm" style={{ color: 'var(--c-text-5)' }}>选择项目 · 提交需求 · 接入 Agent 并发工作</p>
        </div>

        {/* Project concept */}
        <div
          className="rounded-xl p-3 mb-5 text-xs leading-relaxed"
          style={{ border: '1px solid var(--c-border-3)', background: 'var(--c-overlay)', color: 'var(--c-text-5)' }}
        >
          先选择要工作的项目，再进入项目面板。进入后可以查看项目代码、提交需求，并接入 Claude、OpenClaw、Hermes 等 Agent。
        </div>

        <div
          className="rounded-2xl p-6 space-y-5"
          style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-3)' }}
        >
          {/* Name */}
          <div>
            <label className="text-xs uppercase tracking-wider mb-2 block" style={{ color: 'var(--c-text-5)' }}>
              你的名字
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canEnter && handleEnter()}
              placeholder="输入名字..."
              className="app-input w-full rounded-xl px-4 py-3 text-sm"
            />
          </div>

          {/* Recent projects */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--c-text-5)' }}>
                最近工作项目
              </label>
              {!showNewForm && (
                <button
                  onClick={() => setShowNewForm(true)}
                  type="button"
                  className="text-xs px-2.5 py-1 rounded-lg transition-all"
                  style={{ background: 'var(--c-overlay-md)', border: '1px solid var(--c-border-3)', color: 'var(--c-text-4)' }}
                >
                  + 新建项目
                </button>
              )}
            </div>

            {/* New project form (inline, collapsible) */}
            {showNewForm && (
              <div
                className="mb-3 rounded-xl p-3 space-y-2"
                style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.25)' }}
              >
                <input
                  type="text"
                  value={newProjName}
                  onChange={e => setNewProjName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSubmitNewProject();
                    if (e.key === 'Escape') handleCancelNewProject();
                  }}
                  autoFocus
                  placeholder="项目名称（必填），例如：官网 v3"
                  className="app-input w-full rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={newProjDesc}
                  onChange={e => setNewProjDesc(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSubmitNewProject();
                    if (e.key === 'Escape') handleCancelNewProject();
                  }}
                  placeholder="项目描述（可选），例如：落地页转化优化"
                  className="app-input w-full rounded-lg px-3 py-2 text-sm"
                />
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSubmitNewProject}
                    disabled={!newProjName.trim()}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(168,85,247,0.18)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.4)' }}
                  >
                    创建
                  </button>
                  <button
                    onClick={handleCancelNewProject}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{ color: 'var(--c-text-5)', border: '1px solid var(--c-border-3)' }}
                  >
                    取消
                  </button>
                  <span className="text-[11px] ml-auto" style={{ color: 'var(--c-text-6)' }}>
                    项目代号会自动生成，保存在本机
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {allProjects.map(project => {
                const active = selectedProject.code === project.code;
                return (
                  <div
                    key={project.code}
                    className="relative group"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedProject({ code: project.code, name: project.name, desc: project.desc })}
                      className="w-full text-left rounded-xl p-3 transition-all"
                      style={active
                        ? { background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.4)' }
                        : { background: 'var(--c-overlay)', border: '1px solid var(--c-border-2)' }
                      }
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium" style={{ color: active ? '#3b82f6' : 'var(--c-text-2)' }}>{project.name}</span>
                        <span className="font-mono text-[10px]" style={{ color: 'var(--c-text-6)' }}>{project.code}</span>
                      </div>
                      <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: 'var(--c-text-5)' }}>{project.desc}</p>
                    </button>
                    {project.isUser && (
                      <button
                        onClick={() => handleDeleteUserProject(project.code)}
                        type="button"
                        title="从本机移除"
                        aria-label="从本机移除这个项目"
                        className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] transition-all opacity-0 group-hover:opacity-100"
                        style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={handleEnter}
            disabled={!canEnter}
            className="w-full py-3.5 rounded-xl font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', color: '#3b82f6' }}
          >
            {loading ? '进入中...' : `进入「${selectedProject.name}」 →`}
          </button>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: 'var(--c-text-6)' }}>
          Deeplumen · DeepLoop v2
        </p>
      </div>
    </div>
  );
}
