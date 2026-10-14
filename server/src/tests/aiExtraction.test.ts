process.env.NODE_ENV = 'test';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.js';
import {
  AIExtractionService,
  validateCharacterSpan,
  validateExtraction,
} from '../services/aiExtraction.service.js';
import { TaskState, UrgencyLevel } from '../types.js';

describe('Source-Grounded AI Extraction & Ambiguity Detection Service', () => {
  let app: FastifyInstance;
  const refDate = new Date('2026-10-14T00:00:00.000Z');

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  // ==========================================
  // AT-01: Valid Extraction with Source Spans
  // ==========================================
  it('AT-01: Extracts follow-up action, window dates, and exact source spans for clean instruction', async () => {
    const sourceText =
      'Patient is recovering well after laparoscopic appendectomy. Wound dressing intact. Follow-up wound healing check and suture removal in 10 to 14 days.';

    const result = await AIExtractionService.extractInstruction(sourceText, {
      referenceDate: refDate,
      preferLLM: false,
    });

    assert.equal(result.status, TaskState.PROPOSED_DRAFT);
    assert.equal(result.isAmbiguous, false);
    assert.equal(result.ambiguityReason, null);
    assert.equal(result.urgencyLevel, UrgencyLevel.STANDARD);

    // Follow-up action verification
    assert.match(result.followUpAction, /Wound healing check and suture removal/i);

    // Span verification: exact match with source substring
    assert.ok(result.spans.action);
    const actionSpan = result.spans.action;
    assert.equal(
      sourceText.substring(actionSpan.start, actionSpan.end),
      actionSpan.exactQuote
    );

    // Window span verification
    assert.ok(result.spans.window);
    const windowSpan = result.spans.window;
    assert.equal(
      sourceText.substring(windowSpan.start, windowSpan.end),
      windowSpan.exactQuote
    );
    assert.match(windowSpan.exactQuote, /10 to 14 days/);

    // Temporal date calculation
    assert.ok(result.windowStartDate);
    assert.ok(result.windowEndDate);
    const startDate = new Date(result.windowStartDate);
    const endDate = new Date(result.windowEndDate);

    // 10 days and 14 days from refDate
    assert.equal(startDate.toISOString(), new Date('2026-10-24T00:00:00.000Z').toISOString());
    assert.equal(endDate.toISOString(), new Date('2026-10-28T00:00:00.000Z').toISOString());
  });

  // ==========================================
  // AT-02: Missing Date Detection & Ambiguity Escalation
  // ==========================================
  it('AT-02: Escalates to ESCALATED_AMBIGUITY with MISSING_FOLLOWUP_WINDOW when timeframe is absent', async () => {
    const sourceText =
      'Patient with hypertension managed with ACE inhibitors. Follow up for blood pressure check.';

    const result = await AIExtractionService.extractInstruction(sourceText, {
      referenceDate: refDate,
      preferLLM: false,
    });

    assert.equal(result.status, TaskState.ESCALATED_AMBIGUITY);
    assert.equal(result.isAmbiguous, true);
    assert.equal(result.ambiguityReason, 'MISSING_FOLLOWUP_WINDOW');
    assert.equal(result.windowStartDate, null);
    assert.equal(result.windowEndDate, null);

    // Action is still captured and source-grounded
    assert.ok(result.spans.action);
    assert.equal(
      sourceText.substring(result.spans.action.start, result.spans.action.end),
      result.spans.action.exactQuote
    );
  });

  it('AT-02: Flags vague phrasing ("PRN") as ESCALATED_AMBIGUITY', async () => {
    const sourceText = 'Patient discharged home. Follow-up PRN if pain increases.';

    const result = await AIExtractionService.extractInstruction(sourceText, {
      referenceDate: refDate,
      preferLLM: false,
    });

    assert.equal(result.status, TaskState.ESCALATED_AMBIGUITY);
    assert.equal(result.isAmbiguous, true);
    assert.equal(result.ambiguityReason, 'VAGUE_FOLLOWUP_TIMEFRAME');
    assert.equal(result.windowStartDate, null);
    assert.equal(result.windowEndDate, null);

    // Ensure vague phrasing span is captured and verified
    assert.ok(result.spans.vaguePhrases);
    assert.ok(result.spans.vaguePhrases.length > 0);
    const prnSpan = result.spans.vaguePhrases[0];
    assert.equal(prnSpan.exactQuote, 'PRN');
    assert.equal(
      sourceText.substring(prnSpan.start, prnSpan.end),
      prnSpan.exactQuote
    );
  });

  it('AT-02: Flags vague phrasing ("as needed soon / whenever convenient") as ESCALATED_AMBIGUITY', async () => {
    const sourceText =
      'Mild asthma flare controlled. Patient should follow up as needed soon if wheezing recurs, or return whenever convenient.';

    const result = await AIExtractionService.extractInstruction(sourceText, {
      referenceDate: refDate,
      preferLLM: false,
    });

    assert.equal(result.status, TaskState.ESCALATED_AMBIGUITY);
    assert.equal(result.isAmbiguous, true);
    assert.equal(result.ambiguityReason, 'VAGUE_FOLLOWUP_TIMEFRAME');
    assert.equal(result.windowStartDate, null);
    assert.equal(result.windowEndDate, null);

    // Vague phrase spans verified
    assert.ok(result.spans.vaguePhrases);
    assert.ok(result.spans.vaguePhrases.length >= 2);
    for (const span of result.spans.vaguePhrases) {
      assert.equal(
        sourceText.substring(span.start, span.end),
        span.exactQuote
      );
    }
  });

  // ==========================================
  // AT-03: Conflicting Timeframe Detection
  // ==========================================
  it('AT-03: Flags conflicting timeframes ("in 2 weeks" vs "in 6 months") as ESCALATED_AMBIGUITY', async () => {
    const sourceText =
      'Discharge summary: Follow-up in 2 weeks for blood pressure and renal check. Addendum note: Patient clinically stable, return to outpatient clinic in 6 months.';

    const result = await AIExtractionService.extractInstruction(sourceText, {
      referenceDate: refDate,
      preferLLM: false,
    });

    assert.equal(result.status, TaskState.ESCALATED_AMBIGUITY);
    assert.equal(result.isAmbiguous, true);
    assert.equal(result.ambiguityReason, 'CONFLICTING_FOLLOWUP_WINDOWS');
    assert.equal(result.windowStartDate, null);
    assert.equal(result.windowEndDate, null);

    // Verify conflicting window spans are isolated and ground-truthed
    assert.ok(result.spans.conflictingWindows);
    assert.ok(result.spans.conflictingWindows.length >= 2);

    for (const w of result.spans.conflictingWindows) {
      assert.equal(
        sourceText.substring(w.start, w.end),
        w.exactQuote
      );
    }

    assert.equal(result.spans.conflictingWindows[0].exactQuote, 'in 2 weeks');
    assert.equal(result.spans.conflictingWindows[1].exactQuote, 'in 6 months');
  });

  it('AT-03: Flags short vs long conflicting intervals ("review in 3 days... see you in 1 month")', async () => {
    const sourceText = 'Follow-up review in 3 days... see you in 1 month for blood tests.';

    const result = await AIExtractionService.extractInstruction(sourceText, {
      referenceDate: refDate,
      preferLLM: false,
    });

    assert.equal(result.status, TaskState.ESCALATED_AMBIGUITY);
    assert.equal(result.isAmbiguous, true);
    assert.equal(result.ambiguityReason, 'CONFLICTING_FOLLOWUP_WINDOWS');
    assert.equal(result.windowStartDate, null);
    assert.equal(result.windowEndDate, null);

    assert.ok(result.spans.conflictingWindows);
    assert.equal(result.spans.conflictingWindows.length, 2);
    assert.equal(result.spans.conflictingWindows[0].exactQuote, 'in 3 days');
    assert.equal(result.spans.conflictingWindows[1].exactQuote, 'in 1 month');
  });

  // ==========================================
  // Strict Span Validation Guard
  // ==========================================
  it('Strict Span Validation: Rejects and catches offset mismatches', () => {
    const text = 'Follow-up wound healing check in 10 days.';

    // Correct span
    const validSpan = { start: 10, end: 29, exactQuote: 'wound healing check' };
    const validCheck = validateCharacterSpan(text, validSpan);
    assert.equal(validCheck.isValid, true);

    // Offset mismatch (shifted by 2 chars)
    const shiftedSpan = { start: 12, end: 31, exactQuote: 'wound healing check' };
    const shiftedCheck = validateCharacterSpan(text, shiftedSpan);
    assert.equal(shiftedCheck.isValid, false);
    assert.match(shiftedCheck.error ?? '', /Span mismatch/);

    // Out of bounds span
    const oobSpan = { start: 10, end: 100, exactQuote: 'wound healing check' };
    const oobCheck = validateCharacterSpan(text, oobSpan);
    assert.equal(oobCheck.isValid, false);
    assert.match(oobCheck.error ?? '', /out of range/);

    // validateExtraction catches nested mismatch
    const fullValidation = validateExtraction(text, {
      spans: {
        action: shiftedSpan,
      },
    });
    assert.equal(fullValidation.isValid, false);
    assert.equal(fullValidation.errors.length, 1);
  });

  // ==========================================
  // Clinician Urgency Explicit Designation
  // ==========================================
  it('Urgency: Sets CLINICIAN_URGENT only when clinician explicitly designates it', async () => {
    const urgentText =
      'CRITICAL ALERT: Urgent renal function panel, potassium monitoring, and surgical wound inspection required within 48 to 72 hours due to acute kidney injury risk.';

    const result = await AIExtractionService.extractInstruction(urgentText, {
      referenceDate: refDate,
      preferLLM: false,
    });

    assert.equal(result.urgencyLevel, UrgencyLevel.CLINICIAN_URGENT);
    assert.ok(result.spans.urgency);
    assert.equal(
      urgentText.substring(result.spans.urgency.start, result.spans.urgency.end),
      result.spans.urgency.exactQuote
    );

    // Standard instruction defaults to STANDARD
    const standardText = 'Routine follow-up in 2 weeks for blood pressure check.';
    const standardResult = await AIExtractionService.extractInstruction(standardText, {
      referenceDate: refDate,
      preferLLM: false,
    });
    assert.equal(standardResult.urgencyLevel, UrgencyLevel.STANDARD);
  });

  // ==========================================
  // HTTP Route Integration Tests (/api/ai/extract-instruction)
  // ==========================================
  it('HTTP POST /api/ai/extract-instruction: Returns 200 with structured proposal for valid text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/extract-instruction',
      payload: {
        sourceInstructionText: 'Post-op review and suture removal in 10 to 14 days.',
        referenceDate: refDate.toISOString(),
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, TaskState.PROPOSED_DRAFT);
    assert.equal(body.isAmbiguous, false);
    assert.ok(body.followUpAction);
    assert.ok(body.windowStartDate);
    assert.ok(body.windowEndDate);
    assert.ok(body.spans.action);
    assert.ok(body.spans.window);
  });

  it('HTTP POST /api/ai/extract-instruction: Returns 200 with ESCALATED_AMBIGUITY for missing date', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/extract-instruction',
      payload: {
        text: 'Routine asthma check follow-up required.',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, TaskState.ESCALATED_AMBIGUITY);
    assert.equal(body.isAmbiguous, true);
    assert.equal(body.ambiguityReason, 'MISSING_FOLLOWUP_WINDOW');
    assert.equal(body.windowStartDate, null);
    assert.equal(body.windowEndDate, null);
  });

  it('HTTP POST /api/ai/extract-instruction: Returns 200 with ESCALATED_AMBIGUITY for conflicting dates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/extract-instruction',
      payload: {
        sourceInstructionText: 'Follow-up in 2 weeks... return in 6 months',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, TaskState.ESCALATED_AMBIGUITY);
    assert.equal(body.isAmbiguous, true);
    assert.equal(body.ambiguityReason, 'CONFLICTING_FOLLOWUP_WINDOWS');
    assert.ok(body.spans.conflictingWindows);
    assert.equal(body.spans.conflictingWindows.length, 2);
  });

  it('HTTP POST /api/ai/extract-instruction: Returns 400 for empty instruction payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/extract-instruction',
      payload: {
        sourceInstructionText: '   ',
      },
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.ok(body.error);
  });
});
