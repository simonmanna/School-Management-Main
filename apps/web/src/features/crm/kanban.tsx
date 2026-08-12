import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { CalendarDays, User } from 'lucide-react';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DEAL_STAGES, STAGE_META, dealCurrency, useChangeStage, type CrmDeal, type DealStage } from './api';

export { STAGE_META, dealCurrency };

function DealCard({ deal }: { deal: CrmDeal }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => navigate(`/crm/deals/${deal.id}`)}
      className={cn(
        'cursor-grab rounded-lg border bg-white p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing',
        isDragging && 'opacity-60 ring-2 ring-primary/40',
      )}
    >
      <p className="text-sm font-semibold leading-snug text-foreground">{deal.name}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{deal.partner?.name ?? '—'}</p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold">{money(deal.amount, dealCurrency(deal))}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <CalendarDays className="h-3 w-3" />
          {deal.expectedClose ? new Date(deal.expectedClose).toLocaleDateString() : 'No close date'}
        </span>
        {deal.owner ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary" title={deal.owner.name}>
            {deal.owner.name.charAt(0).toUpperCase()}
          </span>
        ) : (
          <User className="h-3 w-3 text-muted-foreground/50" />
        )}
      </div>
    </div>
  );
}

function DealColumn({ stage, deals }: { stage: DealStage; deals: CrmDeal[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const meta = STAGE_META[stage];
  const total = deals.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30',
        isOver && 'border-primary/60 ring-2 ring-primary/20',
      )}
    >
      <div className="flex items-center justify-between rounded-t-xl border-b bg-white/60 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
          <span className="text-xs font-bold uppercase tracking-wide text-foreground">{meta.label}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{deals.length}</span>
        </div>
        {total > 0 && <span className="text-xs font-bold text-foreground">{money(total, 'IDR')}</span>}
      </div>
      <div className="flex min-h-[140px] flex-1 flex-col gap-2 p-2">
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-[11px] text-muted-foreground/60">
            Drop deals here
          </div>
        ) : (
          deals.map((d) => <DealCard key={d.id} deal={d} />)
        )}
      </div>
    </div>
  );
}

interface DealsKanbanProps {
  deals: CrmDeal[];
  loading?: boolean;
}

export function DealsKanban({ deals, loading }: DealsKanbanProps) {
  const changeStage = useChangeStage();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byStage = useMemo(() => {
    const map = new Map<DealStage, CrmDeal[]>();
    for (const s of DEAL_STAGES) map.set(s, []);
    for (const d of deals) {
      const list = map.get(d.stage);
      if (list) list.push(d);
    }
    return map;
  }, [deals]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const dealId = active.id as string;
      const targetStage = over.id as DealStage;
      if (!DEAL_STAGES.includes(targetStage)) return;
      const current = deals.find((d) => d.id === dealId);
      if (!current || current.stage === targetStage) return;
      // Won/lost are terminal on the backend: deletion is blocked for won deals,
      // but stage changes out of won/lost are allowed.
      changeStage.mutate({ id: dealId, stage: targetStage });
    },
    [deals, changeStage],
  );

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {DEAL_STAGES.map((s) => (
          <div key={s} className="flex w-72 shrink-0 flex-col gap-2">
            <div className="h-8 w-28 animate-pulse rounded bg-muted" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {DEAL_STAGES.map((s) => (
          <DealColumn key={s} stage={s} deals={byStage.get(s) ?? []} />
        ))}
      </div>
    </DndContext>
  );
}
