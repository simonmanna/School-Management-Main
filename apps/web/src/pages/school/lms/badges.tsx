import { useMemo, useState } from 'react';
import { Award, Medal, Plus, Search, Sparkles, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  useLmsAwardBadge, useLmsBadgeAwards, useLmsBadges, useLmsCourses, useLmsCreateBadge, useStudents,
} from '@/features/school/api';
import { notify } from '@/lib/notify';

const ALL = '__all__';
const NONE = '__none__';

/**
 * Badges (ADR-014 §3.8).
 *
 * A badge is either site-wide or tied to one course. Awarding is manual here on
 * purpose — a criteria-driven badge is evaluated by the server, and a screen that
 * let a teacher hand-award a criteria badge would quietly contradict it.
 */
export function SchoolLmsBadgesPage() {
  const [scope, setScope] = useState<string>(ALL);
  const [creating, setCreating] = useState(false);
  const [awarding, setAwarding] = useState<{ id: string; name: string } | null>(null);
  const [inspecting, setInspecting] = useState<{ id: string; name: string } | null>(null);

  const { data: badges, isLoading } = useLmsBadges(scope === ALL ? undefined : scope);
  const { data: courses } = useLmsCourses();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Award className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Badges</h1>
        <Badge variant="outline">{badges?.length ?? 0}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Course" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All badges</SelectItem>
              {courses?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" />New badge
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading badges…</p>}

      {!isLoading && (badges?.length ?? 0) === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No badges yet. Create one to recognise work that a mark does not capture.
        </CardContent></Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {badges?.map((b) => (
          <Card key={b.id}>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-start gap-3">
                {b.imageUrl ? (
                  <img src={b.imageUrl} alt="" className="h-12 w-12 rounded object-cover" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded bg-muted">
                    <Medal className="h-6 w-6 text-muted-foreground" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{b.name}</p>
                  {b.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{b.description}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{b.criteriaType}</Badge>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setInspecting({ id: b.id, name: b.name })}
                >
                  <Users className="h-3 w-3" />{b._count?.awards ?? 0} awarded
                </button>
                {b.criteriaType === 'manual' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    onClick={() => setAwarding({ id: b.id, name: b.name })}
                  >
                    <Sparkles className="mr-1 h-3.5 w-3.5" />Award
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {creating && (
        <CreateBadgeDialog
          courses={courses ?? []}
          defaultCourseId={scope === ALL ? NONE : scope}
          onClose={() => setCreating(false)}
        />
      )}
      {awarding && <AwardDialog badge={awarding} onClose={() => setAwarding(null)} />}
      {inspecting && <AwardsDialog badge={inspecting} onClose={() => setInspecting(null)} />}
    </div>
  );
}

function CreateBadgeDialog({
  courses, defaultCourseId, onClose,
}: {
  courses: { id: string; name: string }[];
  defaultCourseId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [courseId, setCourseId] = useState(defaultCourseId);
  const create = useLmsCreateBadge();

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New badge</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Consistent effort" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">What it is for</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Image URL (optional)</Label>
            <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Scope</Label>
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Whole school</SelectItem>
                {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={async () => {
              try {
                await create.mutateAsync({
                  name: name.trim(),
                  description: description.trim() || undefined,
                  imageUrl: imageUrl.trim() || undefined,
                  criteriaType: 'manual',
                  courseOfferingId: courseId === NONE ? undefined : courseId,
                });
                notify.success('Badge created');
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

function AwardDialog({ badge, onClose }: { badge: { id: string; name: string }; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const { data: students, isFetching } = useStudents({ search: search.trim() || undefined, pageSize: 20 });
  const award = useLmsAwardBadge();

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Award “{badge.name}”</DialogTitle></DialogHeader>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-8"
            placeholder="Find a pupil…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-64 overflow-y-auto rounded-md border">
          {isFetching && <p className="p-3 text-xs text-muted-foreground">Searching…</p>}
          {!isFetching && (students?.data ?? []).length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">No pupil matches that.</p>
          )}
          <ul className="divide-y">
            {(students?.data ?? []).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={award.isPending}
                  onClick={async () => {
                    try {
                      await award.mutateAsync({ badgeId: badge.id, studentProfileId: s.id });
                      notify.success(`Awarded to ${s.partner?.name ?? s.admissionNo}`);
                    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 truncate">{s.partner?.name ?? 'Unnamed'}</span>
                  <span className="text-xs text-muted-foreground">{s.admissionNo}</span>
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

function AwardsDialog({ badge, onClose }: { badge: { id: string; name: string }; onClose: () => void }) {
  const { data, isLoading } = useLmsBadgeAwards(badge.id);
  const rows = useMemo(() => data ?? [], [data]);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{badge.name}</DialogTitle></DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nobody holds this badge yet.</p>
        )}
        <ul className="max-h-72 divide-y overflow-y-auto">
          {rows.map((a: any) => (
            <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{a.studentName ?? 'Staff member'}</span>
              <span className="text-xs text-muted-foreground">
                {a.awardedAt ? new Date(a.awardedAt).toLocaleDateString() : ''}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
