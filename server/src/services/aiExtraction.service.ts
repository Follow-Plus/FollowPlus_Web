import { TaskState, UrgencyLevel } from '../types.js';

export interface CharacterSpan {
  start: number;
  end: number;
  exactQuote: string;
  text?: string;
}

export interface ExtractedSpanJsonData {
  action?: CharacterSpan;
  window?: CharacterSpan | null;
  urgency?: CharacterSpan;
  conflictingWindows?: CharacterSpan[];
  vaguePhrases?: CharacterSpan[];
}

export interface ExtractionResult {
  status: TaskState;
  isAmbiguous: boolean;
  ambiguityReason: string | null;
  followUpAction: string;
  windowStartDate: string | null;
  windowEndDate: string | null;
  urgencyLevel: UrgencyLevel;
  extractedSpanJson: string;
  spans: ExtractedSpanJsonData;
  spanMismatch?: boolean;
}

export interface ExtractionOptions {
  referenceDate?: Date;
  preferLLM?: boolean;
}

interface WindowCandidate {
  span: CharacterSpan;
  startDays: number;
  endDays: number;
  rawText: string;
}

/**
 * Validates that a CharacterSpan precisely matches the source text at the specified offsets.
 */
export function validateCharacterSpan(
  sourceText: string,
  span?: CharacterSpan | null
): { isValid: boolean; error?: string } {
  if (!span) return { isValid: true };

  if (typeof span.start !== 'number' || typeof span.end !== 'number') {
    return { isValid: false, error: 'Span start and end must be numbers' };
  }

  if (span.start < 0 || span.end > sourceText.length || span.start > span.end) {
    return {
      isValid: false,
      error: `Span bounds [${span.start}, ${span.end}] out of range for source text length ${sourceText.length}`,
    };
  }

  const quote = span.exactQuote ?? span.text ?? '';
  const actualSubstring = sourceText.substring(span.start, span.end);

  if (actualSubstring !== quote) {
    return {
      isValid: false,
      error: `Span mismatch: exactQuote '${quote}' does not match source substring '${actualSubstring}' at [${span.start}, ${span.end}]`,
    };
  }

  return { isValid: true };
}

/**
 * Validates all character spans in an extraction result against the source instruction text.
 */
