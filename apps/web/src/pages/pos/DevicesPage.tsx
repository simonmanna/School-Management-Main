import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone, Loader2, Plus, Ban, Copy, CheckCircle2, AlertTriangle, Inbox } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface PosDevice {
  id: string;
  name: string;
  platform: string;
  prefix: string;
  branchId: string | null;
  lastSeenAt: string | null;
  lastPushSeq: number;
  revokedAt: string | null;
  createdAt: string;
}

interface RegisterResult {
  id: string;
  name: string;
  platform: string;
  prefix: string;
  deviceToken: string;
}

/** The API base this browser is talking to — the same URL the device needs. */
function apiBaseForDevice(): string {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (configured) return `${configured.replace(/\/$/, '')}/api/v1`;
  return `${window.location.origin}/api/v1`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Offline device registry (sync P1/P5).
 *
 * Registering mints an opaque token that is shown EXACTLY ONCE — the server
 * only stores its hash, so it cannot be re-displayed. Revoking stops the
 * device syncing on its next contact.
 */
export function DevicesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<'android' | 'web'>('android');
  const [issued, setIssued] = useState<RegisterResult | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<PosDevice | null>(null);

  const q = useQuery({
    queryKey: ['pos-devices'] as const,
    queryFn: async (): Promise<PosDevice[]> => (await api.get('/sync/devices')).data,
    refetchInterval: 15_000,
  });

  // Surface rejected-sale count here: this is the page a manager opens when a
  // device "isn't syncing", and a rejected op is the usual reason.
  const { data: rejected } = useQuery({
    queryKey: ['sync-dead-letter-counts'] as const,
    queryFn: async (): Promise<{ open: number }> => (await api.get('/sync/dead-letters/counts')).data,
    refetchInterval: 30_000,
  });

  const register = useMutation({
    mutationFn: async (): Promise<RegisterResult> =>
      (await api.post('/sync/devices/register', { name: name.trim(), platform })).data,
    onSuccess: (data) => {
      setIssued(data);
      setName('');
      qc.invalidateQueries({ queryKey: ['pos-devices'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Registration failed'),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => (await api.post(`/sync/devices/${id}/revoke`)).data,
    onSuccess: () => {
      notify.success('Device revoked — it will stop syncing on next contact');
      setConfirmRevoke(null);
      qc.invalidateQueries({ queryKey: ['pos-devices'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Revoke failed'),
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => notify.success(`${label} copied`),
      () => notify.error('Copy failed — select and copy manually'),
    );
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Smartphone className="h-6 w-6" /> Offline devices
          </h1>
          <p className="text-muted-foreground">
            Android terminals that sell offline and sync when they reconnect.
          </p>
        </div>
        <Link to="/settings/devices/rejected">
          <Button variant={rejected && rejected.open > 0 ? 'destructive' : 'outline'} size="sm">
            <Inbox className="h-4 w-4" />
            {rejected && rejected.open > 0 ? `${rejected.open} rejected` : 'Rejected sales'}
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Register a device</CardTitle>
          <CardDescription>
            The device token is shown once, right after registering. Enter it on the
            tablet's setup screen together with the server URL below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="device-name">Device name</Label>
              <Input
                id="device-name"
                placeholder="e.g. Counter tablet"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-64"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="device-platform">Platform</Label>
              <select
                id="device-platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as 'android' | 'web')}
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="android">Android</option>
                <option value="web">Web terminal</option>
              </select>
            </div>
            <Button onClick={() => register.mutate()} disabled={!name.trim() || register.isPending}>
              {register.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Register
            </Button>
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>
                <span className="text-muted-foreground">Server URL for devices: </span>
                <code className="font-mono">{apiBaseForDevice()}</code>
              </span>
              <Button variant="ghost" size="sm" onClick={() => copy(apiBaseForDevice(), 'Server URL')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              If that says <code>localhost</code>, use this machine's LAN address instead
              (the API prints it on startup) — a phone cannot reach your localhost.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered devices</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : q.data && q.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Platform</th>
                    <th className="py-2 pr-4 font-medium">Prefix</th>
                    <th className="py-2 pr-4 font-medium">Last seen</th>
                    <th className="py-2 pr-4 font-medium">Ops synced</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {q.data.map((d) => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{d.name}</td>
                      <td className="py-2 pr-4">{d.platform}</td>
                      <td className="py-2 pr-4"><code className="font-mono">{d.prefix}</code></td>
                      <td className="py-2 pr-4">{relativeTime(d.lastSeenAt)}</td>
                      <td className="py-2 pr-4">{d.lastPushSeq}</td>
                      <td className="py-2 pr-4">
                        {d.revokedAt ? (
                          <span className="inline-flex items-center gap-1 text-rose-500">
                            <Ban className="h-3.5 w-3.5" /> revoked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-500">
                            <CheckCircle2 className="h-3.5 w-3.5" /> active
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {!d.revokedAt && (
                          <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(d)}>
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No devices registered yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Token is shown once — the server keeps only its hash. */}
      <Dialog open={!!issued} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Device registered — copy the token now</DialogTitle>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-400/50 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              This token is shown <strong>once</strong>. It cannot be recovered — if you lose
              it, revoke the device and register again.
            </span>
          </div>
          {issued && (
            <div className="space-y-3 text-sm">
              {([
                ['Server URL', apiBaseForDevice()],
                ['Device ID', issued.id],
                ['Device token', issued.deviceToken],
                ['Receipt prefix', issued.prefix],
              ] as const).map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <Label>{label}</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded-md border bg-muted/40 p-2 font-mono text-xs">
                      {value}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => copy(value, label)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Enter these four values on the tablet's setup screen, then tap
                "Enroll + first sync".
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmRevoke} onOpenChange={(open) => !open && setConfirmRevoke(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {confirmRevoke?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The device stops syncing on its next contact with the server. Sales already
            queued on it will be rejected — settle or push them first.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => confirmRevoke && revoke.mutate(confirmRevoke.id)}
            >
              {revoke.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              Revoke device
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DevicesPage;
