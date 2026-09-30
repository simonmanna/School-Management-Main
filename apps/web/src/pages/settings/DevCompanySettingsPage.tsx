import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Upload, Building2, Puzzle, PanelLeft } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePosSettings, useUpdatePosSettings } from '@/features/pos/api';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { SIDEBAR_MODULES, isModuleEnabled, moduleFeatureKey, ORG_FEATURES_QUERY_KEY } from '@/lib/sidebar-modules';

interface DeveloperSettings {
  logoUrl: string | null;
  name: string;
  features: Record<string, boolean>;
}

// Accounting, assets, inventory, expense, task board and procurement used to be
// listed here too; they are now controlled per sidebar section (Sidebar Modules).
const KNOWN_FEATURES: Array<{ key: string; label: string; description: string }> = [
  { key: 'multiCurrency', label: 'Multi-Currency', description: 'Foreign currency support and FX revaluation' },
  { key: 'alcoholBeverageMonitor', label: 'Alcohol Beverage Monitor', description: 'Alcohol stock, duty tracking, and compliance reporting' },
  { key: 'offlineDevices', label: 'Offline Devices', description: 'Offline-capable POS terminals and device sync management' },
];

const POS_MODES = [
  { value: 'cafe', label: 'Cafe / Restaurant', desc: 'Menu items with variants, accompaniments, modifiers, tables, KDS, and KOT printing.' },
  { value: 'retail', label: 'Retail', desc: 'Direct product selling with barcode scanning, no tables, no kitchen.' },
  { value: 'rental', label: 'Rental', desc: 'Hire-out of serialized assets: agreements, deposits, returns, inspection and settlement.' },
];

