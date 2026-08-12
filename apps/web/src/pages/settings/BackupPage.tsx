import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Play, HardDrive, Clock, Plus, X, Loader2, Database, FolderOpen, FileText, Printer, Terminal, Shield, Bell, Trash2, Globe, Tag, Settings2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

// =============================================================================
// Types
// =============================================================================

type BackupFrequency = 'manual' | 'every_hour' | 'every_2_hours' | 'every_4_hours' | 'every_6_hours' | 'every_12_hours' | 'daily' | 'weekly' | 'monthly' | 'custom_minutes' | 'custom_hours' | 'cron';
type BackupType = 'full' | 'incremental' | 'differential' | 'snapshot' | 'mirror';
type CompressionLevel = 0 | 1 | 6 | 9;
type EncryptionType = 'none' | 'aes256';
type DestinationType = 'local' | 'external_drive' | 'network_folder' | 'onedrive' | 'google_drive' | 'dropbox' | 's3' | 'azure' | 'ftp' | 'sftp';
type RetentionMode = 'keep_last' | 'keep_by_age' | 'smart';
type InternetBehaviour = 'local_only' | 'upload_immediately' | 'upload_when_internet_returns';
type BackupKind = 'full' | 'incremental' | 'differential' | 'files' | 'config' | 'cleanup';

interface BackupIncludes {
  database: boolean; schemaOnly: boolean; databaseData: boolean;
  uploadedImages: boolean; productImages: boolean; customerDocuments: boolean; generatedReports: boolean; attachments: boolean;
  envFile: boolean; configFiles: boolean; posSettings: boolean; orgSettings: boolean;
  printerConfig: boolean; receiptTemplates: boolean; kitchenPrinterSettings: boolean;
  logs: boolean; auditLogs: boolean; scheduledTasks: boolean;
}

interface BackupDestination {
  type: DestinationType; path: string; label?: string; enabled?: boolean;
  accessKey?: string; secretKey?: string; region?: string; bucket?: string;
}

interface RetentionPolicy { mode: RetentionMode; keepLastCount?: number; keepDays?: number; smartDaily?: number; smartWeekly?: number; smartMonthly?: number; }

interface NotificationsConfig { on: string[]; channels: string[]; emailAddress?: string; phoneNumber?: string; }

interface VerificationConfig { verifyIntegrity: boolean; testRestore: boolean; sha256Checksum: boolean; }

interface EncryptionConfig { type: EncryptionType; password?: string; }

interface CleanupConfig { deleteExpired: boolean; deleteTempFiles: boolean; removeFailedFiles: boolean; }

interface ScheduleConfig { time?: string; dayOfWeek?: number; timezone?: string; customIntervalMinutes?: number; cronExpression?: string; }

interface AdvancedConfig {
  maxThreads: number; compressionLevel: number; pauseBusinessHours: boolean; businessHoursStart: string; businessHoursEnd: string;
  skipIfBusy: boolean; retryCount: number; retryDelayMinutes: number; backupTimeoutMinutes: number; maxDiskUsageGb: number; autoDiskSpaceCheck: boolean;
}

interface BackupConfig {
  frequency: BackupFrequency; dailyConfig?: { times: string[] }; weeklyConfig?: { days: number[]; time: string };
  customCronExpression?: string; customIntervalMinutes?: number;
  types: BackupType[]; includes: BackupIncludes; destinations: BackupDestination[];
  retention: RetentionPolicy; compression: CompressionLevel; encryption: EncryptionConfig;
  verification: VerificationConfig; notifications: NotificationsConfig; cleanup: CleanupConfig;
  internetBehaviour: InternetBehaviour; namingFormat?: string; schedule?: ScheduleConfig; advanced: AdvancedConfig;
}

interface BackupRunResult { kind: BackupKind; status: 'success' | 'failed' | 'skipped'; target?: string; sizeBytes?: number; durationMs: number; finishedAt: string; error?: string; checksumSha256?: string; }
interface BackupStatus { lastByKind: Partial<Record<BackupKind, BackupRunResult>>; recent: BackupRunResult[]; config: BackupConfig; }

