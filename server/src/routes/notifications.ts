import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { NotificationService } from '../services/notification.service.js';
import { ContactChannelSchema } from '../types.js';

export const SimulateNotificationBodySchema = z.object({
  taskId: z.string().min(1, 'taskId is required'),
  channel: ContactChannelSchema.optional(),
  simulateFailure: z.boolean().optional(),
});

export async function notificationRoutes(server: FastifyInstance) {
  /**
   * POST /api/notifications/simulate
   * Triggers consent-aware outbound notice simulation and logs outcome
   */
  server.post('/simulate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const validated = SimulateNotificationBodySchema.parse(req.body);
      const result = await NotificationService.dispatchNotification(validated.taskId, {
        channel: validated.channel,
        simulateFailure: validated.simulateFailure,
      });

      return reply.send({
        success: true,
        ...result,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
