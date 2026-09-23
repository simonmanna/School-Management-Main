import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Save } from 'lucide-react';
import { TERMINOLOGY_DEFAULTS, TERMINOLOGY_KEYS, type Terminology } from '@erp/shared';
import { useSchoolProfile, useUpdateSchoolProfile, type UpdateSchoolProfileInput } from '@/features/school/api';
import { useCurrencies } from '@/features/accounting/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';

/**
 * School settings — identity, money and time, capacity policy and terminology.
 *
 * Everything here is configuration, not code: another country's school sets its
 * own currency, time zone and words ("Class Group" instead of "Stream") without
 * a release. Currency and time zone are saved on the organization, the single
 * source every module reads.
 */

const TERM_LABELS: Record<keyof Terminology, string> = {
  academicLevel: 'Academic level',
  academicLevelPlural: 'Academic levels (plural)',
  gradeLevel: 'Grade level',
  gradeLevelPlural: 'Grade levels (plural)',
  class: 'Class',
  classPlural: 'Classes (plural)',
  section: 'Subdivision of a class',
  sectionPlural: 'Subdivisions (plural)',
  academicYear: 'Academic year',
  academicYearPlural: 'Academic years (plural)',
  term: 'Term',
  termPlural: 'Terms (plural)',
  learner: 'Learner',
  learnerPlural: 'Learners (plural)',
};

const COMMON_ZONES = ['Africa/Kampala', 'Africa/Nairobi', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'Africa/Lagos', 'UTC'];

type Draft = UpdateSchoolProfileInput & { terminology: Partial<Terminology> };

export function SchoolSettingsPage() {
  const { data: profile, isLoading, isError } = useSchoolProfile();
  const { data: currencies } = useCurrencies();
  const update = useUpdateSchoolProfile();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!profile) return;
    setDraft({
      name: profile.name ?? '',
      motto: profile.motto ?? '',
      logoUrl: profile.logoUrl ?? '',
      address: profile.address ?? '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
      website: profile.website ?? '',
      country: profile.country ?? '',
      currencyCode: profile.currencyCode ?? '',
      timezone: profile.timezone ?? 'UTC',
      capacityPolicy: profile.capacityPolicy ?? 'ENFORCE',
      terminology: { ...(profile.terminology ?? {}) },
    });
  }, [profile]);

  const zoneValid = useMemo(() => {
    if (!draft?.timezone) return false;
    try {
      new Intl.DateTimeFormat('en', { timeZone: draft.timezone });
      return true;
    } catch {
      return false;
    }
  }, [draft?.timezone]);

  if (isLoading || !draft) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading school settings…
      </div>
    );
  }
  if (isError) {
    return <div className="p-6 text-sm text-destructive">Could not load the school profile. Check your connection and permissions.</div>;
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const setTerm = (key: keyof Terminology, value: string) =>
    setDraft((d) => {
      if (!d) return d;
      const terminology = { ...d.terminology };
      if (value.trim() === '') delete terminology[key];
      else terminology[key] = value;
      return { ...d, terminology };
    });

  const save = async () => {
    if (!draft.name?.trim()) {
      notify.error('The school needs a name.');
      return;
    }
    if (!zoneValid) {
      notify.error(`"${draft.timezone}" is not a valid time zone.`);
      return;
    }
    const payload: UpdateSchoolProfileInput = {
      ...draft,
      email: draft.email?.trim() || undefined,
      country: draft.country?.trim().toUpperCase() || undefined,
      terminology: Object.fromEntries(
        Object.entries(draft.terminology).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
      ),
    };
    try {
      await update.mutateAsync(payload);
      notify.success('School settings saved.');
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Could not save the settings.');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">School settings</h1>
          <p className="text-sm text-muted-foreground">Identity, currency, time zone, capacity rules and the words your school uses.</p>
        </div>
        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {([
            ['name', 'School name'],
            ['motto', 'Motto'],
            ['logoUrl', 'Logo URL'],
            ['address', 'Address'],
            ['phone', 'Phone'],
            ['email', 'Email'],
            ['website', 'Website'],
            ['country', 'Country (ISO code, e.g. UG)'],
          ] as const).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`profile-${key}`}>{label}</Label>
              <Input id={`profile-${key}`} value={(draft[key] as string) ?? ''} onChange={(e) => set(key, e.target.value)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Money, time and capacity</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="profile-currency">Currency</Label>
            <select
              id="profile-currency"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={draft.currencyCode ?? ''}
              onChange={(e) => set('currencyCode', e.target.value)}
            >
              {(currencies ?? []).map((c: any) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
              {!currencies?.some((c: any) => c.code === draft.currencyCode) && draft.currencyCode && (
                <option value={draft.currencyCode}>{draft.currencyCode}</option>
              )}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="profile-tz">Time zone</Label>
            <Input id="profile-tz" list="tz-options" value={draft.timezone ?? ''} onChange={(e) => set('timezone', e.target.value)} />
            <datalist id="tz-options">{COMMON_ZONES.map((z) => <option key={z} value={z} />)}</datalist>
            {!zoneValid && <p className="text-xs text-destructive">Not a valid IANA time zone.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="profile-capacity">When a class or stream is full</Label>
            <select
              id="profile-capacity"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={draft.capacityPolicy}
              onChange={(e) => set('capacityPolicy', e.target.value as Draft['capacityPolicy'])}
            >
              <option value="ENFORCE">Refuse (authorised override with a reason)</option>
              <option value="WARN">Warn but allow</option>
              <option value="OFF">Ignore capacity</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Terminology</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => set('terminology', {})}>
            <RotateCcw className="mr-2 h-4 w-4" /> Use defaults
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <p className="text-sm text-muted-foreground md:col-span-2">
            Leave a field empty to keep the default. The data model does not change — only the words shown.
          </p>
          {TERMINOLOGY_KEYS.map((key) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`term-${key}`}>{TERM_LABELS[key]}</Label>
              <Input
                id={`term-${key}`}
                maxLength={40}
                placeholder={TERMINOLOGY_DEFAULTS[key]}
                value={draft.terminology[key] ?? ''}
                onChange={(e) => setTerm(key, e.target.value)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