// =============================================================================
// Helpers
// =============================================================================

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FREQ_LABELS: Record<BackupFrequency, string> = { manual: 'Manual Only', every_hour: 'Every Hour', every_2_hours: 'Every 2 Hours', every_4_hours: 'Every 4 Hours', every_6_hours: 'Every 6 Hours', every_12_hours: 'Every 12 Hours', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', custom_minutes: 'Every X Minutes', custom_hours: 'Every X Hours', cron: 'Cron Expression (Advanced)' };

function fmtTime(iso: string) { return new Date(iso).toLocaleString(); }
function fmtSize(b?: number) { if (!b) return '\u2014'; if (b < 1024) return `${b} B`; if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`; return `${(b / 1048576).toFixed(1)} MB`; }
function fmtDuration(ms: number) { const s = Math.round(ms / 1000); if (s < 60) return `${s}s`; return `${Math.floor(s / 60)}m ${s % 60}s`; }

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />{label}</label>;
}

function Section({ title, icon: Icon, desc, children }: { title: string; icon: any; desc?: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="h-4 w-4" />{title}</CardTitle>{desc && <CardDescription>{desc}</CardDescription>}</CardHeader><CardContent className="space-y-3">{children}</CardContent></Card>;
}

// =============================================================================
// Page Component
// =============================================================================

export function BackupPage() {
  const qc = useQueryClient();

  const [freq, setFreq] = useState<BackupFrequency>('daily');
  const [dailyTimes, setDailyTimes] = useState<string[]>(['02:00']);
  const [weeklyDays, setWeeklyDays] = useState<number[]>([0]);
  const [weeklyTime, setWeeklyTime] = useState('03:00');
  const [customInterval, setCustomInterval] = useState(60);
  const [customCron, setCustomCron] = useState('');
  const [types, setTypes] = useState<BackupType[]>(['full']);
  const [showAdvancedTypes, setShowAdvancedTypes] = useState(false);
  const [includes, setIncludes] = useState<BackupIncludes>({} as any);
  const [destinations, setDestinations] = useState<BackupDestination[]>([]);
  const [retentionMode, setRetentionMode] = useState<RetentionMode>('keep_last');
  const [keepLast, setKeepLast] = useState(14);
  const [keepDays, setKeepDays] = useState(30);
  const [smartDaily, setSmartDaily] = useState(30);
  const [smartWeekly, setSmartWeekly] = useState(12);
  const [smartMonthly, setSmartMonthly] = useState(12);
  const [compression, setCompression] = useState<CompressionLevel>(6);
  const [encryptType, setEncryptType] = useState<EncryptionType>('none');
  const [encryptPwd, setEncryptPwd] = useState('');
  const [verifyIntegrity, setVerifyIntegrity] = useState(true);
  const [testRestore, setTestRestore] = useState(false);
  const [sha256, setSha256] = useState(true);
  const [notifyOn, setNotifyOn] = useState<string[]>(['failed']);
  const [notifyChannels, setNotifyChannels] = useState<string[]>(['desktop']);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [internetMode, setInternetMode] = useState<InternetBehaviour>('local_only');
  const [namingFmt, setNamingFmt] = useState('POS-CAFE_{TYPE}_{DATE}_{TIME}');
  const [autoCleanup, setAutoCleanup] = useState(true);
  const [advMaxThreads, setAdvMaxThreads] = useState(1);
  const [advCompression, setAdvCompression] = useState(6);
  const [advRetry, setAdvRetry] = useState(3);
  const [advRetryDelay, setAdvRetryDelay] = useState(5);
  const [advTimeout, setAdvTimeout] = useState(60);
  const [advMaxDisk, setAdvMaxDisk] = useState(50);
  const [advPauseBusiness, setAdvPauseBusiness] = useState(false);
  const [advBusStart, setAdvBusStart] = useState('08:00');
  const [advBusEnd, setAdvBusEnd] = useState('22:00');
  const [advSkipBusy, setAdvSkipBusy] = useState(false);

  const status = useQuery<BackupStatus>({ queryKey: ['backup-status'], queryFn: async () => (await api.get<BackupStatus>('/admin/backups/status')).data });

  const initForm = (cfg: BackupConfig) => {
    setFreq(cfg.frequency);
    setDailyTimes(cfg.dailyConfig?.times ?? ['02:00']);
    setWeeklyDays(cfg.weeklyConfig?.days ?? [0]);
    setWeeklyTime(cfg.weeklyConfig?.time ?? '03:00');
    setCustomInterval(cfg.customIntervalMinutes ?? 60);
    setCustomCron(cfg.customCronExpression ?? '');
    setTypes(cfg.types);
    setIncludes(cfg.includes);
    setDestinations(cfg.destinations);
    setRetentionMode(cfg.retention.mode);
    setKeepLast(cfg.retention.keepLastCount ?? 14);
    setKeepDays(cfg.retention.keepDays ?? 30);
    [setSmartDaily, setSmartWeekly, setSmartMonthly].map((fn, i) => fn([30, 12, 12][i]));
    setCompression(cfg.compression);
    setEncryptType(cfg.encryption.type);
    setEncryptPwd(cfg.encryption.password ?? '');
    setVerifyIntegrity(cfg.verification.verifyIntegrity);
    setTestRestore(cfg.verification.testRestore);
    setSha256(cfg.verification.sha256Checksum);
    setNotifyOn(cfg.notifications.on);
    setNotifyChannels(cfg.notifications.channels);
    setNotifyEmail(cfg.notifications.emailAddress ?? '');
    setInternetMode(cfg.internetBehaviour);
    setNamingFmt(cfg.namingFormat ?? 'POS-CAFE_{TYPE}_{DATE}_{TIME}');
    setAutoCleanup(cfg.cleanup.deleteExpired);
    const a = cfg.advanced;
    setAdvMaxThreads(a.maxThreads); setAdvCompression(a.compressionLevel); setAdvRetry(a.retryCount);
    setAdvRetryDelay(a.retryDelayMinutes); setAdvTimeout(a.backupTimeoutMinutes); setAdvMaxDisk(a.maxDiskUsageGb);
    setAdvPauseBusiness(a.pauseBusinessHours); setAdvBusStart(a.businessHoursStart); setAdvBusEnd(a.businessHoursEnd);
    setAdvSkipBusy(a.skipIfBusy);
  };

  useEffect(() => { if (status.data) initForm(status.data.config); }, [status.data]);

  const buildPayload = (): BackupConfig => ({
    frequency: freq, types,
    dailyConfig: { times: dailyTimes },
    weeklyConfig: { days: weeklyDays, time: weeklyTime },
    customCronExpression: customCron,
    customIntervalMinutes: customInterval,
    includes,
    destinations,
    retention: { mode: retentionMode, keepLastCount: keepLast, keepDays, smartDaily, smartWeekly, smartMonthly },
    compression,
    encryption: { type: encryptType, password: encryptType === 'aes256' ? encryptPwd : '' },
    verification: { verifyIntegrity, testRestore, sha256Checksum: sha256 },
    notifications: { on: notifyOn, channels: notifyChannels, emailAddress: notifyEmail, phoneNumber: '' },
    cleanup: { deleteExpired: autoCleanup, deleteTempFiles: autoCleanup, removeFailedFiles: autoCleanup },
    internetBehaviour: internetMode,
    namingFormat: namingFmt,
    schedule: { time: dailyTimes[0] ?? '02:00', dayOfWeek: 7, timezone: 'UTC', customIntervalMinutes: customInterval, cronExpression: customCron },
    advanced: { maxThreads: advMaxThreads, compressionLevel: advCompression, pauseBusinessHours: advPauseBusiness, businessHoursStart: advBusStart, businessHoursEnd: advBusEnd, skipIfBusy: advSkipBusy, retryCount: advRetry, retryDelayMinutes: advRetryDelay, backupTimeoutMinutes: advTimeout, maxDiskUsageGb: advMaxDisk, autoDiskSpaceCheck: true },
  });

  const save = useMutation({
    mutationFn: async () => (await api.put('/admin/backups/settings', buildPayload())).data,
    onSuccess: () => { notify.success('Backup settings saved'); qc.invalidateQueries({ queryKey: ['backup-status'] }); },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const runFull = useMutation({ mutationFn: async () => (await api.post('/admin/backups/full')).data, onSuccess: () => { notify.success('Full backup done'); qc.invalidateQueries({ queryKey: ['backup-status'] }); }, onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Backup failed') });
  const runInc = useMutation({ mutationFn: async () => (await api.post('/admin/backups/incremental')).data, onSuccess: () => { notify.success('Incremental backup done'); qc.invalidateQueries({ queryKey: ['backup-status'] }); }, onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Backup failed') });
  const runFiles = useMutation({ mutationFn: async () => (await api.post('/admin/backups/files')).data, onSuccess: () => { notify.success('File sync done'); qc.invalidateQueries({ queryKey: ['backup-status'] }); }, onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Sync failed') });
  const runConfig = useMutation({ mutationFn: async () => (await api.post('/admin/backups/config')).data, onSuccess: () => { notify.success('Config backup done'); qc.invalidateQueries({ queryKey: ['backup-status'] }); }, onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Backup failed') });

  const addDest = () => setDestinations([...destinations, { type: 'local', path: '', label: '', enabled: true }]);
  const updDest = (i: number, p: Partial<BackupDestination>) => { const d = [...destinations]; d[i] = { ...d[i], ...p }; setDestinations(d); };
  const rmDest = (i: number) => setDestinations(destinations.filter((_, idx) => idx !== i));

  const toggleArr = (arr: string[], v: string) => arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  const toggleType = (t: BackupType) => setTypes(toggleArr(types, t) as BackupType[]);

  const lastByKind = status.data?.lastByKind;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Backup</h1><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save All Settings</Button></div>

      <Tabs defaultValue="schedule">
        <TabsList className="flex-wrap">
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="retention">Retention</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        {/* ===================================================================== */}
        {/* TAB: Schedule */}
        {/* ===================================================================== */}
        <TabsContent value="schedule" className="space-y-4 mt-4">
          <Section title="Backup Frequency" icon={Clock} desc="How often should backups run?">
            <Select value={freq} onValueChange={(v: BackupFrequency) => setFreq(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(FREQ_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            {freq === 'daily' && (
              <div>
                <Label>Backup times</Label>
                {dailyTimes.map((t, i) => (<div key={i} className="flex items-center gap-2 mt-1"><Input type="time" value={t} onChange={(e) => { const d = [...dailyTimes]; d[i] = e.target.value; setDailyTimes(d); }} className="w-32" />{dailyTimes.length > 1 && <Button size="icon" variant="ghost" onClick={() => setDailyTimes(dailyTimes.filter((_, idx) => idx !== i))}><X className="h-3 w-3" /></Button>}</div>))}
                <Button size="sm" variant="outline" onClick={() => setDailyTimes([...dailyTimes, '12:00'])} className="mt-1"><Plus className="h-3 w-3 mr-1" />Add time</Button>
              </div>
            )}
            {freq === 'weekly' && (
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Days</Label>{[0, 1, 2, 3, 4, 5, 6].map((d) => <Checkbox key={d} label={DAY_NAMES[d]} checked={weeklyDays.includes(d)} onChange={(v) => setWeeklyDays(v ? [...weeklyDays, d] : weeklyDays.filter((x) => x !== d))} />)}</div>
                <div><Label>Time</Label><Input type="time" value={weeklyTime} onChange={(e) => setWeeklyTime(e.target.value)} /></div>
              </div>
            )}
            {freq === 'custom_minutes' && <div><Label>Every X minutes</Label><Input type="number" min={1} value={customInterval} onChange={(e) => setCustomInterval(Number(e.target.value))} /></div>}
            {freq === 'custom_hours' && <div><Label>Every X hours</Label><Input type="number" min={1} value={customInterval} onChange={(e) => setCustomInterval(Number(e.target.value))} /></div>}
            {freq === 'cron' && <div><Label>Cron Expression</Label><Input value={customCron} onChange={(e) => setCustomCron(e.target.value)} placeholder={'0 2 * * *'} /><p className="text-xs text-muted-foreground">Standard cron format: minute hour day month weekday</p></div>}
            {freq === 'monthly' && <p className="text-sm text-muted-foreground">Runs on the 1st of every month at 02:00</p>}
          </Section>

          <Section title="Backup Type" icon={Database} desc="What kind of backups to create">
            <div className="space-y-1">
              <Checkbox label="Full Backup \u2014 Entire database + files" checked={types.includes('full')} onChange={() => toggleType('full')} />
              <Checkbox label="Incremental Backup \u2014 Changes since last backup (WAL)" checked={types.includes('incremental')} onChange={() => toggleType('incremental')} />
              <details className="mt-2">
                <summary className="text-sm cursor-pointer text-muted-foreground hover:text-foreground" onClick={(e) => { e.preventDefault(); setShowAdvancedTypes(!showAdvancedTypes); }}>{showAdvancedTypes ? 'Hide' : 'Show'} advanced types</summary>
                <div className="space-y-1 mt-2 pl-4 border-l-2">
                  <Checkbox label="Differential Backup" checked={types.includes('differential')} onChange={() => toggleType('differential')} />
                  <Checkbox label="Snapshot (filesystem)" checked={types.includes('snapshot')} onChange={() => toggleType('snapshot')} />
                  <Checkbox label="Mirror Backup" checked={types.includes('mirror')} onChange={() => toggleType('mirror')} />
                </div>
              </details>
            </div>
          </Section>

          <Section title="Manual Backup" icon={Play} desc="Trigger a backup immediately">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => runFull.mutate()} disabled={runFull.isPending}>{runFull.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Full Backup</Button>
              <Button variant="outline" onClick={() => runInc.mutate()} disabled={runInc.isPending}>{runInc.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Incremental</Button>
              <Button variant="outline" onClick={() => runFiles.mutate()} disabled={runFiles.isPending}>{runFiles.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sync Files</Button>
              <Button variant="outline" onClick={() => runConfig.mutate()} disabled={runConfig.isPending}>{runConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Backup Config</Button>
            </div>
          </Section>
        </TabsContent>

        {/* ===================================================================== */}
        {/* TAB: Content */}
        {/* ===================================================================== */}
        <TabsContent value="content" className="space-y-4 mt-4">
          <Section title="Database" icon={Database} desc="What database content to include">
            <Checkbox label="PostgreSQL Database (full)" checked={includes.database} onChange={(v) => setIncludes({ ...includes, database: v })} />
            <Checkbox label="Database Data Only" checked={includes.databaseData} onChange={(v) => setIncludes({ ...includes, databaseData: v })} />
            <Checkbox label="Schema Only" checked={includes.schemaOnly} onChange={(v) => setIncludes({ ...includes, schemaOnly: v })} />
          </Section>
          <Section title="Storage Files" icon={FolderOpen} desc="Uploaded files and documents">
            {([['uploadedImages', 'Uploaded Images'], ['productImages', 'Product Images'], ['customerDocuments', 'Customer Documents'], ['generatedReports', 'Generated Reports'], ['attachments', 'Attachments']] as const).map(([k, l]) => <Checkbox key={k} label={l} checked={(includes as any)[k]} onChange={(v) => setIncludes({ ...includes, [k]: v })} />)}
          </Section>
          <Section title="Application" icon={FileText} desc="Configuration and settings">
            {([['envFile', 'Environment (.env)'], ['configFiles', 'Configuration Files'], ['posSettings', 'POS Settings'], ['orgSettings', 'Organization Settings']] as const).map(([k, l]) => <Checkbox key={k} label={l} checked={(includes as any)[k]} onChange={(v) => setIncludes({ ...includes, [k]: v })} />)}
          </Section>
          <Section title="Printing" icon={Printer} desc="Printer and receipt configuration">
            {([['printerConfig', 'Printer Configuration'], ['receiptTemplates', 'Receipt Templates'], ['kitchenPrinterSettings', 'Kitchen Printer Settings']] as const).map(([k, l]) => <Checkbox key={k} label={l} checked={(includes as any)[k]} onChange={(v) => setIncludes({ ...includes, [k]: v })} />)}
          </Section>
          <Section title="System" icon={Terminal} desc="System logs and tasks">
            {([['logs', 'Logs'], ['auditLogs', 'Audit Logs'], ['scheduledTasks', 'Scheduled Tasks']] as const).map(([k, l]) => <Checkbox key={k} label={l} checked={(includes as any)[k]} onChange={(v) => setIncludes({ ...includes, [k]: v })} />)}
          </Section>
        </TabsContent>

        {/* ===================================================================== */}
        {/* TAB: Storage */}
        {/* ===================================================================== */}
        <TabsContent value="storage" className="space-y-4 mt-4">
          <Section title="Backup Destinations" icon={HardDrive} desc="Where to save backups (drag to reorder)">
            {destinations.map((d, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Destination #{i + 1}</span>
                  <Button size="icon" variant="ghost" onClick={() => rmDest(i)}><X className="h-3 w-3" /></Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Type</Label>
                    <Select value={d.type} onValueChange={(v: DestinationType) => updDest(i, { type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">Local Folder</SelectItem>
                        <SelectItem value="external_drive">External Drive</SelectItem>
                        <SelectItem value="network_folder">Network Folder (NAS)</SelectItem>
                        <SelectItem value="onedrive">OneDrive</SelectItem>
                        <SelectItem value="google_drive">Google Drive</SelectItem>
                        <SelectItem value="dropbox">Dropbox</SelectItem>
                        <SelectItem value="s3">Amazon S3</SelectItem>
                        <SelectItem value="azure">Azure Blob Storage</SelectItem>
                        <SelectItem value="ftp">FTP</SelectItem>
                        <SelectItem value="sftp">SFTP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Path / Folder</Label><Input value={d.path} onChange={(e) => updDest(i, { path: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Label</Label><Input value={d.label ?? ''} onChange={(e) => updDest(i, { label: e.target.value })} /></div>
                  <div className="flex items-end pb-2"><Checkbox label="Enabled" checked={d.enabled ?? true} onChange={(v) => updDest(i, { enabled: v })} /></div>
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addDest}><Plus className="h-3 w-3 mr-1" />Add Destination</Button>
          </Section>

          <Section title="Internet Behaviour" icon={Globe} desc="How to handle cloud destinations">
            <Select value={internetMode} onValueChange={(v: InternetBehaviour) => setInternetMode(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local_only">Backup Locally Only</SelectItem>
                <SelectItem value="upload_immediately">Upload Immediately</SelectItem>
                <SelectItem value="upload_when_internet_returns">Upload When Internet Returns</SelectItem>
              </SelectContent>
            </Select>
            {internetMode !== 'local_only' && <p className="text-xs text-muted-foreground">Cloud destinations will be processed {internetMode === 'upload_immediately' ? 'right after local backup' : 'when internet connectivity is detected'}.</p>}
          </Section>

          <Section title="Backup Naming" icon={Tag} desc="How backup files are named">
            <Input value={namingFmt} onChange={(e) => setNamingFmt(e.target.value)} />
            <p className="text-xs text-muted-foreground">Available tokens: <code>{'{TYPE}'}</code>, <code>{'{DATE}'}</code>, <code>{'{TIME}'}</code></p>
            <p className="text-xs text-muted-foreground">Example: {namingFmt.replace('{TYPE}', 'FULL').replace('{DATE}', '2026-07-20').replace('{TIME}', '020000')}.dump</p>
          </Section>
        </TabsContent>

        {/* ===================================================================== */}
        {/* TAB: Retention */}
        {/* ===================================================================== */}
        <TabsContent value="retention" className="space-y-4 mt-4">
          <Section title="Retention Policy" icon={Trash2} desc="How long to keep backups">
            <Select value={retentionMode} onValueChange={(v: RetentionMode) => setRetentionMode(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="keep_last">Keep Last N Backups</SelectItem>
                <SelectItem value="keep_by_age">Delete After N Days</SelectItem>
                <SelectItem value="smart">Smart Retention</SelectItem>
              </SelectContent>
            </Select>
            {retentionMode === 'keep_last' && <div><Label>Keep last</Label><Input type="number" min={1} value={keepLast} onChange={(e) => setKeepLast(Number(e.target.value))} /></div>}
            {retentionMode === 'keep_by_age' && <div><Label>Delete after (days)</Label><Input type="number" min={1} value={keepDays} onChange={(e) => setKeepDays(Number(e.target.value))} /></div>}
            {retentionMode === 'smart' && (
              <div className="grid grid-cols-3 gap-2">
                <div><Label>Daily (days)</Label><Input type="number" min={1} value={smartDaily} onChange={(e) => setSmartDaily(Number(e.target.value))} /></div>
                <div><Label>Weekly (weeks)</Label><Input type="number" min={1} value={smartWeekly} onChange={(e) => setSmartWeekly(Number(e.target.value))} /></div>
                <div><Label>Monthly (months)</Label><Input type="number" min={1} value={smartMonthly} onChange={(e) => setSmartMonthly(Number(e.target.value))} /></div>
              </div>
            )}
          </Section>

          <Section title="Automatic Cleanup" icon={RefreshCw} desc="Housekeeping tasks">
            <Checkbox label="Delete expired backups" checked={autoCleanup} onChange={setAutoCleanup} />
            <Checkbox label="Delete temporary files" checked={autoCleanup} onChange={setAutoCleanup} />
            <Checkbox label="Remove failed backup files" checked={autoCleanup} onChange={setAutoCleanup} />
          </Section>
        </TabsContent>

        {/* ===================================================================== */}
        {/* TAB: Security */}
        {/* ===================================================================== */}
        <TabsContent value="security" className="space-y-4 mt-4">
          <Section title="Compression" icon={HardDrive} desc="Backup file compression level">
            <Select value={String(compression)} onValueChange={(v) => setCompression(Number(v) as CompressionLevel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">None</SelectItem>
                <SelectItem value="1">Fast Compression</SelectItem>
                <SelectItem value="6">Normal Compression</SelectItem>
                <SelectItem value="9">Maximum Compression</SelectItem>
              </SelectContent>
            </Select>
          </Section>

          <Section title="Encryption" icon={Shield} desc="Encrypt backup files with a password">
            <Select value={encryptType} onValueChange={(v: EncryptionType) => setEncryptType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="aes256">AES-256 Password Encryption</SelectItem>
              </SelectContent>
            </Select>
            {encryptType === 'aes256' && <div><Label>Backup Password</Label><Input type="password" value={encryptPwd} onChange={(e) => setEncryptPwd(e.target.value)} placeholder="Enter encryption password" /></div>}
          </Section>

          <Section title="Verification" icon={Shield} desc="Verify backup integrity after creation">
            <Checkbox label="Verify Backup Integrity (pg_restore --list)" checked={verifyIntegrity} onChange={setVerifyIntegrity} />
            <Checkbox label="Test Restore Automatically (dry run)" checked={testRestore} onChange={setTestRestore} />
            <Checkbox label="Calculate SHA-256 Checksum" checked={sha256} onChange={setSha256} />
          </Section>
        </TabsContent>

        {/* ===================================================================== */}
        {/* TAB: Notifications */}
        {/* ===================================================================== */}
        <TabsContent value="notifications" className="space-y-4 mt-4">
          <Section title="Notifications" icon={Bell} desc="Get notified about backup events">
            <div><Label>Notify when</Label>{['completed', 'failed', 'storage_almost_full', 'skipped'].map((k) => <Checkbox key={k} label={k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} checked={notifyOn.includes(k)} onChange={() => setNotifyOn(toggleArr(notifyOn, k))} />)}</div>
            <Separator />
            <div><Label>Via</Label>{['desktop', 'email', 'sms', 'push'].map((k) => <Checkbox key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} checked={notifyChannels.includes(k)} onChange={() => setNotifyChannels(toggleArr(notifyChannels, k))} />)}</div>
            {notifyChannels.includes('email') && <div><Label>Email address</Label><Input type="email" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} placeholder="admin@cafe-pos.local" /></div>}
          </Section>
        </TabsContent>

        {/* ===================================================================== */}
        {/* TAB: Advanced */}
        {/* ===================================================================== */}
        <TabsContent value="advanced" className="space-y-4 mt-4">
          <Section title="Performance" icon={Settings2} desc="Control backup performance">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Max threads</Label><Input type="number" min={1} value={advMaxThreads} onChange={(e) => setAdvMaxThreads(Number(e.target.value))} /></div>
              <div><Label>Compression level (0\u20139)</Label><Input type="number" min={0} max={9} value={advCompression} onChange={(e) => setAdvCompression(Number(e.target.value))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Retry count</Label><Input type="number" min={0} value={advRetry} onChange={(e) => setAdvRetry(Number(e.target.value))} /></div>
              <div><Label>Retry delay (min)</Label><Input type="number" min={0} value={advRetryDelay} onChange={(e) => setAdvRetryDelay(Number(e.target.value))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Backup timeout (min)</Label><Input type="number" min={0} value={advTimeout} onChange={(e) => setAdvTimeout(Number(e.target.value))} /></div>
              <div><Label>Max disk usage (GB)</Label><Input type="number" min={0} value={advMaxDisk} onChange={(e) => setAdvMaxDisk(Number(e.target.value))} /></div>
            </div>
          </Section>

          <Section title="Business Hours" icon={Clock} desc="Restrict backup during busy periods">
            <Checkbox label="Pause during business hours" checked={advPauseBusiness} onChange={setAdvPauseBusiness} />
            {advPauseBusiness && <div className="grid grid-cols-2 gap-2"><div><Label>Business start</Label><Input type="time" value={advBusStart} onChange={(e) => setAdvBusStart(e.target.value)} /></div><div><Label>Business end</Label><Input type="time" value={advBusEnd} onChange={(e) => setAdvBusEnd(e.target.value)} /></div></div>}
            <Checkbox label="Skip backup if POS is busy" checked={advSkipBusy} onChange={setAdvSkipBusy} />
          </Section>
        </TabsContent>
      </Tabs>

      <Separator />

      {/* ===================================================================== */}
      {/* Status Section */}
      {/* ===================================================================== */}
      <Card>
        <CardHeader><CardTitle>Status</CardTitle><CardDescription>Last backup results</CardDescription></CardHeader>
        <CardContent>
          {status.isLoading ? <Skeleton className="h-24 w-full" /> : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                {(['full', 'incremental', 'files'] as BackupKind[]).map((kind) => {
                  const r = lastByKind?.[kind];
                  return (<div key={kind} className="rounded-lg border p-3"><div className="flex items-center justify-between"><span className="text-sm font-medium capitalize">{kind}</span>{r ? <Badge variant={r.status === 'success' ? 'default' : 'destructive'}>{r.status}</Badge> : <Badge variant="outline">never</Badge>}</div>{r && <div className="mt-2 text-xs text-muted-foreground space-y-1"><div>{fmtTime(r.finishedAt)}</div><div className="flex justify-between"><span>Size: {fmtSize(r.sizeBytes)}</span><span>{fmtDuration(r.durationMs)}</span></div></div>}</div>);
                })}
              </div>
              {status.data?.recent && status.data.recent.length > 0 && (
                <div><h4 className="text-sm font-medium mb-2">Recent history</h4><div className="space-y-1 max-h-48 overflow-y-auto">{status.data.recent.slice(0, 10).map((r, i) => (<div key={i} className="flex items-center justify-between text-xs border-b py-1"><span className="capitalize w-16">{r.kind}</span><Badge variant={r.status === 'success' ? 'default' : r.status === 'failed' ? 'destructive' : 'outline'} className="text-[10px] px-1.5 py-0">{r.status}</Badge><span className="text-muted-foreground">{fmtTime(r.finishedAt)}</span><span className="text-muted-foreground">{fmtSize(r.sizeBytes)}</span><span className="text-muted-foreground">{fmtDuration(r.durationMs)}</span></div>))}</div></div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
