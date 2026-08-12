/**
 * Integration test for the School vertical — happy path. **P2A deliverable.**
 *
 * The fork shipped a version of this spec that hand-constructed ~10 services
 * with positional arguments. Those constructors have since gained dependencies
 * on the parent platform (PostingService, DocumentBuilderService and
 * AccountDeterminationService all take more collaborators now), and the fork's
 * `Account.accountType` field no longer exists — accounts resolve through
 * `AccountCategory`. The hand-wired spec therefore no longer even compiles
 * against the current APIs, and stubbing the new collaborators with `{} as any`
 * would produce a test that compiles but proves nothing at runtime.
 *
 * Rather than ship that, this file is intentionally a self-skipping placeholder
 * until P2A builds it properly. P2A must:
 *
 *   1. Wire the services through `Test.createTestingModule` (importing
 *      SchoolModule + its InvoicingModule/AccountingModule deps) instead of
 *      hand-constructing them, so it stays correct as constructors evolve.
 *   2. Rewrite SchoolPaymentService on top of PaymentService.createReceipt so a
 *      fee receipt inside an open cash session writes a CashMovement (B1).
 *   3. Assert the authoritative chain end to end:
 *        student → fee assignment → Document(AR) → Payment → PaymentAllocation
 *        → CashMovement → balanced JournalEntry → AR aging → statement.
 *
 * The unit specs (test/unit/*.spec.ts, 92 cases) cover the school domain logic
 * in isolation for P1; this is the cross-service money-path proof P2A owns.
 */
import { describeDb } from './_setup';

describeDb('integration: school happy path (fee → payment → AR)', () => {
  it.todo('P2A: rebuild against Test.createTestingModule and the hardened SchoolPaymentService');
});
