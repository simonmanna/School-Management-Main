import { schoolTodayNow } from '@/lib/format';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronDown, ChevronUp, Download, Eye, FileText, GripVertical, Image, LayoutGrid,
  Maximize2, Palette, PenLine, Plus, Printer, RotateCcw, Save, Search, ShieldCheck, Sparkles,
  Table as TableIcon, Trash2, Type, Upload, User, X,
} from 'lucide-react';
import {
  useApplyReportCardPreset,
  useReportCardSettings,
  useReportCardSettingsSchema,
  useResetReportCardSettings,
  useSchoolProfile,
  useUpdateReportCardSettings,
  type ReportCardColumnItem,
  type ReportCardFieldDef,
} from '@/features/school/api';
import { notify } from '@/lib/notify';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ReportCardPreview,
  SAMPLE_PREVIEW_DATA,
  pageDimensions,
  type ReportCardPreviewData,
} from './_components/report-card-preview';

/**
 * Report Card Studio — the org's printable report card designer.
 *
 * The control panel renders itself from the field registry served by
 * `GET /school/report-card-settings/schema`, so an option added on the server
 * appears here without a client change. The right pane is a paper-accurate
 * mirror of the PDF renderer, updating on every keystroke.
 */

const GROUP_ICONS: Record<string, typeof FileText> = {
  FileText, Image, Type, Palette, User, Table: TableIcon, LayoutGrid, PenLine, ShieldCheck,
};

