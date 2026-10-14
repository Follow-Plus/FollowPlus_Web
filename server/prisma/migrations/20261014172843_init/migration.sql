-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mrn" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "primaryPhone" TEXT NOT NULL,
    "isSharedPhone" BOOLEAN NOT NULL DEFAULT false,
    "hasSensitiveConsent" BOOLEAN NOT NULL DEFAULT false,
    "languagePref" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FollowUpTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "sourceInstructionText" TEXT NOT NULL,
    "extractedSpanJson" TEXT,
    "followUpAction" TEXT NOT NULL,
    "windowStartDate" DATETIME,
    "windowEndDate" DATETIME,
    "urgencyLevel" TEXT NOT NULL DEFAULT 'STANDARD',
    "currentState" TEXT NOT NULL DEFAULT 'PROPOSED_DRAFT',
    "assignedStaffId" TEXT,
    "scheduledDate" DATETIME,
    "resolutionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FollowUpTask_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "targetAddress" TEXT NOT NULL,
    "messagePayload" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL,
    "patientResponse" TEXT,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactAttempt_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "FollowUpTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "metadataJson" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "FollowUpTask" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_mrn_key" ON "Patient"("mrn");
