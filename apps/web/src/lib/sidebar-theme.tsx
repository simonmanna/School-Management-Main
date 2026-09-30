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
    sidebar: 'linear-gradient(180deg, #0c4a6e 0%, #0a3f5f 50%, #082f49 100%)',
    sidebarBorder: 'rgba(186, 230, 253, 0.10)',
    sidebarText: '#e0f2fe',
    sidebarMuted: 'rgba(186, 230, 253, 0.62)',
    sidebarHover: 'rgba(255, 255, 255, 0.07)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(56, 189, 248, 0.20)',
    sidebarActiveBar: '#7dd3fc',
    brandBg: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
    accent: '#0ea5e9',
    accentHover: '#0284c7',
    accentText: '#0369a1',
    badgeBg: '#0ea5e9',
  },
  oceanTeal: {
    key: 'oceanTeal',
    label: 'Ocean Teal',
    swatch: '#14b8a6',
    sidebar: 'linear-gradient(180deg, #134e4a 0%, #0f3f3c 50%, #042f2e 100%)',
    sidebarBorder: 'rgba(153, 246, 228, 0.10)',
    sidebarText: '#ccfbf1',
    sidebarMuted: 'rgba(153, 246, 228, 0.58)',
    sidebarHover: 'rgba(255, 255, 255, 0.07)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(45, 212, 191, 0.18)',
    sidebarActiveBar: '#5eead4',
    brandBg: 'linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%)',
    accent: '#0d9488',
    accentHover: '#0f766e',
    accentText: '#134e4a',
    badgeBg: '#14b8a6',
  },
  slateNavy: {
    key: 'slateNavy',
    label: 'Slate Navy',
    swatch: '#475569',
    sidebar: 'linear-gradient(180deg, #1e293b 0%, #162032 50%, #0f172a 100%)',
    sidebarBorder: 'rgba(148, 163, 184, 0.12)',
    sidebarText: '#e2e8f0',
    sidebarMuted: 'rgba(148, 163, 184, 0.78)',
    sidebarHover: 'rgba(255, 255, 255, 0.06)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(96, 165, 250, 0.16)',
    sidebarActiveBar: '#60a5fa',
    brandBg: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
    accent: '#3b82f6',
    accentHover: '#2563eb',
    accentText: '#1d4ed8',
    badgeBg: '#3b82f6',
  },
  sageGreen: {
    key: 'sageGreen',
    label: 'Sage Green',
    swatch: '#65a30d',
    sidebar: 'linear-gradient(180deg, #2f4a12 0%, #243a0c 50%, #1a2e05 100%)',
    sidebarBorder: 'rgba(217, 249, 157, 0.10)',
    sidebarText: '#ecfccb',
    sidebarMuted: 'rgba(217, 249, 157, 0.55)',
    sidebarHover: 'rgba(255, 255, 255, 0.07)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(163, 230, 53, 0.16)',
    sidebarActiveBar: '#bef264',
    brandBg: 'linear-gradient(135deg, #84cc16 0%, #4d7c0f 100%)',
    accent: '#65a30d',
    accentHover: '#4d7c0f',
    accentText: '#365314',
    badgeBg: '#65a30d',
  },
  warmIndigo: {
    key: 'warmIndigo',
    label: 'Warm Indigo',
    swatch: '#6366f1',
    sidebar: 'linear-gradient(180deg, #312e81 0%, #272463 50%, #1e1b4b 100%)',
    sidebarBorder: 'rgba(199, 210, 254, 0.12)',
    sidebarText: '#e0e7ff',
    sidebarMuted: 'rgba(199, 210, 254, 0.62)',
    sidebarHover: 'rgba(255, 255, 255, 0.07)',
    sidebarActive: '#ffffff',
    sidebarActiveBg: 'rgba(165, 180, 252, 0.18)',
    sidebarActiveBar: '#c7d2fe',
    brandBg: 'linear-gradient(135deg, #818cf8 0%, #4f46e5 100%)',
    accent: '#6366f1',
    accentHover: '#4f46e5',
    accentText: '#3730a3',
    badgeBg: '#6366f1',
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