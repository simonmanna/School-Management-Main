-- LTI 1.3: platform signing keys + launch sessions.
--
-- This installation acts as the LTI *platform*: it signs an id_token that the
-- external tool verifies against our published JWKS. That requires an RSA
-- keypair per organization, because a launch signed for one tenant must never
-- be accepted as another tenant's.
--
-- The private key is stored AES-256-GCM encrypted, never plaintext. `kid` is
-- published so a tool can select the right key during rotation; a retired key
-- remains readable for verification while new launches use the active one.

CREATE TABLE IF NOT EXISTS "LtiPlatformKey" (
    "id"               TEXT NOT NULL,
    "organizationId"   TEXT NOT NULL,
    "kid"              TEXT NOT NULL,
    "publicKeyPem"     TEXT NOT NULL,
    "privateKeyCipher" TEXT NOT NULL,
    "privateKeyIv"     TEXT NOT NULL,
    "privateKeyTag"    TEXT NOT NULL,
    "retiredAt"        TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LtiPlatformKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LtiPlatformKey_organizationId_kid_key"
    ON "LtiPlatformKey" ("organizationId", "kid");
CREATE INDEX IF NOT EXISTS "LtiPlatformKey_organizationId_retiredAt_idx"
    ON "LtiPlatformKey" ("organizationId", "retiredAt");

-- OIDC requires the platform to echo back the state and nonce it issued and to
-- refuse a replay, so an in-flight launch needs a row. Consumed on use.
CREATE TABLE IF NOT EXISTS "LtiLaunchSession" (
    "id"               TEXT NOT NULL,
    "organizationId"   TEXT NOT NULL,
    "courseModuleId"   TEXT NOT NULL,
    "userId"           TEXT,
    "studentProfileId" TEXT,
    "state"            TEXT NOT NULL,
    "nonce"            TEXT NOT NULL,
    "consumedAt"       TIMESTAMP(3),
    "expiresAt"        TIMESTAMP(3) NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LtiLaunchSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LtiLaunchSession_organizationId_state_key"
    ON "LtiLaunchSession" ("organizationId", "state");
CREATE INDEX IF NOT EXISTS "LtiLaunchSession_organizationId_expiresAt_idx"
    ON "LtiLaunchSession" ("organizationId", "expiresAt");
