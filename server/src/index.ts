import Fastify from 'fastify';
import cors from '@fastify/cors';
import { prisma } from './db.js';
import { taskRoutes } from './routes/tasks.js';
import { aiRoutes } from './routes/ai.js';
import { patientRoutes } from './routes/patient.js';
import { notificationRoutes } from './routes/notifications.js';

export async function buildApp(options: { logger?: boolean } = {}) {
  const isTest = process.env.NODE_ENV === 'test';
  const app = Fastify({
    logger: options.logger ?? (isTest ? false : true),
  });

  await app.register(cors, {
    origin: true,
  });

  app.get('/api/health', async () => {
    return {
      status: 'ok',
      service: 'FollowUp API',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/api/patients', async () => {
    return prisma.patient.findMany({
      include: {
        tasks: {
          include: {
            contactAttempts: true,
            auditLogs: true,
          },
        },
      },
    });
  });

  await app.register(taskRoutes, { prefix: '/api/tasks' });
  await app.register(aiRoutes, { prefix: '/api/ai' });
  await app.register(patientRoutes, { prefix: '/api/patient' });
  await app.register(patientRoutes, { prefix: '/api/patients' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });

  return app;
}

async function main() {
  const app = await buildApp();
  const port = Number(process.env.PORT) || 3001;
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`FollowUp Server listening at http://localhost:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}


// Only start the server when executed directly as entrypoint (not in tests)
const isTestMode =
  process.env.NODE_ENV === 'test' ||
  process.argv.some((arg) => arg.includes('test'));

if (!isTestMode) {
  main();
}

