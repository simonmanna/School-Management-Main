# Cafe POS — Operations Runbook

This runbook covers the day-to-day operational scenarios the on-call person
(or the cafe manager) needs to handle. Keep it next to the production
URLs and database credentials in your password manager.

> **Before you start**: make sure you can reach the API, the database, and the
> printer. Verify the cashier terminal loads `/pos/terminal` and you can log
> in as the admin. If not, jump to **§7 Troubleshooting** before continuing.

---

## 1. Open a shift (morning routine)

1. Power on the terminal and the receipt printer. Open a browser to
   `https://<your-domain>/pos/terminal`.
2. Log in with the cashier's credentials (or the manager's if it's the
   first shift of the day).
3. Click **Open shift** in the top bar.
4. Select a register (e.g. `MAIN-REG`).
5. Enter the **opening float** — the cash you took from the safe to start
   the day. Typical: UGX 50,000 or UGX 100,000. **Get this number from the
   manager; it must match the cash in the drawer.**
6. Click **Open shift**. The topbar should now show a green "Shift open"
   pill with the elapsed time.

**Audit** — every shift open writes one row to `CashSession` and one to
`AuditLog` (entity: `CashSession`, action: `create`).

## 2. Make a sale

1. Scan the barcode or tap the product. If the product has modifier
   groups (e.g. "Latte" → "Size + Milk"), the **AddOns dialog** opens.
2. Optional: tap the customer pill in the cart panel to attach a customer
   (for loyalty points + receipt email).
3. Optional: tap **Disc** for an order-level discount. > 10% requires a
   manager PIN.
4. Tap **Charge**. The Payment dialog opens.
5. Select the tender method (Cash / Card / Mobile Money / Mixed). For
   cash, tap a quick-amount button or type the tendered amount. The
   change due is calculated automatically.
6. Tap **Pay**. The receipt preview appears; auto-print kicks the cash
   drawer. The sale posts to GL + stock + KDS + loyalty in a single tx.

## 3. Handle a held / open tab

A customer steps away mid-order. The cashier parks the cart:

1. Tap **Hold** in the order panel.
2. Enter a name (e.g. `Sarah table 3`).
3. Continue selling other customers. The held list is in the topbar
   (`Pause` icon).

When the customer comes back:

1. Click the **Pause** icon in the topbar to open the held-orders dialog.
2. Find the hold by name. Click **Recall** — the lines materialise into
   the active cart.
3. Continue with the normal sale flow.

## 4. Refund / void a sale

**Refund** (full or partial):

1. Open the Reports page (`/pos/reports`) and find the invoice in
   recent sales. Or paste the invoice number into the search.
2. From the invoice detail, click **Refund**. The cashier must enter a
   reason (> 10% of shift total requires a manager PIN).
3. Backend: posts a credit note + reversing payment + stock-in.

**Void** (within minutes of the sale):

1. In the Reports page, click **Void** on the sale.
2. Must enter a reason + manager PIN.
3. Same outcome as a refund, but the audit log says `pos_void` so the
   books can spot cashier mistakes.

**Reprint a receipt**:

1. From the invoice detail, click **Reprint** — sends to the configured
   printer and writes an audit row.
2. The customer can also be emailed: click **Email** if their email is
   on the customer record.

## 5. Close a shift (end of day)

1. Run an **X-report** mid-shift to verify numbers (`/pos/reports`).
2. When the cafe closes, click **Close shift** in the topbar.
3. The close-shift dialog shows **expected cash in drawer** = opening
   float + cash sales − cash refunds. **Count the cash in the drawer**
   and enter it in "Counted cash". The system shows the variance.
4. Small variance (≤ UGX 10,000) is normal (change-calc rounding).
   Large variance should be flagged to the manager.
5. Click **Close shift**. The Z-report is generated and the terminal
   returns to "shift closed" state.

**Auto-email**: if `Notifications` is configured, the Z-report is emailed
to the manager at end-of-shift.

## 6. Customer loyalty + store credit + tabs

Open `Customer Profile` from the customer pill in the cart panel:

- **Loyalty tab**: see the customer's point balance, points expiring in
  the next 30 days, and a "Redeem" form.
- **Store credit tab**: see the balance, issue new credit (gift card /
  promo), or redeem at sale time.
- **Tab tab**: see the open running balance, record a payment, or open
  a new tab (sets an optional `creditLimit`).

Loyalty points are auto-earned on every sale (skipping the WALKIN
partner) — the cashier doesn't need to do anything.

## 7. Troubleshooting

### 7.1 Terminal won't load
- **Symptom**: `/pos/terminal` shows a blank page or spinner forever.
- **Check**: the API is up. `curl http://localhost:3000/health` (or the
  production URL). If the API is healthy, the browser is probably stale —
  hard refresh (Ctrl+Shift+R).

### 7.2 "Insufficient stock" error on a known product
- The cashier set `stockPolicy='block'` on this product.
- **Fix**: re-stock the product (the stock-items dashboard shows
  per-warehouse on-hand), OR change the policy to `warn` in the product
  settings.

