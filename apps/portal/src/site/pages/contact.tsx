import { useState } from 'react';
import { Clock, ExternalLink, Mail, MapPin, Phone, Send } from 'lucide-react';
import { SITE } from '@/site/content';
import {
  Container, IconPlate, Panel, Reveal, Section, SectionHeading,
} from '@/site/components';
import { Button, Input } from '@/components/ui';
import { usePageTitle } from '@/site/site-shell';
import { PageHero } from '@/site/pages/_hero';

const TOPICS = [
  'Admissions enquiry',
  'Fees and payments',
  'Portal or password help',
  'Transport',
  'Something else',
];

export default function ContactPage() {
  usePageTitle('Contact');

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the school"
        lede="One office line, one inbox, and a rule that nothing from a guardian waits more than two working days."
      />

      <Section>
        <Container>
          <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            {/* ── Details ── */}
            <div className="space-y-4">
              <Reveal>
                <Panel>
                  <IconPlate>
                    <MapPin className="h-5 w-5" />
                  </IconPlate>
                  <h2 className="pt-4 font-semibold">Visit</h2>
                  <address className="pt-2 text-sm not-italic leading-relaxed text-muted-foreground">
                    {SITE.contact.addressLines.map((l) => (
                      <span key={l} className="block">
                        {l}
                      </span>
                    ))}
                  </address>
                  <a
                    href={SITE.contact.mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 pt-3 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open in maps <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Panel>
              </Reveal>

              <Reveal delay={60}>
                <Panel>
                  <IconPlate>
                    <Phone className="h-5 w-5" />
                  </IconPlate>
                  <h2 className="pt-4 font-semibold">Call</h2>
                  <div className="space-y-1.5 pt-2 text-sm">
                    <a className="block font-medium hover:underline" href={`tel:${SITE.contact.phone.replace(/\s/g, '')}`}>
                      {SITE.contact.phone}
                    </a>
                    <a
                      className="block text-muted-foreground hover:underline"
                      href={`tel:${SITE.contact.altPhone.replace(/\s/g, '')}`}
                    >
                      {SITE.contact.altPhone}
                    </a>
                  </div>
                </Panel>
              </Reveal>

              <Reveal delay={120}>
                <Panel>
                  <IconPlate>
                    <Mail className="h-5 w-5" />
                  </IconPlate>
                  <h2 className="pt-4 font-semibold">Write</h2>
                  <div className="space-y-1.5 pt-2 text-sm">
                    <a className="block break-all font-medium hover:underline" href={`mailto:${SITE.contact.email}`}>
                      {SITE.contact.email}
                    </a>
                    <a
                      className="block break-all text-muted-foreground hover:underline"
                      href={`mailto:${SITE.contact.admissionsEmail}`}
                    >
                      {SITE.contact.admissionsEmail} — admissions
                    </a>
                  </div>
                </Panel>
              </Reveal>

              <Reveal delay={180}>
                <Panel>
                  <IconPlate>
                    <Clock className="h-5 w-5" />
                  </IconPlate>
                  <h2 className="pt-4 font-semibold">Office hours</h2>
                  <dl className="space-y-1.5 pt-2 text-sm">
                    {SITE.contact.officeHours.map((h) => (
                      <div key={h.days} className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">{h.days}</dt>
                        <dd className="font-medium">{h.hours}</dd>
                      </div>
                    ))}
                  </dl>
                </Panel>
              </Reveal>
            </div>

            {/* ── Enquiry ── */}
            <EnquiryForm />
          </div>
        </Container>
      </Section>
    </>
  );
}

/**
 * The enquiry form.
 *
 * It opens the sender's own mail client rather than posting to the API, and that
 * is a deliberate choice, not a stub. There is no public "contact us" endpoint
 * on this server — adding one would mean an unauthenticated write path, a spam
 * surface and a queue nobody has agreed to watch. Handing the message to the
 * visitor's mail app instead means the enquiry lands in the office inbox that is
 * already staffed, the sender keeps a copy in their sent items, and the school
 * can reply from the address families already recognise.
 *
 * Nothing typed here is transmitted anywhere until the person presses send in
 * their own mail client.
 */
function EnquiryForm() {
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [phone, setPhone] = useState('');
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState('');

  const compose = () => {
    const to = topic === 'Admissions enquiry' ? SITE.contact.admissionsEmail : SITE.contact.email;
    const body = [
      message.trim(),
      '',
      '—',
      `Name: ${name.trim()}`,
      from.trim() ? `Email: ${from.trim()}` : '',
      phone.trim() ? `Phone: ${phone.trim()}` : '',
      `Sent from the ${SITE.name} website`,
    ]
      .filter(Boolean)
      .join('\n');

    window.location.href =
      `mailto:${to}` +
      `?subject=${encodeURIComponent(`${topic} — ${name.trim() || 'Website enquiry'}`)}` +
      `&body=${encodeURIComponent(body)}`;
  };

  return (
    <Reveal delay={60}>
      <Panel className="p-6 sm:p-8">
        <SectionHeading eyebrow="Enquiry" title="Send us a message" />
        <p className="pt-3 text-sm text-muted-foreground">
          This opens your own email app with the message ready to send, so you keep a copy of what you asked.
        </p>

        <form
          className="space-y-4 pt-6"
          onSubmit={(e) => {
            e.preventDefault();
            compose();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="c-name" className="text-sm font-medium">
                Your name
              </label>
              <Input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="c-phone" className="text-sm font-medium">
                Phone <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="c-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="c-email" className="text-sm font-medium">
              Your email
            </label>
            <Input
              id="c-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="c-topic" className="text-sm font-medium">
              What is it about?
            </label>
            <select
              id="c-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="flex h-12 w-full rounded-lg border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {TOPICS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="c-message" className="text-sm font-medium">
              Message
            </label>
            <textarea
              id="c-message"
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-lg border border-input bg-card p-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Tell us what you need. If it is about a pupil, include their name and class."
            />
          </div>

          <Button type="submit" size="lg" className="w-full">
            <Send className="h-4 w-4" /> Open in my email app
          </Button>

          <p className="text-xs text-muted-foreground">
            Please do not send passwords, payment card details or a national ID number by email. For anything about a
            specific pupil's fees or marks, sign in to the portal instead.
          </p>
        </form>
      </Panel>
    </Reveal>
  );
}
