/**
 * "Where am I?" — the academic context a workflow screen is scoped to.
 *
 * Every mark and result screen already had year/term/class/stream/subject
 * pickers, and those selections persist across screens via `useStickyState`. So
 * a teacher could arrive on a page already scoped to a class and term they set
 * somewhere else, with nothing in the heading saying so — and no screen in the
 * app named the academic year at all. On a shared staffroom machine that is how
 * marks end up against the wrong class.
 *
 * Renders nothing until there is something to say, so it never becomes a row of
 * em-dashes above an empty page.
 */
export function ContextBar({
  year,
  term,
  className,
  stream,
  subject,
  extra,
}: {
  year?: string | null;
  term?: string | null;
  className?: string | null;
  stream?: string | null;
  subject?: string | null;
  extra?: string | null;
}) {
  const parts = [
    { label: 'Year', value: year },
    { label: 'Term', value: term },
    { label: 'Class', value: className },
    { label: 'Stream', value: stream },
    { label: 'Subject', value: subject },
  ].filter((p) => !!p.value);

  if (parts.length === 0 && !extra) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {parts.map((p) => (
        <span key={p.label} className="flex items-baseline gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{p.label}</span>
          <span className="font-medium">{p.value}</span>
        </span>
      ))}
      {extra && <span className="text-muted-foreground">{extra}</span>}
    </div>
  );
}
