import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Stacked filter control: small label on top, input below. Fields grow to share one filter row;
 * `wide` reserves room for datetime inputs. Controls are normalised to one height so labels line up.
 */
export function FilterField({ label, children, wide, className }: { label: string; children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-1 flex-col gap-1 [&>:last-child]:h-10', wide ? 'min-w-[170px] [&>input]:px-1.5' :'min-w-[110px]', className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
