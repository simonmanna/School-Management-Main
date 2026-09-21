import { useRef, useState } from 'react';
import {
  AlertTriangle, Download, PackageOpen, RefreshCw, Settings2, Upload, Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useLmsCourses, useLmsExportCourse, useLmsImportCourse, useLmsOrphans,
  useLmsRepairOrphans, useLmsRollover, useTerms,
} from '@/features/school/api';
import { notify } from '@/lib/notify';

type Tab = 'backup' | 'rollover' | 'maintenance';

const PICK = '__pick__';

/**
 * LMS administration (L8) — backup, restore, rollover and the orphan check.
 *
 * These routes shipped with no screen, so a term rollover meant rebuilding every
 * course by hand. Rollover copies STRUCTURE only: never pupils, submissions or
 * marks, and the server refuses a target term that already has activities.
 */
export function SchoolLmsAdminPage() {
  const [tab, setTab] = useState<Tab>('backup');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-5 w-5" />
        <h1 className="text-xl font-semibold">LMS administration</h1>
      </div>

      <div className="flex gap-2 border-b">
        {([
          { key: 'backup', label: 'Backup & restore' },
          { key: 'rollover', label: 'Term rollover' },
          { key: 'maintenance', label: 'Maintenance' },
        ] as { key: Tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm ${tab === t.key ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'backup' && <BackupPanel />}
      {tab === 'rollover' && <RolloverPanel />}
      {tab === 'maintenance' && <MaintenancePanel />}
    </div>
  );
}

function BackupPanel() {
  const { data: courses } = useLmsCourses();
  const [source, setSource] = useState(PICK);
  const [target, setTarget] = useState(PICK);
  const [includeUserData, setIncludeUserData] = useState(false);
  const [bundle, setBundle] = useState<unknown | null>(null);
  const [bundleName, setBundleName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const exportCourse = useLmsExportCourse();
  const importCourse = useLmsImportCourse();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base"><Download className="h-4 w-4" />Export a course</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Course</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger><SelectValue placeholder="Pick a course" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PICK} disabled>Pick a course</SelectItem>
                {courses?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeUserData} onChange={(e) => setIncludeUserData(e.target.checked)} />
            Include pupil data (submissions and attempts)
          </label>
          <Button
            disabled={source === PICK || exportCourse.isPending}
            onClick={async () => {
              try {
                const data = await exportCourse.mutateAsync({ id: source, includeUserData });
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `course-${source.slice(0, 8)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                notify.success('Bundle downloaded');
              } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Export failed'); }
            }}
          >
            <Download className="mr-1 h-4 w-4" />Download bundle
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="flex items-center gap-2 text-base"><PackageOpen className="h-4 w-4" />Restore into a course</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Bundle file</Label>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  setBundle(JSON.parse(await file.text()));
                  setBundleName(file.name);
                } catch {
                  notify.error('That file is not valid JSON');
                  setBundle(null);
                  setBundleName(null);
                }
              }}
            />
            <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-4 w-4" />{bundleName ?? 'Choose a bundle…'}
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Restore into</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue placeholder="Pick a course" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PICK} disabled>Pick a course</SelectItem>
                {courses?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!bundle || target === PICK || importCourse.isPending}
            onClick={async () => {
              try {
                await importCourse.mutateAsync({ id: target, bundle, includeUserData: false });
                notify.success('Bundle restored');
              } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Restore failed'); }
            }}
          >
            Restore
          </Button>
          <p className="text-xs text-muted-foreground">
            Restore adds the bundle's sections and activities to the chosen course. It does not
            replace what is already there.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function RolloverPanel() {
  const { data: terms } = useTerms();
  const [fromTermId, setFrom] = useState(PICK);
  const [toTermId, setTo] = useState(PICK);
  const rollover = useLmsRollover();

  return (
    <Card className="max-w-xl">
      <CardHeader className="py-3">
        <CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4" />Roll courses into a new term</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">From term</Label>
            <Select value={fromTermId} onValueChange={setFrom}>
              <SelectTrigger><SelectValue placeholder="Term" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PICK} disabled>Pick a term</SelectItem>
                {terms?.data?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To term</Label>
            <Select value={toTermId} onValueChange={setTo}>
              <SelectTrigger><SelectValue placeholder="Term" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PICK} disabled>Pick a term</SelectItem>
                {terms?.data?.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          disabled={fromTermId === PICK || toTermId === PICK || fromTermId === toTermId || rollover.isPending}
          onClick={async () => {
            try {
              const r: any = await rollover.mutateAsync({ fromTermId, toTermId });
              notify.success(`Rolled over ${r?.copied ?? r?.count ?? 0} course(s)`);
            } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Rollover failed'); }
          }}
        >
          <RefreshCw className="mr-1 h-4 w-4" />Roll over
        </Button>
        <p className="text-xs text-muted-foreground">
          Structure only — sections, activities and their settings. Pupils, submissions and marks
          are never carried across, and a target course that already has activities is skipped.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Orphan check (ADR-014 §4). `CourseModule.instanceId` is polymorphic and untyped,
 * which the ADR accepted only on condition this check exists — a module whose
 * plugin row has vanished renders as a broken activity until it is repaired.
 */
function MaintenancePanel() {
  const { data, isLoading, refetch } = useLmsOrphans();
  const repair = useLmsRepairOrphans();
  const orphans: any[] = (data as any)?.orphans ?? (Array.isArray(data) ? data : []);

  return (
    <Card className="max-w-2xl">
      <CardHeader className="flex flex-row items-center justify-between py-3">
        <CardTitle className="flex items-center gap-2 text-base"><Wrench className="h-4 w-4" />Orphaned activities</CardTitle>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1 h-4 w-4" />Re-scan
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Scanning…</p>}
        {!isLoading && orphans.length === 0 && (
          <p className="text-sm text-muted-foreground">No orphaned activities. Every module has its plugin row.</p>
        )}
        {orphans.length > 0 && (
          <>
            <p className="flex items-center gap-2 text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              {orphans.length} activity/activities point at a missing plugin row.
            </p>
            <ul className="divide-y rounded-md border text-sm">
              {orphans.map((o: any) => (
                <li key={o.id ?? o.courseModuleId} className="flex items-center gap-2 p-2">
                  <span className="min-w-0 flex-1 truncate">{o.activityType ?? 'unknown'}</span>
                  <Badge variant="outline" className="text-[10px]">{(o.id ?? o.courseModuleId ?? '').slice(0, 8)}</Badge>
                </li>
              ))}
            </ul>
            <Button
              variant="destructive"
              disabled={repair.isPending}
              onClick={async () => {
                try {
                  const ids = orphans.map((o: any) => o.id ?? o.courseModuleId).filter(Boolean);
                  const r: any = await repair.mutateAsync(ids);
                  notify.success(`Repaired ${r?.repaired ?? ids.length} module(s)`);
                } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Repair failed'); }
              }}
            >
              Soft-delete orphans
            </Button>
            <p className="text-xs text-muted-foreground">
              Repair re-verifies every id before touching it and soft-deletes only confirmed orphans.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
