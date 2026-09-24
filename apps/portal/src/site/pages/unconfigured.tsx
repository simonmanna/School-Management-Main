import { Link } from 'react-router-dom';
import { School } from 'lucide-react';

const NAME = (import.meta.env.VITE_SCHOOL_NAME as string | undefined) ?? 'School Portal';

/**
 * Shown in place of the marketing pages until the school has entered its own
 * content (VITE_SITE_CONTENT_READY=true). The site shipped with a fictional
 * "Sunrise Academy" — invented statistics, term dates, leaders and phone
 * numbers — and would have published them under a real school's name
 * (E2E audit Wave 7). Sign-in and certificate verification stay available.
 */
export default function UnconfiguredSitePage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <School className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{NAME}</h1>
      <p className="text-muted-foreground">
        Our website is being prepared. Parents, pupils and staff can sign in to the portal below.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/login" className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
          Sign in
        </Link>
        <Link to="/verify" className="rounded-lg border px-5 py-2.5 text-sm font-medium">
          Verify a certificate
        </Link>
      </div>
    </div>
  );
}
