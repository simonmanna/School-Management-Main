import { Card, CardContent } from '@/components/ui/card';

export const money = (n: number | string) => `UGX ${Number(n).toLocaleString()}`;
export const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'emerald' }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold ${tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : ''}`}>{value}</div>
    </div>
  );
}

export function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Card className={className}><CardContent className="p-4">{children}</CardContent></Card>;
}
