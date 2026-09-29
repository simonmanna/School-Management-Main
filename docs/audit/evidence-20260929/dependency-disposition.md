# Dependency disposition — audit 2026-09-29 A04

`pnpm audit --prod` before: 30 high / 38 moderate / 4 low. After wave 15: **2 high / 13 moderate / 2 low, 0 critical**.

## Fixed

| Package | Was | Now | How |
|---|---|---|---|
| multer (upload parser, `FileInterceptor`) | 2.1.1 via Nest + direct 1.4.5-lts.2 | 2.4.0 only | `pnpm.overrides.multer >=2.3.0`; unused direct `multer`/`@types/multer` removed. `pnpm why multer -r` shows one copy. Fixes GHSA-72gw-mp4g-v24j, GHSA-wc9g-mqfw-jrwm, GHSA-535w-7cp7-47q4. |
| nodemailer | 6.10.1 | ^9.1.1 | Direct bump. Only `createTransport`/`sendMail` are used (`kernel/notifications/notifications.service.ts`). |
| adm-zip | 0.6.0 | ^0.6.1 | Direct bump (SCORM package serving, advanced LMS only). |
| nanoid | 3.3.12 | ^3.3.19 | Direct bump, same major. |
| axios | 1.17.0 (portal, web, twilio) | ^1.18.0 | Direct bumps + override for twilio's copy. |
| lodash, js-yaml, postcss, brace-expansion | various | patched within major | `pnpm.overrides` scoped to the vulnerable ranges. |
| html-minifier (no patch exists) | via `mjml` → `mjml-cli` | removed | `mjml` was an unused API dependency; removed. |

## Accepted, with reason

| Advisory | Path | Reachability | Disposition |
|---|---|---|---|
| GHSA-v6c2-xwv6-8xf7 music-metadata ASF infinite loop | `@whiskeysockets/baileys` → `music-metadata@7` | Only with `ENABLE_COMMUNICATION_WHATSAPP=true` **and** `WHATSAPP_TRANSPORT=baileys` (experimental, off in `docker-compose.prod.yml`), and only when parsing ASF audio media. School notices are text. | Accept while baileys stays disabled in production. Re-open before enabling the baileys transport; baileys pins music-metadata 7, fix needs upstream. |
| GHSA-ggr8-5vv4-36mx deepmerge-ts stack exhaustion | `@prisma/client` → `prisma` → `@prisma/config` | Prisma CLI config loading at migrate/generate time, fed by the repository's own config — no request data reaches it. | Accept; resolve with the next Prisma minor that lifts deepmerge-ts to 8. |

## Verification

- `pnpm why multer -r` → `multer 2.4.0` only.
- `pnpm audit --prod --json` → `{ high: 2, critical: 0 }` (the two rows above).
- Upload behaviour: `test/unit/files-multipart-limits.spec.ts` (malformed field names, oversize field) + existing files specs.
