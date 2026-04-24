'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { ROLES } from '@/lib/roles';
import { RoleId, SynthesisResult } from '@/types';

const ROLE_DATA = Object.fromEntries(
  Object.entries(ROLES).map(([k, v]) => [k, { label: v.label, color: v.color }])
);

function injectAttribution(html: string): string {
  const script = `
<style>
  [data-source] { transition: outline 0.15s; outline: 2px solid transparent; outline-offset: 2px; }
</style>
<script>
(function() {
  const ROLES = ${JSON.stringify(ROLE_DATA)};
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.92);border:1px solid rgba(255,255,255,0.12);color:#fff;padding:7px 18px;border-radius:999px;font-size:12px;pointer-events:none;transition:opacity 0.15s;opacity:0;z-index:9999;white-space:nowrap;font-family:-apple-system,sans-serif;letter-spacing:0.01em;';
  document.body.appendChild(tip);
  document.querySelectorAll('[data-source]').forEach(function(el) {
    el.addEventListener('mouseenter', function() {
      var role = this.getAttribute('data-source');
      var r = ROLES[role];
      if (!r) return;
      this.style.outline = '2px solid ' + r.color + '50';
      tip.innerHTML = '<span style="color:' + r.color + '">←</span> 来自 ' + r.label;
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

export default function ResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    supabase
      .from('synthesis_results')
      .select('*')
      .eq('room_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        setResult(data);
        setLoading(false);
      });
  }, [id]);

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

  if (!result) {
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

  return (
    <div className="h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/room/${id}`)}
            className="text-gray-500 hover:text-white transition-colors text-sm"
          >
            ← 继续迭代
          </button>
          <span className="text-gray-700">·</span>
          <span className="text-sm text-gray-400">合成结果 · Round {result.round}</span>
        </div>
        <span className="text-xs text-gray-600">悬停区块查看归因</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* HTML preview */}
        <div className="flex-1">
          <iframe
            srcDoc={injectAttribution(result.html_content)}
            className="w-full h-full border-0"
            title="合成产物"
            sandbox="allow-scripts"
          />
        </div>

        {/* Attribution sidebar */}
        <div className="w-52 border-l border-white/10 overflow-y-auto p-4 flex-shrink-0">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">归因摘要</p>

          {result.attribution_map && Object.entries(result.attribution_map).map(([section, roleId]) => {
            const r = ROLES[roleId as RoleId];
            if (!r) return null;
            return (
              <div key={section} className="mb-3 flex items-start gap-2">
                <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: r.color }} />
                <div>
                  <span className="text-xs font-medium" style={{ color: r.color }}>{r.label}</span>
                  <p className="text-xs text-gray-600 leading-snug">{section}</p>
                </div>
              </div>
            );
          })}

          {result.conflicts_resolved && result.conflicts_resolved.length > 0 && (
            <div className="mt-5 pt-4 border-t border-white/10">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">冲突解决</p>
              {result.conflicts_resolved.map((c, i) => (
                <p key={i} className="text-xs text-gray-600 mb-2 leading-snug">{c}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
