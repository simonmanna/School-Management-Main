import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import {
  useBulkImportStudents,
  useParseStudentImportFile,
  useTerms,
  useTerminology,
  type ParsedStudentSheet,
} from '@/features/school/api';
import { useCustomFieldDefs } from '@/features/school/custom-fields';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';
import { exportCSV } from '@/lib/export-csv';

/**
 * Import pupils from an Excel / CSV file. The API reads the file into
 * headings + rows; here the operator maps each heading to a pupil field, checks
 * the preview, and the mapped rows go to `students/bulk-import` in batches
 * (each row is admitted on its own, so one bad row never blocks the rest).
 */

interface SystemField {
  key: string;
  label: string;
  group: 'Pupil' | 'Placement' | 'Guardian' | 'School fields';
  hint?: string;
  /** Normalised heading spellings that auto-map to this field. */
  aliases?: string[];
}

const BASE_FIELDS: SystemField[] = [
  { key: 'admissionNo', label: 'Admission number', group: 'Pupil', hint: 'Required, unique', aliases: ['admissionno', 'admissionnumber', 'admno', 'admission', 'studentid', 'studentno', 'regno', 'registrationno', 'registrationnumber'] },
  { key: 'name', label: 'Full name', group: 'Pupil', hint: 'Or map first + last name', aliases: ['name', 'fullname', 'studentname', 'pupilname', 'learnername'] },
  { key: 'firstName', label: 'First name', group: 'Pupil', aliases: ['firstname', 'givenname', 'forename'] },
  { key: 'middleName', label: 'Middle name', group: 'Pupil', aliases: ['middlename', 'othername', 'othernames'] },
  { key: 'lastName', label: 'Last name', group: 'Pupil', aliases: ['lastname', 'surname', 'familyname'] },
  { key: 'preferredName', label: 'Preferred name', group: 'Pupil', aliases: ['preferredname', 'nickname'] },
  { key: 'gender', label: 'Gender', group: 'Pupil', hint: 'Male / Female / M / F', aliases: ['gender', 'sex'] },
  { key: 'dateOfBirth', label: 'Date of birth', group: 'Pupil', hint: 'YYYY-MM-DD or DD/MM/YYYY', aliases: ['dateofbirth', 'dob', 'birthdate', 'birthday'] },
  { key: 'nationality', label: 'Nationality', group: 'Pupil', aliases: ['nationality'] },
  { key: 'religion', label: 'Religion', group: 'Pupil', aliases: ['religion'] },
  { key: 'nin', label: 'National ID (NIN)', group: 'Pupil', aliases: ['nin', 'nationalid', 'nationalidnumber'] },
  { key: 'email', label: 'Email', group: 'Pupil', aliases: ['email', 'emailaddress', 'studentemail'] },
  { key: 'phone', label: 'Phone', group: 'Pupil', aliases: ['phone', 'phonenumber', 'mobile', 'studentphone'] },
  { key: 'address', label: 'Address', group: 'Pupil', aliases: ['address', 'homeaddress', 'residence address'] },
  { key: 'placeOfBirth', label: 'Place of birth', group: 'Pupil', aliases: ['placeofbirth'] },
  { key: 'countryOfBirth', label: 'Country of birth', group: 'Pupil', aliases: ['countryofbirth'] },
  { key: 'enrollmentDate', label: 'Enrolment date', group: 'Placement', hint: 'Defaults to today', aliases: ['enrollmentdate', 'enrolmentdate', 'admissiondate', 'dateofadmission', 'datejoined'] },
  { key: 'classCode', label: 'Class', group: 'Placement', hint: 'Class code or name', aliases: ['class', 'classcode', 'classname', 'grade', 'form'] },
  { key: 'sectionCode', label: 'Stream', group: 'Placement', hint: 'Stream code or name', aliases: ['stream', 'section', 'streamcode', 'sectioncode', 'streamname'] },
  { key: 'studentCategory', label: 'Student category', group: 'Placement', hint: 'Category name', aliases: ['category', 'studentcategory'] },
  { key: 'residenceType', label: 'Residence', group: 'Placement', hint: 'Day / Boarder', aliases: ['residence', 'residencetype', 'dayboarder', 'boarding'] },
  { key: 'house', label: 'House', group: 'Placement', aliases: ['house'] },
  { key: 'entryStatus', label: 'Entry status', group: 'Placement', hint: 'New entrant / Transfer / …', aliases: ['entrystatus', 'entrytype'] },
  { key: 'guardianFirstName', label: 'Guardian name', group: 'Guardian', aliases: ['guardian', 'guardianname', 'guardianfirstname', 'parent', 'parentname'] },
  { key: 'guardianLastName', label: 'Guardian last name', group: 'Guardian', aliases: ['guardianlastname', 'guardiansurname'] },
  { key: 'guardianRelationship', label: 'Guardian relationship', group: 'Guardian', hint: 'father, mother, guardian, …', aliases: ['relationship', 'guardianrelationship', 'relation'] },
  { key: 'guardianPhone', label: 'Guardian phone', group: 'Guardian', aliases: ['guardianphone', 'parentphone', 'guardiancontact', 'guardianmobile', 'parentcontact'] },
  { key: 'guardianEmail', label: 'Guardian email', group: 'Guardian', aliases: ['guardianemail', 'parentemail'] },
  { key: 'guardianOccupation', label: 'Guardian occupation', group: 'Guardian', aliases: ['guardianoccupation', 'occupation'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const BATCH = 100;

type Step = 'upload' | 'map' | 'preview' | 'done';

interface Failure { sheetRow: number; admissionNo?: string; reason: string; source: Record<string, string> }

export function SchoolStudentImportPage() {
  const vocab = useTerminology();
  const { data: cfDefs } = useCustomFieldDefs('student');
  const { data: terms } = useTerms();
  const parse = useParseStudentImportFile();
  const importer = useBulkImportStudents();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [sheet, setSheet] = useState<ParsedStudentSheet | null>(null);
  /** heading → system field key ('' = ignore). */
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [termId, setTermId] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; failures: Failure[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fields = useMemo<SystemField[]>(() => {
    const sectionLabel = vocab.section;
    const base = BASE_FIELDS.map((f) => (f.key === 'sectionCode' ? { ...f, label: sectionLabel, hint: `${sectionLabel} code or name` } : f));
    const custom = (cfDefs ?? []).map<SystemField>((d) => ({
      key: d.name,
      label: d.label,
      group: 'School fields',
      hint: d.required ? 'Required by your school' : undefined,
      aliases: [norm(d.name), norm(d.label)],
    }));
    return [...base, ...custom];
  }, [cfDefs, vocab.section]);

  const autoMap = (headers: string[]) => {
    const used = new Set<string>();
    const out: Record<string, string> = {};
    for (const h of headers) {
      const n = norm(h);
      const hit = fields.find((f) => !used.has(f.key) && (norm(f.key) === n || norm(f.label) === n || f.aliases?.includes(n)));
      out[h] = hit?.key ?? '';
      if (hit) used.add(hit.key);
    }
    return out;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = await parse.mutateAsync(file);
      setSheet(parsed);
      setMapping(autoMap(parsed.headers));
      setResult(null);
      setStep('map');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not read the file.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const mappedKeys = new Set(Object.values(mapping).filter(Boolean));
  const mappingProblems: string[] = [];
  if (!mappedKeys.has('admissionNo')) mappingProblems.push('Map a column to Admission number.');
  if (!mappedKeys.has('name') && !mappedKeys.has('firstName')) mappingProblems.push('Map a column to Full name, or to First name (and Last name).');
  if (mappedKeys.has('sectionCode') && !mappedKeys.has('classCode')) mappingProblems.push(`${vocab.section} needs a Class column too.`);
  for (const d of cfDefs ?? []) {
    if (d.required && !mappedKeys.has(d.name)) mappingProblems.push(`Your school requires "${d.label}" — map a column to it.`);
  }

  const setColumn = (header: string, key: string) => {
    setMapping((m) => {
      const next = { ...m };
      // One column per field: picking a field taken by another column moves it here.
      if (key) for (const h of Object.keys(next)) if (next[h] === key) next[h] = '';
      next[header] = key;
      return next;
    });
  };

  /** Rows re-keyed by system field, keeping the 1-based sheet row for messages. */
  const mappedRows = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.map((src, i) => {
      const row: Record<string, string> = {};
      for (const [h, key] of Object.entries(mapping)) if (key && src[h]) row[key] = src[h];
      if (termId) row.termId = termId;
      const name = row.name || [row.firstName, row.lastName].filter(Boolean).join(' ');
      const issues: string[] = [];
      if (!row.admissionNo) issues.push('no admission number');
      if (!name) issues.push('no name');
      return { sheetRow: i + 2, row, src, name, issues };
    });
  }, [sheet, mapping, termId]);

  const dupAdmissionNos = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of mappedRows) if (r.row.admissionNo) count.set(r.row.admissionNo.toLowerCase(), (count.get(r.row.admissionNo.toLowerCase()) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
  }, [mappedRows]);

  const invalidCount = mappedRows.filter((r) => r.issues.length).length;
  const previewCols = fields.filter((f) => mappedKeys.has(f.key));

  const runImport = async () => {
    // Rows the preview already knows will fail are reported, not sent.
    const sendable = mappedRows.filter((r) => !r.issues.length);
    const failures: Failure[] = mappedRows
      .filter((r) => r.issues.length)
      .map((r) => ({ sheetRow: r.sheetRow, admissionNo: r.row.admissionNo, reason: r.issues.join(', '), source: r.src }));
    let created = 0;
    setProgress({ done: 0, total: sendable.length });
    try {
      for (let start = 0; start < sendable.length; start += BATCH) {
        const batch = sendable.slice(start, start + BATCH);
        const res = await importer.mutateAsync(batch.map((r) => r.row));
        created += res.created;
        for (const s of res.skipped) {
          const r = batch[s.row];
          failures.push({ sheetRow: r?.sheetRow ?? 0, admissionNo: s.admissionNo ?? r?.row.admissionNo, reason: s.reason, source: r?.src ?? {} });
        }
        setProgress({ done: Math.min(start + BATCH, sendable.length), total: sendable.length });
      }
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'The import stopped part-way. Rows already imported are kept.');
    }
    failures.sort((a, b) => a.sheetRow - b.sheetRow);
    setResult({ created, failures });
    setProgress(null);
    setStep('done');
    if (created) notify.success(`Imported ${created} pupil${created === 1 ? '' : 's'}.`);
  };

  const downloadFailures = () => {
    if (!sheet || !result) return;
    exportCSV(
      'pupil-import-failures.csv',
      ['Sheet row', 'Reason', ...sheet.headers],
      result.failures.map((f) => [String(f.sheetRow), f.reason, ...sheet.headers.map((h) => f.source[h] ?? '')]),
    );
  };

  const downloadTemplate = () => {
    const cols = [...BASE_FIELDS.map((f) => (f.key === 'sectionCode' ? vocab.section : f.label)), ...(cfDefs ?? []).map((d) => d.label)];
    const sample: Record<string, string> = {
      'Admission number': 'ADM-0001', 'Full name': 'Jane Doe', 'First name': '', 'Last name': '', Gender: 'Female',
      'Date of birth': '2015-03-09', Class: 'P4', 'Residence': 'Day', 'Guardian name': 'John Doe',
      'Guardian relationship': 'father', 'Guardian phone': '+256700000000',
    };
    exportCSV('pupil-import-template.csv', cols, [cols.map((c) => sample[c] ?? '')]);
  };

  const reset = () => {
    setSheet(null);
    setMapping({});
    setResult(null);
    setStep('upload');
  };

  const sampleOf = (h: string) => (sheet?.rows ?? []).map((r) => r[h]).filter(Boolean).slice(0, 2).join(', ');
  const groups = ['Pupil', 'Placement', 'Guardian', 'School fields'] as const;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Import Students</h1>
          <p className="text-sm text-muted-foreground">Bring pupils in from an Excel (.xlsx) or CSV file and match its columns to pupil fields.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={downloadTemplate}><Download className="h-4 w-4" /> Template</Button>
          <Button variant="ghost" asChild><Link to="/school/students"><ArrowLeft className="h-4 w-4" /> Students</Link></Button>
        </div>
      </div>

      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Import steps">
        {(['upload', 'map', 'preview', 'done'] as Step[]).map((s, i) => (
          <li
            key={s}
            className={`rounded-full border px-3 py-1 ${step === s ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground'}`}
          >
            {i + 1}. {{ upload: 'Upload', map: 'Map columns', preview: 'Review', done: 'Result' }[s]}
          </li>
        ))}
      </ol>

      {step === 'upload' && (
        <Card>
          <CardContent className="p-6">
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFile(e.dataTransfer.files?.[0]); }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}`}
            >
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
              <span className="font-medium">{parse.isPending ? 'Reading file…' : 'Drop a file here, or click to choose'}</span>
              <span className="text-xs text-muted-foreground">.xlsx or .csv · first row must be column headings · up to 5,000 pupils</span>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                aria-label="Choose import file"
                disabled={parse.isPending}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
          </CardContent>
        </Card>
      )}

      {step === 'map' && sheet && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <p className="text-sm">
              <span className="font-medium">{sheet.fileName}</span>
              {sheet.sheetName ? <> · sheet “{sheet.sheetName}”</> : null} · {sheet.rows.length} row{sheet.rows.length === 1 ? '' : 's'} · {sheet.headers.length} columns
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Column in your file</th>
                    <th className="px-3 py-2 font-medium">Sample values</th>
                    <th className="px-3 py-2 font-medium">Import as</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.headers.map((h) => (
                    <tr key={h} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{h}</td>
                      <td className="max-w-xs truncate px-3 py-2 text-muted-foreground">{sampleOf(h) || '—'}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Import column ${h} as`}
                          className={`w-64 max-w-full rounded-md border bg-card px-2 py-1.5 text-sm ${mapping[h] ? '' : 'text-muted-foreground'}`}
                          value={mapping[h] ?? ''}
                          onChange={(e) => setColumn(h, e.target.value)}
                        >
                          <option value="">— Don’t import —</option>
                          {groups.map((g) => {
                            const opts = fields.filter((f) => f.group === g);
                            if (!opts.length) return null;
                            return (
                              <optgroup key={g} label={g}>
                                {opts.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label}{f.hint ? ` (${f.hint})` : ''}{mappedKeys.has(f.key) && mapping[h] !== f.key ? ' — in use' : ''}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="import-term" className="text-muted-foreground">Place into term</label>
              <select
                id="import-term"
                className="rounded-md border bg-card px-2 py-1.5 text-sm"
                value={termId}
                onChange={(e) => setTermId(e.target.value)}
              >
                <option value="">Current term</option>
                {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? ' (current)' : ''}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">Used only for rows with a class.</span>
            </div>

            {mappingProblems.length > 0 && (
              <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {mappingProblems.map((p) => <li key={p} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> {p}</li>)}
              </ul>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={reset}><ArrowLeft className="h-4 w-4" /> Choose another file</Button>
              <Button disabled={mappingProblems.length > 0} onClick={() => setStep('preview')}>
                Review <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && sheet && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge className="bg-emerald-100 text-emerald-700">{mappedRows.length - invalidCount} ready</Badge>
              {invalidCount > 0 && <Badge className="bg-rose-100 text-rose-700">{invalidCount} with problems</Badge>}
              <span className="text-muted-foreground">
                Class, {vocab.section.toLowerCase()}, category and duplicate checks run during the import; rows that fail are listed afterwards.
              </span>
            </div>
            <div className="max-h-[28rem] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-card text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    {previewCols.map((f) => <th key={f.key} className="whitespace-nowrap px-3 py-2 font-medium">{f.label}</th>)}
                    <th className="px-3 py-2 font-medium">Check</th>
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, 200).map((r) => {
                    const dup = dupAdmissionNos.has((r.row.admissionNo ?? '').toLowerCase());
                    const issues = r.issues;
                    return (
                      <tr key={r.sheetRow} className={`border-b last:border-0 ${issues.length ? 'bg-rose-50 dark:bg-rose-950/20' : dup ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.sheetRow}</td>
                        {previewCols.map((f) => <td key={f.key} className="whitespace-nowrap px-3 py-1.5">{r.row[f.key] ?? ''}</td>)}
                        <td className="whitespace-nowrap px-3 py-1.5">
                          {issues.length ? <span className="text-rose-700 dark:text-rose-400">{issues.join(', ')}</span>
                            : dup ? <span className="text-amber-700 dark:text-amber-400">admission number repeated — only the first imports</span>
                            : <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="OK" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {mappedRows.length > 200 && <p className="text-xs text-muted-foreground">Showing the first 200 of {mappedRows.length} rows.</p>}

            {progress && (
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">Importing {progress.done} / {progress.total}…</p>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" disabled={!!progress} onClick={() => setStep('map')}><ArrowLeft className="h-4 w-4" /> Back to mapping</Button>
              <Button disabled={!!progress || mappedRows.length === invalidCount} onClick={() => void runImport()}>
                <Upload className="h-4 w-4" /> Import {mappedRows.length - invalidCount} pupil{mappedRows.length - invalidCount === 1 ? '' : 's'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'done' && result && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-base font-medium">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" /> {result.created} imported
              </span>
              {result.failures.length > 0 && (
                <span className="flex items-center gap-2 text-base font-medium text-rose-700 dark:text-rose-400">
                  <AlertTriangle className="h-5 w-5" /> {result.failures.length} not imported
                </span>
              )}
            </div>
            {result.failures.length > 0 && (
              <>
                <div className="max-h-96 overflow-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b bg-card text-left text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Admission no.</th>
                        <th className="px-3 py-2 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.failures.map((f, i) => (
                        <tr key={`${f.sheetRow}-${i}`} className="border-b last:border-0">
                          <td className="px-3 py-1.5 text-muted-foreground">{f.sheetRow}</td>
                          <td className="px-3 py-1.5">{f.admissionNo ?? '—'}</td>
                          <td className="px-3 py-1.5">{f.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground">Fix these rows in the downloaded file and import it again — pupils already imported are not affected.</p>
              </>
            )}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={reset}>Import another file</Button>
              <div className="flex gap-2">
                {result.failures.length > 0 && <Button variant="outline" onClick={downloadFailures}><Download className="h-4 w-4" /> Download failed rows</Button>}
                <Button asChild><Link to="/school/students">View students</Link></Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
