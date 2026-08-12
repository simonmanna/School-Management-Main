/**
 * ThemePicker — dropdown for switching the sidebar color palette.
 *
 * Renders a swatch button in the header. On click, opens a small popover
 * listing all 5 sidebar palettes with a swatch + label, and an "Active"
 * badge on the current one.
 */
import { useEffect, useRef, useState } from 'react';
import { Palette, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSidebarTheme, SIDEBAR_THEMES, type SidebarThemeKey } from '@/lib/sidebar-theme';

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { key, setKey } = useSidebarTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = SIDEBAR_THEMES[key];

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size={compact ? 'icon' : 'sm'}
        onClick={() => setOpen((o) => !o)}
        title="Color theme"
        aria-label="Color theme"
      >
        {compact ? (
          <Palette className="h-4 w-4" />
        ) : (
          <>
            <span
              className="inline-block h-4 w-4 rounded-full border-2 border-white shadow-sm"
              style={{ background: current.swatch }}
              aria-hidden
            />
            <span className="hidden md:inline">{current.label}</span>
          </>
        )}
      </Button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 p-3"
          style={{
            width: 256,
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            border: '1px solid #e8edf2',
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span style={{ fontWeight: 600, fontSize: 13, color: '#1e293b' }}>Color Theme</span>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-0.5 transition-colors hover:bg-gray-100"
              style={{ color: '#94a3b8' }}
              aria-label="Close"
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1">
            {(Object.keys(SIDEBAR_THEMES) as SidebarThemeKey[]).map((k) => {
              const t = SIDEBAR_THEMES[k];
              const isActive = k === key;
              return (
                <button
                  key={k}
                  onClick={() => { setKey(k); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all',
                  )}
                  style={{
                    background: isActive ? '#f0f9ff' : 'transparent',
                    border: isActive ? '1.5px solid #bae6fd' : '1px solid transparent',
                  }}
                >
                  <span
                    className="shrink-0 rounded-full border-2 border-white"
                    style={{
                      width: 18,
                      height: 18,
                      background: t.swatch,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                    }}
                    aria-hidden
                  />
                  <span
                    style={{
                      fontSize: 13,
                      color: '#334155',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {t.label}
                  </span>
                  {isActive && (
                    <span className="ml-auto" style={{ color: '#0ea5e9' }}>
                      <Check style={{ width: 14, height: 14 }} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}