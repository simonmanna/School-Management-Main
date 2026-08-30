import axios, { AxiosError } from 'axios';
import { getApiBaseUrl } from '@/lib/api';

/**
 * The client the public pages use.
 *
 * Deliberately not `lib/api.ts`. That instance attaches whatever bearer token is
 * in localStorage, refreshes it on a 401, and raises a toast on a 403 reading
 * "You do not have access to that" — all correct for a signed-in parent, all
 * wrong for a stranger checking a certificate code. A visitor who mistypes a
 * code has not been denied access to anything; they have made a typo, and the
 * page says so itself.
 *
 * The two public endpoints below are `@Public()` on the API and are authorized
 * by the code or link token in the request, never by a session.
 */
export const publicApi = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

/** A certificate as the public verification endpoint reports it. */
export interface CertificateVerification {
  valid: boolean;
  holderName?: string;
  type?: string;
  status?: string;
  issuedAt?: string;
  serialNumber?: string;
}

/**
 * `GET /verify/certificate/:code` — open to anyone, by design.
 *
 * An employer holding a printed certificate has no account here and should not
 * need one. The endpoint answers with the holder's name, the award and its
 * status, and nothing else about the pupil.
 */
export async function verifyCertificate(code: string): Promise<CertificateVerification> {
  const { data } = await publicApi.get<CertificateVerification>(
    `/verify/certificate/${encodeURIComponent(code.trim())}`,
  );
  return data;
}

/** One document on an application, as the applicant portal reports it. */
export interface ApplicationDocument {
  id: string;
  type: string;
  required: boolean;
  verified: boolean;
  rejectionReason: string | null;
  uploadedAt: string | null;
}

/** An application as the magic-link portal reports it. */
export interface ApplicationView {
  applicationNumber: string;
  applicantName: string;
  status: string;
  academicYear: string | null;
  applyingForClass: string | null;
  feeStatus: string | null;
  documents: ApplicationDocument[];
  offer: { status: string; expiresAt: string | null; body: string | null } | null;
}

/**
 * `GET /school/admissions/portal/application?token=` — the applicant's own view.
 *
 * The token comes from the email the admissions office sent and scopes the
 * caller to exactly one application, which is why this needs no login. The site
 * only ever reads here: accepting or declining an offer stays in the emailed
 * link, where the applicant has already proved they hold the token.
 */
export async function fetchApplication(token: string): Promise<ApplicationView> {
  const { data } = await publicApi.get<ApplicationView>('/school/admissions/portal/application', {
    params: { token: token.trim() },
  });
  return data;
}

/**
 * A message for a failed public lookup.
 *
 * Never surfaces the server's own wording for a 404: "Application not found"
 * from an API is fine for staff and unhelpful to a parent who cannot tell
 * whether they mistyped or whether something is broken.
 */
export function publicErrorMessage(e: unknown, notFound: string): string {
  const err = e as AxiosError<{ message?: string | string[] }>;
  if (!err?.response) return 'No connection. Check your internet and try again.';
  const status = err.response.status;
  if (status === 404 || status === 400 || status === 401 || status === 403) return notFound;
  return 'The school system is not responding. Please try again shortly.';
}
