import {
  FollowUpTask,
  Patient,
  AuditLog,
  ContactAttempt,
  CreateDraftTaskInput,
  VerifyTaskInput,
  TransitionTaskInput,
  ContactAttemptInput,
  RescheduleRequestInput,
  ExtractionResult,
  Actor,
} from '../types';

const API_BASE = '/api';

function getActorHeaders(actor?: Actor): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-actor-role': actor?.role || 'RECORDS_STAFF',
    'x-actor-id': actor?.id || 'staff-dashboard-user',
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorMessage = `HTTP Error ${res.status}: ${res.statusText}`;
    try {
      const errorJson = await res.json();
      if (errorJson.error) errorMessage = errorJson.error;
    } catch (_) {
      // fallback
    }
    throw new Error(errorMessage);
  }
  return res.json() as Promise<T>;
}

export const api = {
  /**
   * List all tasks with optional filters
   */
  async getTasks(filter?: { state?: string; patientId?: string }): Promise<FollowUpTask[]> {
    const params = new URLSearchParams();
    if (filter?.state) params.append('state', filter.state);
    if (filter?.patientId) params.append('patientId', filter.patientId);

    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${API_BASE}/tasks${qs}`);
    return handleResponse<FollowUpTask[]>(res);
  },

  /**
   * Get upcoming clinician-urgent tasks
   */
  async getUrgentQueue(): Promise<FollowUpTask[]> {
    const res = await fetch(`${API_BASE}/tasks/queue/urgent`);
    return handleResponse<FollowUpTask[]>(res);
  },

  /**
   * Get outstanding tasks (ambiguous, failed contact, overdue, reschedule)
   */
  async getOutstandingQueue(): Promise<FollowUpTask[]> {
    const res = await fetch(`${API_BASE}/tasks/queue/outstanding`);
    return handleResponse<FollowUpTask[]>(res);
  },

  /**
   * Get a single task by ID
   */
  async getTask(id: string): Promise<FollowUpTask> {
    const res = await fetch(`${API_BASE}/tasks/${id}`);
    return handleResponse<FollowUpTask>(res);
  },

  /**
   * Create a new draft follow-up task
   */
  async createTask(data: CreateDraftTaskInput, actor?: Actor): Promise<FollowUpTask> {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: getActorHeaders(actor),
      body: JSON.stringify(data),
    });
    return handleResponse<FollowUpTask>(res);
  },

  /**
   * Verify and activate a task draft
   */
  async verifyTask(id: string, data: VerifyTaskInput, actor?: Actor): Promise<FollowUpTask> {
    const res = await fetch(`${API_BASE}/tasks/${id}/verify`, {
      method: 'PATCH',
      headers: getActorHeaders(actor),
      body: JSON.stringify(data),
    });
    return handleResponse<FollowUpTask>(res);
  },

  /**
   * State transition with audit documentation
   */
  async transitionTask(id: string, data: TransitionTaskInput, actor?: Actor): Promise<FollowUpTask> {
    const res = await fetch(`${API_BASE}/tasks/${id}/transition`, {
      method: 'POST',
      headers: getActorHeaders(actor),
      body: JSON.stringify(data),
    });
    return handleResponse<FollowUpTask>(res);
  },

  /**
   * Get complete immutable audit trail for a task
   */
  async getAuditTrail(id: string): Promise<AuditLog[]> {
    const res = await fetch(`${API_BASE}/tasks/${id}/audit-trail`);
    return handleResponse<AuditLog[]>(res);
  },

  /**
   * Record a patient contact attempt
   */
  async recordContactAttempt(
    id: string,
    data: ContactAttemptInput,
    actor?: Actor
  ): Promise<ContactAttempt> {
    const res = await fetch(`${API_BASE}/tasks/${id}/contact-attempt`, {
      method: 'POST',
      headers: getActorHeaders(actor),
      body: JSON.stringify(data),
    });
    return handleResponse<ContactAttempt>(res);
  },

  /**
   * Request rescheduling within or outside clinician window
   */
  async rescheduleTask(
    id: string,
    data: RescheduleRequestInput,
    actor?: Actor
  ): Promise<FollowUpTask> {
    const res = await fetch(`${API_BASE}/tasks/${id}/reschedule`, {
      method: 'POST',
      headers: getActorHeaders(actor),
      body: JSON.stringify(data),
    });
    return handleResponse<FollowUpTask>(res);
  },

  /**
   * Trigger background check for overdue deadlines
   */
  async checkOverdue(actor?: Actor): Promise<{ scanned: number; updatedToOverdue: number }> {
    const res = await fetch(`${API_BASE}/tasks/check-overdue`, {
      method: 'POST',
      headers: getActorHeaders(actor),
    });
    return handleResponse<{ scanned: number; updatedToOverdue: number }>(res);
  },

  /**
   * Get all registered patients
   */
  async getPatients(): Promise<Patient[]> {
    const res = await fetch(`${API_BASE}/patients`);
    return handleResponse<Patient[]>(res);
  },

  /**
   * AI Extraction: Extract structured follow-up parameters and spans from free text
   */
  async extractInstruction(
    sourceInstructionText: string,
    referenceDate?: string
  ): Promise<ExtractionResult> {
    const res = await fetch(`${API_BASE}/ai/extract-instruction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceInstructionText,
        referenceDate,
      }),
    });
    return handleResponse<ExtractionResult>(res);
  },

  /**
   * Get patient record with associated tasks
   */
  async getPatientTasks(identifier: string): Promise<Patient> {
    const res = await fetch(`${API_BASE}/patient/${encodeURIComponent(identifier)}/tasks`);
    return handleResponse<Patient>(res);
  },

  /**
   * Constraint-Aware Rescheduling (Patient Portal)
   */
  async reschedulePatientSlot(
    identifier: string,
    data: { requestedDate: string; barrierReason?: string; taskId?: string }
  ): Promise<{
    confirmed: boolean;
    requiresStaffReview: boolean;
    outOfWindow: boolean;
    task: FollowUpTask;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/patient/${encodeURIComponent(identifier)}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  /**
   * Report Attendance Barrier (Patient Portal)
   */
  async reportPatientBarrier(
    identifier: string,
    data: { barrierReason: string; barrierCategory?: string; notes?: string; taskId?: string }
  ): Promise<{
    success: boolean;
    task: FollowUpTask;
    message: string;
  }> {
    const res = await fetch(`${API_BASE}/patient/${encodeURIComponent(identifier)}/report-barrier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  /**
   * Trigger simulated consent-aware notification dispatch
   */
  async simulateNotification(data: {
    taskId: string;
    channel?: string;
    simulateFailure?: boolean;
  }): Promise<{
    success: boolean;
    attemptId: string;
    channel: string;
    targetAddress: string;
    messagePayload: string;
    deliveryStatus: string;
    isRedacted: boolean;
    taskState: string;
  }> {
    const res = await fetch(`${API_BASE}/notifications/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
};
