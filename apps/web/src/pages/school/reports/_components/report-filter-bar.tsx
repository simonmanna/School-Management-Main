import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  useAcademicYears,
  useCampuses,
  useClasses,
  useResultSets,
  useSectionsForClass,
  useSubjects,
  useTerms, currentTerminology } from '@/features/school/api';
import type { ReportCatalogEntry, ReportFilters } from '@/features/school/reports-api';

/**
 * One filter bar for every report in the catalogue.
 *
 * It renders exactly the filters the definition declares — `meta.filters` — and
 * marks `meta.requiredFilters` so the user is told what is missing before the
 * server has to refuse. There is no per-report filter component and there should
 * never be one: a report is data, and its controls follow from its declaration.
 */

const REQUIRED_MARK = <span className="ml-0.5 text-destructive">*</span>;

function Field({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-[10rem] flex-1">
      <Label className="text-xs text-muted-foreground">
        {label}{required ? REQUIRED_MARK : null}
      </Label>
      {children}
    </div>
  );
}

function Select({
  value, onChange, options, placeholder,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function ReportFilterBar({
  meta, filters, onChange,
}: {
  meta: ReportCatalogEntry;
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
}) {
  const shows = useMemo(() => new Set(meta.filters), [meta.filters]);
  const required = useMemo(() => new Set(meta.requiredFilters), [meta.requiredFilters]);
  const set = <K extends keyof ReportFilters>(k: K, v: ReportFilters[K]) =>
    onChange({ ...filters, [k]: v });

  // Only fetch the lookups this report actually shows.
  const years = useAcademicYears();
  const terms = useTerms();
  const classes = useClasses();
  const campuses = useCampuses();
  const subjects = useSubjects();
  const sections = useSectionsForClass(shows.has('sectionId') ? filters.classId : undefined);
  const resultSets = useResultSets(shows.has('resultSetId') ? filters.termId : undefined);

  const opt = (rows: Array<{ id: string; name?: string }> | undefined) =>
    (rows ?? []).map((r) => ({ value: r.id, label: r.name ?? r.id }));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/30 p-3">
      {shows.has('academicYearId') && (
        <Field label="Academic Year" required={required.has('academicYearId')}>
          <Select
            value={filters.academicYearId}
            onChange={(v) => set('academicYearId', v)}
            options={opt(years.data?.data)}
            placeholder="All years"
          />
        </Field>
      )}

      {shows.has('termId') && (
        <Field label="Term" required={required.has('termId')}>
          <Select
            value={filters.termId}
            // Result sets belong to a term; changing the term invalidates the
            // chosen one rather than silently running against a mismatch.
            onChange={(v) => onChange({ ...filters, termId: v, resultSetId: undefined })}
            options={opt(terms.data?.data)}
            placeholder="Current term"
          />
        </Field>
      )}

      {shows.has('campusId') && (
        <Field label="Campus" required={required.has('campusId')}>
          <Select
            value={filters.campusId}
            onChange={(v) => set('campusId', v)}
            options={opt(campuses.data?.data)}
            placeholder="All campuses"
          />
        </Field>
      )}

      {shows.has('classId') && (
        <Field label="Class" required={required.has('classId')}>
          <Select
            value={filters.classId}
            // Sections hang off the class — clear them together.
            onChange={(v) => onChange({ ...filters, classId: v, sectionId: undefined })}
            options={opt(classes.data?.data)}
            placeholder={required.has('classId') ? 'Select a class' : 'All classes'}
          />
        </Field>
      )}

      {shows.has('sectionId') && (
        <Field label={currentTerminology().section} required={required.has('sectionId')}>
          <Select
            value={filters.sectionId}
            onChange={(v) => set('sectionId', v)}
            options={opt(sections.data)}
            placeholder={filters.classId ? `All ${currentTerminology().sectionPlural.toLowerCase()}` : 'Pick a class first'}
          />
        </Field>
      )}

      {shows.has('subjectId') && (
        <Field label="Subject" required={required.has('subjectId')}>
          <Select
            value={filters.subjectId}
            onChange={(v) => set('subjectId', v)}
            options={opt(subjects.data?.data)}
            placeholder="All subjects"
          />
        </Field>
      )}

      {shows.has('resultSetId') && (
        <Field label="Result Set" required={required.has('resultSetId')}>
          <Select
            value={filters.resultSetId}
            onChange={(v) => set('resultSetId', v)}
            options={(resultSets.data ?? []).map((rs) => ({
              value: rs.id,
              // Status matters here: a draft set's figures can still move.
              label: `rev ${rs.revision} · ${rs.status}`,
            }))}
            placeholder={filters.termId ? 'Select a result set' : 'Pick a term first'}
          />
        </Field>
      )}

      {shows.has('dateFrom') && (
        <Field label={shows.has('dateTo') ? 'From' : 'Date'} required={required.has('dateFrom')}>
          <Input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(e) => set('dateFrom', e.target.value || undefined)}
          />
        </Field>
      )}

      {shows.has('dateTo') && (
        <Field label="To" required={required.has('dateTo')}>
          <Input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(e) => set('dateTo', e.target.value || undefined)}
          />
        </Field>
      )}

      {shows.has('asOf') && (
        <Field label="As at" required={required.has('asOf')}>
          <Input
            type="date"
            value={filters.asOf ?? ''}
            onChange={(e) => set('asOf', e.target.value || undefined)}
          />
          {meta.asOfMode === 'current-only' && (
            // Say so before they run it, not only in the note afterwards.
            <p className="mt-1 text-[11px] leading-tight text-amber-600">
              This report shows current balances; it cannot reconstruct a past date.
            </p>
          )}
        </Field>
      )}

      {shows.has('gender') && (
        <Field label="Gender">
          <Select
            value={filters.gender}
            onChange={(v) => set('gender', v)}
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
            ]}
            placeholder="All"
          />
        </Field>
      )}

      {shows.has('residenceType') && (
        <Field label="Residence">
          <Select
            value={filters.residenceType}
            onChange={(v) => set('residenceType', v)}
            options={[
              { value: 'day', label: 'Day' },
              { value: 'boarder', label: 'Boarder' },
            ]}
            placeholder="All"
          />
        </Field>
      )}

      {shows.has('house') && (
        <Field label="House">
          <Input
            value={filters.house ?? ''}
            onChange={(e) => set('house', e.target.value || undefined)}
            placeholder="Any house"
          />
        </Field>
      )}

      {shows.has('search') && (
        <Field label="Search">
          <Input
            value={filters.search ?? ''}
            onChange={(e) => set('search', e.target.value || undefined)}
            placeholder="Name, number, reference…"
          />
        </Field>
      )}

      {shows.has('classBasis') && (
        <Field label="Class basis">
          <Select
            value={filters.classBasis}
            onChange={(v) => set('classBasis', v as ReportFilters['classBasis'])}
            options={[
              { value: 'current', label: 'Current class' },
              { value: 'enrollment', label: 'Enrolment for the term' },
              { value: 'roster', label: 'Frozen academic roster' },
            ]}
            placeholder={`Default (${meta.classBasisDefault ?? 'current'})`}
          />
          {/* The commonest reason two reports disagree on a pupil count. */}
          <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
            Which record decides who is in a class.
          </p>
        </Field>
      )}
    </div>
  );
}
