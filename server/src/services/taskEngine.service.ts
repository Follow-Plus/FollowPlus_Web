import { prisma } from '../db.js';
import { Role, TaskState, UrgencyLevel, ContactChannel } from '../types.js';
import { z } from 'zod';

// Zod schemas for input validation
export const ActorSchema = z.object({
  role: z.nativeEnum(Role),
  id: z.string().min(1, 'Actor ID is required'),
});

export type Actor = z.infer<typeof ActorSchema>;

export const CreateDraftTaskSchema = z.object({
  patientId: z.string().uuid(),
  sourceInstructionText: z.string().min(1, 'Source instruction text is required'),
  extractedSpanJson: z.string().optional(),
  followUpAction: z.string().min(1, 'Follow-up action is required'),
  windowStartDate: z.string().datetime().optional().nullable(),
  windowEndDate: z.string().datetime().optional().nullable(),
  urgencyLevel: z.nativeEnum(UrgencyLevel).default(UrgencyLevel.STANDARD),
});

export type CreateDraftTaskInput = z.input<typeof CreateDraftTaskSchema>;

export const VerifyTaskSchema = z.object({
  followUpAction: z.string().min(1).optional(),
  windowStartDate: z.string().datetime().optional().nullable(),
  windowEndDate: z.string().datetime().optional().nullable(),
  urgencyLevel: z.nativeEnum(UrgencyLevel).optional(),
  assignedStaffId: z.string().optional().nullable(),
  notes: z.string().optional(),
});

export type VerifyTaskInput = z.infer<typeof VerifyTaskSchema>;

export const TransitionTaskSchema = z.object({
  targetState: z.nativeEnum(TaskState),
  actionTaken: z.string().min(1, 'actionTaken is required'),
  scheduledDate: z.string().datetime().optional().nullable(),
  resolutionReason: z.string().optional().nullable(),
  metadata: z.record(z.any()).optional(),
});

export type TransitionTaskInput = z.infer<typeof TransitionTaskSchema>;

export const ContactAttemptSchema = z.object({
  channel: z.nativeEnum(ContactChannel),
  targetAddress: z.string().min(1),
  messagePayload: z.string().min(1),
  deliveryStatus: z.enum(['DELIVERED', 'FAILED', 'NO_ANSWER', 'PENDING']),
  patientResponse: z.string().optional().nullable(),
});

export type ContactAttemptInput = z.infer<typeof ContactAttemptSchema>;

export const RescheduleRequestSchema = z.object({
  requestedDate: z.string().datetime(),
  barrierReason: z.string().min(1, 'Reason or barrier is required'),
});

export type RescheduleRequestInput = z.infer<typeof RescheduleRequestSchema>;

// Deterministic state transition graph
// Mapping: Current State -> Set of Allowed Next States
export const ALLOWED_STATE_TRANSITIONS: Record<TaskState, TaskState[]> = {
  [TaskState.PROPOSED_DRAFT]: [
    TaskState.VERIFIED_PENDING_ACTION,
    TaskState.ESCALATED_AMBIGUITY,
    TaskState.EXPLICITLY_CLOSED,
  ],
  [TaskState.VERIFIED_PENDING_ACTION]: [
    TaskState.APPOINTMENT_SCHEDULED,
    TaskState.CONTACT_FAILED,
    TaskState.RESCHEDULE_REQUESTED,
    TaskState.OVERDUE_UNRESOLVED,
    TaskState.ESCALATED_AMBIGUITY,
    TaskState.EXPLICITLY_CLOSED,
  ],
  [TaskState.CONTACT_FAILED]: [
    TaskState.VERIFIED_PENDING_ACTION,
    TaskState.APPOINTMENT_SCHEDULED,
    TaskState.OVERDUE_UNRESOLVED,
    TaskState.EXPLICITLY_CLOSED,
  ],
  [TaskState.ESCALATED_AMBIGUITY]: [
    TaskState.VERIFIED_PENDING_ACTION,
    TaskState.APPOINTMENT_SCHEDULED,
    TaskState.EXPLICITLY_CLOSED,
  ],
  [TaskState.APPOINTMENT_SCHEDULED]: [
    TaskState.ATTENDANCE_CONFIRMED,
    TaskState.RESCHEDULE_REQUESTED,
    TaskState.OVERDUE_UNRESOLVED,
    TaskState.EXPLICITLY_CLOSED,
  ],
  [TaskState.RESCHEDULE_REQUESTED]: [
    TaskState.APPOINTMENT_SCHEDULED,
    TaskState.ESCALATED_AMBIGUITY,
    TaskState.OVERDUE_UNRESOLVED,
    TaskState.EXPLICITLY_CLOSED,
  ],
  [TaskState.OVERDUE_UNRESOLVED]: [
    TaskState.APPOINTMENT_SCHEDULED,
    TaskState.ATTENDANCE_CONFIRMED,
    TaskState.EXPLICITLY_CLOSED,
  ],
  [TaskState.ATTENDANCE_CONFIRMED]: [
    TaskState.EXPLICITLY_CLOSED,
  ],
  [TaskState.EXPLICITLY_CLOSED]: [],
};

