'use client';

import { useState } from 'react';
import { useTheme, type ThemeMode, type FontSize } from '@/hooks/useTheme';

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: '日间', icon: '☀' },
  { value: 'dark', label: '夜览', icon: '☽' },
  { value: 'system', label: '跟随系统', icon: '◎' },
];

const FONT_OPTIONS: { value: FontSize; label: string }[] = [
  { value: 's', label: '小' },
  { value: 'm', label: '中' },
  { value: 'l', label: '大' },
];

export default function ThemeToggle() {
  const [open, setOpen] = useState(false);
  const { mode, fontSize, changeMode, changeFontSize } = useTheme();

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2 select-none">
      {open && (
        <div
          className="rounded-2xl p-4 flex flex-col gap-4 min-w-[172px]"
          style={{
            background: 'var(--c-surface)',
            border: '1px solid var(--c-border-3)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
          }}
        >
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-widest mb-2.5"
              style={{ color: 'var(--c-text-5)' }}
            >
              主题
            </p>
            <div className="flex flex-col gap-1">
              {THEME_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => changeMode(o.value)}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors text-left w-full"
                  style={
                    mode === o.value
                      ? { background: 'rgba(168,85,247,0.1)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.25)' }
                      : { background: 'transparent', color: 'var(--c-text-3)', border: '1px solid transparent' }
                  }
                >
                  <span className="w-4 text-center text-base leading-none">{o.icon}</span>
                  <span>{o.label}</span>
                  {mode === o.value && <span className="ml-auto text-xs opacity-70">✓</span>}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-widest mb-2.5"
              style={{ color: 'var(--c-text-5)' }}
            >
              字号
            </p>
            <div className="flex gap-1.5">
              {FONT_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => changeFontSize(o.value)}
                  className="flex-1 py-2 rounded-xl text-sm font-medium transition-colors"
                  style={
                    fontSize === o.value
                      ? { background: 'rgba(168,85,247,0.1)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.25)' }
                      : { background: 'var(--c-bg)', color: 'var(--c-text-4)', border: '1px solid var(--c-border-3)' }
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
        style={{
          background: 'var(--c-surface)',
          border: '1px solid var(--c-border-3)',
          color: 'var(--c-text-4)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}
        title="外观设置"
      >
        {open ? <span style={{ fontSize: '18px', lineHeight: 1 }}>×</span> : <span style={{ fontSize: '14px' }}>⚙</span>}
      </button>
    </div>
  );
}
