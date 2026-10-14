import { prisma } from '../db.js';
import { ContactChannel, Role, TaskState } from '../types.js';

export interface DispatchNotificationOptions {
  channel?: ContactChannel;
  simulateFailure?: boolean;
  actorId?: string;
  actorRole?: Role;
}

export interface DispatchNotificationResult {
  attemptId: string;
  channel: ContactChannel;
  targetAddress: string;
  messagePayload: string;
  deliveryStatus: string;
  isRedacted: boolean;
  taskState: TaskState;
}

export class NotificationService {
  public static readonly NEUTRAL_SHARED_NOTICE =
    'Hospital Notice: You have an upcoming appointment notice. Call records desk or log into the portal to review your schedule.';

  /**
   * Dispatches consent-aware simulated message and records ContactAttempt + AuditLog.
   */
  public static async dispatchNotification(
    taskId: string,
    options: DispatchNotificationOptions = {}
  ): Promise<DispatchNotificationResult> {
    const channel = options.channel ?? ContactChannel.SMS;
    const actorRole = options.actorRole ?? Role.ADMIN;
    const actorId = options.actorId ?? 'notification-dispatch-service';

    return prisma.$transaction(async (tx) => {
      const task = await tx.followUpTask.findUnique({
        where: { id: taskId },
        include: { patient: true },
      });

      if (!task) {
        throw new Error(`Task with ID ${taskId} not found`);
      }

      const patient = task.patient;
      const isSharedWithoutConsent = patient.isSharedPhone && !patient.hasSensitiveConsent;

      let messagePayload: string;
      let isRedacted: boolean;

      if (isSharedWithoutConsent) {
        // Enforce Rule Set 2: Redact sensitive clinical terminology, departments, and actions
        messagePayload = this.NEUTRAL_SHARED_NOTICE;
        isRedacted = true;
      } else {
        messagePayload = `Hospital Outpatient Notice: Hello ${patient.fullName}, you have an upcoming follow-up for: ${task.followUpAction}. Clinician window: ${
          task.windowStartDate ? new Date(task.windowStartDate).toLocaleDateString() : 'Pending'
        } to ${
          task.windowEndDate ? new Date(task.windowEndDate).toLocaleDateString() : 'Pending'
        }. Please log into the portal to coordinate your appointment.`;
        isRedacted = false;
      }

      // Check delivery simulation: Phone containing "INVALID" or simulateFailure explicitly triggers FAILED
      const isFailed =
        options.simulateFailure ||
        patient.primaryPhone.includes('INVALID') ||
        patient.primaryPhone === '';

      const deliveryStatus = isFailed ? 'FAILED' : 'DELIVERED';

      const attempt = await tx.contactAttempt.create({
        data: {
          taskId: task.id,
          channel,
          targetAddress: patient.primaryPhone,
          messagePayload,
          deliveryStatus,
          patientResponse: null,
        },
      });

      let nextState = task.currentState as TaskState;

      // Handle delivery failure escalation
      if (deliveryStatus === 'FAILED') {
        if (nextState !== TaskState.EXPLICITLY_CLOSED && nextState !== TaskState.ATTENDANCE_CONFIRMED) {
          nextState = TaskState.CONTACT_FAILED;
          await tx.followUpTask.update({
            where: { id: task.id },
            data: {
              currentState: TaskState.CONTACT_FAILED,
              resolutionReason: `SMS delivery failed: Invalid phone destination or carrier drop (${patient.primaryPhone}). Requires address verification or manual outreach.`,
            },
          });

          await tx.auditLog.create({
            data: {
              taskId: task.id,
              actorRole,
              actorId,
              actionTaken: 'DELIVERY_FAILURE_RECORDED',
              fromState: task.currentState,
              toState: TaskState.CONTACT_FAILED,
              metadataJson: JSON.stringify({
                attemptId: attempt.id,
                channel,
                targetAddress: patient.primaryPhone,
                errorCode: 'CARRIER_INVALID_DESTINATION',
              }),
            },
          });
        }
      } else {
        // Delivery was successful: Log consent-aware audit entry
        const actionTaken = isRedacted
          ? 'SHARED_PHONE_REDACTION_APPLIED'
          : 'FULL_CLINICAL_DISPATCH';

        await tx.auditLog.create({
          data: {
            taskId: task.id,
            actorRole,
            actorId,
            actionTaken,
            fromState: task.currentState,
            toState: task.currentState,
            metadataJson: JSON.stringify({
              attemptId: attempt.id,
              channel,
              targetAddress: patient.primaryPhone,
              isSharedPhone: patient.isSharedPhone,
              hasSensitiveConsent: patient.hasSensitiveConsent,
              privacyPolicyApplied: isRedacted ? 'SUPPRESS_DIAGNOSTIC_DETAILS' : 'STANDARD_DELIVERY',
            }),
          },
        });
      }

      return {
        attemptId: attempt.id,
        channel,
        targetAddress: patient.primaryPhone,
        messagePayload,
        deliveryStatus,
        isRedacted,
        taskState: nextState,
      };
    });
  }
}
