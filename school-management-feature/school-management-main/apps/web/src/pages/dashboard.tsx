import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePartners } from '@/features/partners/api';
import { useProducts } from '@/features/products/api';
import { useAuthStore } from '@/stores/auth.store';

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const partners = usePartners({ page: 1, pageSize: 1 });
  const products = useProducts({ page: 1, pageSize: 1 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {user?.firstName}</h1>
        <p className="text-sm text-muted-foreground">
          Platform foundation (Phase 0 kernel + Phase 1 master data).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Partners</CardDescription>
            <CardTitle className="text-3xl">{partners.data?.meta.total ?? '-'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Customers & suppliers</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Products</CardDescription>
            <CardTitle className="text-3xl">{products.data?.meta.total ?? '-'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Goods, services & fees</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
            <CardTitle className="text-3xl">Ready</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Accounting & inventory engines come next (see ROADMAP.md)
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
