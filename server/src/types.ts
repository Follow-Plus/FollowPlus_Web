import { z } from 'zod';

export enum Role {
  PATIENT = 'PATIENT',
  RECORDS_STAFF = 'RECORDS_STAFF',
  CLINICIAN = 'CLINICIAN',
  ADMIN = 'ADMIN',
}

export enum UrgencyLevel {
  STANDARD = 'STANDARD',
  CLINICIAN_URGENT = 'CLINICIAN_URGENT',
}

export enum TaskState {
  PROPOSED_DRAFT = 'PROPOSED_DRAFT',
  VERIFIED_PENDING_ACTION = 'VERIFIED_PENDING_ACTION',
  CONTACT_FAILED = 'CONTACT_FAILED',
  ESCALATED_AMBIGUITY = 'ESCALATED_AMBIGUITY',
  APPOINTMENT_SCHEDULED = 'APPOINTMENT_SCHEDULED',
  RESCHEDULE_REQUESTED = 'RESCHEDULE_REQUESTED',
  OVERDUE_UNRESOLVED = 'OVERDUE_UNRESOLVED',
  ATTENDANCE_CONFIRMED = 'ATTENDANCE_CONFIRMED',
  EXPLICITLY_CLOSED = 'EXPLICITLY_CLOSED',
}

export enum ContactChannel {
  SMS = 'SMS',
  WHATSAPP = 'WHATSAPP',
  VOICE_CALL = 'VOICE_CALL',
  IN_PERSON = 'IN_PERSON',
}

export const RoleSchema = z.nativeEnum(Role);
export const UrgencyLevelSchema = z.nativeEnum(UrgencyLevel);
export const TaskStateSchema = z.nativeEnum(TaskState);
export const ContactChannelSchema = z.nativeEnum(ContactChannel);
