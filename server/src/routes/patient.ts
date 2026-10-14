import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { TaskState, Role } from '../types.js';

export const RescheduleBodySchema = z.object({
  requestedDate: z.string().datetime(),
  barrierReason: z.string().optional(),
  taskId: z.string().optional(),
});

export const ReportBarrierBodySchema = z.object({
  barrierReason: z.string().min(1, 'Barrier reason is required'),
  barrierCategory: z.string().optional().default('GENERAL'),
  notes: z.string().optional(),
  taskId: z.string().optional(),
});

export async function patientRoutes(server: FastifyInstance) {
  /**
   * Helper: Resolve task from :id (which may be a taskId or patientId/MRN)
   */
  async function resolveTask(identifier: string, specifiedTaskId?: string) {
    if (specifiedTaskId) {
      const task = await prisma.followUpTask.findUnique({
        where: { id: specifiedTaskId },
        include: { patient: true },
      });
      if (task) return task;
    }

    // Try resolving as taskId
    const taskById = await prisma.followUpTask.findUnique({
      where: { id: identifier },
      include: { patient: true },
    });
    if (taskById) return taskById;

    // Try resolving by patientId
    const taskByPatient = await prisma.followUpTask.findFirst({
      where: { patientId: identifier },
      orderBy: { createdAt: 'desc' },
      include: { patient: true },
    });
    if (taskByPatient) return taskByPatient;

    // Try resolving by MRN
    const patientByMrn = await prisma.patient.findUnique({
      where: { mrn: identifier },
      include: {
        tasks: {
          orderBy: { createdAt: 'desc' },
          include: { patient: true },
        },
      },
    });

    if (patientByMrn && patientByMrn.tasks.length > 0) {
      return patientByMrn.tasks[0];
    }

    return null;
  }

  /**
   * GET /api/patient/:id/tasks
   * Fetch active tasks for a patient by ID or MRN
   */
  server.get('/:id/tasks', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;

    const patient = await prisma.patient.findFirst({
      where: {
        OR: [{ id }, { mrn: id }],
      },
      include: {
        tasks: {
          include: {
            contactAttempts: { orderBy: { attemptedAt: 'desc' } },
            auditLogs: { orderBy: { timestamp: 'desc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!patient) {
      return reply.status(404).send({ error: `Patient '${id}' not found` });
    }

    return reply.send(patient);
  });

  /**
   * POST /api/patient/:id/reschedule
   * Constraint-Aware Rescheduling:
   * - Within window: Auto-confirms and moves to APPOINTMENT_SCHEDULED
   * - Outside window: Flags OUT_OF_WINDOW_EXCEPTION and moves to RESCHEDULE_REQUESTED for staff review
   */
  server.post(
    '/:id/reschedule',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof RescheduleBodySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const { id } = req.params;
        const validated = RescheduleBodySchema.parse(req.body);
        const task = await resolveTask(id, validated.taskId);

        if (!task) {
          return reply.status(404).send({ error: `Task for identifier '${id}' not found` });
        }

        const requestedDate = new Date(validated.requestedDate);

        // Check if requested date is within the clinician-approved window
        const isWithinWindow =
          Boolean(task.windowStartDate && task.windowEndDate) &&
          requestedDate >= task.windowStartDate! &&
          requestedDate <= task.windowEndDate!;

        return await prisma.$transaction(async (tx) => {
          if (isWithinWindow) {
            // Permitted confirmation
            const updatedTask = await tx.followUpTask.update({
              where: { id: task.id },
              data: {
                currentState: TaskState.APPOINTMENT_SCHEDULED,
                scheduledDate: requestedDate,
                resolutionReason: `Patient confirmed slot within approved clinician window (${requestedDate.toISOString()}).`,
              },
              include: { patient: true },
            });

            await tx.auditLog.create({
              data: {
                taskId: task.id,
                actorRole: Role.PATIENT,
                actorId: task.patient.id,
                actionTaken: 'PATIENT_SCHEDULED_IN_WINDOW',
                fromState: task.currentState,
                toState: TaskState.APPOINTMENT_SCHEDULED,
                metadataJson: JSON.stringify({
                  scheduledDate: requestedDate.toISOString(),
                  clinicianWindow: {
                    start: task.windowStartDate?.toISOString(),
                    end: task.windowEndDate?.toISOString(),
                  },
                }),
              },
            });

            return reply.send({
              confirmed: true,
              requiresStaffReview: false,
              outOfWindow: false,
              task: updatedTask,
              message: 'Appointment successfully confirmed within clinician window.',
            });
          } else {
            // Out of window: Escalates to staff review
            const updatedTask = await tx.followUpTask.update({
              where: { id: task.id },
              data: {
                currentState: TaskState.RESCHEDULE_REQUESTED,
                resolutionReason: `OUT_OF_WINDOW_EXCEPTION: Requested date (${requestedDate.toISOString()}) is outside approved window (${
                  task.windowStartDate?.toISOString() ?? 'none'
                } to ${task.windowEndDate?.toISOString() ?? 'none'}). Requires Clinical Staff Review. Barrier/Note: ${
                  validated.barrierReason || 'Patient selected alternate date'
                }`,
              },
              include: { patient: true },
            });

            await tx.auditLog.create({
              data: {
                taskId: task.id,
                actorRole: Role.PATIENT,
                actorId: task.patient.id,
                actionTaken: 'RESCHEDULE_OUT_OF_WINDOW_ESCALATION',
                fromState: task.currentState,
                toState: TaskState.RESCHEDULE_REQUESTED,
                metadataJson: JSON.stringify({
                  exceptionType: 'OUT_OF_WINDOW_EXCEPTION',
                  requestedDate: requestedDate.toISOString(),
                  barrierReason: validated.barrierReason,
                  clinicianWindow: {
                    start: task.windowStartDate?.toISOString() ?? null,
                    end: task.windowEndDate?.toISOString() ?? null,
                  },
                }),
              },
            });

            return reply.send({
              confirmed: false,
              requiresStaffReview: true,
              outOfWindow: true,
              task: updatedTask,
              message: 'Requested slot is outside the clinician-approved window. Requires Clinical Staff Review.',
            });
          }
        });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  /**
   * POST /api/patient/:id/report-barrier
   * Reports attendance barriers (travel, cost, caregiver) and flags for administrative attention
   */
  server.post(
    '/:id/report-barrier',
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof ReportBarrierBodySchema> }>,
      reply: FastifyReply
    ) => {
      try {
        const { id } = req.params;
        const validated = ReportBarrierBodySchema.parse(req.body);
        const task = await resolveTask(id, validated.taskId);

        if (!task) {
          return reply.status(404).send({ error: `Task for identifier '${id}' not found` });
        }

        const category = validated.barrierCategory || 'GENERAL';
        const resolutionReason = `PATIENT_BARRIER_REPORTED: [${category}] ${validated.barrierReason}${
          validated.notes ? ` - ${validated.notes}` : ''
        }`;

        const updatedTask = await prisma.followUpTask.update({
          where: { id: task.id },
          data: {
            currentState: TaskState.RESCHEDULE_REQUESTED,
            resolutionReason,
          },
          include: { patient: true },
        });

        await prisma.auditLog.create({
          data: {
            taskId: task.id,
            actorRole: Role.PATIENT,
            actorId: task.patient.id,
            actionTaken: 'PATIENT_BARRIER_REPORTED',
            fromState: task.currentState,
            toState: TaskState.RESCHEDULE_REQUESTED,
            metadataJson: JSON.stringify({
              barrierCategory: category,
              barrierReason: validated.barrierReason,
              notes: validated.notes,
            }),
          },
        });

        return reply.send({
          success: true,
          task: updatedTask,
          message: 'Attendance barrier successfully reported and flagged for staff attention.',
        });
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );
}
