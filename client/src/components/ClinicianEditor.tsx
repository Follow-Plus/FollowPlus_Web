import { useState, useEffect } from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  ShieldAlert,
  User,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { api } from '../services/api';
import { Patient, ExtractionResult, UrgencyLevel } from '../types';

const PRESET_SCENARIOS = [
  {
    name: 'Clean Post-Op Suture Removal (Valid 10-14 days)',
    text: 'Patient is recovering well after laparoscopic appendectomy. Wound dressing intact. Follow-up wound healing check and suture removal in 10 to 14 days.',
  },
  {
    name: 'Clinician-Urgent AKI Risk (Within 48 to 72 hours)',
    text: 'CRITICAL ALERT: Urgent renal function panel, potassium monitoring, and surgical wound inspection required within 48 to 72 hours due to acute kidney injury risk.',
  },
  {
    name: 'AT-02: Missing Date (Unbounded Follow-Up)',
    text: 'Patient with hypertension managed with ACE inhibitors. Discharged clinically stable. Follow up for blood pressure check.',
  },
  {
    name: 'AT-02: Vague Phrasing (PRN & As Needed Soon)',
    text: 'Mild asthma flare controlled. Patient should follow up as needed soon if wheezing recurs, or return whenever convenient.',
  },
  {
    name: 'AT-03: Conflicting Timeframes (2 weeks vs 6 months)',
    text: 'Discharge summary: Follow-up in 2 weeks for blood pressure and renal check. Addendum note: Patient clinically stable, return to outpatient clinic in 6 months.',
  },
];

function formatDateForInput(isoString?: string | null): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

