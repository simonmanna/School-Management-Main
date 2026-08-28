# ADR-016 — Messaging: Multi-Transport Delivery, Consent and Broadcasts

**Status:** Accepted
**Date:** 2026-08-28
**Supersedes:** nothing. Extends the communication platform (WhatsApp/Telegram/internal) with SMS, a consent ledger, school audiences, broadcasts and transport fallback chains.

## Context

The communication module could already carry a 1:1 conversation over WhatsApp,
Telegram or the internal inbox. What a school actually needs on top of that is
different in kind:

- **Reach a group, not a person.** "Fee reminder to every P5 parent" — where the
  roster changes daily and the message is composed on Friday for Monday 6am.
- **Reach them by whatever works.** A parent is on WhatsApp, or they are not; the
  school does not know which, and finding out one number at a time is not a plan.
- **Stop when told to stop.** A parent who replies STOP must stop receiving,
  immediately, on every code path.
- **Know what actually happened.** Not "sent to 380" when the class has 400.

## Decisions

### 1. The SMS vendor lives in data, not in code

There is no dominant SMS API. Schools switch aggregators when rates change, and
regional aggregators are numerous. One adapter class per vendor would mean a
release per school.

`CommunicationChannel.config` therefore holds a declarative description of the
gateway's HTTP shape — endpoint, encoding, parameter templates with
`{{to}}`/`{{text}}`/`{{secret.apiKey}}` placeholders, and dotted paths for
reading the response, delivery receipts and inbound messages. `HttpSmsProvider`
executes it. Adding a gateway is a config row.

Deliberately **not** configurable: retry policy, idempotency, tenancy, consent
enforcement and status ranking. Those are correctness properties owned by the
dispatcher, and a bad config must not be able to weaken them. Gateway
credentials go in a separate AES-256-GCM bag (`secretsEnc`) that is stripped from
every read.

### 2. Consent is enforced at one choke point

`ConsentService.isSuppressed` is called by the dispatcher immediately before the
send, not by each producer. A new feature therefore inherits opt-out handling and
cannot forget it.

The ledger is keyed by **normalized address**, not by person: a parent replying
STOP from a phone must be suppressed on that phone before we know which Contact
it belongs to. It is opt-**out** shaped — school messaging is transactional, and
requiring prior opt-in would suppress everything on day one.

A suppressed delivery ends `cancelled`, never `failed`: an opt-out is a correct
outcome. It must not retry, must not alert the sender, and must never escalate to
another transport.

### 3. An audience is a selector, re-resolved at send time

`MessageBroadcast.audience` stores the *selector* ("class P5 East → guardians"),
not a resolved contact list. A frozen list keeps mailing the student who withdrew
last week and silently skips the one who enrolled this morning.

Two dedupe modes, because both are correct for different messages:
- `per_recipient` (default) keys on the **address**, so a mother with three
  children in one class receives — and is billed for — one closure notice.
- `per_student` sends one message per child, so `{{student.name}}` means
  something on a fee reminder.

### 4. Recipients are persisted separately from deliveries

`BroadcastRecipient` records that the school *intended* to reach someone. It
survives when no delivery was ever created — suppressed by an opt-out, or no
phone number on file.

Collapsing this into `MessageDelivery` would make an unreachable parent invisible
in the report, which is the exact failure the report exists to surface. "380 sent"
is a number nobody questions; "380 sent, 20 have no phone number" is a task for
the registrar.

### 5. A transport is a chain, not a channel

`ChannelPolicy` is an ordered list of steps (`whatsapp/cloud → whatsapp/baileys →
sms → internal`) with two distinct mechanisms:

- **Selection**, once, before sending: take the first step whose channel exists
  and can address this recipient (an SMS step is useless without a phone number).
- **Escalation**, after a *terminal* failure: the remaining steps travel on the
  delivery row, and the dispatcher enqueues the next one. Each escalation
  consumes a step, so a chain is strictly finite and cannot loop.

`transport` distinguishes the two WhatsApp implementations, which share the
`whatsapp` providerId by design — swapping Baileys for Cloud must not rewrite
message history.

Escalation is skipped for `ambiguous` failures: we could not tell whether the
first transport delivered, so escalating risks telling the parent twice.

### 6. Broadcasts get their own worker

Separate from `MessageDispatchWorker` despite the similar shape. The dispatcher
polls every 250ms because Telegram allows 30 messages a second; a broadcast needs
checking about once a second and its work is measured in whole rosters. Sharing a
loop would starve the dispatcher during materialization.

Materialization runs in two passes — write every recipient row first, then fan
out in batches — so a crash mid-broadcast resumes without re-messaging anyone.
Progress counters are recomputed from scratch each pass rather than incremented,
because incrementing drifts the moment a delivery is retried or escalated, and a
progress bar that lies is worse than none.

## Consequences

- Adding an SMS aggregator is an admin task, not a release.
- An opt-out cannot be defeated by choosing a different code path.
- Delivery reports name the people the school failed to reach.
- Two new permissions (`communication:broadcast:read` / `:send`) split "reply to
  a parent" from "text 4,000 guardians at the school's expense". Existing roles
  need them granted; `PERMISSIONS_DB_LOOKUP` mode reads roles from the database,
  so a token refresh alone is not enough.
- `ENABLE_COMMUNICATION_SMS=true` requires `COMM_ENCRYPTION_KEY` (32 bytes,
  base64) — gateway credentials share the Baileys secret bag, and a database dump
  must not hand over an account that can bill the school for every SMS on earth.
