import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ExternalLink, User, Pencil } from 'lucide-react';
import { useStaff, useDepartments, type StaffMember } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

const CAT_META: Record<string, string> = {
  teaching: 'bg-emerald-100 text-emerald-700',
  non_teaching: 'bg-sky-100 text-sky-700',
  support: 'bg-amber-100 text-amber-700',
  admin: 'bg-violet-100 text-violet-700',
};

const STATUS_META: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  on_leave: 'bg-amber-100 text-amber-700',
  suspended: 'bg-rose-100 text-rose-700',
  terminated: 'bg-slate-100 text-slate-700',
  retired: 'bg-slate-100 text-slate-700',
};

/**
 * The person's name lives on the linked Partner — `StaffProfile` has no name
 * columns of its own. Falling back to the employee number is a last resort that
 * now only fires for a genuinely unlinked row.
 */
const fullName = (s: StaffMember) => s.partner?.name?.trim() || s.employeeNo;
const fmtDate = (d?: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

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
    return rows.filter(
      (s) =>
        fullName(s).toLowerCase().includes(q) ||
        s.employeeNo.toLowerCase().includes(q) ||
        (s.partner?.email ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const teaching = rows.filter((s) => s.staffCategory === 'teaching').length;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Teaching Staff (roster)</h1>
          <p className="text-sm text-muted-foreground">
            School-side roster. {rows.length} total · {teaching} teaching. Pay, leave,
            documents and qualifications live on the HR record.
          </p>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, employee no or email…"
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Employee no.</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Department</th>
                  <th className="px-4 py-2 font-medium">Position</th>
                  <th className="px-4 py-2 font-medium">Campus</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Joined</th>
                  <th className="px-4 py-2 font-medium">HR</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No staff found.</td></tr>
                )}
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2 font-mono text-xs">{s.employeeNo}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{fullName(s)}</div>
                      {s.partner?.email && (
                        <div className="text-xs text-muted-foreground">{s.partner.email}</div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge className={CAT_META[s.staffCategory] ?? 'bg-slate-100 text-slate-700'}>
                        {s.staffCategory.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{s.department ? deptName[s.department.id] ?? s.department.name : '—'}</td>
                    <td className="px-4 py-2">{s.position?.name ?? '—'}</td>
                    <td className="px-4 py-2">{s.campus?.name ?? '—'}</td>
                    <td className="px-4 py-2">
                      {s.status ? (
                        <Badge variant="outline" className={STATUS_META[s.status] ?? ''}>
                          {s.status.replace('_', ' ')}
                        </Badge>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2">{fmtDate(s.joinDate)}</td>
                    <td className="px-4 py-2">
                      <Link
                        to="/hr/reconciliation"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        title="Open the HR record, or link this person to one"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/school/staff/${s.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" title="View profile">
                          <User className="h-3 w-3" /> View
                        </Link>
                        <Link to={`/school/staff/${s.id}/edit`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" title="Edit staff">
                          <Pencil className="h-3 w-3" /> Edit
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