export function validateExtraction(
  sourceText: string,
  extraction: { spans?: ExtractedSpanJsonData }
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const spans = extraction.spans;
  if (!spans) return { isValid: true, errors: [] };

  if (spans.action) {
    const v = validateCharacterSpan(sourceText, spans.action);
    if (!v.isValid && v.error) errors.push(v.error);
  }

  if (spans.window) {
    const v = validateCharacterSpan(sourceText, spans.window);
    if (!v.isValid && v.error) errors.push(v.error);
  }

  if (spans.urgency) {
    const v = validateCharacterSpan(sourceText, spans.urgency);
    if (!v.isValid && v.error) errors.push(v.error);
  }

  if (spans.conflictingWindows) {
    for (const cw of spans.conflictingWindows) {
      const v = validateCharacterSpan(sourceText, cw);
      if (!v.isValid && v.error) errors.push(v.error);
    }
  }

  if (spans.vaguePhrases) {
    for (const vp of spans.vaguePhrases) {
      const v = validateCharacterSpan(sourceText, vp);
      if (!v.isValid && v.error) errors.push(v.error);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export class AIExtractionService {
  /**
   * Main entrypoint: Extracts follow-up parameters and applies ambiguity and span validation guards.
   */
  public static async extractInstruction(
    sourceInstructionText: string,
    options: ExtractionOptions = {}
  ): Promise<ExtractionResult> {
    const text = sourceInstructionText || '';
    const refDate = options.referenceDate ?? new Date();

    // Check if an external LLM is configured (OpenAI or Groq) and allowed
    const hasApiKey = Boolean(process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY);
    const allowLLM = options.preferLLM !== false && process.env.MOCK_AI !== 'true' && hasApiKey;

    let result: ExtractionResult;

    if (allowLLM) {
      try {
        result = await this.extractWithLLM(text, refDate);
      } catch (err) {
        // Fall back deterministically if LLM call fails
        result = this.deterministicExtract(text, refDate);
      }
    } else {
      result = this.deterministicExtract(text, refDate);
    }

    // Strict validation guard: Character span verification
    const validation = validateExtraction(text, result);
    if (!validation.isValid) {
      result.status = TaskState.ESCALATED_AMBIGUITY;
      result.isAmbiguous = true;
      result.ambiguityReason = 'SPAN_MISMATCH';
      result.spanMismatch = true;
    }

    return result;
  }

  /**
   * LLM API extraction with JSON structured output and character offset validation.
   */
  private static async extractWithLLM(sourceText: string, refDate: Date): Promise<ExtractionResult> {
    const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
    const isGroq = Boolean(process.env.GROQ_API_KEY);
    const url = isGroq
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const model = isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

    const systemPrompt = `You are a clinical extraction assistant.
Extract structured follow-up instructions strictly grounded in the clinician's notes.
Return JSON with this schema:
{
  "followUpAction": string,
  "actionSpan": { "start": number, "end": number, "exactQuote": string },
  "urgencyLevel": "STANDARD" | "CLINICIAN_URGENT",
  "urgencySpan": { "start": number, "end": number, "exactQuote": string } | null,
  "windowSpan": { "start": number, "end": number, "exactQuote": string } | null,
  "startDaysFromNow": number | null,
  "endDaysFromNow": number | null,
  "conflictingWindows": Array<{ "start": number, "end": number, "exactQuote": string }>,
  "vaguePhrases": Array<{ "start": number, "end": number, "exactQuote": string }>
}
Crucial: Every start/end index must strictly satisfy text.substring(start, end) === exactQuote.`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: sourceText },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API returned status ${response.status}`);
    }

    const payload: any = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);

    // Build ExtractionResult from LLM JSON
    const spans: ExtractedSpanJsonData = {};

    if (parsed.actionSpan) {
      spans.action = {
        start: parsed.actionSpan.start,
        end: parsed.actionSpan.end,
        exactQuote: parsed.actionSpan.exactQuote,
        text: parsed.actionSpan.exactQuote,
      };
    }

    if (parsed.windowSpan) {
      spans.window = {
        start: parsed.windowSpan.start,
        end: parsed.windowSpan.end,
        exactQuote: parsed.windowSpan.exactQuote,
        text: parsed.windowSpan.exactQuote,
      };
    }

    if (parsed.urgencySpan) {
      spans.urgency = {
        start: parsed.urgencySpan.start,
        end: parsed.urgencySpan.end,
        exactQuote: parsed.urgencySpan.exactQuote,
        text: parsed.urgencySpan.exactQuote,
      };
    }

    if (Array.isArray(parsed.conflictingWindows) && parsed.conflictingWindows.length > 0) {
      spans.conflictingWindows = parsed.conflictingWindows.map((w: any) => ({
        start: w.start,
        end: w.end,
        exactQuote: w.exactQuote,
        text: w.exactQuote,
      }));
    }

    if (Array.isArray(parsed.vaguePhrases) && parsed.vaguePhrases.length > 0) {
      spans.vaguePhrases = parsed.vaguePhrases.map((v: any) => ({
        start: v.start,
        end: v.end,
        exactQuote: v.exactQuote,
        text: v.exactQuote,
      }));
    }

    // Check ambiguity flags
    const hasConflictingWindows = spans.conflictingWindows && spans.conflictingWindows.length > 1;
    const hasVaguePhrases = spans.vaguePhrases && spans.vaguePhrases.length > 0;
    const hasMissingWindow = !spans.window && !hasConflictingWindows;

    let status = TaskState.PROPOSED_DRAFT;
    let ambiguityReason: string | null = null;
    let isAmbiguous = false;

    if (hasConflictingWindows) {
      status = TaskState.ESCALATED_AMBIGUITY;
      isAmbiguous = true;
      ambiguityReason = 'CONFLICTING_FOLLOWUP_WINDOWS';
    } else if (hasVaguePhrases) {
      status = TaskState.ESCALATED_AMBIGUITY;
      isAmbiguous = true;
      ambiguityReason = 'VAGUE_FOLLOWUP_TIMEFRAME';
    } else if (hasMissingWindow) {
      status = TaskState.ESCALATED_AMBIGUITY;
      isAmbiguous = true;
      ambiguityReason = 'MISSING_FOLLOWUP_WINDOW';
    }

    let windowStartDate: string | null = null;
    let windowEndDate: string | null = null;

    if (!isAmbiguous && parsed.startDaysFromNow != null && parsed.endDaysFromNow != null) {
      windowStartDate = new Date(refDate.getTime() + parsed.startDaysFromNow * 86400000).toISOString();
      windowEndDate = new Date(refDate.getTime() + parsed.endDaysFromNow * 86400000).toISOString();
    }

    return {
      status,
      isAmbiguous,
      ambiguityReason,
      followUpAction: parsed.followUpAction || 'Clinical follow-up',
      windowStartDate,
      windowEndDate,
      urgencyLevel: parsed.urgencyLevel === 'CLINICIAN_URGENT' ? UrgencyLevel.CLINICIAN_URGENT : UrgencyLevel.STANDARD,
      extractedSpanJson: JSON.stringify(spans),
      spans,
    };
  }

  /**
   * Deterministic mock extractor with 100% exact character-offset source grounding and ambiguity guards.
   */
  public static deterministicExtract(sourceText: string, refDate: Date = new Date()): ExtractionResult {
    const text = sourceText || '';
    const spans: ExtractedSpanJsonData = {};

    // 1. Detect Clinician Urgency
    const urgency = this.detectUrgency(text);
    if (urgency.span) {
      spans.urgency = urgency.span;
    }

    // 2. Detect Vague Phrasing (e.g. PRN, as needed, soon, whenever convenient)
    const vaguePhrases = this.detectVaguePhrases(text);
    if (vaguePhrases.length > 0) {
      spans.vaguePhrases = vaguePhrases;
    }

    // 3. Detect Temporal Windows
    const candidates = this.findTemporalWindowCandidates(text);

    // 4. Extract Follow-Up Action and Span
    const actionResult = this.detectFollowUpAction(text);
    if (actionResult.span) {
      spans.action = actionResult.span;
    }

    // 5. Evaluate Ambiguity and Conflict Guards
    let status = TaskState.PROPOSED_DRAFT;
    let isAmbiguous = false;
    let ambiguityReason: string | null = null;
    let windowStartDate: string | null = null;
    let windowEndDate: string | null = null;

    // Guard A: Conflicting timeframes
    const hasConflictingWindows = this.checkConflictingWindows(candidates);
    if (hasConflictingWindows) {
      status = TaskState.ESCALATED_AMBIGUITY;
      isAmbiguous = true;
      ambiguityReason = 'CONFLICTING_FOLLOWUP_WINDOWS';
      spans.conflictingWindows = candidates.map((c) => c.span);
    }
    // Guard B: Vague phrasing presence (PRN, as needed, soon)
    else if (vaguePhrases.length > 0) {
      status = TaskState.ESCALATED_AMBIGUITY;
      isAmbiguous = true;
      ambiguityReason = 'VAGUE_FOLLOWUP_TIMEFRAME';
      if (candidates.length > 0) {
        spans.window = candidates[0].span;
      }
    }
    // Guard C: Missing explicit timeframe
    else if (candidates.length === 0) {
      status = TaskState.ESCALATED_AMBIGUITY;
      isAmbiguous = true;
      ambiguityReason = 'MISSING_FOLLOWUP_WINDOW';
    }
    // Valid single / compatible window
    else {
      const activeWindow = candidates[0];
      spans.window = activeWindow.span;
      windowStartDate = new Date(refDate.getTime() + activeWindow.startDays * 86400000).toISOString();
      windowEndDate = new Date(refDate.getTime() + activeWindow.endDays * 86400000).toISOString();
    }

    return {
      status,
      isAmbiguous,
      ambiguityReason,
      followUpAction: actionResult.actionName,
      windowStartDate,
      windowEndDate,
      urgencyLevel: urgency.urgencyLevel,
      extractedSpanJson: JSON.stringify(spans),
      spans,
    };
  }

  /**
   * Detects clinician urgency markers and exact span.
   */
  private static detectUrgency(text: string): { urgencyLevel: UrgencyLevel; span?: CharacterSpan } {
    // Only clinician explicit designation can set CLINICIAN_URGENT
    const urgentRegex = /\b(CRITICAL\s+ALERT(?::\s*Urgent)?|STAT|URGENT|urgent|EMERGENCY|immediately|high\s+priority)\b/i;
    const match = text.match(urgentRegex);

    if (match && match.index !== undefined) {
      const start = match.index;
      const exactQuote = match[0];
      const end = start + exactQuote.length;

      return {
        urgencyLevel: UrgencyLevel.CLINICIAN_URGENT,
        span: {
          start,
          end,
          exactQuote,
          text: exactQuote,
        },
      };
    }

    return {
      urgencyLevel: UrgencyLevel.STANDARD,
    };
  }

  /**
   * Detects vague temporal phrasing such as "PRN", "as needed", "soon", etc.
   */
  private static detectVaguePhrases(text: string): CharacterSpan[] {
    const vagueRegex = /\b(PRN|p\.r\.n\.|as needed|soon|whenever convenient|when convenient|if needed|if wheezing recurs|whenever possible|at your convenience)\b/gi;
    const spans: CharacterSpan[] = [];
    let match: RegExpExecArray | null;

    while ((match = vagueRegex.exec(text)) !== null) {
      const start = match.index;
      const exactQuote = match[0];
      const end = start + exactQuote.length;

      spans.push({
        start,
        end,
        exactQuote,
        text: exactQuote,
      });
    }

    return spans;
  }

  /**
   * Locates all temporal windows and computes candidate start/end days.
   */
  private static findTemporalWindowCandidates(text: string): WindowCandidate[] {
    const candidates: WindowCandidate[] = [];
    const seenIndices = new Set<string>();

    const addCandidate = (start: number, end: number, startDays: number, endDays: number) => {
      const key = `${start}-${end}`;
      if (seenIndices.has(key)) return;
      seenIndices.add(key);

      const exactQuote = text.substring(start, end);
      candidates.push({
        span: {
          start,
          end,
          exactQuote,
          text: exactQuote,
        },
        startDays,
        endDays,
        rawText: exactQuote,
      });
    };

    // Pattern 1: Range expressions, e.g., "in 10 to 14 days", "within 48 to 72 hours", "in 1 to 2 weeks", "in 1-2 weeks"
    const rangeRegex = /(?:in|within|after)?\s*(\d+)\s*(?:to|-)\s*(\d+)\s*(hours?|hrs?|days?|weeks?|wks?|months?|mths?|years?|yrs?)\b/gi;
    let match: RegExpExecArray | null;

    while ((match = rangeRegex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const num1 = parseInt(match[1], 10);
      const num2 = parseInt(match[2], 10);
      const unit = match[3].toLowerCase();

      const mult = this.getUnitDaysMultiplier(unit);
      addCandidate(start, end, num1 * mult, num2 * mult);
    }

    // Pattern 2: Single duration expressions, e.g., "in 2 weeks", "in 3 days", "in 6 months", "within 24 hours", "in 1 month"
    const singleRegex = /(?:in|within|after)\s+(\d+)\s+(hours?|hrs?|days?|weeks?|wks?|months?|mths?|years?|yrs?)\b/gi;

    while ((match = singleRegex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Ensure not part of an already matched range
      let isSubsumed = false;
      for (const c of candidates) {
        if (start >= c.span.start && end <= c.span.end) {
          isSubsumed = true;
          break;
        }
      }

      if (!isSubsumed) {
        const num = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        const mult = this.getUnitDaysMultiplier(unit);
        addCandidate(start, end, num * mult, num * mult);
      }
    }

    return candidates;
  }

  private static getUnitDaysMultiplier(unit: string): number {
    if (unit.startsWith('hour') || unit.startsWith('hr')) return 1 / 24;
    if (unit.startsWith('day')) return 1;
    if (unit.startsWith('week') || unit.startsWith('wk')) return 7;
    if (unit.startsWith('month') || unit.startsWith('mth')) return 30;
    if (unit.startsWith('year') || unit.startsWith('yr')) return 365;
    return 1;
  }

  /**
   * Checks if multiple candidate windows conflict with each other.
   */
  private static checkConflictingWindows(candidates: WindowCandidate[]): boolean {
    if (candidates.length < 2) return false;

    const first = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
      const other = candidates[i];
      // If start dates differ by more than 3 days, or ratio > 1.5, consider incompatible
      const diffStart = Math.abs(first.startDays - other.startDays);
      const diffEnd = Math.abs(first.endDays - other.endDays);

      if (diffStart > 3 || diffEnd > 3) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extracts the follow-up clinical action and its character span.
   */
  private static detectFollowUpAction(text: string): { actionName: string; span?: CharacterSpan } {
    // Known clinical actions prioritized for exact substring match
    const knownActions = [
      'wound healing check and suture removal',
      'Wound healing check and suture removal',
      'suture removal',
      'Suture removal',
      'wound inspection and suture removal',
      'Wound inspection and suture removal',
      'wound inspection',
      'Wound inspection',
      'wound check',
      'Wound check',
      'oncology histology pathology review',
      'Oncology histology pathology review',
      'pathology review',
      'Review femoral access site and titration of beta blockers',
      'femoral access site and titration of beta blockers',
      'titration of beta blockers',
      'Urgent renal function panel, potassium monitoring, and surgical wound inspection',
      'renal function panel, potassium monitoring, and surgical wound inspection',
      'renal function panel',
      'blood pressure and renal check',
      'Blood pressure and renal check',
      'blood pressure check',
      'Blood pressure check',
      'HbA1c test',
      'hba1c test',
      'diabetes check',
      'Asthma flare follow-up',
      'asthma flare follow-up',
      'follow up as needed soon',
      'cardiology consultation',
      'consultation',
      'Consultation',
      'routine review',
      'Routine review',
      'review',
      'Review',
    ];

    for (const phrase of knownActions) {
      const idx = text.indexOf(phrase);
      if (idx !== -1) {
        const start = idx;
        const exactQuote = phrase;
        const end = start + exactQuote.length;

        // Capitalize for display
        const display = phrase.charAt(0).toUpperCase() + phrase.slice(1);
        return {
          actionName: display,
          span: {
            start,
            end,
            exactQuote,
            text: exactQuote,
          },
        };
      }
    }

    // Pattern-based extraction: e.g., "Follow-up <action> in/within..."
    const actionRegexes = [
      /(?:follow-?up\s+(?:for\s+)?|schedule\s+|book\s+|order\s+)([^,.;\n]+?)(?:\s+(?:in|within|after|at|by|\d)\b|\.|\n|$)/i,
      /(?:for\s+)([^,.;\n]+?)(?:\s+(?:in|within|after|at|by|\d)\b|\.|\n|$)/i,
      /(?:urgent\s+|stat\s+)([^,.;\n]+?)(?:\s+(?:required|needed)?\s+(?:in|within|after)\b|\.|\n|$)/i,
    ];

    for (const regex of actionRegexes) {
      const match = text.match(regex);
      if (match && match[1]) {
        const rawAction = match[1].trim();
        const idx = text.indexOf(rawAction);
        if (idx !== -1 && rawAction.length >= 3) {
          const start = idx;
          const exactQuote = rawAction;
          const end = start + exactQuote.length;
          const display = rawAction.charAt(0).toUpperCase() + rawAction.slice(1);

          return {
            actionName: display,
            span: {
              start,
              end,
              exactQuote,
              text: exactQuote,
            },
          };
        }
      }
    }

    // Fallback: If "follow up" is anywhere in text, span "follow up"
    const fallbackMatch = text.match(/\b(follow-?up)\b/i);
    if (fallbackMatch && fallbackMatch.index !== undefined) {
      const start = fallbackMatch.index;
      const exactQuote = fallbackMatch[0];
      const end = start + exactQuote.length;
      return {
        actionName: 'Follow-up consultation',
        span: {
          start,
          end,
          exactQuote,
          text: exactQuote,
        },
      };
    }

    return {
      actionName: 'Clinical follow-up',
    };
  }
}
