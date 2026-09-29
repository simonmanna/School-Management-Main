import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, BadgeCheck, Loader2, Search, ShieldX } from 'lucide-react';
import { SITE } from '@/site/content';
import { Container, Panel, Pill, Section, SectionHeading, formatDate } from '@/site/components';
import { Button, Input } from '@/components/ui';
import { usePageTitle } from '@/site/site-shell';
import { PageHero } from '@/site/pages/_hero';
import { publicErrorMessage, verifyCertificate, type CertificateVerification } from '@/site/public-api';

/**
 * Public certificate verification.
 *
 * The one page on this site whose whole purpose is to answer a stranger. An
 * employer or a university holding a printed certificate needs to know whether
 * it is real, and requiring them to have a portal account would mean the check
 * simply never happens.
 *
 * The endpoint behind it returns the holder's name, the award, its status and
 * the issue date — and nothing else about the pupil. No marks, no fees, no
 * contact details, no class list. That restraint is what makes an open endpoint
 * safe to publish.
 */
export default function VerifyPage() {
  usePageTitle('Verify a certificate');

  // Printed certificates link here as /verify?code=… (Wave 16), so a reader who
  // follows the link sees the answer without retyping the code.
  const [params] = useSearchParams();
  const linked = params.get('code')?.trim() ?? '';
  const [code, setCode] = useState(linked);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CertificateVerification | null>(null);

  const check = useMutation({
    mutationFn: () => verifyCertificate(code),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
    },
    onError: (e) => {
      setResult(null);
      setError(publicErrorMessage(e, 'No certificate matches that code.'));
    },
  });

  useEffect(() => {
    if (linked) check.mutate();
    // Run once for the linked code; later checks are the visitor's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHero
        eyebrow="Verification"
        title="Check a certificate"
        lede={`Every certificate ${SITE.name} issues carries a verification code. Enter it to confirm the award is genuine and still valid.`}
      />

      <Section>
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div>
              <SectionHeading
                eyebrow="For employers & institutions"
                title="No account needed"
                lede="The code is printed on the certificate itself, usually beside the serial number or under a QR code."
              />
              <ul className="space-y-3 pt-8 text-sm text-muted-foreground">
                <li className="flex gap-2.5">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    A result shows the holder's name, the award, the date it was issued and whether it is still valid.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    Nothing else about the pupil is released here — no marks, no fees, no contact details.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>
                    If a certificate looks altered or the code does not match, call the school on {SITE.contact.phone}{' '}
                    before relying on it.
                  </span>
                </li>
              </ul>
            </div>

            <Panel className="p-6 sm:p-8">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!code.trim()) {
                    setResult(null);
                    setError('Enter the verification code printed on the certificate.');
                    return;
                  }
                  setError(null);
                  check.mutate();
                }}
              >
                <label htmlFor="cert-code" className="block text-sm font-medium">
                  Verification code
                </label>
                <Input
                  id="cert-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. 7QK2-D48M-XR9T"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="font-mono tracking-wide"
                />
                <Button type="submit" size="lg" className="w-full" disabled={check.isPending}>
                  {check.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Checking…
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" /> Verify
                    </>
                  )}
                </Button>
              </form>

              {error && (
                <p
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}

              {result && <VerificationResult result={result} />}
            </Panel>
          </div>
        </Container>
      </Section>
    </>
  );
}

function VerificationResult({ result }: { result: CertificateVerification }) {
  // `valid: false` covers two different things — no such code, and a code whose
  // certificate has been revoked or voided. They need different words: one is a
  // typo, the other is a red flag.
  if (!result.valid && !result.status) {
    return (
      <div role="status" className="mt-6 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
        <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div>
          <p className="font-semibold text-destructive">No match</p>
          <p className="pt-1 text-sm text-muted-foreground">
            No certificate with that code was issued by this school. Check for a mistyped character, then call the
            office.
          </p>
        </div>
      </div>
    );
  }

  const valid = result.valid;

  return (
    <div
      role="status"
      className={
        'mt-6 rounded-xl border p-5 ' +
        (valid ? 'border-primary/30 bg-secondary/60' : 'border-destructive/30 bg-destructive/10')
      }
    >
      <div className="flex items-center gap-3">
        {valid ? (
          <BadgeCheck className="h-6 w-6 shrink-0 text-[hsl(var(--success))]" />
        ) : (
          <ShieldX className="h-6 w-6 shrink-0 text-destructive" />
        )}
        <div>
          <p className={'font-display text-lg font-bold tracking-tight ' + (valid ? '' : 'text-destructive')}>
            {valid ? 'Genuine certificate' : 'Not currently valid'}
          </p>
          {!valid && result.status && (
            <p className="pt-0.5 text-sm text-muted-foreground">
              This certificate exists but is marked <strong>{result.status}</strong>. Contact the school before relying
              on it.
            </p>
          )}
        </div>
      </div>

      <dl className="grid gap-3 pt-5 sm:grid-cols-2">
        <Row label="Holder" value={result.holderName ?? '—'} />
        <Row label="Award" value={result.type ?? '—'} />
        <Row label="Issued" value={result.issuedAt ? formatDate(result.issuedAt) : '—'} />
        <Row label="Serial" value={result.serialNumber ?? '—'} mono />
      </dl>

      {result.status && (
        <div className="pt-4">
          <Pill tone={valid ? 'brand' : 'accent'}>Status: {result.status}</Pill>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={'pt-0.5 font-medium ' + (mono ? 'font-mono text-sm' : '')}>{value}</dd>
    </div>
  );
}