### 7.3 "Drawer kick didn't fire" after a print
- The `pos.printerHost` setting isn't configured. Check the
  `Settings` table for the org: `SELECT * FROM "Setting" WHERE key LIKE
  'pos.printer%'`. If empty, set `pos.printerHost=192.168.1.42` (your
  printer's IP), `pos.printerPort=9100`.
- The printer must be on the same network as the API. Try `nc -zv
  192.168.1.42 9100` from the API host.
- ESC/POS firmware only — not all thermal printers respond to the
  `ESC p 0 25 250` pulse. Consult the printer's manual; some need a
  different sequence.

### 7.4 "Manager override" keeps failing
- The cashier typed a wrong password 5 times → the manager account is
  locked. Wait 15 minutes, or unlock via the database: `UPDATE "User"
  SET "failedLoginCount"=0, "lockedUntil"=NULL WHERE id='<userId>'`.
- The override has a 5-minute expiry. Re-verify if it's been a while.

### 7.5 Online orders not appearing on the KDS
- The customer got a tracking page but the bar KDS didn't see a new
  ticket. Check the kitchen station: the order's products have
  `station='bar'`. If they were assigned to `cafe` instead, the bar KDS
  won't show them. To reassign, update `Product.station` for the
  affected products.
- The SSE stream is polling every 1s. If the network is congested the
  bar might miss the immediate event but the next poll (1s later) will
  pick it up. If a ticket is **never** showing, check the
  `KitchenTicket` table directly.

### 7.6 Offline queue is stuck
- A customer kept selling while the API was down. The sales are in
  IndexedDB. Once the network is back, the topbar shows "N queued" and
  replays them automatically.
- If a queued sale returns a 5xx, it stays in the queue and retries
  every 5s. If it returns 4xx (other than 408/429), it's dropped as a
  poison message — the cashier should re-enter it manually.
- To **manually flush** the queue: topbar → "queued (N)" → **Sync now**
  button. Or run `localStorage.removeItem('pos:offline-queue')` and
  refresh to discard.

### 7.7 The terminal is showing an "Item has been modified by another user"
- A second cashier or the digital-menu placed an order against the
  same product while the cashier was editing. Refresh the cart and
  start over (or re-add the items).

### 7.8 The Z-report shows a large cash variance
- A refund was processed but the cash wasn't pulled from the drawer
  (the cashier took the cash out manually). Run a manual reconciliation
  in the back office: `SELECT * FROM "CashMovement" WHERE
  "cashSessionId"='<sessionId>' ORDER BY "createdAt"`.
- A customer paid cash but the receipt was lost — the cashier issued a
  duplicate. Look for `auditLog` rows with `entity: 'Document'` and
  `action: 'reprint'`.

### 7.9 Receipts aren't printing
- Check the `pos.printerHost` setting (see §7.3).
- Check the `printQueue` cron is running — receipts queued during a
  printer outage flush automatically once the printer is back.
- The PDF endpoint (`/pos/receipts/:id/pdf`) is always available as a
  fallback — open it in the browser and print manually.

## 8. Disaster recovery

### 8.1 DB is down
- The API returns 5xx on every request. The terminal's offline queue
  catches the sales. Don't power down the terminals.
- When the DB comes back, the queue replays automatically. **DO NOT
  skip the `Idempotency-Key` header** in any custom code — without it,
  the same sale could post twice.

### 8.2 A sale is missing from the X-report
- The sale didn't actually post. Check `CashMovement` and `Payment` for
  the session — if there's no row, the sale was abandoned (the terminal
  was closed mid-checkout).
- Re-create the sale manually from the cart the cashier was working on
  (the cart is in the cashier's local cart store; it survives a refresh
  via sessionStorage).

### 8.3 A sale double-posted (idempotency key missing)
- Look for two `Payment` rows with the same `reference` in the same
  minute, OR two `Document` rows with the same `sourceType='pos'` and
  the same `notes` in the same minute.
- Refund the duplicate via the `Refund` button in the invoice detail
  (or via `POST /pos/refund` if the API UI is down).
- The audit log (`entity: 'Document'`, `action: 'post'`) will show
  both posts with their respective user ids. Talk to the cashier about
  why they retried.

## 9. Daily / weekly / monthly checks

- **Daily**: Z-report sent to manager email. Check for variances
  > UGX 10,000.
- **Weekly**: review `AuditLog` for failed login attempts > 5 in a day.
  Review the `KitchenTicket` table for tickets that stayed in `new`
  status for > 5 minutes (KDS screen wasn't noticed).
- **Monthly**: review `LoyaltyLedger` for partners whose points
  expired (> 365 days inactive, depending on the program). Run a
  small marketing push for inactive customers.

## 10. On-call escalation

1. **First 5 minutes**: restart the API container, check the logs
   (`docker logs <api-container>`), confirm DB connectivity.
2. **5–30 minutes**: open the incident doc, page the backend lead.
3. **30+ minutes**: open a status page incident. Roll back the last
   release if it correlates with the issue.
4. **All clear**: post the root cause + timeline + preventive action
   in the incident doc.

## 11. Configuration reference

| Setting key | Default | Purpose |
|---|---|---|
| `pos.maxDiscountWithoutOverride` | 10 | % discount that doesn't need a manager PIN |
| `pos.printerHost` | (empty) | IP of the ESC/POS thermal printer |
| `pos.printerPort` | 9100 | TCP port for the printer |
| `pos.kickDrawerOnPrint` | true | Send drawer-kick pulse after every print |
| `pos.offlinePollMs` | 5000 | Background sync interval (ms) |
| `loyalty.defaultPointsPerCurrency` | 0.01 | Default if no LoyaltyProgram exists |
| `loyalty.defaultCurrencyPerPoint` | 100 | Default UGX per point on redemption |

To change a setting: `UPDATE "Setting" SET value='20' WHERE
"organizationId"='<id>' AND key='pos.maxDiscountWithoutOverride';`

---

**Last updated**: 2026-06-22 — when adding a new feature, also add a
section to this runbook for any failure mode a cashier might hit.
