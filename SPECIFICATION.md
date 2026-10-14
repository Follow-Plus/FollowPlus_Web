# System Specification: FollowUp (AI Synergy Hackathon 2026 - Healthcare Case 03)

## Document Control & Meta
- **System Name:** FollowUp (Closed-Loop Hospital Follow-Up Coordination Platform)
- **Role Target:** Antigravity AI Code Engine / Senior Full-Stack Architect
- **Target Architecture:** Fastify (Node.js/TypeScript) + SQLite (Prisma ORM) backend; React (TypeScript/Vite/Tailwind CSS) frontend; Local/Mocked or Groq LLM API for extraction.
- **Safety Protocol:** Strictly deterministic state engine; zero autonomous clinical decision-making; zero clinical-risk scoring; explicit source-grounded extraction traceability.

---

## 1. System Overview & Core Principles

FollowUp is a human-supervised, closed-loop coordination system for outpatient hospital follow-ups. It treats clinical follow-up not as a single reminder notification event, but as an **accountable, persistent lifecycle task**.

### Core Operational Principles
1. **Source Traceability:** Every extracted follow-up parameter links directly back to character-level source text spans in the clinician's notes.
2. **Ambiguity & Conflict Blocking:** Missing dates, ambiguous timeframes ("soon", "as needed"), or conflicting instructions immediately block automatic scheduling and force a human-in-the-loop triage queue.
3. **Separation of Concerns:**
   - Administrative lateness != Clinical urgency.
   - Reminder sent != Reminder delivered.
   - Message received != Appointment booked.
   - Appointment booked != Attendance verified.
4. **Clinical Authority Preservation:** The system never alters clinician-stipulated intervals. Patient constraint-based rescheduling is strictly bounded within the approved window; out-of-window requests escalate to human reviewers.
5. **Consent & Privacy Compliance:** Shared household telephone numbers suppress sensitive clinical diagnoses or procedures, defaulting to neutral scheduling alerts.

---

## 2. Technical Stack & Architecture

### Backend
- **Runtime:** Node.js (TypeScript) with Fastify.
- **Database:** SQLite (embedded, zero-config for hackathon evaluation) managed via Prisma ORM.
- **Validation Engine:** Zod for runtime schema validation on all inputs, state transitions, and LLM extractions.
- **Background Worker:** In-memory or cron-based worker for reminder simulation, timeouts, and overdue checks.

### Frontend
- **Framework:** React 18+ with TypeScript (Vite).
- **Styling:** Tailwind CSS + Radix UI / Lucide icons (clean, high-density hospital-grade UI).
- **Views:**
  1. Clinician Follow-Up Editor (structured form + AI assistant with highlighted source spans).
  2. Staff Worklist Queue (Upcoming Urgent vs. Outstanding/Blocked Tasks).
  3. Patient Coordination Portal (constraint-aware slot selection, barrier reporting).
  4. System Audit Log Viewer (immutable historical transition log).

---

## 3. Data Schema & State Machine Specifications

### Prisma Schema (`schema.prisma`)
```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  PATIENT
  RECORDS_STAFF
  CLINICIAN
  ADMIN
}

enum UrgencyLevel {
  STANDARD
  CLINICIAN_URGENT
}

enum TaskState {
  PROPOSED_DRAFT          // AI extracted, awaiting clinician/staff verification
  VERIFIED_PENDING_ACTION // Verified, waiting to contact patient or open booking
  CONTACT_FAILED          // Unreachable number or delivery failure
  ESCALATED_AMBIGUITY     // Missing dates, conflicting instructions, human review required
  APPOINTMENT_SCHEDULED   // Confirmed appointment within clinician window
  RESCHEDULE_REQUESTED    // Patient requested slot outside window or reported barrier
  OVERDUE_UNRESOLVED      // Window passed without attendance/contact resolution
  ATTENDANCE_CONFIRMED    // Clinical visit completed
  EXPLICITLY_CLOSED       // Closed by staff with documented clinical reason
}

enum ContactChannel {
  SMS
  WHATSAPP
  VOICE_CALL
  IN_PERSON
}

model Patient {
  id                  String          @id @default(uuid())
  mrn                 String          @unique // Medical Record Number
  fullName            String
  primaryPhone        String
  isSharedPhone       Boolean         @default(false)
  hasSensitiveConsent Boolean         @default(false)
  languagePref        String          @default("en")
  tasks               FollowUpTask[]
  createdAt           DateTime        @default(now())
}

model FollowUpTask {
  id                    String            @id @default(uuid())
  patientId             String
  patient               Patient           @relation(fields: [patientId], references: [id])
  sourceInstructionText String            // Original clinical note
  extractedSpanJson     String?           // JSON: { action: {text, start, end}, window: {text, start, end} }
  followUpAction        String
  windowStartDate       DateTime?
  windowEndDate         DateTime?
  urgencyLevel          UrgencyLevel      @default(STANDARD)
  currentState          TaskState         @default(PROPOSED_DRAFT)
  assignedStaffId       String?
  scheduledDate         DateTime?
  resolutionReason      String?
  
  auditLogs             AuditLog[]
  contactAttempts       ContactAttempt[]
  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt
}

model ContactAttempt {
  id              String         @id @default(uuid())
  taskId          String
  task            FollowUpTask   @relation(fields: [taskId], references: [id])
  channel         ContactChannel
  targetAddress   String         // Phone or email
  messagePayload  String         // Redacted if shared phone without consent
  deliveryStatus  String         // DELIVERED, FAILED, NO_ANSWER, PENDING
  patientResponse String?
  attemptedAt     DateTime       @default(now())
}

model AuditLog {
  id           String       @id @default(uuid())
  taskId       String
  task         FollowUpTask @relation(fields: [taskId], references: [id])
  actorRole    Role
  actorId      String
  actionTaken  String
  fromState    String?
  toState      String?
  metadataJson String?
  timestamp    DateTime     @default(now())
}
```
