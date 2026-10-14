import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  TaskEngineService,
  Actor,
  CreateDraftTaskSchema,
  VerifyTaskSchema,
  TransitionTaskSchema,
  ContactAttemptSchema,
  RescheduleRequestSchema,
} from '../services/taskEngine.service.js';
import { Role } from '../types.js';
import { prisma } from '../db.js';

function extractActor(req: FastifyRequest): Actor {
  const headers = req.headers;
  const roleHeader = headers['x-actor-role'] as string | undefined;
  const idHeader = headers['x-actor-id'] as string | undefined;

  const body = (req.body as any) || {};

  const role = (roleHeader || body.actorRole || Role.CLINICIAN) as Role;
  const id = (idHeader || body.actorId || 'system-clinician') as string;

  return { role, id };
}

export async function taskRoutes(server: FastifyInstance) {
  /**
   * GET /api/tasks
   * List all tasks (with optional state or search filter)
   */
  server.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const { state, patientId } = req.query as { state?: string; patientId?: string };

    const where: any = {};
    if (state) where.currentState = state;
    if (patientId) where.patientId = patientId;

    const tasks = await prisma.followUpTask.findMany({
      where,
      include: {
        patient: true,
        contactAttempts: { orderBy: { attemptedAt: 'desc' } },
        auditLogs: { orderBy: { timestamp: 'desc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(tasks);
  });

  /**
   * GET /api/tasks/queue/urgent
   * Clinician-designated urgent tasks requiring rapid follow-up
   */
  server.get('/queue/urgent', async (_req: FastifyRequest, reply: FastifyReply) => {
    const tasks = await TaskEngineService.getUrgentQueue();
    return reply.send(tasks);
  });

  /**
   * GET /api/tasks/queue/outstanding
   * Blocked, unreachable, ambiguous, or overdue tasks requiring staff triage
   */
  server.get('/queue/outstanding', async (_req: FastifyRequest, reply: FastifyReply) => {
    const tasks = await TaskEngineService.getOutstandingQueue();
    return reply.send(tasks);
  });

  /**
   * GET /api/tasks/:id
   * Get single task with details
   */
  server.get('/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const task = await prisma.followUpTask.findUnique({
      where: { id },
      include: {
        patient: true,
        contactAttempts: { orderBy: { attemptedAt: 'desc' } },
        auditLogs: { orderBy: { timestamp: 'asc' } },
      },
    });

    if (!task) {
      return reply.status(404).send({ error: `Task ${id} not found` });
    }

    return reply.send(task);
  });

  /**
   * POST /api/tasks
   * Create task draft
   */
  server.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const actor = extractActor(req);
      const validated = CreateDraftTaskSchema.parse(req.body);
      const task = await TaskEngineService.createDraft(validated, actor);
      return reply.status(201).send(task);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/tasks/:id/verify
   * Clinician/staff verification and activation
   */
  server.patch('/:id/verify', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = req.params;
      const actor = extractActor(req);
      const validated = VerifyTaskSchema.parse(req.body);
      const task = await TaskEngineService.verifyTask(id, validated, actor);
      return reply.send(task);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/tasks/:id/transition
   * Validated state transition
   */
  server.post('/:id/transition', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = req.params;
      const actor = extractActor(req);
      const validated = TransitionTaskSchema.parse(req.body);
      const task = await TaskEngineService.transitionState(id, validated, actor);
      return reply.send(task);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * GET /api/tasks/:id/audit-trail
   * Retrieve complete immutable audit log history
   */
  server.get('/:id/audit-trail', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = req.params;
      const auditTrail = await TaskEngineService.getAuditTrail(id);
      return reply.send(auditTrail);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/tasks/:id/contact-attempt
   * Record delivery attempt and apply contact failure rules
   */
  server.post('/:id/contact-attempt', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = req.params;
      const actor = extractActor(req);
      const validated = ContactAttemptSchema.parse(req.body);
      const attempt = await TaskEngineService.recordContactAttempt(id, validated, actor);
      return reply.status(201).send(attempt);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/tasks/:id/reschedule
   * Patient or staff reschedule request
   */
  server.post('/:id/reschedule', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = req.params;
      const actor = extractActor(req);
      const validated = RescheduleRequestSchema.parse(req.body);
      const task = await TaskEngineService.requestReschedule(id, validated, actor);
      return reply.send(task);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/tasks/check-overdue
   * Trigger background scan for overdue deadlines
   */
  server.post('/check-overdue', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const actor = extractActor(req);
      const result = await TaskEngineService.checkOverdueTasks(actor);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
