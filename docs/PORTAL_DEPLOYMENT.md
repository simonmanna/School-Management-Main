# Running the portal for real

The portal (`apps/portal`) is the site students, guardians and teachers sign in
to from home. It is a separate app from the back-office ERP (`apps/web`) on
purpose: different audience, different bundle, different exposure. This file is
what you need to put it on the internet without regretting it.

---

## 1. What is different about this app

| | Admin app (`apps/web`) | Portal (`apps/portal`) |
|---|---|---|
| Audience | staff, on the school network | families, on mobile data |
| Bundle | ~6.0 MB, one chunk | ~380 KB precache, split per audience |
| Login | asks for an organization code | email + password only |
| Session key | `cafe-pos-auth` | `school-portal-auth` |
| Exposure | can stay private (Tailscale) | must be public |

They share the same API, the same tokens and the same database. A portal account
is an ordinary `User` plus a `PortalIdentity` row saying which real person it
speaks for.

---

## 2. Before you expose anything

**Portal roles must exist.** `Student`, `Parent` and `Teacher` are seeded for new
tenants and created on demand by the first invite, so there is normally nothing
to do. Confirm anyway:

```bash
docker compose exec db psql -U cafe-pos -c "select name, permissions from \"Role\" where name in ('Student','Parent','Teacher')"
```

`Student` and `Parent` must **not** hold `school:read`. That grant is the gate on
roughly three hundred routes — the full pupil register, any family's fee balance,
the gradebook, the marks workspace — and a portal token holding it could reach all
of them regardless of what the app displays. `test/unit/portal-role-surface.spec.ts`
asserts this; if you edit the presets, that suite is what tells you.

**SMTP must work**, or invites are minted and never delivered. `NotificationsService`
logs mail instead of sending it when `SMTP_HOST` is unset, and nothing errors.

```env
SMTP_HOST="smtp.example.net"
SMTP_PORT=587
SMTP_USER="..."
SMTP_PASS="..."
SMTP_FROM="no-reply@school.ac.ug"
PORTAL_URL="https://portal.school.ac.ug"
```

`PORTAL_URL` builds the link in the invite email. Unset, the email arrives with a
code and nowhere to type it.

**Strong JWT secrets.** The API refuses to start on placeholders.

```bash
openssl rand -base64 48
```

---

## 3. Public deployment (Caddy + TLS)

Three names, pointed at the host's public IP **before** you start Caddy — it
cannot get a certificate for a name that does not resolve to it.

```
portal.school.ac.ug   → families
api.school.ac.ug      → the API
admin.school.ac.ug    → the back office (consider Tailscale instead, §4)
```

```env
SCHOOL_DOMAIN=school.ac.ug
ACME_EMAIL=ict@school.ac.ug

PORTAL_API_URL=https://api.school.ac.ug
PORTAL_ORG_CODE=DEMO
PORTAL_SCHOOL_NAME="St Example College"

CORS_ORIGINS=https://portal.school.ac.ug,https://admin.school.ac.ug
```

Then:

```bash
docker compose --profile public up -d --build
```

`PORTAL_API_URL` and `PORTAL_ORG_CODE` are **build arguments**, baked into the
bundle. Changing either means rebuilding the portal image, not restarting it.

**Edit the CSP.** `infra/docker/nginx.portal.conf` ships with
`connect-src ... https://API_ORIGIN_PLACEHOLDER`. Replace that with the real API
origin. Leave it and the app loads and every request is blocked by the browser —
which looks exactly like the API being down.

---

## 4. Tailscale for staff

The portal has to be public; the admin app does not. Putting the back office on a
tailnet removes a public login page for the application that can read every
family's data, every mark and the whole ledger.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Then delete the `admin.` block from `infra/docker/Caddyfile` and drop the `web`
service's published port, leaving it reachable only on the docker network and via
the tailnet address. Staff install Tailscale once; families install nothing.

This does **not** work for parents — you cannot ask four hundred families to join
a VPN. Portal and API stay public.

---

## 5. What faces the internet now, and what protects it

| Concern | Where it stands |
|---|---|
| Brute force | 10 login attempts / 5 min / IP (`ThrottlerModule`), plus 10 failed → 15 min account lock |
| Account lockout as a weapon | **Open.** Anyone who knows a parent's email can lock them out repeatedly. Consider exempting portal roles from lockout and relying on throttling, or adding a CAPTCHA |
| Session theft via XSS | Tokens are in `localStorage`. Mitigated by a strict CSP with no `unsafe-inline` on scripts; the portal renders no user-supplied HTML |
| Access-token lifetime | 15 minutes; refresh rotates and is revoked on password change and on portal-identity revocation |
| Tokens in URLs | `EVENT_STREAM_PATHS` in `main.ts` allows `?access_token=` for SSE. The portal calls no SSE route — keep it that way, or that token lands in every access log |
| MFA | **Broken.** `auth.service.ts` writes the pending MFA record with `organizationId: org.id` and reads it back with `organizationId: ''`. Staff cannot complete an MFA login. Fix before relying on it for a public admin login |
| Database console | Adminer is now bound to `127.0.0.1`. It has no authentication in front of it — never publish it |

---

## 6. Giving families their logins

1. **Registrar** opens the admin app → `/school/portals` → **Portal accounts**.
2. Pick a pupil, then invite a guardian from the list, or the pupil themselves.
   Bulk-invite a whole class from the same screen at the start of term.
3. The invite creates an **inactive** account with an unusable password and emails
   a 7-day link. A registrar never sees or chooses anyone's password.
4. The family opens the link, sets a password, and the account activates.
5. Revoke from the same screen. Revocation kills the refresh tokens, so access
   ends within the 15-minute access-token window rather than at next login.

Guardians with no email address on file are **reported** by the bulk invite, not
skipped silently — an unreported skip is a family that never hears from the school
and nobody notices.

---

## 7. Checking it works end to end

```bash
pnpm --filter @erp/api test:integration
```

The suites that matter here:

- `school-portal-onboarding.spec.ts` — invite → accept → login claim → context →
  cross-family denial → revocation
- `school-teacher-ownership.spec.ts` — a teacher writes their own register, marks
  and lesson plans, and is refused a colleague's
- `portal-role-surface.spec.ts` (unit) — the role presets themselves

By hand, once deployed:

1. Invite yourself as a guardian of a test pupil; confirm the email arrives with a
   working link.
2. Set a password, sign in, land on `/parent`.
3. Check the fee balance **matches the bursar's statement for the same pupil**.
   They read the same service; if they disagree, stop and find out why before
   letting families see it.
4. Start a mobile-money payment. Confirm it shows as *waiting*, not *paid*, until
   the provider callback lands.
5. Edit `?asStudent=` to another family's pupil id → 403.
6. Sign in as a teacher off-site, take a register, and confirm it appears in the
   admin app.
