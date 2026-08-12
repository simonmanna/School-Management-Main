# Internal Communication & WhatsApp / Telegram Integration — Plan

> **Status:** Draft  
> **Author:** Simon / Engineering  
> **Date:** 2026-07-23  
> **Target:** Full-stack (API + Admin UI)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What Already Exists](#2-what-already-exists)
3. [System Overview](#3-system-overview)
4. [Phase 1 — Internal Staff Chat](#4-phase-1--internal-staff-chat)
5. [Phase 2 — WhatsApp Integration](#5-phase-2--whatsapp-integration)
6. [Phase 3 — Telegram Integration](#6-phase-3--telegram-integration)
7. [Phase 4 — Customer Messaging](#7-phase-4--customer-messaging)
8. [Schema Changes](#8-schema-changes)
9. [Infrastructure & Deployment](#9-infrastructure--deployment)
10. [Difficulty Assessment](#10-difficulty-assessment)
11. [Implementation Timeline](#11-implementation-timeline)
12. [Open Questions](#12-open-questions)

---

## 1. Executive Summary

**Is it hard?** Moderate — not trivial but the foundation is already in place. The codebase already has a multi-channel notification engine (`NotificationsService`), an event bus with transactional outbox (`EventBus`), webhooks with retry logic, and cron workers. You're not starting from scratch.

**What you'll build:**

| Layer | What's new | Difficulty |
|---|---|---|
| **Staff chat UI** | Real-time messaging panel in the web app | Medium |
| **WhatsApp API client** | Business API wrapper for sending/receiving | Medium |
| **Telegram API client** | Bot API wrapper | Low |
| **Customer contact resolution** | Map phone → Partner | Low |
| **Message templates** | Pre-approved WhatsApp templates | Low |
| **Inbound webhook receivers** | Parse incoming messages from Meta/Telegram | Low |
| **Conversation model** | Threaded message history | Low |

**What's already reusable:**

| Existing component | Use in this system |
|---|---|
| `NotificationsService` | Multi-channel dispatch (email, in-app, SMS) — extend with `whatsapp` and `telegram` channels |
| `EventBus` / `EventOutboxService` | React to domain events (order placed, payment received, low stock) → auto-send messages |
| `WebhooksService` | Already handles outgoing signed HTTP deliveries; WhatsApp/Telegram webhooks can reuse the pattern |
| `CronWorkersService` | Scheduled message sending, reminder automation |
| `Prisma` / `Postgres` | Store messages, conversations, templates, webhook registrations |

---

## 2. What Already Exists

### 2.1 Notification Engine (`kernel/notifications/`)

```
apps/api/src/kernel/notifications/
  notifications.service.ts     ← send() with channels: in_app, email, sms, push
  notifications.controller.ts  ← REST API: list, mark-read, preferences
  push.service.ts              ← Web Push API placeholder
  notifications.module.ts
```

- `send()` always writes a `Notification` row for durability, then best-effort dispatches the channel
- `channel` enum values: `in_app`, `email`, `sms`, `push` → **add `whatsapp`, `telegram`**
- Per-user, per-channel, per-category opt-out via `NotificationPreference`

### 2.2 Event Bus (`kernel/events/`)

```
apps/api/src/kernel/events/
  event-bus.ts            ← publish() writes to EventOutbox
  event-outbox.service.ts ← manage transactional outbox rows
  outbox.worker.ts        ← polls and dispatches to registered handlers
```

- Transactional outbox pattern → events survive partial failures
- Used already by POS for `PosSaleCompleted`, `LowStockAlert`, etc.

### 2.3 Webhook Engine (`kernel/webhooks/`)

```
apps/api/src/kernel/webhooks/
  webhooks.service.ts     ← create/rotate/delete endpoints, HMAC signing
  webhooks.controller.ts  ← REST CRUD
  webhooks.module.ts
```

- Multi-attempt delivery with exponential backoff (1m → 5m → 30m → 2h → 12h → dead)
- HMAC-SHA256 signed payloads

### 2.4 Worker Infrastructure

```
apps/api/src/kernel/workers/
  cron-workers.service.ts     ← CRON expression scheduler
  reservation-worker.ts       ← existing scheduled tasks
```

- Node.js cron scheduling already wired into the NestJS DI

### 2.5 Prisma Schema — Existing Relevant Models

| Model | Fields | Reuse |
|---|---|---|
| `Notification` | orgId, userId, channel, title, body, payload, status | Durable record of every sent message |
| `NotificationPreference` | orgId, userId, channel, category, enabled | User opt-outs per channel |
| `Partner` | id, name, phone, email | Customer contact resolution |
| `User` | id, email, phone | Staff contact resolution |
| `EventOutbox` | eventName, payload, status | React-to-event triggers |
| `WebhookEndpoint` | url, events, signingSecret, isActive | WhatsApp/Telegram webhook registration |

---

## 3. System Overview

### 3.1 Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    YOUR APPLICATION                         │
│                                                             │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────────┐ │
│  │  Staff Chat   │   │   Admin UI     │   │  POS / Other  │ │
│  │  (web app)    │   │  (settings)    │   │  (triggers)   │ │
│  └──────┬───────┘   └───────┬────────┘   └──────┬─────────┘ │
│         │                   │                    │           │
│  ┌──────┴───────────────────┴────────────────────┴─────────┐ │
│  │                  API Layer                               │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │           MessagingService (NEW)                   │  │ │
│  │  │  ┌────────────┐ ┌──────────┐ ┌────────────────┐   │  │ │
│  │  │  │ WhatsApp   │ │ Telegram │ │ Internal Chat  │   │  │ │
│  │  │  │ Provider   │ │ Provider │ │ (DB-backed)    │   │  │ │
│  │  │  └─────┬──────┘ └────┬─────┘ └────────────────┘   │  │ │
│  │  └────────┼─────────────┼─────────────────────────────┘  │ │
│  └───────────┼─────────────┼────────────────────────────────┘ │
│              │             │                                   │
│  ┌───────────┴─────────────┴────────────────────────────────┐ │
│  │     Infrastructure Layer                                 │ │
│  │  ┌─────────┐ ┌────────────┐ ┌─────────┐ ┌────────────┐  │ │
│  │  │ Event   │ │ Webhook    │ │ Cron    │ │Notification│  │ │
│  │  │ Bus     │ │ Engine     │ │ Workers │ │ Service    │  │ │
│  │  └─────────┘ └────────────┘ └─────────┘ └────────────┘  │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                          │                    │
          ┌───────────────┴────┐    ┌──────────┴──────────┐
          │   WhatsApp Cloud   │    │   Telegram Bot API   │
          │   API (Meta)       │    │   (telegram.org)    │
          └────────────────────┘    └─────────────────────┘
```

### 3.2 Message Flow — Two Directions

**Outgoing (server → user/customer):**
```
Trigger → EventBus → Outbox → MessagingService → WhatsApp/Telegram API
```

**Incoming (user/customer → server):**
```
WhatsApp/Telegram → Webhook Receiver → Message handler → Create Conversation record
                                                         → Notification to staff
                                                         → Auto-reply (optional)
```

---

## 4. Phase 1 — Internal Staff Chat

### 4.1 Overview

A real-time chat board inside the web app where staff can:
- Send messages to individuals or groups (e.g. "Kitchen", "All Staff", "Shift A")
- See a notification badge when new messages arrive
- Mention specific users (`@john` notifies them)
- Attach screenshots or order references

### 4.2 Schema — Conversations & Messages

```prisma
/// A chat conversation (1:1 or group)
model Conversation {
  id              String     @id @default(uuid())
  organizationId  String
  name            String?    // null for 1:1 chats (derived from member names)
  type            ConversationType @default(direct)
  createdById     String?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  members ConversationMember[]
  messages Message[]

  @@index([organizationId])
  @@index([organizationId, updatedAt])
}

enum ConversationType {
  direct          // 1:1 between two users
  group           // Named group chat
  broadcast       // One-way announcement (manager → all)
  whatsapp        // WhatsApp conversation with external contact
  telegram        // Telegram conversation with external contact
}

/// Membership of a user in a conversation
model ConversationMember {
  id             String       @id @default(uuid())
  conversationId String
  userId         String
  lastReadAt     DateTime?    // for unread badge
  joinedAt       DateTime     @default(now())
  leftAt         DateTime?

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@unique([conversationId, userId])
}

/// A single message
model Message {
  id              String      @id @default(uuid())
  organizationId  String
  conversationId  String
  senderId        String?     // null for system/bot messages
  content         String
  messageType     MessageType @default(text)
  referenceId     String?     // link to an Order/Invoice/Partner id
  referenceType   String?     // 'order', 'invoice', 'partner'
  attachmentUrl   String?     // uploaded file URL
  externalId      String?     // WhatsApp/Telegram message id (for external convos)
  externalChannel String?     // 'whatsapp', 'telegram'
  createdAt       DateTime    @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  readBy       MessageReadReceipt[]

  @@index([organizationId, conversationId, createdAt])
  @@index([externalId, externalChannel])
}

enum MessageType {
  text
  image
  file
  system           // "John joined", "Order #42 created"
  order_reference
  invoice_reference
}

/// Track who has read a message
model MessageReadReceipt {
  id        String   @id @default(uuid())
  messageId String
  userId    String
  readAt    DateTime @default(now())

  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@unique([messageId, userId])
}
```

### 4.3 API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /chat/conversations` | List user's conversations (ordered by last message) |
| `POST /chat/conversations` | Create new conversation (specify type + members) |
| `GET /chat/conversations/:id/messages` | Paginated message history |
| `POST /chat/conversations/:id/messages` | Send a message |
| `POST /chat/conversations/:id/read` | Mark messages as read (advance `lastReadAt`) |
| `GET /chat/unread-count` | Total unread badge count |
| `POST /chat/conversations/:id/members` | Add members to group |
| `DELETE /chat/conversations/:id/members/:userId` | Remove member |
| `GET /chat/users` | Search staff users (for @mentions) |

### 4.4 Real-time via Server-Sent Events (SSE)

Rather than WebSockets (which need sticky sessions or a pub/sub layer), use SSE — the existing NestJS app can push events via the event bus:

```
Client subscribes:  GET /chat/stream (SSE endpoint, auth'd)
Server pushes:      { type: 'new_message', conversationId, message }
                    { type: 'typing', conversationId, userId }
                    { type: 'conversation_updated', conversationId }
```

The frontend uses `EventSource` (standard browser API, auto-reconnects). SSE works through proxies, HTTP/2, and doesn't need an additional server.

### 4.5 Frontend UI

```
┌─────────────────────────────────────────────────────────┐
│ 🔔 3 unread                              [Simon] ▼     │
├─────────────────────────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────────────────────────┐  │
│ │ Conversations │  │  Chat (Kitchen Group)            │  │
│ │               │  │                                  │  │
│ │ ● Kitchen     │  │  [10:32] John: Need more plates  │  │
│ │   John: Need..│  │  [10:33] You: On it             │  │
│ │ ● Shift Lead  │  │  [10:34] Mary: Order #42 is up  │  │
│ │ ○ Alice (DM)  │  │                                  │  │
│ │ ○ All Staff   │  │  ══════════════════════════════  │  │
│ │               │  │  │ Type a message...    [Send] │  │
│ └──────────────┘  │  └──────────────────────────────────┘  │
│                   │                                        │
│                   │  Toggle: Internal | WhatsApp | Telegram │
│                   │  (tabs for external channels)           │
└─────────────────────────────────────────────────────────┘
```

The same chat UI also shows WhatsApp and Telegram conversations once those integrations are live (Phase 2–3). Staff see all channels in one unified inbox.

### 4.6 Auto-generated Conversations

Certain events auto-create conversations:

| Trigger | Conversation | Members |
|---|---|---|
| Shift starts | `Kitchen` group | All active kitchen + waitstaff |
| Order placed (delivery) | WhatsApp DM with customer | Assigned driver |
| Low stock alert | `Management` group | Manager + inventory staff |

---

## 5. Phase 2 — WhatsApp Integration

### 5.1 How WhatsApp Works

Meta provides the **WhatsApp Business Cloud API**. You register a business, get a phone number, and receive a **permanent webhook URL** that Meta calls when messages arrive.

**Cost:** Meta charges per conversation (24-hour window). ~$0.005–$0.08 per conversation depending on region. Free tier: 1,000 conversations/month.

**Key constraint:** Outbound messages to customers **must use pre-approved templates** unless the customer initiated the conversation within the last 24 hours (24-hour free-form window). Templates go through Meta review (24–48 hours).

### 5.2 Architecture

```
┌───────────────────────────────────────────────────────┐
│                   WhatsApp Provider                    │
├───────────────────────────────────────────────────────┤
│  WhatsAppClient (NEW)                                 │
│  ├── sendText(to, body)                               │
│  ├── sendTemplate(to, templateName, params)           │
│  ├── sendImage(to, mediaUrl)                          │
│  ├── markAsRead(messageId)                            │
│  └── processWebhook(payload) → incoming message       │
│                                                       │
│  Config:                                              │
│    WHATSAPP_PHONE_NUMBER_ID  (from Meta Business)     │
│    WHATSAPP_ACCESS_TOKEN     (permanent or temporary) │
│    WHATSAPP_WEBHOOK_SECRET   (verify token)           │
│    WHATSAPP_API_VERSION      (v22.0+)                 │
│    WHATSAPP_BUSINESS_ACCOUNT_ID                       │
└───────────────────────────────────────────────────────┘
```

### 5.3 Outbound Messages

```typescript
class WhatsAppClient {
  async sendText(to: string, body: string): Promise<{ messageId: string }> {
    // POST https://graph.facebook.com/v22.0/{phoneNumberId}/messages
    // {
    //   messaging_product: "whatsapp",
    //   to: "2567XXXXXXX",
    //   type: "text",
    //   text: { body }
    // }
    // Header: Authorization: Bearer {accessToken}
  }

  async sendTemplate(to: string, templateName: string, parameters: Record<string, string>): Promise<{ messageId: string }> {
    // POST with "type": "template" and "template.name"
  }
}
```

**Outbound use cases:**

| Use Case | Channel | Requires Template? |
|---|---|---|
| Order confirmation to customer | WhatsApp | Yes (first message) |
| Delivery ETA to customer | WhatsApp | Yes (if > 24h since last) |
| Staff shift reminder | WhatsApp | No (staff opt-in, ongoing convo) |
| Low stock alert to manager | WhatsApp | Optional |
| Promotional message | WhatsApp | Yes (always) |

### 5.4 Inbound Messages (Webhook Receiver)

Meta sends a `POST` to your webhook URL for every incoming message. You register a dedicated endpoint:

```
POST /api/webhooks/whatsapp
```

```typescript
@Post('webhooks/whatsapp')
async handleIncoming(@Body() body: WhatsAppWebhookPayload) {
  // Meta sends a challenge GET on setup — respond with hub.challenge
  // On incoming messages:
  // 1. Extract from + body + messageId
  // 2. Resolve sender: lookup Partner by phone number
  // 3. Create Message record in WhatsApp conversation
  // 4. Create in-app Notification for assigned staff
  // 5. Auto-reply if configured (e.g. "Thanks for your order!")
  // 6. Mark as read (send read receipt via API)
}
```

Meta also sends **message status updates** (sent, delivered, read, failed) — these update the `Message.externalId` status.

### 5.5 Contact Resolution

When a WhatsApp message arrives from an unknown number:

```
Phone +2567XXXXXXX
  → Search Partner.phone (stripped to digits)
  → Search User.phone
  → If found: link to existing contact, create conversation
  → If not found: create provisional contact + flag for staff
```

### 5.6 Template Management

WhatsApp requires template pre-approval. Provide an admin UI:

```
Settings > WhatsApp > Templates
┌──────────────────────────────────────────────┐
│ Template Name      Status    Category        │
│ order_confirmed    Approved  Transactional   │
│ delivery_eta       Approved  Transactional   │
│ happy_birthday     Pending   Marketing       │
│                                              │
│ [Create Template] [Sync from Meta]           │
└──────────────────────────────────────────────┘
```

Staff don't create templates in the UI — they're managed on Meta Business Platform. This page is **read-only** (displays synced templates + status).

### 5.7 Schema Additions for WhatsApp

```prisma
/// WhatsApp template (synced from Meta Business Platform)
model WhatsAppTemplate {
  id                String   @id @default(uuid())
  organizationId    String
  name              String   // unique template name on Meta
  category          String   // 'transactional', 'marketing', 'authentication'
  status            String   // 'approved', 'pending', 'rejected'
  body              String   // template text with {{1}} placeholders
  headerType        String?  // 'text', 'image', 'video'
  headerValue       String?
  footerText        String?
  namespace         String?  // Meta template namespace
  language          String   @default("en")
  lastSyncedAt      DateTime?
  createdAt         DateTime @default(now())

  @@unique([organizationId, name])
}
```

---

## 6. Phase 3 — Telegram Integration

### 6.1 How Telegram Works

Telegram provides the **Bot API** — a much simpler HTTP API than WhatsApp. You create a bot via [@BotFather](https://t.me/BotFather), get an API token, and use polling or webhooks.

**Cost:** Free. Unlimited messages. No template approval needed.

**Key difference from WhatsApp:** No pre-approval for outbound messages. No 24-hour window restriction. The bot can message anyone who has started a chat with it.

### 6.2 Architecture

```
┌───────────────────────────────────────────────────────┐
│                   Telegram Provider                    │
├───────────────────────────────────────────────────────┤
│  TelegramClient (NEW)                                 │
│  ├── sendText(chatId, body)                           │
│  ├── sendReply(chatId, replyToMsgId, body)            │
│  ├── sendPhoto(chatId, photoUrl, caption)             │
│  ├── sendKeyboard(chatId, body, buttons[][])          │
│  ├── setWebhook(url)                                  │
│  └── processWebhook(payload) → incoming message       │
│                                                       │
│  Config:                                              │
│    TELEGRAM_BOT_TOKEN     (from @BotFather)           │
│    TELEGRAM_BOT_USERNAME  (@YourBotName)              │
└───────────────────────────────────────────────────────┘
```

### 6.3 Setup

1. Create bot via `@BotFather` → get token
2. Call `setWebhook()` pointing to your API endpoint:
   ```
   POST https://api.telegram.org/bot{TOKEN}/setWebhook
     ?url=https://yourdomain.com/api/webhooks/telegram
     &secret_token={yourVerificationToken}
   ```
3. Telegram sends message updates as POST to your webhook URL
4. Process identically to WhatsApp inbound handler

### 6.4 Staff Notification Use Cases

| Use Case | Method |
|---|---|
| New order alert | Bot sends to kitchen group chat |
| Low stock alert | Bot DMs the manager |
| Daily sales summary | Scheduled message via cron |
| Shift reminder | Bot DMs the staff member |
| Customer inquiry forwarded | Bot message + staff replies from chat UI |

### 6.5 Group Chats

Telegram supports group chats natively. You can:
- Create a private Telegram group for your staff
- Add the bot as a member
- The bot listens to messages and @mentions
- The bot can forward messages from the ERP into the group (e.g. "New order #42 — 2x Latte, UGX 18,000")

---

## 7. Phase 4 — Customer Messaging

### 7.1 Use Cases

| Scenario | Direction | Channel | Trigger |
|---|---|---|---|
| Order confirmation | Outgoing | WhatsApp | Order placed |
| Delivery ETA | Outgoing | WhatsApp | Driver assigned |
| Ready for pickup notification | Outgoing | WhatsApp | KDS marks ready |
| Customer asks "How long?" | Incoming | WhatsApp/Telegram | Customer sends message |
| Promotional offer (opt-in only) | Outgoing | WhatsApp | Campaign scheduled |
| Feedback request post-visit | Outgoing | WhatsApp | Invoice settled |

### 7.2 Consent & Opt-in

- Customers must opt in to receive WhatsApp messages (Meta requirement)
- Capture consent at: POS customer creation, digital menu checkout, or via a WhatsApp opt-in message
- Store `partner.chatOptIn: Boolean` and `partner.preferredChannel: 'whatsapp' | 'telegram' | 'sms' | null`

### 7.3 Auto-Reply Rules

Configure simple auto-reply rules for common customer queries:

```
[Incoming message contains "status" or "order"]
→ Look up most recent order for phone number
→ Reply: "Your order #42 is being prepared. ETA 15 min."

[Incoming message contains "hours" or "open"]
→ Reply: "We're open Mon–Sat 8AM–10PM, Sun 9AM–9PM."
```

Rules are stored as:

```prisma
model AutoReplyRule {
  id              String   @id @default(uuid())
  organizationId  String
  name            String
  keywords        String[] // e.g. ["status", "order", "where"]
  replyText       String
  channel         String   // 'whatsapp', 'telegram', 'all'
  isActive        Boolean  @default(true)
  priority        Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### 7.4 Staff Reply Workflow

When a customer sends a message via WhatsApp/Telegram:

1. Inbound webhook creates a `Message` in a `conversation` with `type: 'whatsapp'` or `'telegram'`
2. Staff sees it in the unified chat UI (Phase 1), marked with a WhatsApp/Telegram icon
3. Staff types a reply → `MessagingService` sends via WhatsApp/Telegram API
4. Customer receives the reply with the business name as sender

---

## 8. Schema Changes (Full)

### 8.1 New Tables

| Model | Purpose | Phase |
|---|---|---|
| `Conversation` | Chat thread (internal, WhatsApp, Telegram) | P1 |
| `ConversationMember` | Who is in a conversation | P1 |
| `Message` | Individual message in a conversation | P1 |
| `MessageReadReceipt` | Read tracking for unread badges | P1 |
| `AutoReplyRule` | Keyword-based auto-reply rules | P4 |
| `WhatsAppTemplate` | Synced WhatsApp message templates | P2 |

### 8.2 Modified Tables

| Table | New Field | Purpose | Phase |
|---|---|---|---|
| `Partner` | `chatOptIn: Boolean @default(false)` | WhatsApp/Telegram opt-in consent | P2 |
| `Partner` | `preferredChannel: String?` | Preferred contact channel | P2 |
| `User` | `telegramChatId: String?` | Staff Telegram DM link | P3 |
| `User` | `whatsappPhone: String?` | Staff WhatsApp number | P2 |
| `Organization` settings (JSON) | `messaging.whatsapp` | WhatsApp config (phone ID, token) | P2 |
| `Organization` settings (JSON) | `messaging.telegram` | Telegram bot token | P3 |
| `Notification` | `whatsappMessageId: String?` | Track delivery status | P2 |
| `Notification` | `conversationId: String?` | Link notification to conversation | P1 |

### 8.3 New Enums

```prisma
enum ConversationType { direct, group, broadcast, whatsapp, telegram }
enum MessageType { text, image, file, system, order_reference, invoice_reference }
```

---

## 9. Infrastructure & Deployment

### 9.1 What You Need to Host

| Component | Requirement | Cost |
|---|---|---|
| **API server** | Already have one (NestJS on VPS) | Existing |
| **PostgreSQL** | Already have one | Existing |
| **WhatsApp Business Account** | Register at [business.facebook.com](https://business.facebook.com) | Free |
| **WhatsApp Phone Number** | Virtual number via Meta or SIM-based verification | One-time ~$1 |
| **Telegram Bot Token** | Via @BotFather | Free |
| **HTTPS** | Required for Meta webhooks (already have likely) | Existing |
| **Public domain** | Required for webhook endpoints (already have likely) | Existing |

### 9.2 Webhook Security

Both Meta and Telegram verify webhook origins:

```typescript
// WhatsApp: Meta sends X-Hub-Signature-256 header
// Verify HMAC-SHA256 of request body against your verify token

// Telegram: send secret_token on setWebhook, verify in X-Telegram-Bot-Api-Secret-Token header

@Post('webhooks/whatsapp')
@Public() // no JWT auth — Meta can't pass it
async handleWhatsApp(
  @Headers('x-hub-signature-256') signature: string,
  @Body() body: any,
) {
  // Verify signature against WHATSAPP_WEBHOOK_SECRET
  // Process message...
}
```

### 9.3 Rate Limits

| Platform | Limit | Mitigation |
|---|---|---|
| WhatsApp | 80 msg/sec per phone number | Queue via EventOutbox |
| WhatsApp Template | 250 msg/sec per business account | Spread across numbers if needed |
| Telegram | 30 msg/sec per bot | Queue + batch |

All outbound sends go through the **transactional outbox** (`EventOutbox`) so they're durable and rate-limit friendly. A dedicated worker picks them up and sends with appropriate throttling.

---

## 10. Difficulty Assessment

| Component | Difficulty | Why |
|---|---|---|
| **Staff Chat UI** (Phase 1) | **Medium** | REST endpoints + SSE streaming are straightforward. Real-time state management (optimistic updates, unread counts) is the tricky part. Use React Query + Zustand like the existing POS. |
| **WhatsApp outbound** (Phase 2) | **Low–Medium** | Single HTTP POST to Meta API. The complexity is template management and the 24-hour conversation window — not the HTTP call. |
| **WhatsApp inbound webhook** (Phase 2) | **Low** | Standard webhook receiver. Parse JSON, create message record. Same pattern as existing `WebhooksService`. |
| **WhatsApp template approval** | **Operational** | Not code — you write templates in Meta Business dashboard, wait 24–48h for approval. Do this in parallel with coding. |
| **Telegram integration** (Phase 3) | **Low** | Much simpler than WhatsApp. No templates, no 24h window, no approval. Free. One HTTP API. |
| **Customer messaging workflow** (Phase 4) | **Medium** | The complexity is in the business logic (auto-reply rules, consent tracking, forwarding to staff) — not the API calls. |
| **Unified inbox (all channels)** | **Medium** | The chat UI from Phase 1 already handles this. You add channel icons and slight differences in message rendering (WhatsApp read receipts, Telegram reactions). |

**Overall: 5/10 difficulty.** The hardest part is the real-time chat UI, and even that is well-trodden ground. WhatsApp/Telegram are just HTTP APIs with webhooks.

### 10.1 What NOT to build

| Avoid | Reason |
|---|---|
| Own WhatsApp Gateway (e.g. whatsapp-web.js) | Breaks frequently, Meta bans. Use the official Cloud API. |
| WebSockets server | SSE is simpler, stateless, works through proxies. Save WebSockets for Phase 2 if latency becomes an issue. |
| Multi-tenant WhatsApp numbers | One number per tenant requires Meta verification per number. Start with one. |
| Telegram inline keyboards / rich UIs | Nice-to-have but complex. Start with text. |
| End-to-end encryption for staff chat | Overkill for internal operations. Use HTTPS. |

---

## 11. Implementation Timeline

| Phase | Duration | Deliverables |
|---|---|---|
| **P0 — Foundation** | 1 week | `Conversation` + `Message` schema, migrations, base `ConversationService` CRUD |
| **P1 — Staff Chat** | 3 weeks | Chat UI (conversation list, message pane, send, SSE streaming, unread badges, @mentions). API endpoints. Auto-create Kitchen/Shift conversations. |
| **P2 — WhatsApp** | 3 weeks | `WhatsAppClient` (send/recv), webhook receiver, contact resolution, template sync UI, outbound triggers (order confirmation, delivery ETA). |
| **P3 — Telegram** | 1 week | `TelegramClient`, webhook receiver, staff group chat integration, daily summary cron. |
| **P4 — Customer Messaging** | 2 weeks | Auto-reply rules, opt-in/consent UI, unified inbox tab in chat UI (WhatsApp + Telegram conversations alongside internal chats), promotional campaigns (basic cron-scheduled blast). |
| **P5 — Polish** | 1 week | Rate limiting, retry queues, delivery tracking, reporting (messages sent/received per channel), staff notification preferences. |

**Total: ~11 weeks** for a full implementation by one developer.

---

## 12. Open Questions

1. **WhatsApp — one number per organization or one global number?**  
   Start with one number for the whole business. Multi-tenant WhatsApp is complex (Meta requires separate business verification per number). If you have multiple branches, they can share one number with context routing.

2. **Telegram — do staff already use it?**  
   If yes, this is the easiest channel to get adoption for internal comms. No app install required on staff devices.

3. **Staff chat — do you need file/image sharing?**  
   If yes, add `attachmentUrl` to `Message` and implement file upload (reuse existing `/files` endpoint). Adds ~1 week.

4. **Should WhatsApp messages be transcribed into the staff chat or kept separate?**  
   Proposed: **Unified inbox**. Staff see internal, WhatsApp, and Telegram conversations in one UI with channel badges. A single search across all channels.

5. **Do you need customer-facing chat history?**  
   Proposed: Yes — every message to/from a customer is stored and visible in the customer's profile page. The staff can see past conversations when the customer messages again.

6. **Offline/queue for message delivery?**  
   Already solved — the EventOutbox provides exactly this. If WhatsApp/Telegram API is down, messages stay in the outbox and retry.

7. **Do you want WhatsApp Business API on-prem (360dialog) or Cloud?**  
   Cloud API is recommended — zero infrastructure, free tier, easiest setup. On-prem requires a dedicated server + static IP.

8. **Staff chat persistence — how long to keep messages?**  
   Proposed: 90 days retention for internal, permanent for WhatsApp/Telegram (customer comms may have legal requirements). Configurable per organization.
