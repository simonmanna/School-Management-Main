import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Wave 16 — the school's own fields ("Blood group", "Bus stop", …) rendered on
 * the forms they belong to. The API validates them too; this only renders and
 * collects, so a required field shows as required here and is enforced there.
 */
export interface CustomFieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'textarea' | string;
  options: string[];
  required: boolean;
}

export type CustomFieldEntity = 'student' | 'staff' | 'class' | 'guardian' | 'fee' | 'subject';

export function useCustomFieldDefs(entityType: CustomFieldEntity) {
  return useQuery({
    queryKey: ['school', 'custom-fields', 'for', entityType],
    staleTime: 5 * 60_000,
    queryFn: async () => (await api.get<CustomFieldDef[]>(`/school/custom-fields/for/${entityType}`)).data,
  });
}

/** Only the defined keys, for sending; other keys in the bag are the server's. */
export function pickCustomFieldValues(defs: CustomFieldDef[] | undefined, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs ?? []) if (values[d.name] !== undefined) out[d.name] = values[d.name];
  return out;
}

/** Which required fields are still empty (for disabling a submit button). */
export function missingRequired(defs: CustomFieldDef[] | undefined, values: Record<string, unknown>): string[] {
  return (defs ?? []).filter((d) => d.required && (values[d.name] === undefined || values[d.name] === null || values[d.name] === '')).map((d) => d.label);
}

export function CustomFieldsSection({
  entityType,
  values,
  onChange,
  className,
}: {
  entityType: CustomFieldEntity;
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  className?: string;
}) {
  const { data: defs } = useCustomFieldDefs(entityType);
  if (!defs?.length) return null;
  const set = (name: string, v: unknown) => onChange({ ...values, [name]: v });
  const field = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
  return (
    <div className={className ?? 'grid grid-cols-2 gap-3'}>
      {defs.map((d) => {
        const id = `cf-${entityType}-${d.name}`;
        const v = values[d.name];
        const label = (
          <Label htmlFor={id} className="text-xs">
            {d.label}{d.required && <span className="text-destructive"> *</span>}
          </Label>
        );
        let control: React.ReactNode;
        switch (d.type) {
          case 'select':
            control = (
              <select id={id} className={field} value={v == null ? '' : String(v)} onChange={(e) => set(d.name, e.target.value || null)}>
                <option value="">—</option>
                {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            );
            break;
          case 'boolean':
            control = (
              <select id={id} className={field} value={v === true ? 'yes' : v === false ? 'no' : ''} onChange={(e) => set(d.name, e.target.value === '' ? null : e.target.value === 'yes')}>
                <option value="">—</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            );
            break;
          case 'textarea':
            control = <textarea id={id} className={`${field} min-h-20`} value={v == null ? '' : String(v)} onChange={(e) => set(d.name, e.target.value)} />;
            break;
          default:
            control = (
              <Input
                id={id}
                type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'}
                value={v == null ? '' : String(v)}
                onChange={(e) => set(d.name, e.target.value)}
              />
            );
        }
        return (
          <div key={d.name} className={`space-y-1 ${d.type === 'textarea' ? 'col-span-2' : ''}`}>
            {label}
            {control}
          </div>
        );
      })}
    </div>
  );
}
