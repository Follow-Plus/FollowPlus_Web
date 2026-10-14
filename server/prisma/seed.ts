import { PrismaClient } from '@prisma/client';
import { Role, UrgencyLevel, TaskState, ContactChannel } from '../src/types.js';

const prisma = new PrismaClient();

function addDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function addHours(hours: number): Date {
  const date = new Date();
  date.setTime(date.getTime() + hours * 60 * 60 * 1000);
  return date;
}

async function main() {
  console.log('Clearing existing records...');
  await prisma.auditLog.deleteMany({});
  await prisma.contactAttempt.deleteMany({});
  await prisma.followUpTask.deleteMany({});
  await prisma.patient.deleteMany({});

  console.log('Seeding synthetic patients and follow-up tasks...');

  // ==========================================
  // Patient 1: Standard Routine Follow-Up
  // ==========================================
  const patient1 = await prisma.patient.create({
    data: {
      mrn: 'MRN-1001',
      fullName: 'David Miller',
      primaryPhone: '+1-555-0101',
      isSharedPhone: false,
      hasSensitiveConsent: true,
      languagePref: 'en',
    },
  });

  const task1 = await prisma.followUpTask.create({
    data: {
      patientId: patient1.id,
      sourceInstructionText:
        'Patient is recovering well after laparoscopic appendectomy. Wound dressing intact. Follow-up wound healing check and suture removal in 10 to 14 days.',
      extractedSpanJson: JSON.stringify({
        action: { text: 'wound healing check and suture removal', start: 83, end: 122 },
        window: { text: 'in 10 to 14 days', start: 123, end: 139 },
      }),
      followUpAction: 'Wound healing check and suture removal',
      windowStartDate: addDays(10),
      windowEndDate: addDays(14),
      urgencyLevel: UrgencyLevel.STANDARD,
      currentState: TaskState.VERIFIED_PENDING_ACTION,
      assignedStaffId: 'staff-nurse-01',
    },
  });

  await prisma.contactAttempt.create({
    data: {
      taskId: task1.id,
      channel: ContactChannel.SMS,
      targetAddress: patient1.primaryPhone,
      messagePayload:
        'Hello David, please schedule your post-op wound healing check with Dr. Gomez between 10 to 14 days from discharge.',
      deliveryStatus: 'DELIVERED',
      patientResponse: 'Thank you, looking at slots.',
    },
  });

  await prisma.auditLog.create({
    data: {
      taskId: task1.id,
      actorRole: Role.CLINICIAN,
      actorId: 'dr-gomez',
      actionTaken: 'TASK_VERIFIED',
      fromState: TaskState.PROPOSED_DRAFT,
      toState: TaskState.VERIFIED_PENDING_ACTION,
      metadataJson: JSON.stringify({ verifiedWindowDays: [10, 14] }),
    },
  });

  // ==========================================
  // Patient 2: Shared Household Phone (No Sensitive Consent)
  // ==========================================
  const patient2 = await prisma.patient.create({
    data: {
      mrn: 'MRN-1002',
      fullName: 'Maria Gonzalez',
      primaryPhone: '+1-555-0102',
      isSharedPhone: true,
      hasSensitiveConsent: false,
      languagePref: 'es',
    },
  });

  const task2 = await prisma.followUpTask.create({
    data: {
      patientId: patient2.id,
      sourceInstructionText:
        'Biopsy sample submitted to pathology. Schedule oncology histology pathology review in 3 to 4 weeks once genomic panels return.',
      extractedSpanJson: JSON.stringify({
        action: { text: 'oncology histology pathology review', start: 48, end: 84 },
        window: { text: 'in 3 to 4 weeks', start: 85, end: 100 },
      }),
      followUpAction: 'Oncology histology pathology review',
      windowStartDate: addDays(21),
      windowEndDate: addDays(28),
      urgencyLevel: UrgencyLevel.STANDARD,
      currentState: TaskState.VERIFIED_PENDING_ACTION,
      assignedStaffId: 'staff-coord-02',
    },
  });

  // Sensitive details suppressed into neutral text
  await prisma.contactAttempt.create({
    data: {
      taskId: task2.id,
      channel: ContactChannel.SMS,
      targetAddress: patient2.primaryPhone,
      messagePayload:
        'Aviso de la Clinica: Estimada Maria, tiene una cita de seguimiento pendiente para dentro de 3 a 4 semanas. Por favor ingrese al portal seguro para coordinar su horario.',
      deliveryStatus: 'DELIVERED',
      patientResponse: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      taskId: task2.id,
      actorRole: Role.RECORDS_STAFF,
      actorId: 'staff-coord-02',
      actionTaken: 'SHARED_PHONE_REDACTION_APPLIED',
      fromState: TaskState.PROPOSED_DRAFT,
      toState: TaskState.VERIFIED_PENDING_ACTION,
      metadataJson: JSON.stringify({
        privacyPolicyApplied: 'SUPPRESS_DIAGNOSTIC_DETAILS',
        reason: 'isSharedPhone=true, hasSensitiveConsent=false',
      }),
    },
  });

  // ==========================================
  // Patient 3: Unreachable / Invalid Phone Number
  // ==========================================
  const patient3 = await prisma.patient.create({
    data: {
      mrn: 'MRN-1003',
      fullName: 'Robert Chen',
      primaryPhone: '+1-000-INVALID',
      isSharedPhone: false,
      hasSensitiveConsent: true,
      languagePref: 'en',
    },
  });

  const task3 = await prisma.followUpTask.create({
    data: {
      patientId: patient3.id,
      sourceInstructionText:
        'Post cardiac catheterization discharge. Review femoral access site and titration of beta blockers in 1 to 2 weeks.',
      extractedSpanJson: JSON.stringify({
        action: { text: 'Review femoral access site and titration of beta blockers', start: 39, end: 97 },
        window: { text: 'in 1 to 2 weeks', start: 98, end: 113 },
      }),
      followUpAction: 'Review femoral access site and beta blockers',
      windowStartDate: addDays(7),
      windowEndDate: addDays(14),
      urgencyLevel: UrgencyLevel.STANDARD,
      currentState: TaskState.CONTACT_FAILED,
      assignedStaffId: 'staff-nurse-01',
      resolutionReason: 'SMS delivery failed: Invalid phone destination. Requires address verification or postal dispatch.',
    },
  });

  await prisma.contactAttempt.create({
    data: {
      taskId: task3.id,
      channel: ContactChannel.SMS,
      targetAddress: patient3.primaryPhone,
      messagePayload: 'Hospital follow-up reminder: Please book your post-cath review.',
      deliveryStatus: 'FAILED',
      patientResponse: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      taskId: task3.id,
      actorRole: Role.ADMIN,
      actorId: 'system-worker',
      actionTaken: 'DELIVERY_FAILURE_RECORDED',
      fromState: TaskState.VERIFIED_PENDING_ACTION,
      toState: TaskState.CONTACT_FAILED,
      metadataJson: JSON.stringify({ errorCode: 'CARRIER_INVALID_DESTINATION', retriesExhausted: true }),
    },
  });

  // ==========================================
  // Patient 4: Free-Text Note with Missing Dates (Vague Instructions)
  // ==========================================
  const patient4 = await prisma.patient.create({
    data: {
      mrn: 'MRN-1004',
      fullName: 'Emily Davis',
      primaryPhone: '+1-555-0104',
      isSharedPhone: false,
      hasSensitiveConsent: true,
      languagePref: 'en',
    },
  });

  const task4 = await prisma.followUpTask.create({
    data: {
      patientId: patient4.id,
      sourceInstructionText:
        'Mild asthma flare controlled. Patient should follow up as needed soon if wheezing recurs, or return whenever convenient.',
      extractedSpanJson: JSON.stringify({
        action: { text: 'follow up as needed soon', start: 44, end: 68 },
        window: { text: 'soon if wheezing recurs, or return whenever convenient', start: 61, end: 115 },
      }),
      followUpAction: 'Asthma flare follow-up',
      windowStartDate: null,
      windowEndDate: null,
      urgencyLevel: UrgencyLevel.STANDARD,
      currentState: TaskState.ESCALATED_AMBIGUITY,
      assignedStaffId: 'staff-triage-lead',
      resolutionReason:
        'Deterministic rule violation: Missing specific date bounds (found "as needed soon / whenever convenient"). Escalated to clinician triage.',
    },
  });

  await prisma.auditLog.create({
    data: {
      taskId: task4.id,
      actorRole: Role.ADMIN,
      actorId: 'deterministic-rule-engine',
      actionTaken: 'AMBIGUITY_BLOCKED',
      fromState: TaskState.PROPOSED_DRAFT,
      toState: TaskState.ESCALATED_AMBIGUITY,
      metadataJson: JSON.stringify({
        violation: 'UNBOUNDED_TEMPORAL_SPECIFIER',
        offendingPhrase: 'as needed soon / whenever convenient',
      }),
    },
  });

  // ==========================================
  // Patient 5: Note with Conflicting Follow-Up Timeframes
  // ==========================================
  const patient5 = await prisma.patient.create({
    data: {
      mrn: 'MRN-1005',
      fullName: 'Michael Brown',
      primaryPhone: '+1-555-0105',
      isSharedPhone: false,
      hasSensitiveConsent: false,
      languagePref: 'en',
    },
  });

  const task5 = await prisma.followUpTask.create({
    data: {
      patientId: patient5.id,
      sourceInstructionText:
        'Discharge summary: Follow-up in 2 weeks for blood pressure and renal check. Addendum note: Patient clinically stable, return to outpatient clinic in 6 months.',
      extractedSpanJson: JSON.stringify({
        action: { text: 'blood pressure and renal check', start: 43, end: 73 },
        conflictingWindows: [
          { text: 'in 2 weeks', start: 32, end: 42 },
          { text: 'in 6 months', start: 145, end: 156 },
        ],
      }),
      followUpAction: 'Blood pressure and renal check',
      windowStartDate: null,
      windowEndDate: null,
      urgencyLevel: UrgencyLevel.STANDARD,
      currentState: TaskState.ESCALATED_AMBIGUITY,
      assignedStaffId: 'staff-triage-lead',
      resolutionReason:
        'Deterministic rule violation: Conflicting intervals detected ("in 2 weeks" vs "in 6 months"). Automatic booking blocked.',
    },
  });

  await prisma.auditLog.create({
    data: {
      taskId: task5.id,
      actorRole: Role.ADMIN,
      actorId: 'deterministic-rule-engine',
      actionTaken: 'CONFLICT_DETECTED',
      fromState: TaskState.PROPOSED_DRAFT,
      toState: TaskState.ESCALATED_AMBIGUITY,
      metadataJson: JSON.stringify({
        conflictType: 'TEMPORAL_WINDOW_DISCREPANCY',
        detectedWindows: ['2 weeks', '6 months'],
      }),
    },
  });

  // ==========================================
  // Patient 6: Clinician-Designated Urgent Follow-Up
  // ==========================================
  const patient6 = await prisma.patient.create({
    data: {
      mrn: 'MRN-1006',
      fullName: 'Sarah Wilson',
      primaryPhone: '+1-555-0106',
      isSharedPhone: false,
      hasSensitiveConsent: true,
      languagePref: 'en',
    },
  });

  const task6 = await prisma.followUpTask.create({
    data: {
      patientId: patient6.id,
      sourceInstructionText:
        'CRITICAL ALERT: Urgent renal function panel, potassium monitoring, and surgical wound inspection required within 48 to 72 hours due to acute kidney injury risk.',
      extractedSpanJson: JSON.stringify({
        action: { text: 'Urgent renal function panel, potassium monitoring, and surgical wound inspection', start: 16, end: 89 },
        window: { text: 'within 48 to 72 hours', start: 99, end: 120 },
      }),
      followUpAction: 'Urgent renal panel & wound inspection',
      windowStartDate: addHours(48),
      windowEndDate: addHours(72),
      urgencyLevel: UrgencyLevel.CLINICIAN_URGENT,
      currentState: TaskState.VERIFIED_PENDING_ACTION,
      assignedStaffId: 'dr-patel-urgent-care',
    },
  });

  await prisma.contactAttempt.create({
    data: {
      taskId: task6.id,
      channel: ContactChannel.VOICE_CALL,
      targetAddress: patient6.primaryPhone,
      messagePayload:
        'PRIORITY CALL: Contacting patient Sarah Wilson for immediate 48h laboratory and surgical follow-up scheduling.',
      deliveryStatus: 'PENDING',
      patientResponse: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      taskId: task6.id,
      actorRole: Role.CLINICIAN,
      actorId: 'dr-patel',
      actionTaken: 'URGENT_TASK_VERIFIED',
      fromState: TaskState.PROPOSED_DRAFT,
      toState: TaskState.VERIFIED_PENDING_ACTION,
      metadataJson: JSON.stringify({
        urgencyDesignation: 'CLINICIAN_URGENT',
        clinicalProtocol: '48_72_HOUR_AKI_SURVEILLANCE',
      }),
    },
  });

  console.log('Seed completed successfully with 6 comprehensive test patients and audit records!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
