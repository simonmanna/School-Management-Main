-- Front Desk visitor / walk-in log
CREATE TABLE "FrontDeskLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "partnerId" TEXT,
  "visitorName" TEXT NOT NULL,
  "phone" TEXT,
  "purpose" TEXT,
  "personVisited" TEXT,
  "status" TEXT NOT NULL DEFAULT 'in',
  "notes" TEXT,
  "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FrontDeskLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FrontDeskLog_organizationId_idx" ON "FrontDeskLog" ("organizationId");
CREATE INDEX "FrontDeskLog_partnerId_idx" ON "FrontDeskLog" ("partnerId");
CREATE INDEX "FrontDeskLog_status_idx" ON "FrontDeskLog" ("status");

ALTER TABLE "FrontDeskLog" ADD CONSTRAINT "FrontDeskLog_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
