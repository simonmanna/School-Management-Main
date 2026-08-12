import { useNavigate } from 'react-router-dom';
import { Building2, Wrench, AlertTriangle, DollarSign, Clock, FileText } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency } from '@/lib/utils';
import { useAssetDashboardSummary, useAssetDashboardUpcoming } from '@/features/fixed-asset/api';

export function AssetDashboardPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canView = hasPermission(PERMISSIONS.fixedAsset.read);
  const { data: summary } = useAssetDashboardSummary();
  const { data: upcoming } = useAssetDashboardUpcoming();

  if (!canView) return <div className="p-8 text-center text-muted-foreground">No permission to view fixed assets.</div>;

  const cards = [
    { title: 'Total Assets', value: summary?.totalAssets ?? 0, icon: Building2, color: 'text-blue-600' },
    { title: 'Active', value: summary?.activeAssets ?? 0, icon: Building2, color: 'text-green-600' },
    { title: 'Under Maintenance', value: summary?.maintenanceAssets ?? 0, icon: Wrench, color: 'text-yellow-600' },
    { title: 'Disposed', value: summary?.disposedAssets ?? 0, icon: AlertTriangle, color: 'text-red-600' },
    { title: 'Total Value', value: formatCurrency(summary?.totalValue ?? 0), icon: DollarSign, color: 'text-green-600' },
    { title: 'Purchase Cost', value: formatCurrency(summary?.totalPurchaseCost ?? 0), icon: FileText, color: 'text-purple-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Fixed Assets Dashboard</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/fixed-assets')}>Asset Register</Button>
          <Button variant="outline" onClick={() => navigate('/fixed-assets/categories')}>Categories</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{c.title}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.color}`} />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{c.value}</p></CardContent>
          </Card>
        ))}
      </div>

      {summary?.byCategory && summary.byCategory.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Assets by Category</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {summary.byCategory.map((cat: any) => (
                <div key={cat.id} className="flex justify-between items-center">
                  <span>{cat.name}</span>
                  <Badge variant="outline">{cat._count?.assets ?? 0}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2"><Clock className="h-5 w-5 text-yellow-500" /><CardTitle>Maintenance Due (30 days)</CardTitle></CardHeader>
          <CardContent>
            {upcoming?.maintenanceDue?.length ? upcoming.maintenanceDue.map((m: any) => (
              <div key={m.id} className="flex justify-between py-1 text-sm border-b last:border-0">
                <span>{m.asset?.name ?? m.title}</span>
                <span className="text-muted-foreground">{m.nextMaintenanceDate ? new Date(m.nextMaintenanceDate).toLocaleDateString() : ''}</span>
              </div>
            )) : <p className="text-sm text-muted-foreground">No upcoming maintenance</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2"><AlertTriangle className="h-5 w-5 text-orange-500" /><CardTitle>Warranty Expiring (90 days)</CardTitle></CardHeader>
          <CardContent>
            {upcoming?.warrantyExpiring?.length ? upcoming.warrantyExpiring.map((w: any) => (
              <div key={w.id} className="flex justify-between py-1 text-sm border-b last:border-0">
                <span>{w.asset?.name ?? ''}</span>
                <span className="text-muted-foreground">{new Date(w.warrantyEnd).toLocaleDateString()}</span>
              </div>
            )) : <p className="text-sm text-muted-foreground">No expiring warranties</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Recently Added Assets</CardTitle></CardHeader>
          <CardContent>
            {upcoming?.recentAssets?.length ? upcoming.recentAssets.map((a: any) => (
              <div key={a.id} className="flex justify-between py-1 text-sm border-b last:border-0 cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/fixed-assets/${a.id}`)}>
                <span className="font-medium">{a.name}</span>
                <span className="text-muted-foreground">{a.assetCode}</span>
              </div>
            )) : <p className="text-sm text-muted-foreground">No recent assets</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent Depreciation</CardTitle></CardHeader>
          <CardContent>
            {upcoming?.recentDepreciation?.length ? upcoming.recentDepreciation.map((d: any) => (
              <div key={d.id} className="flex justify-between py-1 text-sm border-b last:border-0">
                <span>{d.asset?.name ?? ''}</span>
                <span className="text-muted-foreground">{d.period} · {formatCurrency(d.depreciationAmount)}</span>
              </div>
            )) : <p className="text-sm text-muted-foreground">No depreciation yet</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
