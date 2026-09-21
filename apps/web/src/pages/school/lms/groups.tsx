import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Layers, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useLmsAddGroupMember, useLmsCoursePage, useLmsCreateGroup, useLmsCreateGrouping,
  useLmsEnrolments, useLmsGroupMembers, useLmsGroupings, useLmsGroups, useLmsRemoveGroupMember,
} from '@/features/school/api';
import { can, CAP, type CoursePageView } from '@/features/school/lms/types';
import { notify } from '@/lib/notify';

/**
 * Groups and groupings (ADR-014 §3.3).
 *
 * A GROUP is a set of people inside one course; a GROUPING is a set of groups.
 * Separate-groups forums, group assignments and differentiated release all read
 * these, so they are course structure rather than a convenience list.
 *
 * Members are picked from the course's own enrolments, not the whole school — a
 * pupil who is not enrolled cannot be in one of its groups.
 */
export function SchoolLmsGroupsPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();

  const [selected, setSelected] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [creatingGrouping, setCreatingGrouping] = useState(false);
  const [addingMember, setAddingMember] = useState(false);

  const { data: page } = useLmsCoursePage(id);
  const { data: groups, isLoading } = useLmsGroups(id);
  const { data: groupings } = useLmsGroupings(id);
  const { data: members } = useLmsGroupMembers(selected ?? undefined);
  const { data: enrolments } = useLmsEnrolments(id, 'active');
  const removeMember = useLmsRemoveGroupMember();

  const course = page as CoursePageView | undefined;
  const mayManage = can(course?.capabilities, CAP.courseManage);
  const active = (groups ?? []).find((g) => g.id === selected) ?? null;

  // Names for the member list: `LmsGroupMember` stores ids only, and the course's
  // enrolment list is the one place that already resolves them.
  const nameFor = (studentProfileId: string | null) =>
    (enrolments ?? []).find((e) => e.studentProfileId === studentProfileId)?.studentName ?? 'Unknown';

  const memberIds = new Set((members ?? []).map((m: any) => m.studentProfileId));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(`/school/lms/courses/${id}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">Groups</h1>
          <p className="truncate text-sm text-muted-foreground">{course?.course.name}</p>
        </div>
        {mayManage && (
          <>
            <Button variant="outline" size="sm" onClick={() => setCreatingGrouping(true)}>
              <Layers className="mr-1 h-4 w-4" />New grouping
            </Button>
            <Button size="sm" onClick={() => setCreatingGroup(true)}>
              <Plus className="mr-1 h-4 w-4" />New group
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-base">Groups</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && (groups ?? []).length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">No groups yet.</p>
            )}
            <ul className="divide-y">
              {(groups ?? []).map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(g.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                      selected === g.id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <Badge variant="outline" className="text-[10px] tabular-nums">{g._count?.members ?? 0}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="text-base">
                {active ? active.name : 'Members'}
              </CardTitle>
              {active && mayManage && (
                <Button size="sm" variant="outline" onClick={() => setAddingMember(true)}>
                  <UserPlus className="mr-1 h-4 w-4" />Add member
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {!active && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Pick a group to see who is in it.
                </p>
              )}
              {active && (members ?? []).length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">This group is empty.</p>
              )}
              <ul className="divide-y">
                {(members ?? []).map((m: any) => (
                  <li key={m.id} className="flex items-center gap-2 p-3 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {m.studentProfileId ? nameFor(m.studentProfileId) : 'Staff member'}
                    </span>
                    {mayManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Remove from group"
                        onClick={async () => {
                          try {
                            await removeMember.mutateAsync(m.id);
                            notify.success('Removed from group');
                          } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3"><CardTitle className="text-base">Groupings</CardTitle></CardHeader>
            <CardContent>
              {(groupings ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No groupings. A grouping bundles groups so an activity can be released to several at once.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {(groupings ?? []).map((g: any) => (
                    <li key={g.id} className="flex items-center gap-2 rounded border px-3 py-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      <Badge variant="outline" className="text-[10px] tabular-nums">
                        {(g.groupIds ?? []).length} group(s)
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {creatingGroup && <CreateGroupDialog courseId={id} onClose={() => setCreatingGroup(false)} />}
      {creatingGrouping && (
        <CreateGroupingDialog courseId={id} groups={groups ?? []} onClose={() => setCreatingGrouping(false)} />
      )}
      {addingMember && active && (
        <AddMemberDialog
          groupId={active.id}
          candidates={(enrolments ?? []).filter((e) => e.studentProfileId && !memberIds.has(e.studentProfileId))}
          onClose={() => setAddingMember(false)}
        />
      )}
    </div>
  );
}

function CreateGroupDialog({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useLmsCreateGroup();
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New group</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Red team" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({ courseId, name: name.trim(), description: description.trim() || undefined });
                notify.success('Group created');
                onClose();
              } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateGroupingDialog({
  courseId, groups, onClose,
}: { courseId: string; groups: { id: string; name: string }[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const create = useLmsCreateGrouping();
  const toggle = (gid: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New grouping</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Groups in this grouping</Label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {groups.length === 0 && <p className="text-xs text-muted-foreground">Create a group first.</p>}
              {groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={picked.has(g.id)} onChange={() => toggle(g.id)} />
                  <span className="truncate">{g.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({ courseId, name: name.trim(), groupIds: Array.from(picked) });
                notify.success('Grouping created');
                onClose();
              } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMemberDialog({
  groupId, candidates, onClose,
}: {
  groupId: string;
  candidates: { studentProfileId: string | null; studentName: string | null; admissionNo: string | null }[];
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const add = useLmsAddGroupMember();
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? candidates.filter((c) => (c.studentName ?? '').toLowerCase().includes(needle) || (c.admissionNo ?? '').toLowerCase().includes(needle))
    : candidates;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add member</DialogTitle></DialogHeader>
        <Input autoFocus placeholder="Find an enrolled pupil…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 overflow-y-auto rounded-md border">
          {shown.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">
              Nobody left to add — everyone enrolled is already in this group.
            </p>
          )}
          <ul className="divide-y">
            {shown.map((c) => (
              <li key={c.studentProfileId}>
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={async () => {
                    try {
                      await add.mutateAsync({ groupId, studentProfileId: c.studentProfileId! });
                      notify.success(`Added ${c.studentName ?? 'pupil'}`);
                    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 truncate">{c.studentName ?? 'Unnamed'}</span>
                  <span className="text-xs text-muted-foreground">{c.admissionNo}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
