'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
const storageKey = 'peclat-crm-theme';

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
  window.addEventListener('peclat-theme-change', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('peclat-theme-change', onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light');

  function toggleTheme() {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // A preferência fica válida na sessão mesmo quando o armazenamento está indisponível.
    }
    window.dispatchEvent(new Event('peclat-theme-change'));
  }

  const dark = theme === 'dark';
  const label = dark ? 'Ativar modo claro' : 'Ativar modo escuro';
  return <button type="button" className="icon-button theme-toggle" aria-label={label} title={label} aria-pressed={dark} onClick={toggleTheme}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
}
