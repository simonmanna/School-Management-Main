# Running POS-CAFE on your LAN (+ the Android app on a phone)

Goal: the cafe keeps selling when the internet dies. That means the API and
Postgres run **on a PC in the cafe**, and every terminal — browsers and phones
— talks to that PC over the local network. The internet is only for remote
reports and backup.

## 0. Do I need Android Studio?

**No.** The APK is built from the command line:

```bash
cd apps/android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew :app:assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

It needs a JDK (17+) and the Android SDK, both of which the Android Studio
install on this machine already provides — you just never have to open the IDE.
To change the app, edit the Kotlin files and re-run that command. Studio is
only worth opening if you want the visual previews or a debugger.

## 1. Point the server at the LAN

The API now binds `0.0.0.0` by default, so it is already reachable from the
LAN. On startup it prints the exact URLs:

```
ERP API listening on http://localhost:3000/api/v1 — Docs at /api/docs
  LAN (Wi-Fi): http://192.168.1.23:3000/api/v1     ← this is what devices use
```

Set `HOST=127.0.0.1` to force loopback-only.

**Windows Firewall** will block the first inbound connection. Allow the ports
once, from an **admin** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "POS API"  -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "POS Web"  -Direction Inbound -LocalPort 5173 -Protocol TCP -Action Allow -Profile Private
```

> Use `-Profile Private`. Make sure the cafe Wi-Fi is marked a **Private**
> network in Windows, not Public.

**Give the PC a fixed address.** DHCP will eventually move it and every device
breaks at once. Either set a static IP or a DHCP reservation on the router.

## 2. Existing deployed web terminals

Nothing to reinstall — just point browsers at the server PC:

```
http://192.168.1.23:5173      (dev server)
```

For the production build, serve `apps/web/dist` from the same machine. CORS
already accepts private-range origins automatically outside production; in
production set the real origins:

```env
CORS_ORIGINS=http://192.168.1.23:5173,http://pos.cafe.local
```

The web POS is now an installable PWA: open it in Chrome → **Install app**. It
precaches the app shell and caches the menu in IndexedDB, so a terminal that
reloads mid-outage still shows the menu and queues sales.

## 3. Try the Android app on your phone

**a. Put the phone on the same Wi-Fi as the server PC.** Phone data off, or at
least on the same network — a phone on mobile data cannot see `192.168.x.x`.

**b. Install the APK.** Either:

```bash
# USB: enable Developer options → USB debugging on the phone, then:
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

or copy `app-debug.apk` to the phone (email/USB/Drive) and tap it — you'll have
to allow "install from unknown sources" for the installing app.

**c. Register the device.** In the web back office: **Settings → Offline
devices → Register**. Copy the four values it shows — **the token is displayed
once and cannot be recovered.**

**d. Enroll on the phone.** Open POS Cafe and enter:

| Field | Value |
|---|---|
| Server URL | `http://192.168.1.23:3000/api/v1` (the LAN URL, **not** localhost) |
| Device ID | from the dialog |
| Device token | from the dialog |
| Receipt prefix | e.g. `D1` |

Tap **Enroll + first sync**. That pulls the menu, tables, staff and settings.

**e. Sell.** Log in with a staff PIN (verified on-device — no network needed),
add items, take cash. Then the actual test:

> Turn on **airplane mode** and keep selling. Sales get provisional numbers
> (`D1-000001`) and queue locally. Turn Wi-Fi back on and open **Sync** — the
> queue drains, and each sale gets its real `INV-2026-…` number.

Push the same batch twice and nothing double-charges: per-op idempotency keys
make a replay return the original invoice.

### Phone gotchas

- **`localhost` will not work.** On a phone that means the phone itself.
- **Cleartext HTTP is allowed only for private ranges** (`10.x`, `172.16–31.x`,
  `192.168.x`, localhost) — see `network_security_config.xml`. A public HTTP
  server is refused by design; use HTTPS for anything off-LAN.
- **The phone must reach the PC**: many guest/public Wi-Fi networks enable
  client isolation, which silently blocks device-to-device traffic. Test with
  the phone's browser at `http://192.168.1.23:3000/api/v1/health` — you should
  get `{"status":"ok"}`. If that fails, nothing else will work.
- **Printing offline**: the phone prints ESC/POS directly over TCP 9100 to a
  network printer. The Windows spooler path only exists on the server.

## 4. Cloud (optional)

The cafe does not need it to sell. When you want remote reports and off-site
backup, see [`infra/replication/README.md`](../infra/replication/README.md):
Postgres logical replication LAN → cloud, plus the cloud API running with
`READ_ONLY_MODE=true` so it can never accept a write that would diverge from
the cafe.

## 5. Daily reality check

- Sales are recorded on the **LAN PC**. If that PC dies, the cafe stops. Keep
  the nightly `pg_dump` and test a restore.
- **Settings → Offline devices** shows each device's last-seen time and how many
  ops it has synced. A device that hasn't been seen for hours is a device
  holding unsynced money.
- **Rejected sales** (same section) is the first place to look when a device
  "isn't syncing".
