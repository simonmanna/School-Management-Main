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

/**
 * Surface the API's own message instead of a generic "could not save".
 * The fees endpoints answer with real reasons — "This fee structure is
 * scheduled to 2 term(s)", "…already exists" — and swallowing them was why
 * a failed save looked like a broken screen.
 */
export function apiError(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  return msg || fallback;
}
