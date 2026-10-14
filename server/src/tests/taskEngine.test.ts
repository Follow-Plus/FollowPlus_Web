process.env.NODE_ENV = 'test';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../db.js';
import { TaskEngineService } from '../services/taskEngine.service.js';
import { Role, TaskState, UrgencyLevel, ContactChannel } from '../types.js';
import { buildApp } from '../index.js';
import { FastifyInstance } from 'fastify';

describe('Task Engine Service & Deterministic State Machine', () => {
  let testPatientId: string;
  let testPatientSharedId: string;
  let app: FastifyInstance;

  before(async () => {
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await app.ready();

    // Create a dedicated test patient
    const patient = await prisma.patient.create({
      data: {
        mrn: `TEST-MRN-${Date.now()}`,
        fullName: 'Test Patient Alpha',
        primaryPhone: '+1-555-9999',
        isSharedPhone: false,
        hasSensitiveConsent: true,
      },
    });
    testPatientId = patient.id;

    const sharedPatient = await prisma.patient.create({
      data: {
        mrn: `TEST-MRN-SHARED-${Date.now()}`,
        fullName: 'Shared Phone Patient',
        primaryPhone: '+1-555-8888',
        isSharedPhone: true,
        hasSensitiveConsent: false,
      },
    });
    testPatientSharedId = sharedPatient.id;
  });

  after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('Rule 1 & 5: Successfully creates draft task with audit trail', async () => {
    const actor = { role: Role.CLINICIAN, id: 'dr-watson' };
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 7);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);

    const draft = await TaskEngineService.createDraft(
      {
        patientId: testPatientId,
        sourceInstructionText: 'Post-operative check in 1-2 weeks',
        followUpAction: 'Wound inspection',
        windowStartDate: startDate.toISOString(),
        windowEndDate: endDate.toISOString(),
        urgencyLevel: UrgencyLevel.STANDARD,
      },
      actor
    );

    assert.equal(draft.currentState, TaskState.PROPOSED_DRAFT);
    assert.equal(draft.urgencyLevel, UrgencyLevel.STANDARD);

    const auditTrail = await TaskEngineService.getAuditTrail(draft.id);
    assert.equal(auditTrail.length, 1);
    assert.equal(auditTrail[0].actionTaken, 'DRAFT_CREATED');
    assert.equal(auditTrail[0].actorRole, Role.CLINICIAN);
    assert.equal(auditTrail[0].actorId, 'dr-watson');
    assert.equal(auditTrail[0].fromState, null);
    assert.equal(auditTrail[0].toState, TaskState.PROPOSED_DRAFT);
  });

  it('Rule: Prevents illegal jump from PROPOSED_DRAFT to ATTENDANCE_CONFIRMED', async () => {
    const actor = { role: Role.CLINICIAN, id: 'dr-watson' };
    const draft = await TaskEngineService.createDraft(
      {
        patientId: testPatientId,
        sourceInstructionText: 'Routine review',
        followUpAction: 'Routine review',
      },
      actor
    );

    await assert.rejects(
      async () => {
        await TaskEngineService.transitionState(
          draft.id,
          {
            targetState: TaskState.ATTENDANCE_CONFIRMED,
            actionTaken: 'ILLEGAL_ATTENDANCE_SKIP',
          },
          actor
        );
      },
      /Deterministic Rule Violation: Transition from 'PROPOSED_DRAFT' to 'ATTENDANCE_CONFIRMED' is strictly forbidden/
    );
  });

  it('Rule: Prevents illegal jump from PROPOSED_DRAFT to APPOINTMENT_SCHEDULED', async () => {
    const actor = { role: Role.RECORDS_STAFF, id: 'staff-mike' };
    const draft = await TaskEngineService.createDraft(
      {
        patientId: testPatientId,
        sourceInstructionText: 'Routine check',
        followUpAction: 'Routine check',
      },
      actor
    );

    await assert.rejects(
      async () => {
        await TaskEngineService.transitionState(
          draft.id,
          {
            targetState: TaskState.APPOINTMENT_SCHEDULED,
            actionTaken: 'BYPASS_VERIFICATION',
            scheduledDate: new Date().toISOString(),
          },
          actor
        );
      },
      /Deterministic Rule Violation: Transition from 'PROPOSED_DRAFT' to 'APPOINTMENT_SCHEDULED' is strictly forbidden/
    );
  });

  it('Rule 2: Verification without temporal dates escalates to ESCALATED_AMBIGUITY', async () => {
    const actor = { role: Role.CLINICIAN, id: 'dr-watson' };
    const draft = await TaskEngineService.createDraft(
      {
        patientId: testPatientId,
        sourceInstructionText: 'Follow up whenever convenient or if symptoms recur',
        followUpAction: 'Symptom review',
        windowStartDate: null,
        windowEndDate: null,
      },
      actor
    );

    const verified = await TaskEngineService.verifyTask(draft.id, {}, actor);
    assert.equal(verified.currentState, TaskState.ESCALATED_AMBIGUITY);
    assert.match(verified.resolutionReason ?? '', /Missing concrete temporal window bounds/);
  });

  it('Full Valid Lifecycle: DRAFT -> VERIFIED -> SCHEDULED -> ATTENDANCE -> CLOSED', async () => {
    const clinician = { role: Role.CLINICIAN, id: 'dr-house' };
    const staff = { role: Role.RECORDS_STAFF, id: 'staff-clara' };

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 5);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 10);
    const bookingDate = new Date();
    bookingDate.setDate(bookingDate.getDate() + 7);

    // 1. Create draft
    const draft = await TaskEngineService.createDraft(
      {
        patientId: testPatientId,
        sourceInstructionText: 'Post-surgical follow-up in 5-10 days',
        followUpAction: 'Suture removal & post-op check',
        windowStartDate: startDate.toISOString(),
        windowEndDate: endDate.toISOString(),
      },
      clinician
    );
    assert.equal(draft.currentState, TaskState.PROPOSED_DRAFT);

    // 2. Clinician verifies
    const verified = await TaskEngineService.verifyTask(draft.id, {}, clinician);
    assert.equal(verified.currentState, TaskState.VERIFIED_PENDING_ACTION);

    // 3. Book appointment within window
    const scheduled = await TaskEngineService.transitionState(
      draft.id,
      {
        targetState: TaskState.APPOINTMENT_SCHEDULED,
        actionTaken: 'PATIENT_BOOKED_SLOT',
        scheduledDate: bookingDate.toISOString(),
      },
      staff
    );
    assert.equal(scheduled.currentState, TaskState.APPOINTMENT_SCHEDULED);
    assert.ok(scheduled.scheduledDate);

    // 4. Confirm attendance
    const attended = await TaskEngineService.transitionState(
      draft.id,
      {
        targetState: TaskState.ATTENDANCE_CONFIRMED,
        actionTaken: 'CLINICAL_VISIT_ATTENDED',
      },
      staff
    );
    assert.equal(attended.currentState, TaskState.ATTENDANCE_CONFIRMED);

    // 5. Explicitly closed
    const closed = await TaskEngineService.transitionState(
      draft.id,
      {
        targetState: TaskState.EXPLICITLY_CLOSED,
        actionTaken: 'EPISODE_OF_CARE_CLOSED',
        resolutionReason: 'Care plan successfully executed.',
      },
      clinician
    );
    assert.equal(closed.currentState, TaskState.EXPLICITLY_CLOSED);

    // Verify complete audit history
    const auditLogs = await TaskEngineService.getAuditTrail(draft.id);
    assert.equal(auditLogs.length, 5);
    assert.equal(auditLogs[0].actionTaken, 'DRAFT_CREATED');
    assert.equal(auditLogs[1].actionTaken, 'TASK_VERIFIED_ACTIVATED');
    assert.equal(auditLogs[2].actionTaken, 'PATIENT_BOOKED_SLOT');
    assert.equal(auditLogs[3].actionTaken, 'CLINICAL_VISIT_ATTENDED');
    assert.equal(auditLogs[4].actionTaken, 'EPISODE_OF_CARE_CLOSED');
  });

  it('Rule 4: Out-of-window booking is rejected; reschedule request transitions to RESCHEDULE_REQUESTED', async () => {
    const clinician = { role: Role.CLINICIAN, id: 'dr-watson' };
    const patientActor = { role: Role.PATIENT, id: 'patient-alpha' };

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 7);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);

    const draft = await TaskEngineService.createDraft(
      {
        patientId: testPatientId,
        sourceInstructionText: 'Ultrasound in 7 to 14 days',
        followUpAction: 'Renal ultrasound',
        windowStartDate: startDate.toISOString(),
        windowEndDate: endDate.toISOString(),
      },
      clinician
    );
    await TaskEngineService.verifyTask(draft.id, {}, clinician);

    // Attempting to schedule at day 30 (outside 7-14 day window) directly
    const farDate = new Date();
    farDate.setDate(farDate.getDate() + 30);

    await assert.rejects(
      async () => {
        await TaskEngineService.transitionState(
          draft.id,
          {
            targetState: TaskState.APPOINTMENT_SCHEDULED,
            actionTaken: 'DIRECT_OUT_OF_WINDOW_BOOKING',
            scheduledDate: farDate.toISOString(),
          },
          patientActor
        );
      },
      /exceeds clinician-stipulated window end/
    );

    // Submitting through requestReschedule moves to RESCHEDULE_REQUESTED
    const rescheduled = await TaskEngineService.requestReschedule(
      draft.id,
      {
        requestedDate: farDate.toISOString(),
        barrierReason: 'Patient traveling out of town for business during approved 2-week window.',
      },
      patientActor
    );

    assert.equal(rescheduled.currentState, TaskState.RESCHEDULE_REQUESTED);
    assert.match(rescheduled.resolutionReason ?? '', /\[OUT-OF-WINDOW\]/);
  });

  it('Rule 3: Failed contact attempt moves task to CONTACT_FAILED and logs audit entry', async () => {
    const clinician = { role: Role.CLINICIAN, id: 'dr-watson' };
    const staff = { role: Role.RECORDS_STAFF, id: 'staff-bot' };

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 2);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 5);

    const draft = await TaskEngineService.createDraft(
      {
        patientId: testPatientId,
        sourceInstructionText: 'Check INR levels in 2-5 days',
        followUpAction: 'INR check',
        windowStartDate: startDate.toISOString(),
        windowEndDate: endDate.toISOString(),
      },
      clinician
    );
    await TaskEngineService.verifyTask(draft.id, {}, clinician);

    // Record failed attempt
    const attempt = await TaskEngineService.recordContactAttempt(
      draft.id,
      {
        channel: ContactChannel.SMS,
        targetAddress: '+1-555-9999',
        messagePayload: 'Please schedule your INR check.',
        deliveryStatus: 'FAILED',
      },
      staff
    );

    assert.equal(attempt.deliveryStatus, 'FAILED');

    // Verify task state transitioned to CONTACT_FAILED
    const task = await prisma.followUpTask.findUnique({ where: { id: draft.id } });
    assert.equal(task?.currentState, TaskState.CONTACT_FAILED);

    const audit = await TaskEngineService.getAuditTrail(draft.id);
    const failedLog = audit.find((log) => log.actionTaken === 'CONTACT_FAILURE_ESCALATION');
    assert.ok(failedLog);
    assert.equal(failedLog.toState, TaskState.CONTACT_FAILED);
  });

  it('Rule: Past-due deadlines trigger OVERDUE_UNRESOLVED without altering urgencyLevel', async () => {
    const clinician = { role: Role.CLINICIAN, id: 'dr-watson' };
    const system = { role: Role.ADMIN, id: 'cron-worker' };

    // Past deadline: window ended yesterday
    const pastStart = new Date();
    pastStart.setDate(pastStart.getDate() - 10);
    const pastEnd = new Date();
    pastEnd.setDate(pastEnd.getDate() - 1);

    const draft = await TaskEngineService.createDraft(
      {
        patientId: testPatientId,
        sourceInstructionText: 'Urgent cardiac review needed',
        followUpAction: 'Cardiac enzyme review',
        windowStartDate: pastStart.toISOString(),
        windowEndDate: pastEnd.toISOString(),
        urgencyLevel: UrgencyLevel.CLINICIAN_URGENT,
      },
      clinician
    );
    await TaskEngineService.verifyTask(draft.id, {}, clinician);

    // Run overdue scan
    const scanResult = await TaskEngineService.checkOverdueTasks(system);
    assert.ok(scanResult.transitionedTaskIds.includes(draft.id));

    const overdueTask = await prisma.followUpTask.findUnique({ where: { id: draft.id } });
    assert.equal(overdueTask?.currentState, TaskState.OVERDUE_UNRESOLVED);
    // Crucial: Administrative lateness != Clinical urgency: urgencyLevel is preserved!
    assert.equal(overdueTask?.urgencyLevel, UrgencyLevel.CLINICIAN_URGENT);
  });

  it('HTTP Endpoints: Verify /api/tasks queues and audit-trail', async () => {
    // 1. Test GET /api/tasks/queue/urgent
    const urgentRes = await app.inject({
      method: 'GET',
      url: '/api/tasks/queue/urgent',
    });
    assert.equal(urgentRes.statusCode, 200);
    const urgentTasks = JSON.parse(urgentRes.payload);
    assert.ok(Array.isArray(urgentTasks));
    for (const t of urgentTasks) {
      assert.equal(t.urgencyLevel, UrgencyLevel.CLINICIAN_URGENT);
    }

    // 2. Test GET /api/tasks/queue/outstanding
    const outstandingRes = await app.inject({
      method: 'GET',
      url: '/api/tasks/queue/outstanding',
    });
    assert.equal(outstandingRes.statusCode, 200);
    const outstandingTasks = JSON.parse(outstandingRes.payload);
    assert.ok(Array.isArray(outstandingTasks));
    for (const t of outstandingTasks) {
      assert.ok(
        [
          TaskState.CONTACT_FAILED,
          TaskState.ESCALATED_AMBIGUITY,
          TaskState.OVERDUE_UNRESOLVED,
          TaskState.RESCHEDULE_REQUESTED,
        ].includes(t.currentState)
      );
    }

    // 3. Test POST /api/tasks draft creation via HTTP
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: {
        'x-actor-role': Role.CLINICIAN,
        'x-actor-id': 'dr-endpoint-test',
      },
      payload: {
        patientId: testPatientId,
        sourceInstructionText: 'Endpoint test note',
        followUpAction: 'Endpoint action test',
        urgencyLevel: UrgencyLevel.STANDARD,
      },
    });
    assert.equal(createRes.statusCode, 201);
    const createdTask = JSON.parse(createRes.payload);
    assert.equal(createdTask.currentState, TaskState.PROPOSED_DRAFT);

    // 4. Test GET /api/tasks/:id/audit-trail via HTTP
    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/tasks/${createdTask.id}/audit-trail`,
    });
    assert.equal(auditRes.statusCode, 200);
    const auditHistory = JSON.parse(auditRes.payload);
    assert.ok(auditHistory.length >= 1);
    assert.equal(auditHistory[0].actionTaken, 'DRAFT_CREATED');
    assert.equal(auditHistory[0].actorId, 'dr-endpoint-test');
  });
});
