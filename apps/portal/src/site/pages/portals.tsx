import { Link } from 'react-router-dom';
import {
  ArrowRight, BookOpen, Check, ClipboardList, KeyRound, LogIn, ShieldCheck, Smartphone, Wallet,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { PORTAL_AUDIENCES, SITE } from '@/site/content';
import {
  Container, CtaLink, IconPlate, Panel, Reveal, Section, SectionHeading,
} from '@/site/components';
import { usePageTitle } from '@/site/site-shell';
import { PageHero } from '@/site/pages/_hero';

/**
 * The bridge page.
 *
 * Everything on the public site is open to anyone; everything behind `/login` is
 * about one identified child. This page explains where that line falls, because
 * the single most common portal support call is a parent who has been typing
 * their child's name into a login box, and the second most common is one who
 * expects to be able to create an account.
 */

const AUDIENCE_ICON = { parent: Wallet, student: BookOpen, teacher: ClipboardList } as const;

export default function PortalsPage() {
  usePageTitle('Portal guide');
  const signedIn = useAuthStore((s) => !!s.accessToken);

  return (
    <>
      <PageHero
        eyebrow="The portal"
        title="Your school, signed in"
        lede="Fees, attendance, results and coursework for your own family — on the same site, behind one password."
      >
        <CtaLink to={signedIn ? '/home' : '/login'} variant="onDark" className="px-7">
          <LogIn className="h-4 w-4" /> {signedIn ? 'Go to my portal' : 'Sign in'}
        </CtaLink>
      </PageHero>

      {/* ── What each audience gets ── */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="Three doors"
            title="What you see depends on who you are"
            lede="The server decides which workspace an account opens into. Nobody picks their own role at the login screen."
          />
          <div className="grid gap-4 pt-12 lg:grid-cols-3">
            {PORTAL_AUDIENCES.map((a, i) => {
              const Icon = AUDIENCE_ICON[a.key];
              return (
                <Reveal key={a.key} delay={i * 70}>
                  <Panel className="flex h-full flex-col">
                    <IconPlate>
                      <Icon className="h-5 w-5" />
                    </IconPlate>
                    <h2 className="pt-4 font-display text-xl font-bold tracking-tight">{a.title}</h2>
                    <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                    <ul className="space-y-2 pt-5">
                      {a.points.map((p) => (
                        <li key={p} className="flex items-start gap-2 text-sm">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto pt-6">
                      <CtaLink to={signedIn ? '/home' : '/login'} variant="outline" className="w-full">
                        {signedIn ? 'Open portal' : 'Sign in'} <ArrowRight className="h-4 w-4" />
                      </CtaLink>
                    </div>
                  </Panel>
                </Reveal>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* ── Getting an account ── */}
      <Section tone="muted">
        <Container>
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionHeading
                eyebrow="Access"
                title="How to get an account"
                lede="Portal accounts are issued by the school office against a real pupil or guardian record. There is no sign-up form, and that is on purpose — self-signup would mean anyone could claim to be somebody's parent."
              />
              <ol className="space-y-4 pt-8">
                {[
                  {
                    title: 'The office creates it',
                    body: `Ask at reception or email ${SITE.contact.email}. The account is attached to your child's record, using the email address the school already holds for you.`,
                  },
                  {
                    title: 'An invite arrives by email',
                    body: 'It contains a one-time link. Opening it lets you set your own password — the school never sees it and cannot tell you what it is.',
                  },
                  {
                    title: 'Sign in from anywhere',
                    body: 'Use the Sign in button on this site, on any phone or computer. The same address works at home and at school.',
                  },
                ].map((s, i) => (
                  <li key={s.title} className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-semibold">{s.title}</p>
                      <p className="pt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-4">
              <Panel>
                <IconPlate>
                  <KeyRound className="h-5 w-5" />
                </IconPlate>
                <h3 className="pt-4 font-semibold">Forgotten your password?</h3>
                <p className="pt-2 text-sm leading-relaxed text-muted-foreground">
                  Reset it yourself — a link goes to the address on your account. The office cannot read or resend a
                  password, only send a fresh reset.
                </p>
                <Link
                  to="/forgot-password"
                  className="inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Reset my password <ArrowRight className="h-4 w-4" />
                </Link>
              </Panel>

              <Panel>
                <IconPlate>
                  <Smartphone className="h-5 w-5" />
                </IconPlate>
                <h3 className="pt-4 font-semibold">Put it on your home screen</h3>
                <p className="pt-2 text-sm leading-relaxed text-muted-foreground">
                  The portal installs like an app. In your browser menu choose <em>Add to Home screen</em> — no store,
                  no download, and it opens straight to your child.
                </p>
              </Panel>

              <Panel>
                <IconPlate>
                  <ShieldCheck className="h-5 w-5" />
                </IconPlate>
                <h3 className="pt-4 font-semibold">What we will never ask</h3>
                <ul className="space-y-2 pt-2 text-sm text-muted-foreground">
                  <li>The school will never ask for your password — by phone, SMS, email or in person.</li>
                  <li>Fees are never collected through a link in a text message. Check the balance on the portal.</li>
                  <li>
                    If a message about fees looks wrong, ring the office on {SITE.contact.phone} before paying anything.
                  </li>
                </ul>
              </Panel>
            </div>
          </div>
        </Container>
      </Section>

      <Section className="py-14">
        <Container>
          <div className="flex flex-col items-center gap-4 rounded-3xl border bg-card px-6 py-12 text-center">
            <h2 className="font-display text-2xl font-bold tracking-tight">Ready when you are</h2>
            <p className="max-w-md text-muted-foreground">
              Everything about your own child sits behind one password, on this same site.
            </p>
            <CtaLink to={signedIn ? '/home' : '/login'} className="px-8">
              {signedIn ? 'Go to my portal' : 'Sign in to the portal'} <ArrowRight className="h-4 w-4" />
            </CtaLink>
          </div>
        </Container>
      </Section>
    </>
  );
}
