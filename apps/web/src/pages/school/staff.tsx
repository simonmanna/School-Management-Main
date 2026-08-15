import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useStaff, useDepartments, type StaffMember } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

const CAT_META: Record<string, string> = {
  teaching: 'bg-emerald-100 text-emerald-700',
  non_teaching: 'bg-sky-100 text-sky-700',
  support: 'bg-amber-100 text-amber-700',
};

const fullName = (s: StaffMember) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ') || s.partner?.name || s.employeeNo;

export function SchoolStaffPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useStaff();
  const { data: depts } = useDepartments();

  const rows = useMemo(() => data?.data ?? [], [data]);
  const deptName = useMemo(
    () => Object.fromEntries((depts?.data ?? []).map((d) => [d.id, d.name])),
    [depts],
  );
  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((s) => fullName(s).toLowerCase().includes(q) || s.employeeNo.toLowerCase().includes(q));
  }, [rows, search]);

  const teaching = rows.filter((s) => s.staffCategory === 'teaching').length;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Staff</h1>
          <p className="text-sm text-muted-foreground">
            Teaching &amp; non-teaching staff. {rows.length} total · {teaching} teaching.
          </p>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or employee no…"
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Employee no.</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="px-4 py-2 font-medium">Designation</th>
                <th className="px-4 py-2 font-medium">Qualification</th>
                <th className="px-4 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No staff found.</td></tr>
              )}
              {filtered.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-mono text-xs">{s.employeeNo}</td>
                  <td className="px-4 py-2 font-medium">{fullName(s)}</td>
                  <td className="px-4 py-2">
                    <Badge className={CAT_META[s.staffCategory] ?? 'bg-slate-100 text-slate-700'}>
                      {s.staffCategory.replace('_', ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">{s.department ? deptName[s.department.id] ?? '—' : '—'}</td>
                  <td className="px-4 py-2">{s.designation ?? s.position?.name ?? '—'}</td>
                  <td className="px-4 py-2">{s.qualification ?? '—'}</td>
                  <td className="px-4 py-2">{s.dateOfJoining ? new Date(s.dateOfJoining).toISOString().slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