export function SchoolReportCardSettingsPage() {
  const { data: saved, isLoading } = useReportCardSettings();
  const { data: schema } = useReportCardSettingsSchema();
  const { data: school } = useSchoolProfile();
  const update = useUpdateReportCardSettings();
  const applyPreset = useApplyReportCardPreset();
  const resetSettings = useResetReportCardSettings();

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [group, setGroup] = useState<string>('paper');
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(0.72);
  const [fit, setFit] = useState(true);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewFrame = useRef<HTMLDivElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  // Effective settings = what is stored, with unsaved edits laid over the top.
  const effective = useMemo(
    () => ({ ...(saved ?? {}), ...draft }) as Record<string, any>,
    [saved, draft],
  );

  const dirtyKeys = useMemo(
    () => Object.keys(draft).filter((k) => !deepEqual(draft[k], (saved as any)?.[k])),
    [draft, saved],
  );
  const dirty = dirtyKeys.length > 0;

  const setField = useCallback((key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    if (!dirty) return;
    const patch = Object.fromEntries(dirtyKeys.map((k) => [k, draft[k]]));
    try {
      await update.mutateAsync(patch);
      setDraft({});
      notify.success('Report card design saved', `${dirtyKeys.length} setting${dirtyKeys.length === 1 ? '' : 's'} updated`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not save the report card design');
    }
  }, [dirty, dirtyKeys, draft, update]);

  // Ctrl/Cmd+S saves, matching every other editor the user has open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Warn before losing unsaved edits on a hard navigation.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  // Scale the page down to whatever the preview column can actually show.
  useEffect(() => {
    if (!fit) return;
    const el = previewFrame.current;
    if (!el) return;
    const recompute = () => {
      const pageWidthPx = (pageDimensions(effective).w / 25.4) * 96;
      setZoom(clamp((el.clientWidth - 24) / pageWidthPx, 0.3, 1.4));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, effective.pageSize, effective.orientation]);

  const previewData = useMemo<ReportCardPreviewData>(() => ({
    ...SAMPLE_PREVIEW_DATA,
    school: school
      ? {
          name: school.name ?? SAMPLE_PREVIEW_DATA.school.name,
          motto: (school as any).motto ?? undefined,
          address: (school as any).address ?? undefined,
          phone: (school as any).phone ?? undefined,
          email: (school as any).email ?? undefined,
          website: (school as any).website ?? undefined,
          logoUrl: (school as any).logoUrl ?? undefined,
        }
      : SAMPLE_PREVIEW_DATA.school,
  }), [school]);

  const doPreset = async (key: string) => {
    try {
      await applyPreset.mutateAsync(key);
      setDraft({});
      notify.success(`Applied the ${key} preset`, 'Every setting was replaced — fine-tune from here.');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not apply that preset');
    }
  };

  const doReset = async (scope?: string) => {
    try {
      await resetSettings.mutateAsync(scope);
      setDraft((d) => {
        if (!scope || !schema) return {};
        const keys = new Set(schema.fields.filter((f) => f.group === scope).map((f) => f.key));
        return Object.fromEntries(Object.entries(d).filter(([k]) => !keys.has(k)));
      });
      notify.success(scope ? 'Section reset to defaults' : 'Report card reset to defaults');
    } catch {
      notify.error('Could not reset');
    }
  };

  const exportJson = () => {
    if (!schema) return;
    const payload = Object.fromEntries(schema.fields.map((f) => [f.key, effective[f.key]]));
    const blob = new Blob([JSON.stringify({ _kind: 'report-card-design', version: 2, settings: payload }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-card-design-${schoolTodayNow()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = (parsed?.settings ?? parsed) as Record<string, unknown>;
      const known = new Set((schema?.fields ?? []).map((f) => f.key));
      const patch = Object.fromEntries(Object.entries(incoming).filter(([k]) => known.has(k)));
      if (Object.keys(patch).length === 0) {
        notify.error('That file has no recognisable report card settings');
        return;
      }
      setDraft((d) => ({ ...d, ...patch }));
      notify.success(`Loaded ${Object.keys(patch).length} settings`, 'Review the preview, then save.');
    } catch {
      notify.error('Could not read that file — expected JSON exported from this page');
    }
  };

  const printPreview = () => {
    const node = previewRef.current;
    if (!node) return;
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) {
      notify.error('Allow pop-ups to print the preview');
      return;
    }
    const page = pageDimensions(effective);
    w.document.write(
      `<!doctype html><html><head><title>Report Card Preview</title>` +
      `<style>@page{size:${page.w}mm ${page.h}mm;margin:0}body{margin:0}</style>` +
      `</head><body>${node.outerHTML}</body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  if (isLoading || !schema) {
    return <div className="p-6 text-sm text-muted-foreground">Loading the report card designer…</div>;
  }
  if (!saved) {
    return <div className="p-6 text-sm text-muted-foreground">Unable to load report card settings.</div>;
  }

  const searching = query.trim().length > 0;
  const visibleFields = schema.fields.filter((f) => {
    if (searching) {
      const q = query.toLowerCase();
      return f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q) || (f.help ?? '').toLowerCase().includes(q);
    }
    return f.group === group;
  }).filter((f) => shouldShow(f, effective));

  const activeGroup = schema.groups.find((g) => g.key === group);

  return (
    <div className="mx-auto max-w-[1700px] p-6">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            Report Card Studio
            {dirty && <Badge variant="secondary">{dirtyKeys.length} unsaved</Badge>}
            {!dirty && saved.presetKey && <Badge variant="outline" className="capitalize">{saved.presetKey}</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">
            Design the printable report card. Everything here drives the generated PDF — the page on the right is what prints.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
          <Button variant="ghost" size="sm" onClick={() => importInput.current?.click()} title="Load a design file">
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button variant="ghost" size="sm" onClick={exportJson} title="Save this design to a file">
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="ghost" size="sm" onClick={printPreview} title="Print the preview page">
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void doReset()} disabled={resetSettings.isPending}>
            <RotateCcw className="h-4 w-4" /> Reset All
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || update.isPending}>
            <Save className="h-4 w-4" /> {update.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* ── Presets ─────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Start from
          </span>
          {schema.presets.map((p) => (
            <button
              key={p.key}
              type="button"
              title={p.description}
              onClick={() => void doPreset(p.key)}
              disabled={applyPreset.isPending}
              className={cn(
                'group rounded-md border px-3 py-1.5 text-left text-sm transition-colors hover:border-primary hover:bg-accent',
                saved.presetKey === p.key && !dirty && 'border-primary bg-accent',
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {saved.presetKey === p.key && !dirty && <Check className="h-3.5 w-3.5 text-primary" />}
                {p.label}
              </span>
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            Applying a preset replaces every setting.
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-12">
        {/* ── Control panel ─────────────────────────────────────────── */}
        <div className="space-y-3 xl:col-span-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search every setting…"
              className="w-full rounded-md border bg-card py-2 pl-9 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {!searching && (
            <div className="flex flex-wrap gap-1 rounded-md border bg-muted/40 p-1">
              {schema.groups.map((g) => {
                const Icon = GROUP_ICONS[g.icon] ?? FileText;
                const count = schema.fields.filter((f) => f.group === g.key && dirtyKeys.includes(f.key)).length;
                return (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setGroup(g.key)}
                    className={cn(
                      'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
                      group === g.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {g.label}
                    {count > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{count}</span>}
                  </button>
                );
              })}
            </div>
          )}

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">
                  {searching ? `${visibleFields.length} matching setting${visibleFields.length === 1 ? '' : 's'}` : activeGroup?.label}
                </CardTitle>
                {!searching && activeGroup && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{activeGroup.description}</p>
                )}
              </div>
              {!searching && (
                <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void doReset(group)} disabled={resetSettings.isPending}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </Button>
              )}
            </CardHeader>
            <CardContent className="max-h-[calc(100vh-22rem)] space-y-4 overflow-y-auto pb-4">
              {visibleFields.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {searching ? 'No settings match that search.' : 'Nothing to configure here.'}
                </p>
              )}
              {visibleFields.map((f) => (
                <FieldControl
                  key={f.key}
                  field={f}
                  value={effective[f.key]}
                  changed={dirtyKeys.includes(f.key)}
                  onChange={(v) => setField(f.key, v)}
                  onReset={() => setField(f.key, schema.defaults[f.key])}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        {/* ── Live preview ──────────────────────────────────────────── */}
        <div className="xl:col-span-7">
          <Card className="sticky top-4">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Eye className="h-4 w-4" /> Live Preview
                <span className="text-xs font-normal text-muted-foreground">
                  {String(effective.pageSize)} · {String(effective.orientation)}
                </span>
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant={fit ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setFit(true)}
                  title="Fit the page to the panel"
                >
                  <Maximize2 className="h-3.5 w-3.5" /> Fit
                </Button>
                {[0.5, 0.75, 1].map((z) => (
                  <Button
                    key={z}
                    variant={!fit && zoom === z ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => { setFit(false); setZoom(z); }}
                  >
                    {z * 100}%
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <div ref={previewFrame} className="overflow-auto rounded-md bg-muted/40 p-3" style={{ maxHeight: 'calc(100vh - 14rem)' }}>
                <div
                  style={{
                    width: `${(pageDimensions(effective).w / 25.4) * 96 * zoom}px`,
                    height: `${(pageDimensions(effective).h / 25.4) * 96 * zoom}px`,
                    margin: '0 auto',
                  }}
                >
                  <div
                    style={{
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top left',
                      boxShadow: '0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.10)',
                      width: 'fit-content',
                    }}
                  >
                    <ReportCardPreview ref={previewRef} settings={effective} data={previewData} />
                  </div>
                </div>
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Sample marks · real school identity. Generated PDFs use each student's own results.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Field controls ─────────────────────────────────────────────────────────

interface ControlProps {
  field: ReportCardFieldDef;
  value: unknown;
  changed: boolean;
  onChange: (v: unknown) => void;
  onReset: () => void;
}

function FieldControl({ field, value, changed, onChange, onReset }: ControlProps) {
  const inline = field.type === 'boolean';

  return (
    <div className={cn('rounded-md', changed && 'ring-1 ring-primary/30')}>
      <div className={cn('flex gap-3', inline ? 'items-center justify-between' : 'flex-col')}>
        <div className={cn('min-w-0', inline && 'flex-1')}>
          <label className="flex items-center gap-1.5 text-sm font-medium">
            {field.label}
            {changed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" title="Unsaved change" />}
            {changed && (
              <button type="button" onClick={onReset} className="text-[10px] uppercase text-muted-foreground hover:text-foreground">
                revert
              </button>
            )}
          </label>
          {field.help && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{field.help}</p>}
        </div>
        <div className={cn(inline ? 'shrink-0' : 'w-full')}>
          <FieldInput field={field} value={value} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: ReportCardFieldDef; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'boolean':
      return <Switch checked={Boolean(value)} onChange={onChange} label={field.label} />;

    case 'color':
      return <ColorInput value={String(value ?? '#000000')} onChange={onChange} />;

    case 'number':
      return <NumberInput field={field} value={Number(value ?? field.default ?? 0)} onChange={onChange} />;

    case 'select':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        >
          {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );

    case 'textarea':
      return (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="w-full resize-y rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      );

    case 'list':
      return <ListInput value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />;

    case 'columns':
      return <ColumnsInput field={field} value={Array.isArray(value) ? (value as ReportCardColumnItem[]) : []} onChange={onChange} />;

    case 'text':
    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      );
  }
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card p-1 pl-1.5">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
        aria-label="Colour picker"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="w-full bg-transparent font-mono text-xs uppercase outline-none"
      />
    </div>
  );
}

function NumberInput({ field, value, onChange }: { field: ReportCardFieldDef; value: number; onChange: (v: number) => void }) {
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const step = field.step ?? 1;
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer accent-primary"
        aria-label={field.label}
      />
      <div className="flex w-[76px] shrink-0 items-center gap-1 rounded-md border bg-card px-2 py-1">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
          className="w-full bg-transparent text-right text-xs tabular-nums outline-none"
        />
        {field.unit && <span className="text-[10px] text-muted-foreground">{field.unit}</span>}
      </div>
    </div>
  );
}

/** Free-form repeated text lines — footer lines, conduct traits, signatories. */
function ListInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const set = (i: number, v: string) => onChange(value.map((x, j) => (j === i ? v : x)));
  return (
    <div className="space-y-1.5">
      {value.map((line, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={line}
            onChange={(e) => set(i, e.target.value)}
            className="w-full rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label="Remove line"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange([...value, ''])} disabled={value.length >= 20}>
        <Plus className="h-3.5 w-3.5" /> Add line
      </Button>
    </div>
  );
}

/**
 * Ordered, tickable, renameable list. Order is the print order, so it supports
 * both drag-and-drop and keyboard-reachable move buttons.
 */
function ColumnsInput({
  field,
  value,
  onChange,
}: {
  field: ReportCardFieldDef;
  value: ReportCardColumnItem[];
  onChange: (v: ReportCardColumnItem[]) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const locked = new Set(field.locked ?? []);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length || from === to) return;
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const patch = (i: number, changes: Partial<ReportCardColumnItem>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...changes } : x)));

  const enabledCount = value.filter((x) => x.enabled).length;

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-2.5 py-1.5 text-xs text-muted-foreground">
        <span>{enabledCount} of {value.length} shown</span>
        <div className="flex gap-1">
          <button type="button" className="hover:text-foreground" onClick={() => onChange(value.map((x) => ({ ...x, enabled: true })))}>
            All
          </button>
          <span>·</span>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => onChange(value.map((x) => ({ ...x, enabled: locked.has(x.key) })))}
          >
            None
          </button>
        </div>
      </div>
      <ul className="max-h-72 divide-y overflow-y-auto">
        {value.map((item, i) => (
          <li
            key={item.key}
            draggable
            onDragStart={() => setDragging(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (dragging != null) move(dragging, i); setDragging(null); }}
            onDragEnd={() => setDragging(null)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1.5 transition-colors',
              dragging === i && 'opacity-40',
              !item.enabled && 'bg-muted/40',
            )}
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
            <input
              type="checkbox"
              checked={item.enabled}
              disabled={locked.has(item.key)}
              onChange={(e) => patch(i, { enabled: e.target.checked })}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Show ${item.label}`}
            />
            <input
              value={item.label}
              onChange={(e) => patch(i, { label: e.target.value })}
              className={cn(
                'w-full min-w-0 bg-transparent text-sm outline-none',
                !item.enabled && 'text-muted-foreground line-through',
              )}
              aria-label={`Label for ${item.key}`}
            />
            <div className="flex shrink-0">
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label="Move up">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === value.length - 1} className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label="Move down">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * A field is hidden when its `showIf` predicate fails. With no `equals` the
 * test is "meaningfully on" — which for a select means anything but 'none'.
 */
function shouldShow(field: ReportCardFieldDef, settings: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  const actual = settings[field.showIf.key];
  if (field.showIf.equals !== undefined) return actual === field.showIf.equals;
  return actual !== false && actual !== 'none' && actual !== '' && actual != null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
