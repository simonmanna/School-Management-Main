-- Communication platform — core schema (Phase 0).
-- Transport-independent Conversation/Message + provider channels + delivery
-- queue + external-identity mapping + templates/rules. See the // ==== banner in
-- schema.prisma for the design rules.

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "chatOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phoneE164" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "telegramChatId" TEXT;

-- CreateTable
CREATE TABLE "CommunicationChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "desiredState" TEXT NOT NULL DEFAULT 'disconnected',
    "pairingQr" TEXT,
    "pairingQrExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "leaseOwnerToken" TEXT,
    "leaseHeartbeatAt" TIMESTAMP(3),
    "nextSendAt" TIMESTAMP(3),
    "dailySentCount" INTEGER NOT NULL DEFAULT 0,
    "dailyCountDate" TIMESTAMP(3),
    "config" JSONB NOT NULL DEFAULT '{}',
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "CommunicationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'direct',
    "name" TEXT,
    "contextType" TEXT,
    "contextId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "visibleToPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultConversationChannelId" TEXT,
    "syncToDevices" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalConversationId" TEXT,
    "nextSendAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "address" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "partnerId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "participantType" TEXT NOT NULL DEFAULT 'user',
    "userId" TEXT,
    "partnerId" TEXT,
    "externalIdentityId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "lastReadMessageId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderType" TEXT NOT NULL DEFAULT 'user',
    "senderUserId" TEXT,
    "senderPartnerId" TEXT,
    "senderExternalIdentityId" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT NOT NULL,
    "replyToMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'file',
    "filename" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationChannelId" TEXT,
    "channelId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "recipientExternalIdentityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "errorCode" TEXT,
    "ambiguous" BOOLEAN NOT NULL DEFAULT false,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "providerRequestId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "externalConversationId" TEXT,
    "externalSenderId" TEXT,
    "rawMetadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppAuthState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "keyType" TEXT NOT NULL,
    "keyId" TEXT NOT NULL DEFAULT '',
    "valueEnc" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "eventName" TEXT,
    "providerId" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "version" INTEGER NOT NULL DEFAULT 1,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "templateKey" TEXT NOT NULL,
    "recipientResolver" TEXT NOT NULL,
    "channelSelector" TEXT NOT NULL DEFAULT 'internal',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunicationChannel_organizationId_providerId_idx" ON "CommunicationChannel"("organizationId", "providerId");

-- CreateIndex
CREATE INDEX "CommunicationChannel_providerId_transport_desiredState_idx" ON "CommunicationChannel"("providerId", "transport", "desiredState");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationChannel_organizationId_providerId_name_key" ON "CommunicationChannel"("organizationId", "providerId", "name");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_updatedAt_idx" ON "Conversation"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_contextType_contextId_idx" ON "Conversation"("organizationId", "contextType", "contextId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_syncToDevices_updatedAt_idx" ON "Conversation"("organizationId", "syncToDevices", "updatedAt");

-- CreateIndex
CREATE INDEX "ConversationChannel_conversationId_idx" ON "ConversationChannel"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationChannel_organizationId_channelId_idx" ON "ConversationChannel"("organizationId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationChannel_organizationId_channelId_externalConver_key" ON "ConversationChannel"("organizationId", "channelId", "externalConversationId");

-- CreateIndex
CREATE INDEX "ExternalIdentity_organizationId_partnerId_idx" ON "ExternalIdentity"("organizationId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_organizationId_providerId_externalUserId_key" ON "ExternalIdentity"("organizationId", "providerId", "externalUserId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_organizationId_userId_idx" ON "ConversationParticipant"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "ConversationParticipant_conversationId_idx" ON "ConversationParticipant"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_participantType_user_key" ON "ConversationParticipant"("conversationId", "participantType", "userId", "partnerId", "externalIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_seq_key" ON "Message"("seq");

-- CreateIndex
CREATE INDEX "Message_organizationId_conversationId_occurredAt_idx" ON "Message"("organizationId", "conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "Message_organizationId_seq_idx" ON "Message"("organizationId", "seq");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "MessageAttachment_organizationId_fileId_idx" ON "MessageAttachment"("organizationId", "fileId");

-- CreateIndex
CREATE INDEX "MessageDelivery_status_nextAttemptAt_idx" ON "MessageDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MessageDelivery_channelId_status_nextAttemptAt_idx" ON "MessageDelivery"("channelId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MessageDelivery_organizationId_messageId_idx" ON "MessageDelivery"("organizationId", "messageId");

-- CreateIndex
CREATE INDEX "MessageDelivery_providerId_externalMessageId_idx" ON "MessageDelivery"("providerId", "externalMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_organizationId_idempotencyKey_key" ON "MessageDelivery"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_providerId_providerRequestId_key" ON "MessageDelivery"("providerId", "providerRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalMessage_messageId_key" ON "ExternalMessage"("messageId");

-- CreateIndex
CREATE INDEX "ExternalMessage_organizationId_providerId_externalConversat_idx" ON "ExternalMessage"("organizationId", "providerId", "externalConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalMessage_organizationId_providerId_externalMessageId_key" ON "ExternalMessage"("organizationId", "providerId", "externalMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppAuthState_organizationId_channelId_idx" ON "WhatsAppAuthState"("organizationId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAuthState_channelId_keyType_keyId_key" ON "WhatsAppAuthState"("channelId", "keyType", "keyId");

-- CreateIndex
CREATE INDEX "MessageTemplate_organizationId_eventName_active_idx" ON "MessageTemplate"("organizationId", "eventName", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_organizationId_key_providerId_locale_versio_key" ON "MessageTemplate"("organizationId", "key", "providerId", "locale", "version");

-- CreateIndex
CREATE INDEX "CommunicationRule_organizationId_eventName_enabled_idx" ON "CommunicationRule"("organizationId", "eventName", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationRule_organizationId_eventName_templateKey_key" ON "CommunicationRule"("organizationId", "eventName", "templateKey");

-- CreateIndex
CREATE INDEX "Partner_organizationId_phoneE164_idx" ON "Partner"("organizationId", "phoneE164");

-- AddForeignKey
ALTER TABLE "ConversationChannel" ADD CONSTRAINT "ConversationChannel_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalMessage" ADD CONSTRAINT "ExternalMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

