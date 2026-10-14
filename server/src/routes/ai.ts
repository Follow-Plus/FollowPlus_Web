import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AIExtractionService } from '../services/aiExtraction.service.js';

export const ExtractInstructionBodySchema = z.object({
  sourceInstructionText: z.string().optional(),
  text: z.string().optional(),
  instructionText: z.string().optional(),
  referenceDate: z.string().datetime().optional(),
}).refine(
  (data) => Boolean(data.sourceInstructionText?.trim() || data.text?.trim() || data.instructionText?.trim()),
  {
    message: 'sourceInstructionText, text, or instructionText must be provided as non-empty string',
  }
);

export async function aiRoutes(server: FastifyInstance) {
  /**
   * POST /api/ai/extract-instruction
   * Takes free-text clinical instructions, executes extraction and ambiguity detection,
   * validates source character spans, and returns structured follow-up parameters.
   */
  server.post('/extract-instruction', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsed = ExtractInstructionBodySchema.parse(req.body);
      const text = (parsed.sourceInstructionText || parsed.text || parsed.instructionText)!.trim();

      const referenceDate = parsed.referenceDate ? new Date(parsed.referenceDate) : undefined;
      const extraction = await AIExtractionService.extractInstruction(text, { referenceDate });

      return reply.send(extraction);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