export function ClinicianEditor({ onTaskCreated }: { onTaskCreated?: () => void }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [sourceText, setSourceText] = useState<string>(PRESET_SCENARIOS[0].text);
  const [extracting, setExtracting] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);

  // Structured form state
  const [followUpAction, setFollowUpAction] = useState<string>('');
  const [windowStart, setWindowStart] = useState<string>('');
  const [windowEnd, setWindowEnd] = useState<string>('');
  const [urgencyLevel, setUrgencyLevel] = useState<UrgencyLevel>('STANDARD');
  const [clinicianNotes, setClinicianNotes] = useState<string>('');
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  useEffect(() => {
    api
      .getPatients()
      .then((data) => {
        setPatients(data);
        if (data.length > 0 && !selectedPatientId) {
          setSelectedPatientId(data[0].id);
        }
      })
      .catch((err) => console.error('Failed to load patients', err));
  }, []);

  // Run extraction on load or trigger
  const handleExtract = async () => {
    if (!sourceText.trim()) return;
    setExtracting(true);
    setFeedbackMessage(null);

    try {
      const result = await api.extractInstruction(sourceText);
      setExtractionResult(result);

      // Populate structured form from extracted values
      setFollowUpAction(result.followUpAction || '');
      setWindowStart(formatDateForInput(result.windowStartDate));
      setWindowEnd(formatDateForInput(result.windowEndDate));
      setUrgencyLevel(result.urgencyLevel);
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: `Extraction failed: ${err.message}` });
    } finally {
      setExtracting(false);
    }
  };

  // Build segmented highlighted text
  const renderHighlightedText = (): React.ReactNode => {
    if (!extractionResult || !sourceText) {
      return <p className="text-slate-600 italic whitespace-pre-wrap">{sourceText}</p>;
    }

    interface Interval {
      start: number;
      end: number;
      type: 'action' | 'window' | 'urgency' | 'conflict' | 'vague';
      label: string;
      exactQuote: string;
    }

    const intervals: Interval[] = [];
    const spans = extractionResult.spans;

    if (spans.action) {
      intervals.push({
        start: spans.action.start,
        end: spans.action.end,
        type: 'action',
        label: 'Action',
        exactQuote: spans.action.exactQuote,
      });
    }

    if (spans.window) {
      intervals.push({
        start: spans.window.start,
        end: spans.window.end,
        type: 'window',
        label: 'Timeframe',
        exactQuote: spans.window.exactQuote,
      });
    }

    if (spans.urgency) {
      intervals.push({
        start: spans.urgency.start,
        end: spans.urgency.end,
        type: 'urgency',
        label: 'Urgency',
        exactQuote: spans.urgency.exactQuote,
      });
    }

    if (spans.conflictingWindows) {
      spans.conflictingWindows.forEach((cw, idx) => {
        intervals.push({
          start: cw.start,
          end: cw.end,
          type: 'conflict',
          label: `Conflict #${idx + 1}`,
          exactQuote: cw.exactQuote,
        });
      });
    }

    if (spans.vaguePhrases) {
      spans.vaguePhrases.forEach((vp) => {
        intervals.push({
          start: vp.start,
          end: vp.end,
          type: 'vague',
          label: 'Vague Phrase',
          exactQuote: vp.exactQuote,
        });
      });
    }

    // Sort intervals by start offset
    intervals.sort((a, b) => a.start - b.start);

    const segments: React.ReactNode[] = [];
    let cursor = 0;

    for (let i = 0; i < intervals.length; i++) {
      const it = intervals[i];
      if (it.start < cursor) continue; // Skip overlapping for rendering safety

      // Add preceding plain text
      if (it.start > cursor) {
        segments.push(
          <span key={`plain-${cursor}`}>{sourceText.substring(cursor, it.start)}</span>
        );
      }

      // Add highlighted span with tooltip badge
      let styleClass = 'bg-sky-100 text-sky-900 border-sky-300';
      if (it.type === 'window') styleClass = 'bg-emerald-100 text-emerald-950 border-emerald-300';
      if (it.type === 'urgency') styleClass = 'bg-rose-100 text-rose-950 border-rose-300 font-semibold';
      if (it.type === 'conflict') styleClass = 'bg-purple-100 text-purple-950 border-purple-300';
      if (it.type === 'vague') styleClass = 'bg-amber-100 text-amber-950 border-amber-300 font-medium';

      segments.push(
        <mark
          key={`span-${it.start}-${it.end}`}
          className={`px-1.5 py-0.5 rounded border ${styleClass} transition-all inline-block my-0.5`}
          title={`[${it.label}]: "${it.exactQuote}" (${it.start}..${it.end})`}
        >
          {sourceText.substring(it.start, it.end)}
          <span className="text-[10px] ml-1 uppercase font-mono px-1 py-0.2 bg-white/70 rounded border border-black/10">
            {it.label}
          </span>
        </mark>
      );

      cursor = it.end;
    }

    if (cursor < sourceText.length) {
      segments.push(<span key={`plain-end`}>{sourceText.substring(cursor)}</span>);
    }

    return <div className="leading-relaxed whitespace-pre-wrap">{segments}</div>;
  };

  const handleCreateTask = async (shouldVerify: boolean) => {
    if (!selectedPatientId) {
      setFeedbackMessage({ type: 'error', text: 'Please select a patient' });
      return;
    }
    if (!followUpAction.trim()) {
      setFeedbackMessage({ type: 'error', text: 'Follow-up action is required' });
      return;
    }

    setSubmitting(true);
    setFeedbackMessage(null);

    try {
      const draft = await api.createTask(
        {
          patientId: selectedPatientId,
          sourceInstructionText: sourceText,
          extractedSpanJson: extractionResult?.extractedSpanJson,
          followUpAction,
          windowStartDate: windowStart ? new Date(windowStart).toISOString() : null,
          windowEndDate: windowEnd ? new Date(windowEnd).toISOString() : null,
          urgencyLevel,
        },
        { role: 'CLINICIAN', id: 'dr-current-clinician' }
      );

      if (shouldVerify) {
        // Attempt immediate verification
        await api.verifyTask(
          draft.id,
          {
            followUpAction,
            windowStartDate: windowStart ? new Date(windowStart).toISOString() : null,
            windowEndDate: windowEnd ? new Date(windowEnd).toISOString() : null,
            urgencyLevel,
            notes: clinicianNotes,
          },
          { role: 'CLINICIAN', id: 'dr-current-clinician' }
        );
      }

      setFeedbackMessage({
        type: 'success',
        text: `Task successfully ${shouldVerify ? 'verified & coordinated' : 'saved as draft'}! Task ID: ${draft.id}`,
      });

      if (onTaskCreated) onTaskCreated();
    } catch (err: any) {
      setFeedbackMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPatient = patients.find((p) => p.id === selectedPatientId);

  return (
    <div className="space-y-6">
      {/* Clinician Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-sky-700" />
            Clinician Follow-Up Order & Extraction Console
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Free-text clinical notes are extracted with character-level source span traceability and strict ambiguity guards.
          </p>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">Load Preset Scenario:</span>
          <select
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            onChange={(e) => {
              const idx = parseInt(e.target.value, 10);
              if (!isNaN(idx)) {
                setSourceText(PRESET_SCENARIOS[idx].text);
                setExtractionResult(null);
                setFeedbackMessage(null);
              }
            }}
          >
            {PRESET_SCENARIOS.map((s, idx) => (
              <option key={idx} value={idx}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {feedbackMessage && (
        <div
          className={`p-4 rounded-xl border text-sm font-medium flex items-center gap-3 ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200'
          }`}
        >
          {feedbackMessage.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0" />
          )}
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      {/* Main Two-Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Panel: Free-Text Note & Traceability Highlighting */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <span>Free-Text Clinical Instruction Note</span>
              </label>
              <button
                type="button"
                onClick={handleExtract}
                disabled={extracting || !sourceText.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-700 text-white rounded-lg text-xs font-semibold hover:bg-sky-800 transition-colors disabled:opacity-50"
              >
                {extracting ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-sky-200" />
                )}
                {extracting ? 'Extracting Spans...' : 'Extract Follow-Up Plan'}
              </button>
            </div>

            <textarea
              rows={5}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Enter clinician discharge instructions or post-operative follow-up notes..."
              className="w-full text-xs font-mono p-3 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white text-slate-800"
            />

            {/* Interactive Source Span Highlighting Display */}
            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/70 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-sky-700" />
                  Character-Level Source Span Grounding
                </span>
                <span className="text-[11px] text-slate-500">
                  {extractionResult ? 'Traceability spans verified' : 'Click "Extract" to view spans'}
                </span>
              </div>

              <div className="text-xs text-slate-800 min-h-[90px]">{renderHighlightedText()}</div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 text-[10px] text-slate-600">
                <span className="font-semibold text-slate-500">Legend:</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-300">
                  Follow-Up Action
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Target Timeframe
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 font-medium">
                  Clinician Urgency
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                  Vague Phrasing
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-300">
                  Conflicting Timeframe
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Structured Extraction & Ambiguity Guard */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-2 flex items-center justify-between">
              <span>Structured Follow-Up Order</span>
              {extractionResult && (
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                    extractionResult.isAmbiguous
                      ? 'bg-amber-100 text-amber-800 border-amber-200'
                      : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                  }`}
                >
                  {extractionResult.status}
                </span>
              )}
            </h3>

            {/* Ambiguity Alert Banner */}
            {extractionResult && extractionResult.isAmbiguous && (
              <div className="bg-amber-50 border border-amber-300 p-4 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                  <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                  <span>Ambiguity Blocking Activated: {extractionResult.ambiguityReason}</span>
                </div>
                <p className="text-xs text-amber-800">
                  {extractionResult.ambiguityReason === 'MISSING_FOLLOWUP_WINDOW' &&
                    'The clinical note does not designate concrete start/end window dates. Automatic scheduling is blocked until a valid timeframe is set.'}
                  {extractionResult.ambiguityReason === 'VAGUE_FOLLOWUP_TIMEFRAME' &&
                    'Vague temporal phrasing (e.g., "PRN", "as needed", or "soon") prevents deterministic scheduling. Human review is required.'}
                  {extractionResult.ambiguityReason === 'CONFLICTING_FOLLOWUP_WINDOWS' &&
                    'Multiple incompatible timeframes were detected in the note. Clinician must resolve the conflict before outpatient booking.'}
                  {extractionResult.ambiguityReason === 'SPAN_MISMATCH' &&
                    'Extracted span offsets did not match the original clinical note string.'}
                </p>
                <div className="text-[11px] font-semibold text-amber-900 pt-1 border-t border-amber-200/80">
                  Action Required: Adjust the window dates below or save as an Escalated Ambiguity task for staff triage.
                </div>
              </div>
            )}

            {/* Patient Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-slate-500" />
                <span>Target Outpatient</span>
              </label>
              <select
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} (MRN: {p.mrn}) — {p.primaryPhone} {p.isSharedPhone ? '[Shared Phone]' : ''}
                  </option>
                ))}
              </select>

              {selectedPatient?.isSharedPhone && (
                <div className="text-[11px] bg-amber-50 text-amber-800 border border-amber-200 p-2 rounded-lg font-medium flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                  <span>
                    Shared phone registered without sensitive consent: neutral scheduling language will be enforced on dispatch.
                  </span>
                </div>
              )}
            </div>

            {/* Follow-Up Action */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Follow-Up Clinical Action</label>
              <input
                type="text"
                value={followUpAction}
                onChange={(e) => setFollowUpAction(e.target.value)}
                placeholder="e.g., Wound healing check and suture removal"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Window Start & End Dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-slate-500" />
                  <span>Window Start Date</span>
                </label>
                <input
                  type="datetime-local"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-slate-500" />
                  <span>Window End Date</span>
                </label>
                <input
                  type="datetime-local"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            {/* Urgency Level */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>Clinician Urgency Designation</span>
                <span className="text-[11px] text-slate-500 font-normal">Separated from admin lateness</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setUrgencyLevel('STANDARD')}
                  className={`p-2.5 text-xs font-semibold rounded-lg border text-center transition-all ${
                    urgencyLevel === 'STANDARD'
                      ? 'bg-sky-50 text-sky-800 border-sky-400 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  STANDARD
                </button>
                <button
                  type="button"
                  onClick={() => setUrgencyLevel('CLINICIAN_URGENT')}
                  className={`p-2.5 text-xs font-semibold rounded-lg border text-center transition-all ${
                    urgencyLevel === 'CLINICIAN_URGENT'
                      ? 'bg-rose-100 text-rose-800 border-rose-400 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  CLINICIAN_URGENT
                </button>
              </div>
            </div>

            {/* Optional Clinician Note */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Verification Notes (Optional)</label>
              <input
                type="text"
                value={clinicianNotes}
                onChange={(e) => setClinicianNotes(e.target.value)}
                placeholder="Internal instructions for hospital coordination staff..."
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* Submission Actions */}
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="button"
                onClick={() => handleCreateTask(true)}
                disabled={submitting || (!windowStart && !windowEnd && !extractionResult?.isAmbiguous)}
                className="w-full sm:flex-1 py-2.5 px-4 bg-sky-700 text-white rounded-lg text-xs font-bold hover:bg-sky-800 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Create & Verify Task</span>
              </button>

              <button
                type="button"
                onClick={() => handleCreateTask(false)}
                disabled={submitting}
                className="w-full sm:w-auto py-2.5 px-4 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-bold border border-slate-200 transition-colors disabled:opacity-50"
              >
                Save as Draft
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
