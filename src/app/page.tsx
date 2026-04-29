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
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        backgroundImage: "url('/entry-bg.jpg')",
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div className="relative w-full" style={{ maxWidth: '548px' }}>
        {/* Main card — frosted glass with a near-neutral vertical gradient
            (saturation pulled way down from the previous lavender) so the
            rotating rainbow border carries all the color emphasis. */}
        <div
          className="rounded-3xl p-6 sm:p-7 relative rainbow-sweep"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.66) 0%, rgba(248,246,250,0.58) 55%, rgba(238,234,242,0.52) 100%)',
            backdropFilter: 'blur(60px) saturate(140%)',
            WebkitBackdropFilter: 'blur(60px) saturate(140%)',
            border: '1px solid rgba(255, 255, 255, 0.55)',
            boxShadow:
              '0 12px 36px rgba(15, 23, 42, 0.08),' +
              '0 2px 8px rgba(15, 23, 42, 0.03),' +
              'inset 0 1px 0 rgba(255, 255, 255, 0.75)',
          }}
        >
          {/* Hero illustration — soft purple wash with sparkles + selected pill */}
          <div
            className="rounded-2xl p-5 mb-5 relative overflow-hidden"
            style={{
              background:
                'linear-gradient(135deg, rgba(241,245,249,0.55) 0%, rgba(226,232,240,0.40) 60%, rgba(203,213,225,0.45) 100%)',
              border: '1px solid rgba(255, 255, 255, 0.4)',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.55)',
              minHeight: '160px',
            }}
          >
            {/* sparkle decorations */}
            <span className="absolute select-none" style={{ top: '14%', left: '8%', fontSize: '20px', color: '#0f172a', opacity: 0.85 }} aria-hidden>✦</span>
            <span className="absolute select-none" style={{ top: '60%', left: '15%', fontSize: '14px', color: '#0f172a', opacity: 0.55 }} aria-hidden>✧</span>
            <span className="absolute select-none" style={{ top: '20%', right: '10%', fontSize: '12px', color: '#0f172a', opacity: 0.5 }} aria-hidden>✦</span>
            <span className="absolute select-none" style={{ bottom: '14%', right: '20%', fontSize: '10px', color: '#475569', opacity: 0.45 }} aria-hidden>✧</span>

            {/* dot/particle texture */}
            <div className="absolute inset-0 pointer-events-none" style={{
              background:
                'radial-gradient(circle at 25% 70%, rgba(255,255,255,0.6) 1px, transparent 2px),' +
                'radial-gradient(circle at 75% 30%, rgba(255,255,255,0.5) 1px, transparent 2px),' +
                'radial-gradient(circle at 50% 85%, rgba(255,255,255,0.5) 1px, transparent 2px)',
              backgroundSize: '40px 40px, 60px 60px, 80px 80px',
              opacity: 0.6,
            }} />

            {/* selected project pill — floats over the gradient */}
            <div className="relative flex flex-col items-end gap-2 z-10 mt-2">
              <div
                className="flex items-center gap-2 pl-3 pr-4 py-2 rounded-full"
                style={{
                  background: 'rgba(255, 255, 255, 0.65)',
                  backdropFilter: 'blur(16px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                  boxShadow: '0 6px 18px rgba(15,23,42,0.10), inset 0 1px 0 rgba(255,255,255,0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.7)',
                }}
              >
                <span style={{ color: '#0f172a' }} aria-hidden>✦</span>
                <span className="font-medium" style={{ color: '#1f2937', fontSize: '15px' }}>{selectedProject.name}</span>
                <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(15,23,42,0.10)', color: '#0f172a' }}>{selectedProject.code}</span>
              </div>
              <p className="text-xs pr-1 max-w-[260px] text-right" style={{ color: '#475569', opacity: 0.85 }}>
                {selectedProject.desc}
              </p>
            </div>

            {/* paper plane icon bottom-left */}
            <div className="absolute bottom-3 left-3 z-10" style={{ color: '#0f172a', opacity: 0.7 }} aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13" />
                <path d="m22 2-7 20-4-9-9-4z" />
              </svg>
            </div>
          </div>

          {/* Form: name input */}
          <div className="space-y-3 mb-4">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && canEnter && handleEnter()}
              placeholder="你的名字"
              className="w-full rounded-2xl px-5 py-3 text-sm transition-all"
              style={{
                background: 'rgba(255, 255, 255, 0.55)',
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                border: '1px solid rgba(255, 255, 255, 0.7)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
                color: '#1f2937',
                outline: 'none',
              }}
            />
          </div>

          {/* Project chooser */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-medium uppercase tracking-wider" style={{ color: '#475569' }}>
                选择项目
              </span>
              {!showNewForm && (
                <button
                  onClick={() => setShowNewForm(true)}
                  type="button"
                  className="text-xs px-3 py-1 rounded-full font-medium transition-all"
                  style={{ background: 'rgba(15,23,42,0.10)', color: '#0f172a', border: '1px solid rgba(15,23,42,0.25)' }}
                >
                  + 新建
                </button>
              )}
            </div>

            {/* New project form (inline, collapsible) */}
            {showNewForm && (
              <div className="mb-3 rounded-2xl p-3 space-y-2"
                style={{ background: 'rgba(15,23,42,0.05)', border: '1px solid rgba(15,23,42,0.20)' }}
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
                  placeholder="项目名称（必填）"
                  className="w-full rounded-xl px-3 py-2 text-sm"
                  style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.7)', outline: 'none', color: '#1f2937' }}
                />
                <input
                  type="text"
                  value={newProjDesc}
                  onChange={e => setNewProjDesc(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSubmitNewProject();
                    if (e.key === 'Escape') handleCancelNewProject();
                  }}
                  placeholder="项目描述（可选）"
                  className="w-full rounded-xl px-3 py-2 text-sm"
                  style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.7)', outline: 'none', color: '#1f2937' }}
                />
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    onClick={handleSubmitNewProject}
                    disabled={!newProjName.trim()}
                    className="text-xs px-3 py-1.5 rounded-full font-medium transition-all disabled:opacity-40"
                    style={{ background: '#0f172a', color: '#fff' }}
                  >
                    创建
                  </button>
                  <button
                    onClick={handleCancelNewProject}
                    className="text-xs px-3 py-1.5 rounded-full transition-all"
                    style={{ color: '#475569' }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {allProjects.map(project => {
                const active = selectedProject.code === project.code;
                return (
                  <div key={project.code} className="relative group">
                    <button
                      type="button"
                      onClick={() => setSelectedProject({ code: project.code, name: project.name, desc: project.desc })}
                      className="rounded-full px-3.5 py-1.5 text-xs font-medium transition-all"
                      style={active
                        ? {
                            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
                            color: '#ffffff',
                            boxShadow: '0 6px 16px rgba(15,23,42,0.30), inset 0 1px 0 rgba(255,255,255,0.3)',
                            border: '1px solid rgba(255,255,255,0.2)',
                          }
                        : {
                            background: 'rgba(255, 255, 255, 0.55)',
                            backdropFilter: 'blur(12px)',
                            WebkitBackdropFilter: 'blur(12px)',
                            color: '#0f172a',
                            border: '1px solid rgba(255,255,255,0.7)',
                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
                          }
                      }
                    >
                      {active && <span className="mr-1" aria-hidden>✦</span>}
                      {project.name}
                    </button>
                    {project.isUser && (
                      <button
                        onClick={() => handleDeleteUserProject(project.code)}
                        type="button"
                        title="从本机移除"
                        aria-label="从本机移除这个项目"
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] transition-all opacity-0 group-hover:opacity-100"
                        style={{ background: '#ef4444', color: '#fff' }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

          {/* Enter button — gradient pill */}
          <button
            onClick={handleEnter}
            disabled={!canEnter}
            className="w-full py-3.5 rounded-full font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
            style={canEnter
              ? {
                  background: '#0f172a',
                  color: '#ffffff',
                  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.28)',
                }
              : {
                  background: '#e5e7eb',
                  color: '#9ca3af',
                }
            }
          >
            {loading ? (
              <>处理中...</>
            ) : (
              <>
                <span aria-hidden>✦</span>
                <span>进入「{selectedProject.name}」</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </>
            )}
          </button>

          {/* Title + subtitle (anchored at the bottom of the card) */}
          <div className="mt-6 pt-5" style={{ borderTop: '1px solid #e2e8f0' }}>
            <h2 className="font-bold text-lg mb-0.5" style={{ color: '#0f172a' }}>DeepLoop</h2>
            <p className="text-xs" style={{ color: '#6b7280' }}>选择项目 · 提交需求 · 接入 Agent 并发工作。</p>
          </div>
        </div>

        <p className="text-center text-xs mt-4" style={{ color: '#475569' }}>
          Deeplumen · DeepLoop v2
        </p>
      </div>
    </div>
  );
}