export class TaskEngineService {
  /**
   * Create a new draft follow-up task and record audit log.
   */
  static async createDraft(input: CreateDraftTaskInput, actor: Actor) {
    const validated = CreateDraftTaskSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      const task = await tx.followUpTask.create({
        data: {
          patientId: validated.patientId,
          sourceInstructionText: validated.sourceInstructionText,
          extractedSpanJson: validated.extractedSpanJson ?? null,
          followUpAction: validated.followUpAction,
          windowStartDate: validated.windowStartDate ? new Date(validated.windowStartDate) : null,
          windowEndDate: validated.windowEndDate ? new Date(validated.windowEndDate) : null,
          urgencyLevel: validated.urgencyLevel,
          currentState: TaskState.PROPOSED_DRAFT,
        },
        include: { patient: true },
      });

      await tx.auditLog.create({
        data: {
          taskId: task.id,
          actorRole: actor.role,
          actorId: actor.id,
          actionTaken: 'DRAFT_CREATED',
          fromState: null,
          toState: TaskState.PROPOSED_DRAFT,
          metadataJson: JSON.stringify({
            urgencyLevel: task.urgencyLevel,
            followUpAction: task.followUpAction,
          }),
        },
      });

      return task;
    });
  }

  /**
   * Verify and activate a draft task by a clinician or records staff.
   */
  static async verifyTask(taskId: string, input: VerifyTaskInput, actor: Actor) {
    const validated = VerifyTaskSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      const task = await tx.followUpTask.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      if (task.currentState !== TaskState.PROPOSED_DRAFT && task.currentState !== TaskState.ESCALATED_AMBIGUITY) {
        throw new Error(
          `Cannot verify task in state '${task.currentState}'. Verification is only permitted from PROPOSED_DRAFT or ESCALATED_AMBIGUITY.`
        );
      }

      // Check if dates are defined. If missing dates, force ESCALATED_AMBIGUITY
      const effectiveStartDate = validated.windowStartDate !== undefined
        ? (validated.windowStartDate ? new Date(validated.windowStartDate) : null)
        : task.windowStartDate;
      const effectiveEndDate = validated.windowEndDate !== undefined
        ? (validated.windowEndDate ? new Date(validated.windowEndDate) : null)
        : task.windowEndDate;

      const hasMissingDates = !effectiveStartDate || !effectiveEndDate;
      const targetState = hasMissingDates ? TaskState.ESCALATED_AMBIGUITY : TaskState.VERIFIED_PENDING_ACTION;

      const updatedTask = await tx.followUpTask.update({
        where: { id: taskId },
        data: {
          followUpAction: validated.followUpAction ?? task.followUpAction,
          windowStartDate: effectiveStartDate,
          windowEndDate: effectiveEndDate,
          urgencyLevel: validated.urgencyLevel ?? task.urgencyLevel,
          assignedStaffId: validated.assignedStaffId ?? task.assignedStaffId,
          currentState: targetState,
          resolutionReason: hasMissingDates
            ? 'Missing concrete temporal window bounds; escalated for clinical review.'
            : null,
        },
        include: { patient: true },
      });

      await tx.auditLog.create({
        data: {
          taskId,
          actorRole: actor.role,
          actorId: actor.id,
          actionTaken: hasMissingDates ? 'ESCALATED_DUE_TO_MISSING_DATES' : 'TASK_VERIFIED_ACTIVATED',
          fromState: task.currentState,
          toState: targetState,
          metadataJson: JSON.stringify({
            verifiedBy: actor.id,
            windowStartDate: updatedTask.windowStartDate,
            windowEndDate: updatedTask.windowEndDate,
            notes: validated.notes ?? null,
          }),
        },
      });

      return updatedTask;
    });
  }

  /**
   * Perform a validated deterministic state transition.
   */
  static async transitionState(taskId: string, input: TransitionTaskInput, actor: Actor) {
    const validated = TransitionTaskSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      const task = await tx.followUpTask.findUnique({
        where: { id: taskId },
        include: { patient: true },
      });

      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      const currentState = task.currentState as TaskState;
      const targetState = validated.targetState;

      // Deterministic validation: Check if transition is allowed
      const allowedNextStates = ALLOWED_STATE_TRANSITIONS[currentState] || [];
      if (!allowedNextStates.includes(targetState)) {
        throw new Error(
          `Deterministic Rule Violation: Transition from '${currentState}' to '${targetState}' is strictly forbidden.`
        );
      }

      // Special constraint: PROPOSED_DRAFT cannot jump directly to ATTENDANCE_CONFIRMED
      if (currentState === TaskState.PROPOSED_DRAFT && targetState === TaskState.ATTENDANCE_CONFIRMED) {
        throw new Error('Deterministic Rule Violation: Draft tasks cannot directly confirm attendance without verification.');
      }

      // If transitioning to APPOINTMENT_SCHEDULED, validate booking date bounds
      let scheduledDate: Date | null = null;
      if (targetState === TaskState.APPOINTMENT_SCHEDULED) {
        if (!validated.scheduledDate) {
          throw new Error('Scheduled date must be provided when transitioning to APPOINTMENT_SCHEDULED.');
        }
        scheduledDate = new Date(validated.scheduledDate);

        // Bounded checking: Verify whether scheduled date is within clinician-approved window
        if (task.windowStartDate && scheduledDate < task.windowStartDate) {
          throw new Error(
            `Booking date ${scheduledDate.toISOString()} is earlier than clinician-stipulated window start ${task.windowStartDate.toISOString()}. Out-of-window bookings require escalation.`
          );
        }
        if (task.windowEndDate && scheduledDate > task.windowEndDate) {
          throw new Error(
            `Booking date ${scheduledDate.toISOString()} exceeds clinician-stipulated window end ${task.windowEndDate.toISOString()}. Out-of-window requests must transition to RESCHEDULE_REQUESTED for review.`
          );
        }
      } else if (validated.scheduledDate) {
        scheduledDate = new Date(validated.scheduledDate);
      }

      // Update task
      const updatedTask = await tx.followUpTask.update({
        where: { id: taskId },
        data: {
          currentState: targetState,
          scheduledDate: scheduledDate ?? task.scheduledDate,
          resolutionReason: validated.resolutionReason ?? task.resolutionReason,
        },
        include: { patient: true },
      });

      // Write immutable audit log
      await tx.auditLog.create({
        data: {
          taskId,
          actorRole: actor.role,
          actorId: actor.id,
          actionTaken: validated.actionTaken,
          fromState: currentState,
          toState: targetState,
          metadataJson: JSON.stringify({
            ...validated.metadata,
            scheduledDate: scheduledDate ? scheduledDate.toISOString() : null,
            resolutionReason: validated.resolutionReason ?? null,
          }),
        },
      });

      return updatedTask;
    });
  }

  /**
   * Record a contact attempt. If delivery fails, automatically transitions task to CONTACT_FAILED.
   */
  static async recordContactAttempt(taskId: string, input: ContactAttemptInput, actor: Actor) {
    const validated = ContactAttemptSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      const task = await tx.followUpTask.findUnique({
        where: { id: taskId },
        include: { patient: true },
      });

      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      // Consent & Privacy rule check:
      // If shared phone and no sensitive consent, ensure message payload is neutral
      let sanitizedPayload = validated.messagePayload;
      if (task.patient.isSharedPhone && !task.patient.hasSensitiveConsent) {
        sanitizedPayload = `[REDACTED SENSITIVE DETAILS] ${validated.messagePayload}`;
      }

      const attempt = await tx.contactAttempt.create({
        data: {
          taskId,
          channel: validated.channel,
          targetAddress: validated.targetAddress,
          messagePayload: sanitizedPayload,
          deliveryStatus: validated.deliveryStatus,
          patientResponse: validated.patientResponse ?? null,
        },
      });

      // Failed delivery rule: Failed contact attempts move task to CONTACT_FAILED
      if (validated.deliveryStatus === 'FAILED') {
        const fromState = task.currentState as TaskState;
        if (fromState !== TaskState.CONTACT_FAILED && fromState !== TaskState.EXPLICITLY_CLOSED) {
          await tx.followUpTask.update({
            where: { id: taskId },
            data: {
              currentState: TaskState.CONTACT_FAILED,
              resolutionReason: `Contact attempt via ${validated.channel} failed. Target address: ${validated.targetAddress}`,
            },
          });

          await tx.auditLog.create({
            data: {
              taskId,
              actorRole: actor.role,
              actorId: actor.id,
              actionTaken: 'CONTACT_FAILURE_ESCALATION',
              fromState,
              toState: TaskState.CONTACT_FAILED,
              metadataJson: JSON.stringify({
                attemptId: attempt.id,
                channel: validated.channel,
                deliveryStatus: 'FAILED',
              }),
            },
          });
        }
      } else {
        await tx.auditLog.create({
          data: {
            taskId,
            actorRole: actor.role,
            actorId: actor.id,
            actionTaken: `CONTACT_ATTEMPT_${validated.deliveryStatus}`,
            fromState: task.currentState,
            toState: task.currentState,
            metadataJson: JSON.stringify({
              attemptId: attempt.id,
              channel: validated.channel,
              deliveryStatus: validated.deliveryStatus,
            }),
          },
        });
      }

      return attempt;
    });
  }

  /**
   * Patient or staff requests reschedule. Out-of-window requests transition to RESCHEDULE_REQUESTED for human triage.
   */
  static async requestReschedule(taskId: string, input: RescheduleRequestInput, actor: Actor) {
    const validated = RescheduleRequestSchema.parse(input);
    const requestedDate = new Date(validated.requestedDate);

    return prisma.$transaction(async (tx) => {
      const task = await tx.followUpTask.findUnique({
        where: { id: taskId },
        include: { patient: true },
      });

      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      const isOutsideWindow =
        (task.windowStartDate && requestedDate < task.windowStartDate) ||
        (task.windowEndDate && requestedDate > task.windowEndDate);

      const targetState = TaskState.RESCHEDULE_REQUESTED;

      const updatedTask = await tx.followUpTask.update({
        where: { id: taskId },
        data: {
          currentState: targetState,
          resolutionReason: `Reschedule requested for ${requestedDate.toISOString()}. ${
            isOutsideWindow ? '[OUT-OF-WINDOW] ' : ''
          }Barrier/Reason: ${validated.barrierReason}`,
        },
        include: { patient: true },
      });

      await tx.auditLog.create({
        data: {
          taskId,
          actorRole: actor.role,
          actorId: actor.id,
          actionTaken: isOutsideWindow ? 'RESCHEDULE_OUT_OF_WINDOW_ESCALATION' : 'RESCHEDULE_REQUESTED',
          fromState: task.currentState,
          toState: targetState,
          metadataJson: JSON.stringify({
            requestedDate: requestedDate.toISOString(),
            isOutsideWindow,
            barrierReason: validated.barrierReason,
            clinicianWindow: {
              start: task.windowStartDate?.toISOString() ?? null,
              end: task.windowEndDate?.toISOString() ?? null,
            },
          }),
        },
      });

      return updatedTask;
    });
  }

  /**
   * Overdue scan rule:
   * Tasks past their windowEndDate without attendance or scheduling transition to OVERDUE_UNRESOLVED
   * WITHOUT altering urgencyLevel (Administrative lateness != Clinical urgency).
   */
  static async checkOverdueTasks(actor: Actor) {
    const now = new Date();

    const tasksPastDeadline = await prisma.followUpTask.findMany({
      where: {
        windowEndDate: { lt: now },
        currentState: {
          in: [
            TaskState.VERIFIED_PENDING_ACTION,
            TaskState.CONTACT_FAILED,
            TaskState.RESCHEDULE_REQUESTED,
          ],
        },
      },
    });

    const transitionedTaskIds: string[] = [];

    for (const task of tasksPastDeadline) {
      await prisma.$transaction(async (tx) => {
        await tx.followUpTask.update({
          where: { id: task.id },
          data: {
            currentState: TaskState.OVERDUE_UNRESOLVED,
            // Notice: urgencyLevel is explicitly NOT modified!
            resolutionReason: `Window expired on ${task.windowEndDate?.toISOString()} without attendance or resolution.`,
          },
        });

        await tx.auditLog.create({
          data: {
            taskId: task.id,
            actorRole: actor.role,
            actorId: actor.id,
            actionTaken: 'OVERDUE_DEADLINE_TRIGGERED',
            fromState: task.currentState,
            toState: TaskState.OVERDUE_UNRESOLVED,
            metadataJson: JSON.stringify({
              preservedUrgencyLevel: task.urgencyLevel,
              windowEndDate: task.windowEndDate?.toISOString(),
            }),
          },
        });

        transitionedTaskIds.push(task.id);
      });
    }

    return {
      scannedCount: tasksPastDeadline.length,
      transitionedTaskIds,
    };
  }

  /**
   * Retrieve complete immutable audit trail for a task.
   */
  static async getAuditTrail(taskId: string) {
    return prisma.auditLog.findMany({
      where: { taskId },
      orderBy: { timestamp: 'asc' },
    });
  }

  /**
   * Queue: Clinician-designated urgent tasks requiring rapid follow-up.
   */
  static async getUrgentQueue() {
    return prisma.followUpTask.findMany({
      where: {
        urgencyLevel: UrgencyLevel.CLINICIAN_URGENT,
        currentState: {
          notIn: [TaskState.ATTENDANCE_CONFIRMED, TaskState.EXPLICITLY_CLOSED],
        },
      },
      include: {
        patient: true,
        contactAttempts: { orderBy: { attemptedAt: 'desc' } },
        auditLogs: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
      orderBy: [
        { windowStartDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });
  }

  /**
   * Queue: Outstanding, blocked, failed, ambiguity, or overdue tasks.
   */
  static async getOutstandingQueue() {
    return prisma.followUpTask.findMany({
      where: {
        currentState: {
          in: [
            TaskState.CONTACT_FAILED,
            TaskState.ESCALATED_AMBIGUITY,
            TaskState.OVERDUE_UNRESOLVED,
            TaskState.RESCHEDULE_REQUESTED,
          ],
        },
      },
      include: {
        patient: true,
        contactAttempts: { orderBy: { attemptedAt: 'desc' } },
        auditLogs: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
      orderBy: [
        { updatedAt: 'desc' },
      ],
    });
  }
}
