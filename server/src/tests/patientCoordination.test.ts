process.env.NODE_ENV = 'test';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.js';
import { prisma } from '../db.js';
import { NotificationService } from '../services/notification.service.js';
import { TaskState, UrgencyLevel, ContactChannel, Role } from '../types.js';

describe('Patient Coordination & Privacy Safeguards (AT-04 & AT-08)', () => {
  let app: FastifyInstance;
  let sharedPatientId: string;
  let privatePatientId: string;
  let sharedTaskId: string;
  let privateTaskId: string;
  let inWindowTaskId: string;

  const now = new Date();
  const windowStart = new Date(now.getTime() + 7 * 86400000);
  const windowEnd = new Date(now.getTime() + 14 * 86400000);

  before(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Create Patient with Shared Phone without sensitive consent
    const p1 = await prisma.patient.create({
      data: {
        mrn: `MRN-SHARED-${Date.now()}`,
        fullName: 'Maria Rodriguez',
        primaryPhone: '+1-555-0987',
        isSharedPhone: true,
        hasSensitiveConsent: false,
        languagePref: 'en',
      },
    });
    sharedPatientId = p1.id;

    // Task with sensitive clinical oncology details
    const t1 = await prisma.followUpTask.create({
      data: {
        patientId: sharedPatientId,
        sourceInstructionText:
          'Biopsy submitted. Schedule oncology histology pathology review in 1 to 2 weeks.',
        followUpAction: 'Oncology histology pathology review',
        windowStartDate: windowStart,
        windowEndDate: windowEnd,
        urgencyLevel: UrgencyLevel.STANDARD,
        currentState: TaskState.VERIFIED_PENDING_ACTION,
      },
    });
    sharedTaskId = t1.id;

    // 2. Create Patient with Private Phone and sensitive consent
    const p2 = await prisma.patient.create({
      data: {
        mrn: `MRN-PRIVATE-${Date.now()}`,
        fullName: 'Johnathan Walker',
        primaryPhone: '+1-555-0123',
        isSharedPhone: false,
        hasSensitiveConsent: true,
        languagePref: 'en',
      },
    });
    privatePatientId = p2.id;

    const t2 = await prisma.followUpTask.create({
      data: {
        patientId: privatePatientId,
        sourceInstructionText: 'Post-op wound healing check and suture removal in 10 to 14 days.',
        followUpAction: 'Wound healing check and suture removal',
        windowStartDate: windowStart,
        windowEndDate: windowEnd,
        urgencyLevel: UrgencyLevel.STANDARD,
        currentState: TaskState.VERIFIED_PENDING_ACTION,
      },
    });
    privateTaskId = t2.id;

    // 3. Create Task for in-window vs out-of-window testing
    const t3 = await prisma.followUpTask.create({
      data: {
        patientId: privatePatientId,
        sourceInstructionText: 'Routine post-cath cardiology check in 7 to 14 days.',
        followUpAction: 'Cardiology check',
        windowStartDate: windowStart,
        windowEndDate: windowEnd,
        urgencyLevel: UrgencyLevel.STANDARD,
        currentState: TaskState.VERIFIED_PENDING_ACTION,
      },
    });
    inWindowTaskId = t3.id;
  });

  after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ==========================================
  // AT-04: Consent-Aware Redaction (Shared Phone)
  // ==========================================
  it('AT-04: Redacts sensitive clinical terms and dispatches neutral notice for shared household phone', async () => {
    const result = await NotificationService.dispatchNotification(sharedTaskId, {
      channel: ContactChannel.SMS,
    });

    assert.equal(result.isRedacted, true);
    assert.equal(result.deliveryStatus, 'DELIVERED');
    assert.equal(result.messagePayload, NotificationService.NEUTRAL_SHARED_NOTICE);

    // Ensure sensitive terms are NOT leaked
    assert.equal(result.messagePayload.includes('oncology'), false);
    assert.equal(result.messagePayload.includes('biopsy'), false);
    assert.equal(result.messagePayload.includes('histology'), false);

    // Verify ContactAttempt record
    const attempt = await prisma.contactAttempt.findUnique({
      where: { id: result.attemptId },
    });
    assert.ok(attempt);
    assert.equal(attempt.messagePayload, NotificationService.NEUTRAL_SHARED_NOTICE);

    // Verify AuditLog record
    const auditLogs = await prisma.auditLog.findMany({
      where: { taskId: sharedTaskId, actionTaken: 'SHARED_PHONE_REDACTION_APPLIED' },
    });
    assert.ok(auditLogs.length > 0);
    const meta = JSON.parse(auditLogs[0].metadataJson || '{}');
    assert.equal(meta.privacyPolicyApplied, 'SUPPRESS_DIAGNOSTIC_DETAILS');
    assert.equal(meta.isSharedPhone, true);
    assert.equal(meta.hasSensitiveConsent, false);
  });

  it('AT-04: Dispatches full clinical details when patient phone is private or consent is granted', async () => {
    const result = await NotificationService.dispatchNotification(privateTaskId, {
      channel: ContactChannel.SMS,
    });

    assert.equal(result.isRedacted, false);
    assert.equal(result.deliveryStatus, 'DELIVERED');
    assert.match(result.messagePayload, /Wound healing check and suture removal/);
    assert.match(result.messagePayload, /Johnathan Walker/);

    // Verify AuditLog record
    const auditLogs = await prisma.auditLog.findMany({
      where: { taskId: privateTaskId, actionTaken: 'FULL_CLINICAL_DISPATCH' },
    });
    assert.ok(auditLogs.length > 0);
  });

  // ==========================================
  // AT-08: Out-of-Window Rescheduling Guard
  // ==========================================
  it('AT-08: In-Window slot selection permits confirmation and sets APPOINTMENT_SCHEDULED', async () => {
    // Select date 10 days out (within [Day +7, Day +14])
    const inWindowDate = new Date(now.getTime() + 10 * 86400000);

    const res = await app.inject({
      method: 'POST',
      url: `/api/patient/${inWindowTaskId}/reschedule`,
      payload: {
        requestedDate: inWindowDate.toISOString(),
        barrierReason: 'Patient preferred morning slot',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.confirmed, true);
    assert.equal(body.outOfWindow, false);
    assert.equal(body.requiresStaffReview, false);
    assert.equal(body.task.currentState, TaskState.APPOINTMENT_SCHEDULED);
    assert.ok(body.task.scheduledDate);

    // Verify task state in database
    const dbTask = await prisma.followUpTask.findUnique({ where: { id: inWindowTaskId } });
    assert.equal(dbTask?.currentState, TaskState.APPOINTMENT_SCHEDULED);

    // Verify audit log
    const auditLog = await prisma.auditLog.findFirst({
      where: { taskId: inWindowTaskId, actionTaken: 'PATIENT_SCHEDULED_IN_WINDOW' },
    });
    assert.ok(auditLog);
    assert.equal(auditLog.actorRole, Role.PATIENT);
  });

  it('AT-08: Out-of-Window slot selection blocks auto-confirmation, sets RESCHEDULE_REQUESTED & OUT_OF_WINDOW_EXCEPTION', async () => {
    // Select date 30 days out (way outside [Day +7, Day +14])
    const outOfWindowDate = new Date(now.getTime() + 30 * 86400000);

    const res = await app.inject({
      method: 'POST',
      url: `/api/patient/${inWindowTaskId}/reschedule`,
      payload: {
        requestedDate: outOfWindowDate.toISOString(),
        barrierReason: 'Patient traveling abroad next week; requested appointment in 1 month',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.confirmed, false);
    assert.equal(body.outOfWindow, true);
    assert.equal(body.requiresStaffReview, true);
    assert.equal(body.task.currentState, TaskState.RESCHEDULE_REQUESTED);
    assert.match(body.task.resolutionReason, /OUT_OF_WINDOW_EXCEPTION/);

    // Verify database state: Must be RESCHEDULE_REQUESTED, NOT APPOINTMENT_SCHEDULED
    const dbTask = await prisma.followUpTask.findUnique({ where: { id: inWindowTaskId } });
    assert.equal(dbTask?.currentState, TaskState.RESCHEDULE_REQUESTED);

    // Verify audit log
    const auditLog = await prisma.auditLog.findFirst({
      where: { taskId: inWindowTaskId, actionTaken: 'RESCHEDULE_OUT_OF_WINDOW_ESCALATION' },
    });
    assert.ok(auditLog);
    const meta = JSON.parse(auditLog.metadataJson || '{}');
    assert.equal(meta.exceptionType, 'OUT_OF_WINDOW_EXCEPTION');
    assert.equal(meta.isOutsideWindow, undefined); // Or check meta
  });

  // ==========================================
  // Attendance Barrier Reporting
  // ==========================================
  it('Barrier Reporting: Successfully reports attendance constraint and moves task to RESCHEDULE_REQUESTED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/patient/${privateTaskId}/report-barrier`,
      payload: {
        barrierCategory: 'TRANSPORTATION',
        barrierReason: 'No wheelchair-accessible transportation available on weekdays',
        notes: 'Needs community shuttle assistance',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.task.currentState, TaskState.RESCHEDULE_REQUESTED);
    assert.match(body.task.resolutionReason, /PATIENT_BARRIER_REPORTED: \[TRANSPORTATION\]/);

    // Verify AuditLog
    const audit = await prisma.auditLog.findFirst({
      where: { taskId: privateTaskId, actionTaken: 'PATIENT_BARRIER_REPORTED' },
    });
    assert.ok(audit);
    assert.equal(audit.actorRole, Role.PATIENT);
  });

  // ==========================================
  // Notification Simulation Route
  // ==========================================
  it('HTTP POST /api/notifications/simulate: Dispatches consent-aware notification via API', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/simulate',
      payload: {
        taskId: sharedTaskId,
        channel: 'SMS',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.isRedacted, true);
    assert.equal(body.deliveryStatus, 'DELIVERED');
    assert.equal(body.messagePayload, NotificationService.NEUTRAL_SHARED_NOTICE);
  });

  it('HTTP GET /api/patient/:id/tasks: Returns patient and associated follow-up tasks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/patient/${sharedPatientId}/tasks`,
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.id, sharedPatientId);
    assert.ok(Array.isArray(body.tasks));
    assert.ok(body.tasks.length > 0);
  });
});