export function DevCompanySettingsPage() {
  const qc = useQueryClient();
  const auth = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState(false);

  // POS Mode
  const { data: posSettings, isLoading: posLoading } = usePosSettings();
  const updatePos = useUpdatePosSettings();
  const [posMode, setPosMode] = useState('cafe');

  const q = useQuery<DeveloperSettings>({
    queryKey: ['settings-developer'],
    queryFn: async () => (await api.get<DeveloperSettings>('/settings/developer')).data,
  });

  useEffect(() => {
    if (q.data) {
      setName(q.data.name);
      setLogoUrl(q.data.logoUrl);
      setFeatures(q.data.features);
    }
  }, [q.data]);

  useEffect(() => {
    if (posSettings?.posMode) setPosMode(posSettings.posMode);
  }, [posSettings]);

  const save = useMutation({
    mutationFn: async () => {
      // Persist every module explicitly so later default changes don't flip a saved choice.
      const resolved = { ...features };
      for (const m of SIDEBAR_MODULES) resolved[moduleFeatureKey(m.key)] = isModuleEnabled(features, m);
      const payload: Record<string, unknown> = { name, features: resolved };
      if (logoUrl !== undefined) payload.logoUrl = logoUrl;
      return (await api.put('/settings/developer', payload)).data;
    },
    onSuccess: (data: DeveloperSettings) => {
      notify.success('Developer settings saved');
      const org = auth.organization;
      if (org) {
        auth.setOrganization({ ...org, name: data.name });
      }
      qc.invalidateQueries({ queryKey: ['settings-developer'] });
      qc.invalidateQueries({ queryKey: ORG_FEATURES_QUERY_KEY });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate image type
    if (!file.type.startsWith('image/')) {
      notify.error('Please select an image file');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('ownerType', 'organization');
      formData.append('ownerId', 'logo');

      const uploadRes = await api.post('/files/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const signedRes = await api.post(`/files/${uploadRes.data.id}/signed-url`);
      setLogoUrl(signedRes.data.url);
      notify.success('Logo uploaded');
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleFeature = (key: string) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleModule = (key: string) => {
    const mod = SIDEBAR_MODULES.find((m) => m.key === key)!;
    setFeatures((prev) => ({ ...prev, [moduleFeatureKey(key)]: !isModuleEnabled(prev, mod) }));
  };

  const setAllModules = (on: boolean) => {
    setFeatures((prev) => {
      const next = { ...prev };
      for (const m of SIDEBAR_MODULES) next[moduleFeatureKey(m.key)] = on;
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Developer Company Settings</h1>
      <p className="text-sm text-muted-foreground">
        Configure the base company profile and which modules are available.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Company Profile */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <div>
                <CardTitle>Company Profile</CardTitle>
                <CardDescription>Basic company identity used across the system.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {q.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                {/* Company Logo */}
                <div>
                  <label className="text-sm font-medium">Company Logo</label>
                  <div className="mt-2 flex items-center gap-4">
                    {logoUrl ? (
                      <div className="relative h-20 w-20 overflow-hidden rounded-lg border bg-muted">
                        <img
                          src={logoUrl}
                          alt="Company logo"
                          className="h-full w-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed bg-muted/30">
                        <Building2 className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploading ? (
                          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                        ) : (
                          <Upload className="mr-2 h-3 w-3" />
                        )}
                        {logoUrl ? 'Replace' : 'Upload'}
                      </Button>
                      {logoUrl && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setLogoUrl(null)}
                        >
                          Remove
                        </Button>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </div>
                  </div>
                  {logoUrl && (
                    <p className="mt-1.5 text-xs text-muted-foreground truncate max-w-xs">
                      {logoUrl}
                    </p>
                  )}
                </div>

                <hr className="border-t" />

                {/* Company Name */}
                <div>
                  <label className="text-sm font-medium">Company Name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1"
                    placeholder="Your company name"
                  />
                </div>

                {/* POS Mode */}
                <hr className="border-t" />
                <div>
                  <label className="text-sm font-medium">POS Mode</label>
                  <p className="text-xs text-muted-foreground mb-3">
                    Choose between Cafe/Restaurant or Retail mode. This affects the POS terminal layout and available features.
                  </p>
                  {posLoading ? (
                    <Skeleton className="h-10 w-64" />
                  ) : (
                    <div className="space-y-3">
                      <Select value={posMode} onValueChange={setPosMode}>
                        <SelectTrigger className="w-64">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {POS_MODES.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {POS_MODES.find((m) => m.value === posMode) && (
                        <p className="text-sm text-muted-foreground">{POS_MODES.find((m) => m.value === posMode)!.desc}</p>
                      )}
                      <Button onClick={async () => {
                        try {
                          await updatePos.mutateAsync({ posMode });
                          notify.success('POS settings saved');
                        } catch {
                          notify.error('Failed to save POS settings');
                        }
                      }} disabled={updatePos.isPending} size="sm">
                        {updatePos.isPending ? 'Saving...' : 'Save POS Mode'}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Feature Toggles */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Puzzle className="h-4 w-4 text-muted-foreground" />
              <div>
                <CardTitle>Features</CardTitle>
                <CardDescription>Enable or disable modules for this organization.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="space-y-3">
                {KNOWN_FEATURES.map((feat) => (
                  <label
                    key={feat.key}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded"
                      checked={!!features[feat.key]}
                      onChange={() => toggleFeature(feat.key)}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {feat.label}
                        {features[feat.key] && (
                          <Badge variant="secondary" className="text-[10px]">active</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{feat.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sidebar Modules */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PanelLeft className="h-4 w-4 text-muted-foreground" />
              <div>
                <CardTitle>Sidebar Modules</CardTitle>
                <CardDescription>Checked modules appear in the sidebar menu for every user. Dashboard and Settings are always shown.</CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setAllModules(true)} disabled={q.isLoading}>Check all</Button>
              <Button size="sm" variant="outline" onClick={() => setAllModules(false)} disabled={q.isLoading}>Uncheck all</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {SIDEBAR_MODULES.map((mod) => {
                const on = isModuleEnabled(features, mod);
                return (
                  <label
                    key={mod.key}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded"
                      checked={on}
                      onChange={() => toggleModule(mod.key)}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {mod.section}
                        {on && <Badge variant="secondary" className="text-[10px]">shown</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{mod.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending || q.isLoading}>
          {save.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Developer Settings
        </Button>
      </div>
    </div>
  );
}
