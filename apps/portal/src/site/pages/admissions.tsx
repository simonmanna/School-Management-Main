import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertCircle, Check, ChevronDown, FileText, Mail, PhoneCall, Search, Loader2,
} from 'lucide-react';
import { ADMISSION_REQUIREMENTS, ADMISSION_STEPS, FAQS, SITE } from '@/site/content';
import {
  Container, CtaLink, IconPlate, Panel, Pill, Reveal, Section, SectionHeading, formatDate,
} from '@/site/components';
import { Button, Input } from '@/components/ui';
import { usePageTitle } from '@/site/site-shell';
import { PageHero } from '@/site/pages/_hero';
import { fetchApplication, publicErrorMessage, type ApplicationView } from '@/site/public-api';
import { cn } from '@/lib/utils';

export default function AdmissionsPage() {
  usePageTitle('Admissions');

  return (
    <>
      <PageHero
        eyebrow="Admissions"
        title="Applying for a place"
        lede="Six steps, no mystery. We will tell you early and plainly whether the class you want has room, rather than keeping a family waiting on a list that is already full."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <CtaLink to={`mailto:${SITE.contact.admissionsEmail}`} variant="onDark" className="px-7">
            <Mail className="h-4 w-4" /> Email admissions
          </CtaLink>
          <CtaLink
            to={`tel:${SITE.contact.phone.replace(/\s/g, '')}`}
            variant="ghost"
            className="border border-white/25 text-white hover:bg-white/10"
          >
            <PhoneCall className="h-4 w-4" /> {SITE.contact.phone}
          </CtaLink>
        </div>
      </PageHero>

      {/* ── Steps ── */}
      <Section>
        <Container>
          <SectionHeading eyebrow="The process" title="From first call to first day" />
          <ol className="grid gap-4 pt-12 sm:grid-cols-2 lg:grid-cols-3">
            {ADMISSION_STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 50}>
                <li className="h-full rounded-2xl border bg-card p-6">
                  <span className="font-display text-3xl font-bold tabular-nums text-primary/25">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="pt-2 font-display text-lg font-bold tracking-tight">{s.title}</h3>
                  <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </Container>
      </Section>

      {/* ── Requirements + fees ── */}
      <Section tone="muted">
        <Container>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <IconPlate>
                <FileText className="h-5 w-5" />
              </IconPlate>
              <h2 className="pt-4 font-display text-2xl font-bold tracking-tight">What to bring</h2>
              <p className="pt-2 text-sm text-muted-foreground">
                Originals are seen and returned at the office; copies are kept on file.
              </p>
              <ul className="space-y-2.5 pt-5">
                {ADMISSION_REQUIREMENTS.map((r) => (
                  <li key={r} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel>
              <Pill tone="accent">Fees</Pill>
              <h2 className="pt-4 font-display text-2xl font-bold tracking-tight">What it costs</h2>
              <div className="space-y-3 pt-3 text-sm leading-relaxed text-muted-foreground">
                <p>
                  Fees are set per class and per term, and differ for day and boarding. The full structure for the
                  coming year is published before the term opens and is sent with every offer letter — you will never
                  be asked to accept a place before you know the figure.
                </p>
                <p>
                  Optional items — transport, swimming, music tuition, after-school care — are billed only to pupils
                  who take them, and appear as separate lines rather than being folded into a single number.
                </p>
                <p>
                  Once a pupil is enrolled, every invoice, payment and receipt is visible to guardians on the portal,
                  at any hour, without ringing the bursar.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 pt-6">
                <CtaLink to={`mailto:${SITE.contact.admissionsEmail}`} variant="primary">
                  Request the fee structure
                </CtaLink>
                <CtaLink to="/contact" variant="outline">
                  Contact the bursar
                </CtaLink>
              </div>
            </Panel>
          </div>
        </Container>
      </Section>

      {/* ── Live status check ── */}
      <Section>
        <Container>
          <ApplicationStatusCheck />
        </Container>
      </Section>

      {/* ── FAQ ── */}
      <Section tone="muted">
        <Container>
          <SectionHeading eyebrow="Questions" title="Asked most often" align="center" />
          <div className="mx-auto max-w-3xl divide-y rounded-2xl border bg-card px-2 pt-2 sm:px-4">
            {FAQS.map((f) => (
              <Faq key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
          <p className="pt-8 text-center text-sm text-muted-foreground">
            Not answered here?{' '}
            <a
              href={`mailto:${SITE.contact.admissionsEmail}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {SITE.contact.admissionsEmail}
            </a>
          </p>
        </Container>
      </Section>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Check an application without an account.
 *
 * This reads the real applicant portal endpoint, which is `@Public()` and
 * authorized solely by the token the admissions office emailed. That token is
 * the whole permission — so the field asks for the link, and the page pulls the
 * token out of it rather than making a parent find the query string themselves.
 *
 * The page only reads. Accepting or declining an offer stays in the emailed
 * link: a decision that binds a family to a school year should be taken from
 * the message addressed to them, not from a box on a public web page that
 * anyone could be watching over their shoulder.
 */
function ApplicationStatusCheck() {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplicationView | null>(null);

  const check = useMutation({
    mutationFn: () => fetchApplication(extractToken(raw)),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
    },
    onError: (e) => {
      setResult(null);
      setError(
        publicErrorMessage(
          e,
          'That link has expired or is not recognised. Ask the admissions office to send a fresh one.',
        ),
      );
    },
  });

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
      <div>
        <SectionHeading
          eyebrow="Already applied?"
          title="Check your application"
          lede="Paste the link the admissions office emailed you. It shows the stage your application has reached, which documents are still outstanding, and any offer made."
        />
        <p className="pt-6 text-sm text-muted-foreground">
          Lost the email?{' '}
          <a
            href={`mailto:${SITE.contact.admissionsEmail}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Ask for a new link
          </a>{' '}
          — for the family's protection, it can only be sent to the address already on the application.
        </p>
      </div>

      <Panel className="p-6 sm:p-8">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const token = extractToken(raw);
            if (!token) {
              setResult(null);
              setError('Paste the whole link from the email, or just the code at the end of it.');
              return;
            }
            setError(null);
            check.mutate();
          }}
        >
          <label htmlFor="app-token" className="block text-sm font-medium">
            Application link or code
          </label>
          <Input
            id="app-token"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="https://portal.school/…?token=… or the code itself"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="submit" size="lg" className="w-full" disabled={check.isPending}>
            {check.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <Search className="h-4 w-4" /> Check status
              </>
            )}
          </Button>
        </form>

        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {result && <ApplicationResult app={result} />}
      </Panel>
    </div>
  );
}

function ApplicationResult({ app }: { app: ApplicationView }) {
  const outstanding = app.documents.filter((d) => d.required && !d.verified);

  return (
    <div className="mt-6 space-y-4 border-t pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-bold tracking-tight">{app.applicantName}</p>
          <p className="pt-0.5 text-xs text-muted-foreground">Application {app.applicationNumber}</p>
        </div>
        <Pill tone="brand">{humanise(app.status)}</Pill>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Applying for" value={app.applyingForClass ?? '—'} />
        <Field label="Academic year" value={app.academicYear ?? '—'} />
        <Field label="Application fee" value={app.feeStatus ? humanise(app.feeStatus) : '—'} />
        <Field label="Documents" value={`${app.documents.filter((d) => d.verified).length} of ${app.documents.length} verified`} />
      </dl>

      {outstanding.length > 0 && (
        <div className="rounded-xl bg-accent/10 p-4">
          <p className="text-sm font-semibold">Still needed</p>
          <ul className="space-y-1 pt-2 text-sm text-muted-foreground">
            {outstanding.map((d) => (
              <li key={d.id} className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--accent))]" />
                <span>
                  {humanise(d.type)}
                  {d.rejectionReason ? ` — ${d.rejectionReason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {app.offer && (
        <div className="rounded-xl border border-primary/30 bg-secondary/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Offer {humanise(app.offer.status).toLowerCase()}</p>
            {app.offer.expiresAt && (
              <span className="text-xs text-muted-foreground">Respond by {formatDate(app.offer.expiresAt)}</span>
            )}
          </div>
          <p className="pt-2 text-sm text-muted-foreground">
            Accept or decline from the link in your offer email — that message is the record of the decision.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background/60 px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="pt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-4 px-3 py-4 text-left sm:px-4"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium">{q}</span>
        <ChevronDown className={cn('h-5 w-5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <p className="px-3 pb-5 text-sm leading-relaxed text-muted-foreground sm:px-4">{a}</p>}
    </div>
  );
}

/* ── helpers ── */

/**
 * Accept whatever the parent pasted.
 *
 * People paste the whole email link far more often than the bare token, and
 * telling them off for it is a support call. If it parses as a URL, take the
 * `token` parameter; otherwise treat the input as the token itself.
 */
function extractToken(input: string): string {
  const value = input.trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.searchParams.get('token')?.trim() ?? value;
  } catch {
    const match = value.match(/[?&]token=([^&\s]+)/);
    return match ? decodeURIComponent(match[1]) : value;
  }
}

/** `offer_accepted` → `Offer accepted`. The API's enums are not written for parents. */
function humanise(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
