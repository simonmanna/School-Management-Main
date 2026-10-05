# School Portal — Android app

The LMS portal for pupils and teachers, as a native Android app. Same API, same
rules: every route it calls is one the web portal (`apps/portal`) already calls,
and every permission decision stays on the server.

## Stack

| Piece | Choice |
| --- | --- |
| Language / UI | Kotlin 2.4.20, Jetpack Compose (BOM 2026.09.00), Material 3 |
| Build | Gradle 9.8, AGP 9.4.1 (built-in Kotlin — no `kotlin-android` plugin) |
| SDK | `compileSdk`/`targetSdk` 37, `minSdk` 26 |
| Network | Retrofit 3 + OkHttp 5 + kotlinx.serialization |
| Navigation | Navigation Compose 2.10.2 |
| State | ViewModel + `StateFlow`, `collectAsStateWithLifecycle` |
| DI | Hand-wired `AppContainer` — no KSP, no annotation processing |
| Secrets | Android Keystore AES-GCM (`SecretBox`), not the deprecated `security-crypto` |

## Build

Needs JDK 17+ and the Android SDK with API 37 installed. `ANDROID_HOME` must
point at the SDK (or add a `local.properties` with `sdk.dir`).

```bash
cd apps/mobile
./gradlew :app:assembleDebug          # APK at app/build/outputs/apk/debug/
./gradlew :app:testDebugUnitTest      # contract tests
./gradlew :app:lintDebug              # clean as of this commit
./gradlew :app:assembleRelease        # R8 + resource shrinking
```

Install: `adb install -r app/build/outputs/apk/debug/app-debug.apk`

## Pointing it at an API

Defaults live in `app/build.gradle.kts` as `DEFAULT_API_BASE_URL`
(`http://10.0.2.2:3000`, the host machine as seen from the emulator) and
`DEFAULT_ORG_CODE` (`DEMO`). Both are editable at runtime under **Change
server** on the sign-in screen, so one APK serves a school testing on its own
LAN and a hosted deployment. `OriginInterceptor` rewrites the origin of every
request; the `/api/v1` prefix comes from the Retrofit interface.

Cleartext HTTP is permitted only for loopback and private ranges
(`res/xml/network_security_config.xml`). Anything else must be HTTPS.

## What it does

**Pupil (and guardian, read-only)**
- Home: what is due in the next 14 days, today's timetable, attendance, school notices
- Courses: enrolled courses with server-computed progress
- Course page: sections and activities, with availability and completion as the server resolved them
- Activity: pages, files, folders, links, homework hand-in (text + attachments), quiz intro
- Quiz: the CBT attempt — one question per screen, autosave, server-owned expiry
- Marks: released marks only, published term results, report cards, attendance
- Notices: the school's own notice history, markable as read

**Teacher**
- Today: marking counters, lesson-plan counters, today's lessons, exam-paper progress
- Classes: the classes behind their teaching assignments
- Register: one tap per pupil using the school's own attendance statuses, any date up to today
- Marking: assessments they own → mark sheet → record a draft mark → send for approval

## Rules this app does not bend

- **The server decides.** `asStudent` is sent only for a guardian, and the server
  accepts it only for their own child. Capabilities, availability, attempt counts
  and hand-in windows all arrive resolved and are re-checked on write.
- **A withheld mark is not a zero.** `ModuleGrade.score` is null until a mark is
  approved; the UI shows "Not released yet" and never a figure.
- **No derived figures.** Progress, attendance rates, balances and results are
  rendered as the API sends them. A client that computes its own is how it comes
  to contradict the bursar.
- **Entry is not approval.** The mark sheet writes drafts and submits for
  approval; it cannot approve.

## Tests

`app/src/test` holds contract tests for the shapes that have actually bitten the
web portal: decimals arriving as strings *or* numbers, `pendingGrades` arriving
as a count *or* a list, teaching assignments collapsing onto class ids rather
than assignment ids, withheld vs. scored marks, and plugin bodies with missing
or null keys. 15 tests, all passing.

## Not done yet

- No offline cache: the app renders error states rather than stale data.
- No push notifications; notices are polled when the screen opens.
- Report card and receipt PDFs are listed but not downloaded (the web portal
  fetches them as blobs with a bearer header; the equivalent here is a signed
  URL route that does not exist yet).
- Not yet run on a device or emulator — no AVD or handset was attached when it
  was built.
