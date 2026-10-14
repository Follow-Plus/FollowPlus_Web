export type Role = 'PATIENT' | 'RECORDS_STAFF' | 'CLINICIAN' | 'ADMIN';

export type UrgencyLevel = 'STANDARD' | 'CLINICIAN_URGENT';

export type TaskState =
  | 'PROPOSED_DRAFT'
  | 'VERIFIED_PENDING_ACTION'
  | 'CONTACT_FAILED'
  | 'ESCALATED_AMBIGUITY'
  | 'APPOINTMENT_SCHEDULED'
  | 'RESCHEDULE_REQUESTED'
  | 'OVERDUE_UNRESOLVED'
  | 'ATTENDANCE_CONFIRMED'
  | 'EXPLICITLY_CLOSED';

export type ContactChannel = 'SMS' | 'WHATSAPP' | 'VOICE_CALL' | 'IN_PERSON';

export interface Patient {
  id: string;
  mrn: string;
  fullName: string;
  primaryPhone: string;
  isSharedPhone: boolean;
  hasSensitiveConsent: boolean;
  languagePref: string;
  createdAt?: string;
  tasks?: FollowUpTask[];
}

export interface CharacterSpan {
  start: number;
  end: number;
  exactQuote: string;
  text?: string;
}

export interface ExtractedSpanJsonData {
  action?: CharacterSpan;
  window?: CharacterSpan | null;
  urgency?: CharacterSpan;
  conflictingWindows?: CharacterSpan[];
  vaguePhrases?: CharacterSpan[];
}

export interface ExtractionResult {
  status: TaskState;
  isAmbiguous: boolean;
  ambiguityReason: string | null;
  followUpAction: string;
  windowStartDate: string | null;
  windowEndDate: string | null;
  urgencyLevel: UrgencyLevel;
  extractedSpanJson: string;
  spans: ExtractedSpanJsonData;
  spanMismatch?: boolean;
}

export interface ContactAttempt {
  id: string;
  taskId: string;
  channel: ContactChannel;
  targetAddress: string;
  messagePayload: string;
  deliveryStatus: 'DELIVERED' | 'FAILED' | 'NO_ANSWER' | 'PENDING' | string;
  patientResponse?: string | null;
  attemptedAt: string;
}

export interface AuditLog {
  id: string;
  taskId: string;
  actorRole: Role;
  actorId: string;
  actionTaken: string;
  fromState?: string | null;
  toState?: string | null;
  metadataJson?: string | null;
  timestamp: string;
}

export interface FollowUpTask {
  id: string;
  patientId: string;
  patient: Patient;
  sourceInstructionText: string;
  extractedSpanJson?: string | null;
  followUpAction: string;
  windowStartDate?: string | null;
  windowEndDate?: string | null;
  urgencyLevel: UrgencyLevel;
  currentState: TaskState;
  assignedStaffId?: string | null;
  scheduledDate?: string | null;
  resolutionReason?: string | null;
  contactAttempts?: ContactAttempt[];
  auditLogs?: AuditLog[];
  createdAt: string;
  updatedAt: string;
}

export interface Actor {
  role: Role;
  id: string;
}

export interface CreateDraftTaskInput {
  patientId: string;
  sourceInstructionText: string;
  extractedSpanJson?: string;
  followUpAction: string;
  windowStartDate?: string | null;
  windowEndDate?: string | null;
  urgencyLevel?: UrgencyLevel;
}

export interface VerifyTaskInput {
  followUpAction?: string;
  windowStartDate?: string | null;
  windowEndDate?: string | null;
  urgencyLevel?: UrgencyLevel;
  assignedStaffId?: string | null;
  notes?: string;
}

export interface TransitionTaskInput {
  targetState: TaskState;
  actionTaken: string;
  scheduledDate?: string | null;
  resolutionReason?: string | null;
  metadata?: Record<string, any>;
}

export interface ContactAttemptInput {
  channel: ContactChannel;
  targetAddress: string;
  messagePayload: string;
  deliveryStatus: 'DELIVERED' | 'FAILED' | 'NO_ANSWER' | 'PENDING';
  patientResponse?: string | null;
}

export interface RescheduleRequestInput {
  requestedDate: string;
  barrierReason: string;
}
