import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Loader2, Upload, Building2, Puzzle } from 'lucide-react';
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

interface DeveloperSettings {
  logoUrl: string | null;
  name: string;
  features: Record<string, boolean>;
}

const KNOWN_FEATURES: Array<{ key: string; label: string; description: string }> = [
  { key: 'accounting', label: 'Accounting', description: 'Chart of accounts, journals, posting engine' },
  { key: 'assets', label: 'Assets', description: 'Fixed asset register and depreciation' },
  { key: 'inventory', label: 'Inventory', description: 'Stock tracking, batches, serial numbers' },
  { key: 'multiCurrency', label: 'Multi-Currency', description: 'Foreign currency support and FX revaluation' },
  { key: 'expense', label: 'Expense', description: 'Employee expense reports, approvals, and reimbursements' },
  { key: 'taskBoard', label: 'Task Board', description: 'Kanban-style task management and workflow tracking' },
  { key: 'alcoholBeverageMonitor', label: 'Alcohol Beverage Monitor', description: 'Alcohol stock, duty tracking, and compliance reporting' },
  { key: 'offlineDevices', label: 'Offline Devices', description: 'Offline-capable POS terminals and device sync management' },
  { key: 'procurement', label: 'Procurement', description: 'Purchase requests, orders, and receipts' },
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
      const payload: Record<string, unknown> = { name, features };
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
