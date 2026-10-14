import { useState, useEffect } from 'react';
import {
  User,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Send,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Phone,
  MessageSquare,
  Bus,
  DollarSign,
  HeartHandshake,
  Briefcase,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';
import { Patient, FollowUpTask } from '../types';

const BARRIER_CATEGORIES = [
  { id: 'TRANSPORTATION', label: 'Transportation / Travel', icon: Bus },
  { id: 'FINANCIAL', label: 'Financial / Insurance', icon: DollarSign },
  { id: 'CAREGIVER', label: 'Caregiver / Childcare', icon: HeartHandshake },
  { id: 'WORK_SCHEDULE', label: 'Work / Shift Conflict', icon: Briefcase },
  { id: 'ACUTE_SYMPTOMS', label: 'Acute Symptoms / Illness', icon: AlertCircle },
];

export function PatientPortal() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>('');
  const [currentPatient, setCurrentPatient] = useState<Patient | null>(null);
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<FollowUpTask | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Reschedule Form
  const [requestedDateTime, setRequestedDateTime] = useState<string>('');
  const [rescheduleReason, setRescheduleReason] = useState<string>('');
  const [rescheduling, setRescheduling] = useState<boolean>(false);
  const [rescheduleFeedback, setRescheduleFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // Barrier Form
  const [barrierCategory, setBarrierCategory] = useState<string>('TRANSPORTATION');
  const [barrierReason, setBarrierReason] = useState<string>('');
  const [reportingBarrier, setReportingBarrier] = useState<boolean>(false);
  const [barrierFeedback, setBarrierFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Notification Simulation
  const [simulating, setSimulating] = useState<boolean>(false);
  const [simulatedNotice, setSimulatedNotice] = useState<{
    message: string;
    isRedacted: boolean;
    deliveryStatus: string;
  } | null>(null);

  const loadPatients = async () => {
    try {
      const allPatients = await api.getPatients();
      setPatients(allPatients);
      if (allPatients.length > 0 && !selectedPatientId) {
        setSelectedPatientId(allPatients[0].id);
      }
    } catch (err) {
      console.error('Failed to load patients', err);
    }
  };

  const loadPatientTasks = async (patientId: string) => {
    setLoading(true);
    setRescheduleFeedback(null);
    setBarrierFeedback(null);
    setSimulatedNotice(null);

    try {
      const patientData = await api.getPatientTasks(patientId);
      setCurrentPatient(patientData);
      const patientTasks = patientData.tasks || [];
      setTasks(patientTasks);
      if (patientTasks.length > 0) {
        setSelectedTask(patientTasks[0]);
      } else {
        setSelectedTask(null);
      }
    } catch (err) {
      console.error('Failed to load patient tasks', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    if (selectedPatientId) {
      loadPatientTasks(selectedPatientId);
    }
  }, [selectedPatientId]);

  // Evaluate requested date against clinician window in real-time
  const getWindowEvaluation = () => {
    if (!requestedDateTime || !selectedTask?.windowStartDate || !selectedTask?.windowEndDate) {
      return null;
    }

    const req = new Date(requestedDateTime);
    const start = new Date(selectedTask.windowStartDate);
    const end = new Date(selectedTask.windowEndDate);

    const isWithin = req >= start && req <= end;
    return {
      isWithin,
      startDate: start.toLocaleDateString(),
      endDate: end.toLocaleDateString(),
    };
  };

  const handleRescheduleSubmit = async () => {
    if (!selectedTask || !requestedDateTime) return;
    setRescheduling(true);
    setRescheduleFeedback(null);

    try {
      const res = await api.reschedulePatientSlot(selectedTask.id, {
        requestedDate: new Date(requestedDateTime).toISOString(),
        barrierReason: rescheduleReason.trim() ? rescheduleReason : undefined,
      });

      if (res.confirmed) {
        setRescheduleFeedback({
          type: 'success',
          text: `Appointment Confirmed! Your follow-up has been booked for ${new Date(
            requestedDateTime
          ).toLocaleString()} within your doctor's approved window.`,
        });
      } else {
        setRescheduleFeedback({
          type: 'warning',
          text: `Request Submitted for Staff Review: The date you selected is outside your doctor's approved window (${
            selectedTask.windowStartDate
              ? new Date(selectedTask.windowStartDate).toLocaleDateString()
              : ''
          } - ${
            selectedTask.windowEndDate
              ? new Date(selectedTask.windowEndDate).toLocaleDateString()
              : ''
          }). A hospital coordinator will review your request.`,
        });
      }

      await loadPatientTasks(selectedPatientId);
    } catch (err: any) {
      setRescheduleFeedback({
        type: 'error',
        text: `Reschedule request failed: ${err.message}`,
      });
    } finally {
      setRescheduling(false);
    }
  };

  const handleBarrierSubmit = async () => {
    if (!selectedTask || !barrierReason.trim()) return;
    setReportingBarrier(true);
    setBarrierFeedback(null);

    try {
      await api.reportPatientBarrier(selectedTask.id, {
        barrierCategory,
        barrierReason,
      });

      setBarrierFeedback({
        type: 'success',
        text: 'Your attendance constraint has been submitted. Our hospital coordination desk has been alerted and will contact you to assist.',
      });
      setBarrierReason('');
      await loadPatientTasks(selectedPatientId);
    } catch (err: any) {
      setBarrierFeedback({
        type: 'error',
        text: `Failed to report barrier: ${err.message}`,
      });
    } finally {
      setReportingBarrier(false);
    }
  };

  const handleSimulateNotice = async () => {
    if (!selectedTask) return;
    setSimulating(true);
    try {
      const result = await api.simulateNotification({
        taskId: selectedTask.id,
        channel: 'SMS',
      });

      setSimulatedNotice({
        message: result.messagePayload,
        isRedacted: result.isRedacted,
        deliveryStatus: result.deliveryStatus,
      });
    } catch (err: any) {
      console.error('Simulation failed', err);
    } finally {
      setSimulating(false);
    }
  };

  const windowEval = getWindowEvaluation();

  return (
    <div className="space-y-6">
      {/* Patient Header & Account Switcher */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <User className="h-5 w-5 text-sky-700" />
            Patient Coordination & Scheduling Portal
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Review your approved follow-up window, select convenient appointment slots, or report barriers.
          </p>
        </div>

        {/* Patient Switcher for Demonstration */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">Switch Patient Record:</span>
          <select
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg p-2 bg-slate-50 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName} (MRN: {p.mrn}) {p.isSharedPhone ? '[Shared Phone]' : '[Private Phone]'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Patient Profile & Privacy Status Banner */}
      {currentPatient && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <span className="text-base font-bold text-slate-900">{currentPatient.fullName}</span>
              <span className="ml-2 text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                MRN: {currentPatient.mrn}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Phone className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-mono">{currentPatient.primaryPhone}</span>
            </div>
          </div>

          {/* Rule Set 2: Privacy Status Callout */}
          {currentPatient.isSharedPhone && !currentPatient.hasSensitiveConsent ? (
            <div className="p-4 bg-amber-50 text-amber-950 border border-amber-300 rounded-xl text-xs space-y-1.5 flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-amber-900">
                  Shared Household Telephone Privacy Safeguard Active
                </h4>
                <p className="text-amber-800 text-[11px] leading-relaxed">
                  This telephone is registered as shared within a household without sensitive clinical consent.
                  To protect your medical privacy, automated text and call alerts will suppress specific diagnostic terms or procedure names into neutral appointment notifications. Full details are viewable inside this secure portal.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-blue-50/70 text-blue-900 border border-blue-200 rounded-xl text-xs flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-blue-600 flex-shrink-0" />
              <span>
                Private phone registered with sensitive communication consent. Full clinical follow-up details authorized.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white p-12 rounded-xl border border-slate-200 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin text-sky-700" />
          <span>Loading patient tasks and appointments...</span>
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-white p-12 rounded-xl border border-slate-200 text-center text-xs text-slate-500">
          No active follow-up instructions found for this patient record.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Follow-Up Overview & Interactive Rescheduling */}
          <div className="lg:col-span-7 space-y-4">
            {/* Task Card */}
            {selectedTask && (
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Doctor's Prescribed Follow-Up
                    </span>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">
                      {selectedTask.followUpAction}
                    </h3>
                  </div>

                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                      selectedTask.currentState === 'APPOINTMENT_SCHEDULED'
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                        : selectedTask.currentState === 'RESCHEDULE_REQUESTED'
                        ? 'bg-purple-100 text-purple-800 border-purple-300'
                        : selectedTask.currentState === 'ESCALATED_AMBIGUITY'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'bg-blue-100 text-blue-800 border-blue-300'
                    }`}
                  >
                    {selectedTask.currentState}
                  </span>
                </div>

                {/* Approved Window Banner */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-sky-700" />
                    <div>
                      <span className="font-bold text-slate-700">Clinician-Approved Target Window:</span>
                      <div className="text-slate-600 font-medium">
                        {selectedTask.windowStartDate && selectedTask.windowEndDate ? (
                          <>
                            {new Date(selectedTask.windowStartDate).toLocaleDateString()} to{' '}
                            {new Date(selectedTask.windowEndDate).toLocaleDateString()}
                          </>
                        ) : (
                          <span className="text-amber-800 italic">No specific window designated</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedTask.scheduledDate && (
                    <div className="text-right sm:border-l sm:border-slate-200 sm:pl-3">
                      <span className="text-[10px] uppercase font-bold text-slate-400">Confirmed Booking</span>
                      <div className="font-bold text-emerald-800">
                        {new Date(selectedTask.scheduledDate).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>

                {selectedTask.resolutionReason && (
                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-0.5">
                    <span className="font-bold text-[10px] uppercase tracking-wider text-amber-700">
                      Coordination Desk Note:
                    </span>
                    <p className="font-medium text-[11px]">{selectedTask.resolutionReason}</p>
                  </div>
                )}

                {/* Rescheduling Form */}
                <div className="pt-2 border-t border-slate-200 space-y-3">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-sky-700" />
                    <span>Select or Reschedule Appointment Slot</span>
                  </h4>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">Choose Desired Date & Time</label>
                    <input
                      type="datetime-local"
                      value={requestedDateTime}
                      onChange={(e) => setRequestedDateTime(e.target.value)}
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  {/* Real-Time Constraint Validation Pill */}
                  {windowEval && (
                    <div
                      className={`p-3 rounded-lg border text-xs font-medium flex items-start gap-2 ${
                        windowEval.isWithin
                          ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                          : 'bg-amber-50 text-amber-900 border-amber-300'
                      }`}
                    >
                      {windowEval.isWithin ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold">Within Doctor's Approved Window.</span>
                            <p className="text-[11px] text-emerald-800 mt-0.5">
                              This slot is eligible for immediate automated confirmation.
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold">Outside Doctor's Approved Window ({windowEval.startDate} - {windowEval.endDate}).</span>
                            <p className="text-[11px] text-amber-800 mt-0.5">
                              Rule 4 active: Out-of-window requests cannot be automatically confirmed. It will be escalated to clinical staff for review.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">Reason / Timing Preference (Optional)</label>
                    <input
                      type="text"
                      value={rescheduleReason}
                      onChange={(e) => setRescheduleReason(e.target.value)}
                      placeholder="e.g., Prefer early morning slot before work"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleRescheduleSubmit}
                    disabled={rescheduling || !requestedDateTime}
                    className="w-full py-2.5 px-4 bg-sky-700 text-white rounded-lg text-xs font-bold hover:bg-sky-800 transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <Calendar className="h-4 w-4" />
                    <span>{rescheduling ? 'Submitting Slot Request...' : 'Confirm Appointment Slot'}</span>
                  </button>

                  {rescheduleFeedback && (
                    <div
                      className={`p-3 rounded-lg border text-xs font-medium flex items-start gap-2 ${
                        rescheduleFeedback.type === 'success'
                          ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                          : rescheduleFeedback.type === 'warning'
                          ? 'bg-amber-50 text-amber-900 border-amber-200'
                          : 'bg-rose-50 text-rose-900 border-rose-200'
                      }`}
                    >
                      {rescheduleFeedback.type === 'success' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      )}
                      <span>{rescheduleFeedback.text}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Attendance Barrier Reporting & Outbound Notice Tester */}
          <div className="lg:col-span-5 space-y-4">
            {/* Barrier Reporting Panel */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div>
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <HeartHandshake className="h-4 w-4 text-rose-600" />
                  <span>Report Attendance Barrier</span>
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Let us know if you face difficulties attending so staff can coordinate transport, financial, or caregiver support.
                </p>
              </div>

              {/* Barrier Category Pills */}
              <div className="grid grid-cols-2 gap-2">
                {BARRIER_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = barrierCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setBarrierCategory(cat.id)}
                      className={`p-2 rounded-lg border text-left text-xs font-medium flex items-center gap-2 transition-all ${
                        isSelected
                          ? 'bg-rose-50 border-rose-300 text-rose-900 shadow-sm'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">{cat.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Describe the difficulty / constraint</label>
                <textarea
                  rows={2}
                  value={barrierReason}
                  onChange={(e) => setBarrierReason(e.target.value)}
                  placeholder="e.g., Do not have personal transport; need assistance with hospital shuttle service..."
                  className="w-full text-xs border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <button
                type="button"
                onClick={handleBarrierSubmit}
                disabled={reportingBarrier || !barrierReason.trim()}
                className="w-full py-2 px-3 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 transition-colors shadow-sm disabled:opacity-50"
              >
                {reportingBarrier ? 'Submitting Barrier...' : 'Submit Barrier to Hospital Staff'}
              </button>

              {barrierFeedback && (
                <div
                  className={`p-3 rounded-lg border text-xs font-medium flex items-start gap-2 ${
                    barrierFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                      : 'bg-rose-50 text-rose-900 border-rose-200'
                  }`}
                >
                  {barrierFeedback.type === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
                  )}
                  <span>{barrierFeedback.text}</span>
                </div>
              )}
            </div>

            {/* Notification Simulation Demo Panel (Rule Set 2) */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4 text-sky-700" />
                  <span>Outbound Message Privacy Preview</span>
                </h4>
                <button
                  type="button"
                  onClick={handleSimulateNotice}
                  disabled={simulating || !selectedTask}
                  className="px-2.5 py-1 bg-sky-50 text-sky-800 border border-sky-300 rounded-md text-[11px] font-bold hover:bg-sky-100 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  <Send className="h-3 w-3" />
                  <span>{simulating ? 'Simulating...' : 'Dispatch Test Alert'}</span>
                </button>
              </div>

              <p className="text-[11px] text-slate-500">
                Demonstrates how FollowUp automatically redacts sensitive details when patient has a shared phone without consent.
              </p>

              {simulatedNotice ? (
                <div className="space-y-2 pt-1">
                  <div className="p-3 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono space-y-1.5 shadow-inner">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>SMS / WhatsApp Alert</span>
                      <span className="text-emerald-400 uppercase font-semibold">
                        {simulatedNotice.deliveryStatus}
                      </span>
                    </div>
                    <p className="text-slate-200 leading-relaxed text-[11px]">
                      "{simulatedNotice.message}"
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-[11px] px-1">
                    <span className="font-semibold text-slate-600">Privacy Filter:</span>
                    <span
                      className={`font-bold px-2 py-0.5 rounded-full text-[10px] border ${
                        simulatedNotice.isRedacted
                          ? 'bg-amber-100 text-amber-800 border-amber-300'
                          : 'bg-blue-100 text-blue-800 border-blue-300'
                      }`}
                    >
                      {simulatedNotice.isRedacted
                        ? 'Redacted Neutral Notice'
                        : 'Full Clinical Notice'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center text-[11px] text-slate-400">
                  Click "Dispatch Test Alert" to view the consent-aware text dispatched to this patient's number.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
