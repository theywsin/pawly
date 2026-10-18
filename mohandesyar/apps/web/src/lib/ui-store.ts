import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';

function readTheme(): Theme {
  try {
    return (localStorage.getItem('my.theme') as Theme) || 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme): void {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** UI-only state (docs/02: Zustand never holds server data). */
export const useUi = create<{ theme: Theme; sidebarOpen: boolean; setTheme(t: Theme): void; setSidebar(o: boolean): void }>((set) => ({
  theme: readTheme(),
  sidebarOpen: false,
  setTheme(theme) {
    try {
      localStorage.setItem('my.theme', theme);
    } catch {
      /* storage unavailable */
    }
    applyTheme(theme);
    set({ theme });
  },
  setSidebar(sidebarOpen) {
    set({ sidebarOpen });
  },
}));
