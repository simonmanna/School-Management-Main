import { useEffect, useState } from 'react';
import { useReportCardSettings, useUpdateReportCardSettings, type ReportCardSettings } from '@/features/school/api';
import { notify } from '@/lib/notify';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const COLOR_FIELDS: { key: keyof ReportCardSettings; label: string }[] = [
  { key: 'schoolNameColor', label: 'School Name Color' },
  { key: 'schoolAddressColor', label: 'School Address Color' },
  { key: 'contactColor', label: 'Contact Color' },
  { key: 'websiteColor', label: 'Website Color' },
  { key: 'emailColor', label: 'Email Color' },
  { key: 'reportTitleColor', label: 'Report Title Color' },
];

const TOGGLE_FIELDS: { key: keyof ReportCardSettings; label: string }[] = [
  { key: 'showSchoolLogo', label: 'Show School Logo' },
  { key: 'showStudentPhoto', label: 'Show Student Photo' },
  { key: 'showWatermark', label: 'Show Watermark' },
  { key: 'showClassTeacherComment', label: 'Class Teachers Comment' },
  { key: 'showHeadTeacherComment', label: 'Head Teachers Comment' },
  { key: 'showTermEndDate', label: 'Show Term End Date' },
  { key: 'showTermStartDate', label: 'Show Term Start Date' },
  { key: 'showFeesBalance', label: 'Show Fees Balance' },
  { key: 'showSchoolMotto', label: 'Show School Motto' },
];

export function SchoolReportCardSettingsPage() {
  const { data, isLoading } = useReportCardSettings();
  const update = useUpdateReportCardSettings();
  const [draft, setDraft] = useState<Partial<ReportCardSettings>>({});

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading report card settings…</div>;
  if (!data) return <div className="p-6 text-muted-foreground">Unable to load settings.</div>;

  const saved = data as ReportCardSettings;
  const val = (k: keyof ReportCardSettings) => (k in draft ? (draft as any)[k] : (saved as any)[k]);

  const set = (k: keyof ReportCardSettings, v: boolean | string) => setDraft((d) => ({ ...d, [k]: v }));

  const dirty = Object.keys(draft).some((k) => (draft as any)[k] !== (saved as any)[k]);

  const save = async () => {
    try {
      const res = await update.mutateAsync(draft);
      setDraft(res);
      notify.success('Report card settings saved');
    } catch (e: any) {
      notify.error(e?.message ?? 'Failed to save settings');
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Report Card Settings</h1>
          <p className="text-sm text-muted-foreground">Configure the printable report card layout, colors and visibility.</p>
        </div>
        <Button onClick={save} disabled={!dirty || update.isPending}>
          {update.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: configuration */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Header Colors</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              {COLOR_FIELDS.map((f) => (
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                  <div className="flex items-center gap-2 rounded-md border bg-card p-1.5">
                    <input
                      type="color"
                      value={String(val(f.key))}
                      onChange={(e) => set(f.key, e.target.value)}
                      className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <input
                      type="text"
                      value={String(val(f.key))}
                      onChange={(e) => set(f.key, e.target.value)}
                      className="w-full bg-transparent text-sm outline-none"
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Visibility</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TOGGLE_FIELDS.map((f) => (
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                  <select
                    value={val(f.key) ? 'shown' : 'hidden'}
                    onChange={(e) => set(f.key, e.target.value === 'shown')}
                    className="rounded-md border bg-card p-2 text-sm"
                  >
                    <option value="choose">Choose…</option>
                    <option value="shown">Shown</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right: live preview */}
        <div>
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="text-base">Live Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border p-5" style={{ background: '#fff', color: '#111' }}>
                <div className="text-center">
                  {val('showSchoolLogo') && (
                    <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed text-xs text-muted-foreground">
                      LOGO
                    </div>
                  )}
                  <div className="text-lg font-bold" style={{ color: val('schoolNameColor') as string }}>
                    St. Andrews Secondary School, Nyapeya
                  </div>
                  {val('showSchoolMotto') && (
                    <div className="text-xs italic" style={{ color: val('schoolAddressColor') as string }}>
                      “Knowledge is Light”
                    </div>
                  )}
                  <div className="mt-1 text-xs" style={{ color: val('schoolAddressColor') as string }}>
                    P.O. Box 12345, Nyapeya, Uganda
                  </div>
                  <div className="text-xs" style={{ color: val('contactColor') as string }}>
                    Tel: 0123456789 / 0987654321
                  </div>
                  <div className="text-xs" style={{ color: val('websiteColor') as string }}>
                    https://www.standrewssecondaryschool.edu
                  </div>
                  <div className="text-xs" style={{ color: val('emailColor') as string }}>
                    info@standrewssecondaryschool.edu
                  </div>
                </div>

                <div
                  className="mt-4 text-center text-base font-bold underline"
                  style={{ color: val('reportTitleColor') as string }}
                >
                  Continuous Assessment Report
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div><span className="font-semibold">NAME:</span> Ngarombo Ronald Andrew</div>
                  <div><span className="font-semibold">REG NO:</span> REG-1003</div>
                  <div><span className="font-semibold">GENDER:</span> Male</div>
                  <div><span className="font-semibold">CLASS:</span> S.1 NORTH</div>
                  <div><span className="font-semibold">TERM:</span> Term 1 2026</div>
                  {val('showTermStartDate') && <div><span className="font-semibold">START:</span> 01 Feb 2026</div>}
                  {val('showTermEndDate') && <div><span className="font-semibold">END:</span> 30 Apr 2026</div>}
                  {val('showStudentPhoto') && (
                    <div className="col-span-2"><span className="font-semibold">PHOTO:</span> [student photo]</div>
                  )}
                  {val('showFeesBalance') && (
                    <div className="col-span-2"><span className="font-semibold">FEES BALANCE:</span> UGX 150,000</div>
                  )}
                </div>

                <table className="mt-4 w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="p-1 text-left">SUBJECT</th>
                      <th className="p-1">U1</th>
                      <th className="p-1">U2</th>
                      <th className="p-1">U3</th>
                      <th className="p-1">COMMENT</th>
                      <th className="p-1">INITIALS</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b"><td className="p-1">English Language</td><td className="p-1 text-center">1.5</td><td className="p-1 text-center">3</td><td className="p-1 text-center">2.6</td><td className="p-1">Some learning outcomes…</td><td className="p-1 text-center">T.M.</td></tr>
                    <tr className="border-b"><td className="p-1">Mathematics</td><td className="p-1 text-center">100</td><td className="p-1 text-center">100</td><td className="p-1 text-center">100</td><td className="p-1">Excellent</td><td className="p-1 text-center">J.M.</td></tr>
                  </tbody>
                </table>

                {val('showWatermark') && (
                  <div className="pointer-events-none mt-3 text-center text-xs text-muted-foreground opacity-40">
                    WATERMARK
                  </div>
                )}
                {val('showClassTeacherComment') && (
                  <div className="mt-3 text-xs"><span className="font-semibold">Class Teacher:</span> Consistent effort this term.</div>
                )}
                {val('showHeadTeacherComment') && (
                  <div className="mt-1 text-xs"><span className="font-semibold">Head Teacher:</span> Keep up the good work.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
