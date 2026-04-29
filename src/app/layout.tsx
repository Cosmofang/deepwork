import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeepLoop — 集体意图，AI 合成',
  description: '多人协作的新范式：意图 + 合成',
};

// Runs before React hydration to prevent theme flash. Theme + font scale are
// still managed via the useTheme hook (used by the inline appearance menu in
// the project panel top bar) — only the floating bottom-right ThemeToggle UI
// has been removed.
const INIT_SCRIPT = `(function(){try{
  var m=localStorage.getItem('dw-theme')||'system';
  var f=localStorage.getItem('dw-font')||'m';
  var fps={s:14,m:16,l:18};
  document.documentElement.style.fontSize=(fps[f]||16)+'px';
  if(m==='dark'||(m==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches)){
    document.documentElement.classList.add('dark');
  }
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <head>
        <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
