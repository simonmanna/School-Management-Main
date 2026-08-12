import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

interface Setting {
  id: string;
  key: string;
  value: unknown;
}

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Setting[]>('/settings')).data,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Organization configuration & your access.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your access</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              Signed in as <span className="font-medium">{user?.email}</span>
            </div>
            <div>Roles: {user?.roles.join(', ') || '-'}</div>
            <div>{permissions.length} permission(s) granted</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organization settings</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {isLoading ? (
              'Loading...'
            ) : settings && settings.length > 0 ? (
              <ul className="space-y-1">
                {settings.map((s) => (
                  <li key={s.id}>
                    <span className="font-medium">{s.key}</span>: {JSON.stringify(s.value)}
                  </li>
                ))}
              </ul>
            ) : (
              'No settings configured yet.'
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
