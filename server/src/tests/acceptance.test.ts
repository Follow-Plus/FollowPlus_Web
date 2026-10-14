process.env.NODE_ENV = 'test';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.js';
import { prisma } from '../db.js';
import { TaskEngineService } from '../services/taskEngine.service.js';
import { AIExtractionService } from '../services/aiExtraction.service.js';
import { NotificationService } from '../services/notification.service.js';
import { TaskState, UrgencyLevel, Role, ContactChannel } from '../types.js';

describe('Comprehensive Acceptance Test Suite (AT-01 to AT-09)', () => {
  let app: FastifyInstance;
  let testPatientStandardId: string;
  let testPatientSharedId: string;
  let testPatientUnreachableId: string;

  before(async () => {
    app = await buildApp();
    await app.ready();

    // Standard patient
    const p1 = await prisma.patient.create({
      data: {
        mrn: `MRN-ACC-STD-${Date.now()}`,
        fullName: 'Alice Walker',
        primaryPhone: '+1-555-4001',
        isSharedPhone: false,
        hasSensitiveConsent: true,
      },
    });
    testPatientStandardId = p1.id;

    // Shared phone patient without sensitive consent
    const p2 = await prisma.patient.create({
      data: {
        mrn: `MRN-ACC-SHR-${Date.now()}`,
        fullName: 'Carlos Santana',
        primaryPhone: '+1-555-4002',
        isSharedPhone: true,
        hasSensitiveConsent: false,
      },
    });
    testPatientSharedId = p2.id;

    // Unreachable patient with invalid phone
    const p3 = await prisma.patient.create({
      data: {
        mrn: `MRN-ACC-UNR-${Date.now()}`,
        fullName: 'David Unreachable',
        primaryPhone: '+1-000-INVALID',
        isSharedPhone: false,
        hasSensitiveConsent: true,
      },
    });
    testPatientUnreachableId = p3.id;
  });

  after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // =========================================================================
  // AT-01: An overdue follow-up window transitions/surfaces task as OVERDUE_UNRESOLVED
  // =========================================================================
  it('AT-01: Past-due window transitions task to OVERDUE_UNRESOLVED without altering urgencyLevel', async () => {
    const pastStart = new Date(Date.now() - 10 * 86400000);
    const pastEnd = new Date(Date.now() - 2 * 86400000); // 2 days overdue

    const task = await prisma.followUpTask.create({
      data: {
        patientId: testPatientStandardId,
        sourceInstructionText: 'Post-op review in 7 to 10 days.',
        followUpAction: 'Post-op review',
        windowStartDate: pastStart,
        windowEndDate: pastEnd,
        urgencyLevel: UrgencyLevel.STANDARD,
        currentState: TaskState.VERIFIED_PENDING_ACTION,
      },
    });

    // Run overdue scan via API
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/check-overdue',
      headers: { 'x-actor-role': 'ADMIN', 'x-actor-id': 'system-scanner' },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.scannedCount >= 1);
    assert.ok(body.transitionedTaskIds.length >= 1);

    // Verify task state in database
    const updated = await prisma.followUpTask.findUnique({ where: { id: task.id } });
    assert.equal(updated?.currentState, TaskState.OVERDUE_UNRESOLVED);

    // Administrative lateness != Clinical urgency: Must preserve STANDARD urgency
    assert.equal(updated?.urgencyLevel, UrgencyLevel.STANDARD);

    // Verify task is surfaced in the outstanding queue
    const outstandingRes = await app.inject({
      method: 'GET',
      url: '/api/tasks/queue/outstanding',
    });
    assert.equal(outstandingRes.statusCode, 200);
    const outstandingTasks = outstandingRes.json();
    const found = outstandingTasks.find((t: any) => t.id === task.id);
    assert.ok(found, 'Overdue task must be surfaced in the staff outstanding queue');
  });

  // =========================================================================
  // AT-02: Instructions without usable dates yield ESCALATED_AMBIGUITY
  // =========================================================================
  it('AT-02: Note lacking concrete dates yields ESCALATED_AMBIGUITY and blocks auto-booking', async () => {
    const ambiguousText =
      'Mild asthma flare controlled. Patient should follow up as needed soon if wheezing recurs, or return whenever convenient.';

    const extraction = await AIExtractionService.extractInstruction(ambiguousText);
    assert.equal(extraction.status, TaskState.ESCALATED_AMBIGUITY);
    assert.equal(extraction.isAmbiguous, true);
    assert.equal(extraction.windowStartDate, null);
    assert.equal(extraction.windowEndDate, null);

    // Creating and verifying task without temporal dates enforces ESCALATED_AMBIGUITY
    const draft = await TaskEngineService.createDraft(
      {
        patientId: testPatientStandardId,
        sourceInstructionText: ambiguousText,
        followUpAction: 'Asthma check',
        windowStartDate: null,
        windowEndDate: null,
      },
      { role: Role.CLINICIAN, id: 'dr-ellis' }
    );

    const verified = await TaskEngineService.verifyTask(draft.id, {}, { role: Role.CLINICIAN, id: 'dr-ellis' });
    assert.equal(verified.currentState, TaskState.ESCALATED_AMBIGUITY);
    assert.match(verified.resolutionReason ?? '', /Missing concrete temporal window bounds/);
  });

  // =========================================================================
  // AT-03: Conflicting dates are flagged with ambiguity and hold automated booking
  // =========================================================================
  it('AT-03: Conflicting intervals in note trigger CONFLICTING_FOLLOWUP_WINDOWS and hold auto-booking', async () => {
    const conflictingText =
      'Discharge summary: Follow-up in 2 weeks for blood pressure and renal check. Addendum note: Patient clinically stable, return to outpatient clinic in 6 months.';

    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/extract-instruction',
      payload: { sourceInstructionText: conflictingText },
    });

    assert.equal(res.statusCode, 200);
    const extraction = res.json();
    assert.equal(extraction.status, TaskState.ESCALATED_AMBIGUITY);
    assert.equal(extraction.isAmbiguous, true);
    assert.equal(extraction.ambiguityReason, 'CONFLICTING_FOLLOWUP_WINDOWS');
    assert.equal(extraction.windowStartDate, null);
    assert.equal(extraction.windowEndDate, null);

    // Spans for both conflicting windows isolated
    assert.ok(extraction.spans.conflictingWindows);
    assert.equal(extraction.spans.conflictingWindows.length, 2);
    assert.equal(extraction.spans.conflictingWindows[0].exactQuote, 'in 2 weeks');
    assert.equal(extraction.spans.conflictingWindows[1].exactQuote, 'in 6 months');
  });

  // =========================================================================
  // AT-04: Outbound communication to a shared phone without consent redacts clinical details
  // =========================================================================
  it('AT-04: Shared phone without consent suppresses oncology/diagnostic terminology into neutral alert', async () => {
    const sensitiveTask = await prisma.followUpTask.create({
      data: {
        patientId: testPatientSharedId,
        sourceInstructionText:
          'Biopsy reviewed. Coordinate oncology chemotherapy review and surgical pathology follow-up in 3 weeks.',
        followUpAction: 'Oncology chemotherapy and surgical pathology review',
        urgencyLevel: UrgencyLevel.STANDARD,
        currentState: TaskState.VERIFIED_PENDING_ACTION,
      },
    });

    const dispatch = await NotificationService.dispatchNotification(sensitiveTask.id, {
      channel: ContactChannel.SMS,
    });

    assert.equal(dispatch.isRedacted, true);
    assert.equal(dispatch.deliveryStatus, 'DELIVERED');
    assert.equal(dispatch.messagePayload, NotificationService.NEUTRAL_SHARED_NOTICE);

    // Strict privacy assurance: Clinical words MUST be absent from payload
    assert.equal(dispatch.messagePayload.includes('oncology'), false);
    assert.equal(dispatch.messagePayload.includes('chemotherapy'), false);
    assert.equal(dispatch.messagePayload.includes('pathology'), false);

    // Audit trail records SHARED_PHONE_REDACTION_APPLIED
    const logs = await prisma.auditLog.findMany({
      where: { taskId: sensitiveTask.id, actionTaken: 'SHARED_PHONE_REDACTION_APPLIED' },
    });
    assert.ok(logs.length > 0);
  });

  // =========================================================================
  // AT-05: Human edits and overrides write immutable records to AuditLog
  // =========================================================================
  it('AT-05: Staff and clinician overrides write immutable records to AuditLog', async () => {
    const task = await prisma.followUpTask.create({
      data: {
        patientId: testPatientStandardId,
        sourceInstructionText: 'Post-op check in 14 days.',
        followUpAction: 'Wound check',
        urgencyLevel: UrgencyLevel.STANDARD,
        currentState: TaskState.PROPOSED_DRAFT,
      },
    });

    const actor = { role: Role.RECORDS_STAFF, id: 'coordinator-tina' };
    const newStartDate = new Date(Date.now() + 10 * 86400000).toISOString();
    const newEndDate = new Date(Date.now() + 14 * 86400000).toISOString();

    // Human staff verifies and sets concrete window
    await TaskEngineService.verifyTask(
      task.id,
      {
        followUpAction: 'Specialist wound inspection and culture',
        windowStartDate: newStartDate,
        windowEndDate: newEndDate,
        notes: 'Overridden based on verbal surgeon instructions.',
      },
      actor
    );

    // Transition with manual override reason
    await TaskEngineService.transitionState(
      task.id,
      {
        targetState: TaskState.APPOINTMENT_SCHEDULED,
        actionTaken: 'MANUAL_PHONE_COORDINATION_BOOKED',
        scheduledDate: newStartDate,
        resolutionReason: 'Direct patient phone agreement on slot.',
      },
      actor
    );

    // Query immutable audit trail via API
    const res = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/audit-trail`,
    });

    assert.equal(res.statusCode, 200);
    const auditTrail = res.json();
    assert.ok(auditTrail.length >= 2);

    const verificationEntry = auditTrail.find(
      (l: any) => l.actionTaken === 'TASK_VERIFIED_ACTIVATED' || l.actionTaken === 'TASK_VERIFIED'
    );
    assert.ok(verificationEntry);
    assert.equal(verificationEntry.actorRole, Role.RECORDS_STAFF);
    assert.equal(verificationEntry.actorId, 'coordinator-tina');

    const transitionEntry = auditTrail.find((l: any) => l.actionTaken === 'MANUAL_PHONE_COORDINATION_BOOKED');
    assert.ok(transitionEntry);
    assert.equal(transitionEntry.toState, TaskState.APPOINTMENT_SCHEDULED);
  });

  // =========================================================================
  // AT-08: Slot requests outside the clinical window transition to RESCHEDULE_REQUESTED instead of auto-confirming
  // =========================================================================
  it('AT-08: Slot request outside clinician window forces RESCHEDULE_REQUESTED & OUT_OF_WINDOW_EXCEPTION', async () => {
    const windowStart = new Date(Date.now() + 7 * 86400000);
    const windowEnd = new Date(Date.now() + 14 * 86400000);

    const task = await prisma.followUpTask.create({
      data: {
        patientId: testPatientStandardId,
        sourceInstructionText: 'Post-discharge follow up in 1 to 2 weeks.',
        followUpAction: 'Post-discharge review',
        windowStartDate: windowStart,
        windowEndDate: windowEnd,
        currentState: TaskState.VERIFIED_PENDING_ACTION,
      },
    });

    // Patient requests slot 45 days in the future (outside window)
    const outDate = new Date(Date.now() + 45 * 86400000).toISOString();

    const res = await app.inject({
      method: 'POST',
      url: `/api/patient/${task.id}/reschedule`,
      payload: {
        requestedDate: outDate,
        barrierReason: 'Patient unavailable in next 2 weeks due to personal commitment',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();

    assert.equal(body.confirmed, false);
    assert.equal(body.outOfWindow, true);
    assert.equal(body.requiresStaffReview, true);
    assert.equal(body.task.currentState, TaskState.RESCHEDULE_REQUESTED);
    assert.match(body.task.resolutionReason, /OUT_OF_WINDOW_EXCEPTION/);

    // Audit log verifies escalation
    const auditEntry = await prisma.auditLog.findFirst({
      where: { taskId: task.id, actionTaken: 'RESCHEDULE_OUT_OF_WINDOW_ESCALATION' },
    });
    assert.ok(auditEntry);
  });

  // =========================================================================
  // AT-09: Unreachable phone / failed contact attempts transition task to CONTACT_FAILED and keep it visible
  // =========================================================================
  it('AT-09: Delivery failure on invalid phone transitions task to CONTACT_FAILED and surfaces in triage queue', async () => {
    const task = await prisma.followUpTask.create({
      data: {
        patientId: testPatientUnreachableId,
        sourceInstructionText: 'Cardiology consultation in 10 days.',
        followUpAction: 'Cardiology consultation',
        urgencyLevel: UrgencyLevel.STANDARD,
        currentState: TaskState.VERIFIED_PENDING_ACTION,
      },
    });

    // Notification service attempts dispatch to "+1-000-INVALID"
    const dispatch = await NotificationService.dispatchNotification(task.id, {
      channel: ContactChannel.SMS,
    });

    assert.equal(dispatch.deliveryStatus, 'FAILED');
    assert.equal(dispatch.taskState, TaskState.CONTACT_FAILED);

    // Verify task state in database
    const dbTask = await prisma.followUpTask.findUnique({ where: { id: task.id } });
    assert.equal(dbTask?.currentState, TaskState.CONTACT_FAILED);
    assert.match(dbTask?.resolutionReason ?? '', /SMS delivery failed: Invalid phone destination/);

    // Verify task is visible in outstanding queue for manual staff recovery
    const queueRes = await app.inject({
      method: 'GET',
      url: '/api/tasks/queue/outstanding',
    });
    assert.equal(queueRes.statusCode, 200);
    const outstanding = queueRes.json();
    const found = outstanding.find((t: any) => t.id === task.id);
    assert.ok(found, 'Task with failed contact MUST stay visible in staff outstanding queue');
  });
});
