/**
 * Sidebar / accent color theme system.
 *
 * Distinct from the existing light/dark ThemeProvider (which only flips a
 * `dark` class on <html>). This provider cycles through 5 branded palettes
 * that tint the sidebar gradient and accent color — useful for white-label
 * deployments and per-customer aesthetics.
 *
 * The active palette is persisted to localStorage and rehydrated on mount.
 * Components that need the palette use the `useSidebarTheme()` hook and apply
 * the colors via inline styles (we need CSS gradients, which Tailwind can't
 * express cleanly).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type SidebarThemeKey =
  | 'skyBlue'
  | 'oceanTeal'
  | 'slateNavy'
  | 'sageGreen'
  | 'warmIndigo';

export interface SidebarTheme {
  key: SidebarThemeKey;
  label: string;
  swatch: string;
  /** Background of the sidebar (linear-gradient string). */
  sidebar: string;
  /** Divider lines inside the sidebar. */
  sidebarBorder: string;
  /** Default text color. */
  sidebarText: string;
  /** Muted text color (sub-items, hints). */
  sidebarMuted: string;
  /** Hover background. */
  sidebarHover: string;
  /** Text color when a nav item is active. */
  sidebarActive: string;
  /** Background for active nav item. */
  sidebarActiveBg: string;
  /** Accent bar on the left edge of the active item. */
  sidebarActiveBar: string;
  /** Brand-tile background (logo box). */
  brandBg: string;
  /** Primary accent (buttons, badges, focus rings). */
  accent: string;
  accentHover: string;
  accentText: string;
  badgeBg: string;
}

export const SIDEBAR_THEMES: Record<SidebarThemeKey, SidebarTheme> = {
  skyBlue: {
    key: 'skyBlue',
    label: 'Sky Blue',
    swatch: '#38bdf8',
    sidebar: 'linear-gradient(180deg, #0369a1 0%, #0369a1 45%, #0369a1 100%)',
    sidebarBorder: 'rgba(255, 255, 255, 0.12)',
    sidebarText: '#f0f9ff',
    sidebarMuted: 'rgba(186, 230, 255, 0.65)',
    sidebarHover: 'rgba(255, 255, 255, 0.12)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(255, 255, 255, 0.22)',
    sidebarActiveBar: '#ffffff',
    brandBg: 'rgba(255, 255, 255, 0.20)',
    accent: '#0ea5e9',
    accentHover: '#0284c7',
    accentText: '#0369a1',
    badgeBg: '#7dd3fc',
  },
  oceanTeal: {
    key: 'oceanTeal',
    label: 'Ocean Teal',
    swatch: '#14b8a6',
    sidebar: 'linear-gradient(180deg, #14b8a6 0%, #0d9488 45%, #064e3b 100%)',
    sidebarBorder: 'rgba(255, 255, 255, 0.10)',
    sidebarText: '#f0fdfa',
    sidebarMuted: 'rgba(153, 246, 228, 0.60)',
    sidebarHover: 'rgba(255, 255, 255, 0.08)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(255, 255, 255, 0.18)',
    sidebarActiveBar: '#5eead4',
    brandBg: 'rgba(255, 255, 255, 0.15)',
    accent: '#0d9488',
    accentHover: '#0f766e',
    accentText: '#134e4a',
    badgeBg: '#2dd4bf',
  },
  slateNavy: {
    key: 'slateNavy',
    label: 'Slate Navy',
    swatch: '#475569',
    sidebar: 'linear-gradient(180deg, #334155 0%, #1e293b 45%, #0f172a 100%)',
    sidebarBorder: 'rgba(255, 255, 255, 0.05)',
    sidebarText: '#f8fafc',
    sidebarMuted: 'rgba(148, 163, 184, 0.70)',
    sidebarHover: 'rgba(255, 255, 255, 0.06)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(255, 255, 255, 0.10)',
    sidebarActiveBar: '#38bdf8',
    brandBg: 'rgba(255, 255, 255, 0.08)',
    accent: '#3b82f6',
    accentHover: '#2563eb',
    accentText: '#1d4ed8',
    badgeBg: '#60a5fa',
  },
  sageGreen: {
    key: 'sageGreen',
    label: 'Sage Green',
    swatch: '#65a30d',
    sidebar: 'linear-gradient(180deg, #65a30d 0%, #3f6212 45%, #1a2e05 100%)',
    sidebarBorder: 'rgba(255, 255, 255, 0.08)',
    sidebarText: '#f7fee7',
    sidebarMuted: 'rgba(190, 242, 100, 0.55)',
    sidebarHover: 'rgba(255, 255, 255, 0.08)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(255, 255, 255, 0.15)',
    sidebarActiveBar: '#bef264',
    brandBg: 'rgba(255, 255, 255, 0.12)',
    accent: '#65a30d',
    accentHover: '#4d7c0f',
    accentText: '#365314',
    badgeBg: '#a3e635',
  },
  warmIndigo: {
    key: 'warmIndigo',
    label: 'Warm Indigo',
    swatch: '#6366f1',
    sidebar: 'linear-gradient(180deg, #818cf8 0%, #6366f1 45%, #4338ca 100%)',
    sidebarBorder: 'rgba(255, 255, 255, 0.12)',
    sidebarText: '#eef2ff',
    sidebarMuted: 'rgba(199, 210, 254, 0.65)',
    sidebarHover: 'rgba(255, 255, 255, 0.10)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(255, 255, 255, 0.20)',
    sidebarActiveBar: '#c7d2fe',
    brandBg: 'rgba(255, 255, 255, 0.18)',
    accent: '#6366f1',
    accentHover: '#4f46e5',
    accentText: '#3730a3',
    badgeBg: '#a5b4fc',
  },
};

interface SidebarThemeContextValue {
  key: SidebarThemeKey;
  theme: SidebarTheme;
  setKey: (k: SidebarThemeKey) => void;
}

const Ctx = createContext<SidebarThemeContextValue | null>(null);

const STORAGE_KEY = 'poscafe.sidebarThemeKey';
const DEFAULT_KEY: SidebarThemeKey = 'skyBlue';

export function SidebarThemeProvider({ children }: { children: React.ReactNode }) {
  const [key, setKeyState] = useState<SidebarThemeKey>(() => {
    if (typeof window === 'undefined') return DEFAULT_KEY;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return (stored && stored in SIDEBAR_THEMES) ? (stored as SidebarThemeKey) : DEFAULT_KEY;
  });

  // Expose the accent + sidebar gradient as CSS variables on :root so any
  // styled component can pick them up without needing the hook.
  useEffect(() => {
    const t = SIDEBAR_THEMES[key];
    const root = document.documentElement;
    root.style.setProperty('--sb-accent', t.accent);
    root.style.setProperty('--sb-accent-hover', t.accentHover);
    root.style.setProperty('--sb-accent-text', t.accentText);
    root.style.setProperty('--sb-sidebar', t.sidebar);
  }, [key]);

  const setKey = useCallback((k: SidebarThemeKey) => {
    setKeyState(k);
    try { window.localStorage.setItem(STORAGE_KEY, k); } catch { /* ignore */ }
  }, []);

  const value = useMemo<SidebarThemeContextValue>(
    () => ({ key, theme: SIDEBAR_THEMES[key], setKey }),
    [key, setKey],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSidebarTheme(): SidebarThemeContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSidebarTheme must be used within SidebarThemeProvider');
  return v;
}