import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Clock,
  PhoneCall,
  Send,
  CheckCircle2,
  XCircle,
  History,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import { api } from '../services/api';
import {
  FollowUpTask,
  TaskState,
  ContactChannel,
  AuditLog,
} from '../types';

export function StaffDashboard({ onOpenTask }: { onOpenTask?: (task: FollowUpTask) => void }) {
  const [activeTab, setActiveTab] = useState<'urgent' | 'outstanding'>('urgent');
  const [outstandingFilter, setOutstandingFilter] = useState<string>('ALL');
  const [urgentTasks, setUrgentTasks] = useState<FollowUpTask[]>([]);
  const [outstandingTasks, setOutstandingTasks] = useState<FollowUpTask[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modal State
  const [selectedTask, setSelectedTask] = useState<FollowUpTask | null>(null);
  const [modalTab, setModalTab] = useState<'contact' | 'transition' | 'audit'>('contact');
  const [modalLoading, setModalLoading] = useState<boolean>(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Contact Attempt Form State
  const [contactChannel, setContactChannel] = useState<ContactChannel>('SMS');
  const [contactPayload, setContactPayload] = useState<string>('');
  const [deliveryStatus, setDeliveryStatus] = useState<'DELIVERED' | 'FAILED' | 'NO_ANSWER' | 'PENDING'>('DELIVERED');
  const [patientResponse, setPatientResponse] = useState<string>('');

  // Transition Form State
  const [targetState, setTargetState] = useState<TaskState>('APPOINTMENT_SCHEDULED');
  const [scheduledDate, setScheduledDate] = useState<string>('');
  const [resolutionReason, setResolutionReason] = useState<string>('');

  // Status message
  const [statusAlert, setStatusAlert] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setStatusAlert(null);
    try {
      const [urgent, outstanding] = await Promise.all([
        api.getUrgentQueue(),
        api.getOutstandingQueue(),
      ]);
      setUrgentTasks(urgent);
      setOutstandingTasks(outstanding);
    } catch (err: any) {
      setStatusAlert({ type: 'error', text: `Failed to load staff queues: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openActionModal = async (task: FollowUpTask) => {
    if (onOpenTask) onOpenTask(task);
    setSelectedTask(task);
    setModalTab('contact');
    setStatusAlert(null);
    setResolutionReason('');
    setScheduledDate('');
    setPatientResponse('');

    // Set intelligent message payload default based on patient privacy policy
    if (task.patient.isSharedPhone && !task.patient.hasSensitiveConsent) {
      setContactPayload(
        `Hospital Care Alert: Hello ${task.patient.fullName}, you have an outpatient follow-up scheduled. Please access your secure coordination portal or call the desk.`
      );
    } else {
      setContactPayload(
        `Hello ${task.patient.fullName}, this is Hospital Outpatient Coordination regarding your follow-up: "${task.followUpAction}". Please book your appointment slot.`
      );
    }

    // Preload audit trail
    try {
      setModalLoading(true);
      const logs = await api.getAuditTrail(task.id);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Failed to load audit trail', err);
    } finally {
      setModalLoading(false);
    }
  };

  const handleRecordContact = async () => {
    if (!selectedTask) return;
    setModalLoading(true);
    setStatusAlert(null);

    try {
      await api.recordContactAttempt(
        selectedTask.id,
        {
          channel: contactChannel,
          targetAddress: selectedTask.patient.primaryPhone,
          messagePayload: contactPayload,
          deliveryStatus,
          patientResponse: patientResponse.trim() ? patientResponse : null,
        },
        { role: 'RECORDS_STAFF', id: 'staff-coordinator-01' }
      );

      setStatusAlert({ type: 'success', text: 'Contact attempt successfully recorded and audited.' });
      await loadData();
      // Reload task details and audit trail
      const updated = await api.getTask(selectedTask.id);
      setSelectedTask(updated);
      const logs = await api.getAuditTrail(selectedTask.id);
      setAuditLogs(logs);
    } catch (err: any) {
      setStatusAlert({ type: 'error', text: err.message });
    } finally {
      setModalLoading(false);
    }
  };

  const handleTransition = async () => {
    if (!selectedTask) return;
    if (!resolutionReason.trim()) {
      setStatusAlert({ type: 'error', text: 'Mandatory resolution reason is required for state transitions.' });
      return;
    }

    setModalLoading(true);
    setStatusAlert(null);

    try {
      await api.transitionTask(
        selectedTask.id,
        {
          targetState,
          actionTaken: `STAFF_TRANSITION_TO_${targetState}`,
          scheduledDate: scheduledDate ? new Date(scheduledDate).toISOString() : null,
          resolutionReason,
        },
        { role: 'RECORDS_STAFF', id: 'staff-coordinator-01' }
      );

      setStatusAlert({ type: 'success', text: `Task successfully transitioned to ${targetState}.` });
      await loadData();
      const updated = await api.getTask(selectedTask.id);
      setSelectedTask(updated);
      const logs = await api.getAuditTrail(selectedTask.id);
      setAuditLogs(logs);
    } catch (err: any) {
      setStatusAlert({ type: 'error', text: err.message });
    } finally {
      setModalLoading(false);
    }
  };

  const handleRerouteToClinician = async () => {
    if (!selectedTask) return;
    setModalLoading(true);
    setStatusAlert(null);

    try {
      await api.transitionTask(
        selectedTask.id,
        {
          targetState: 'ESCALATED_AMBIGUITY',
          actionTaken: 'RE_ROUTED_TO_CLINICIAN_TRIAGE',
          resolutionReason: 'Staff triage: Re-routed to discharging clinician for interval clarification or barrier resolution.',
        },
        { role: 'RECORDS_STAFF', id: 'staff-coordinator-01' }
      );

      setStatusAlert({ type: 'success', text: 'Task re-routed to clinician triage queue.' });
      await loadData();
      const updated = await api.getTask(selectedTask.id);
      setSelectedTask(updated);
      const logs = await api.getAuditTrail(selectedTask.id);
      setAuditLogs(logs);
    } catch (err: any) {
      setStatusAlert({ type: 'error', text: err.message });
    } finally {
      setModalLoading(false);
    }
  };

  const handleRunOverdueCheck = async () => {
    setLoading(true);
    try {
      const res = await api.checkOverdue();
      setStatusAlert({
        type: 'success',
        text: `Overdue scan complete: Scanned ${res.scanned} active tasks, flagged ${res.updatedToOverdue} past deadlines.`,
      });
      await loadData();
    } catch (err: any) {
      setStatusAlert({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Filter outstanding tasks
  const filteredOutstanding = outstandingTasks.filter((t) => {
    if (outstandingFilter !== 'ALL' && t.currentState !== outstandingFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.patient.fullName.toLowerCase().includes(q) ||
      t.patient.mrn.toLowerCase().includes(q) ||
      t.followUpAction.toLowerCase().includes(q)
    );
  });

  const filteredUrgent = urgentTasks.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      t.patient.fullName.toLowerCase().includes(q) ||
      t.patient.mrn.toLowerCase().includes(q) ||
      t.followUpAction.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Clock className="h-5 w-5 text-sky-700" />
            Staff Coordination Worklist & Triage Queue
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Prioritized outpatient follow-up tracking: Urgent clinical deadlines vs outstanding blocked tasks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRunOverdueCheck}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold hover:bg-amber-100 transition-colors disabled:opacity-50"
            title="Scan active tasks for past deadline intervals"
          >
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <span>Run Overdue Scan</span>
          </button>

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {statusAlert && (
        <div
          className={`p-4 rounded-xl border text-sm font-medium flex items-center gap-3 ${
            statusAlert.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200'
          }`}
        >
          {statusAlert.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0" />
          )}
          <span>{statusAlert.text}</span>
        </div>
      )}

      {/* Tabs and Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-3">
        {/* Main Worklist Tabs */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('urgent')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border ${
              activeTab === 'urgent'
                ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Upcoming Clinician-Urgent</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                activeTab === 'urgent' ? 'bg-rose-800 text-white' : 'bg-rose-100 text-rose-800'
              }`}
            >
              {urgentTasks.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('outstanding')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border ${
              activeTab === 'outstanding'
                ? 'bg-sky-700 text-white border-sky-700 shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Outstanding Task Queue</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                activeTab === 'outstanding' ? 'bg-sky-900 text-white' : 'bg-sky-100 text-sky-800'
              }`}
            >
              {outstandingTasks.length}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="h-3.5 w-3.5 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search patient, MRN, action..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-800"
          />
        </div>
      </div>

      {/* Sub-Filters for Outstanding Queue */}
      {activeTab === 'outstanding' && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500 font-medium mr-1 flex items-center gap-1">
            <Filter className="h-3 w-3" /> Filter:
          </span>
          {[
            { id: 'ALL', label: 'All Outstanding' },
            { id: 'ESCALATED_AMBIGUITY', label: 'Ambiguity Escalations' },
            { id: 'CONTACT_FAILED', label: 'Contact Failed' },
            { id: 'RESCHEDULE_REQUESTED', label: 'Reschedule Requested' },
            { id: 'OVERDUE_UNRESOLVED', label: 'Overdue Unresolved' },
          ].map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setOutstandingFilter(pill.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors border ${
                outstandingFilter === pill.id
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      )}

      {/* Table / List View */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-sky-700" />
            <span>Loading worklist tasks...</span>
          </div>
        ) : (activeTab === 'urgent' ? filteredUrgent : filteredOutstanding).length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            No follow-up tasks currently matching this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-700 font-bold">
                  <th className="py-3 px-4">Patient / MRN</th>
                  <th className="py-3 px-4">Follow-Up Action</th>
                  <th className="py-3 px-4">Clinician Window</th>
                  <th className="py-3 px-4">Urgency & State</th>
                  <th className="py-3 px-4">Triage / Failure Reason</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(activeTab === 'urgent' ? filteredUrgent : filteredOutstanding).map((task) => {
                  const isUrgent = task.urgencyLevel === 'CLINICIAN_URGENT';
                  const isEscalated = task.currentState === 'ESCALATED_AMBIGUITY';
                  const isFailed = task.currentState === 'CONTACT_FAILED';
                  const isOverdue = task.currentState === 'OVERDUE_UNRESOLVED';
                  const isReschedule = task.currentState === 'RESCHEDULE_REQUESTED';

                  return (
                    <tr key={task.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{task.patient.fullName}</div>
                        <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span>{task.patient.mrn}</span>
                          <span>&bull;</span>
                          <span>{task.patient.primaryPhone}</span>
                        </div>
                        {task.patient.isSharedPhone && (
                          <span className="inline-block mt-1 text-[10px] font-semibold bg-amber-100 text-amber-900 border border-amber-200 px-1.5 py-0.2 rounded">
                            Shared Phone
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-sky-950">{task.followUpAction}</div>
                        <div className="text-[11px] text-slate-500 italic mt-0.5 max-w-xs truncate" title={task.sourceInstructionText}>
                          "{task.sourceInstructionText}"
                        </div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {task.windowStartDate && task.windowEndDate ? (
                          <div className="space-y-0.5">
                            <div className="text-slate-800 font-medium">
                              {new Date(task.windowStartDate).toLocaleDateString()}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              to {new Date(task.windowEndDate).toLocaleDateString()}
                            </div>
                          </div>
                        ) : (
                          <span className="text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px] font-medium">
                            No window set
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex flex-col items-start gap-1">
                          {isUrgent && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> CLINICIAN URGENT
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              isEscalated
                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                : isFailed
                                ? 'bg-rose-100 text-rose-900 border-rose-300'
                                : isOverdue
                                ? 'bg-orange-100 text-orange-900 border-orange-300'
                                : isReschedule
                                ? 'bg-purple-100 text-purple-900 border-purple-300'
                                : 'bg-blue-100 text-blue-900 border-blue-300'
                            }`}
                          >
                            {task.currentState}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 max-w-xs">
                        {task.resolutionReason ? (
                          <div className="text-[11px] text-amber-900 bg-amber-50/80 border border-amber-200 p-2 rounded line-clamp-2">
                            {task.resolutionReason}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px] italic">None documented</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openActionModal(task)}
                          className="px-3 py-1.5 bg-sky-700 text-white rounded-lg text-xs font-bold hover:bg-sky-800 transition-colors shadow-sm inline-flex items-center gap-1.5"
                        >
                          <span>Manage Task</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">
                    Hospital Coordination Action: {selectedTask.patient.fullName}
                  </h3>
                  <span className="text-xs font-mono bg-slate-200 text-slate-700 px-2 py-0.5 rounded">
                    {selectedTask.patient.mrn}
                  </span>
                </div>
                <p className="text-xs text-sky-900 font-semibold mt-1">
                  Follow-Up Action: {selectedTask.followUpAction}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedTask(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex border-b border-slate-200 px-5 pt-3 bg-white gap-4 text-xs font-bold">
              <button
                type="button"
                onClick={() => setModalTab('contact')}
                className={`pb-2.5 border-b-2 flex items-center gap-1.5 ${
                  modalTab === 'contact'
                    ? 'border-sky-700 text-sky-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <PhoneCall className="h-3.5 w-3.5" />
                <span>1. Record Contact Attempt</span>
              </button>

              <button
                type="button"
                onClick={() => setModalTab('transition')}
                className={`pb-2.5 border-b-2 flex items-center gap-1.5 ${
                  modalTab === 'transition'
                    ? 'border-sky-700 text-sky-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>2. Resolve / Transition</span>
              </button>

              <button
                type="button"
                onClick={() => setModalTab('audit')}
                className={`pb-2.5 border-b-2 flex items-center gap-1.5 ${
                  modalTab === 'audit'
                    ? 'border-sky-700 text-sky-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <History className="h-3.5 w-3.5" />
                <span>3. Immutable Audit Trail</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* Tab 1: Contact Attempt */}
              {modalTab === 'contact' && (
                <div className="space-y-4">
                  {selectedTask.patient.isSharedPhone && (
                    <div className="p-3 bg-amber-50 text-amber-900 border border-amber-300 rounded-xl text-xs space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <ShieldAlert className="h-4 w-4 text-amber-600" />
                        <span>Shared Phone Privacy Protection Applied</span>
                      </div>
                      <p className="text-[11px] text-amber-800">
                        Patient has a shared telephone line without explicit sensitive consent. Sensitive clinical diagnosis or procedure names must be redacted into neutral scheduling alerts.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Communication Channel</label>
                      <select
                        value={contactChannel}
                        onChange={(e) => setContactChannel(e.target.value as ContactChannel)}
                        className="w-full text-xs border border-slate-300 rounded-lg p-2 text-slate-800"
                      >
                        <option value="SMS">SMS Text Message</option>
                        <option value="WHATSAPP">WhatsApp</option>
                        <option value="VOICE_CALL">Voice Phone Call</option>
                        <option value="IN_PERSON">In Person</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Delivery Status</label>
                      <select
                        value={deliveryStatus}
                        onChange={(e) => setDeliveryStatus(e.target.value as any)}
                        className="w-full text-xs border border-slate-300 rounded-lg p-2 text-slate-800"
                      >
                        <option value="DELIVERED">DELIVERED (Message sent & received)</option>
                        <option value="FAILED">FAILED (Invalid phone / network drop)</option>
                        <option value="NO_ANSWER">NO_ANSWER (Voice call rang out)</option>
                        <option value="PENDING">PENDING</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Target Address</label>
                    <input
                      type="text"
                      disabled
                      value={selectedTask.patient.primaryPhone}
                      className="w-full text-xs border border-slate-200 bg-slate-100 rounded-lg p-2 font-mono text-slate-600"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Dispatch Message Payload</label>
                    <textarea
                      rows={3}
                      value={contactPayload}
                      onChange={(e) => setContactPayload(e.target.value)}
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Patient Response / Notes (Optional)</label>
                    <input
                      type="text"
                      value={patientResponse}
                      onChange={(e) => setPatientResponse(e.target.value)}
                      placeholder="e.g., Patient requested morning appointment; looking at dates"
                      className="w-full text-xs border border-slate-300 rounded-lg p-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleRecordContact}
                      disabled={modalLoading || !contactPayload.trim()}
                      className="px-4 py-2 bg-sky-700 text-white rounded-lg text-xs font-bold hover:bg-sky-800 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>{modalLoading ? 'Recording...' : 'Submit Contact Attempt'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 2: Transition & Resolution */}
              {modalTab === 'transition' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Target State Transition</label>
                      <select
                        value={targetState}
                        onChange={(e) => setTargetState(e.target.value as TaskState)}
                        className="w-full text-xs border border-slate-300 rounded-lg p-2 text-slate-800"
                      >
                        <option value="APPOINTMENT_SCHEDULED">APPOINTMENT_SCHEDULED (Confirm slot)</option>
                        <option value="VERIFIED_PENDING_ACTION">VERIFIED_PENDING_ACTION (Reopen booking)</option>
                        <option value="ATTENDANCE_CONFIRMED">ATTENDANCE_CONFIRMED (Visit completed)</option>
                        <option value="EXPLICITLY_CLOSED">EXPLICITLY_CLOSED (Administrative/Clinical closure)</option>
                        <option value="ESCALATED_AMBIGUITY">ESCALATED_AMBIGUITY (Escalate back to clinician)</option>
                      </select>
                    </div>

                    {targetState === 'APPOINTMENT_SCHEDULED' && (
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-700">Appointment Scheduled Date</label>
                        <input
                          type="datetime-local"
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          className="w-full text-xs border border-slate-300 rounded-lg p-2 text-slate-800"
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Mandatory Resolution / Action Reason</span>
                      <span className="text-[11px] text-rose-600 font-semibold">* Required for audit compliance</span>
                    </label>
                    <textarea
                      rows={3}
                      value={resolutionReason}
                      onChange={(e) => setResolutionReason(e.target.value)}
                      placeholder="e.g., Appointment confirmed within clinician window; patient agreed to attend via SMS."
                      className="w-full text-xs border border-slate-300 rounded-lg p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleRerouteToClinician}
                      disabled={modalLoading}
                      className="px-3 py-2 bg-amber-50 text-amber-900 border border-amber-300 rounded-lg text-xs font-bold hover:bg-amber-100 transition-colors"
                    >
                      Re-route to Clinician Review
                    </button>

                    <button
                      type="button"
                      onClick={handleTransition}
                      disabled={modalLoading || !resolutionReason.trim()}
                      className="px-4 py-2 bg-sky-700 text-white rounded-lg text-xs font-bold hover:bg-sky-800 transition-colors disabled:opacity-50"
                    >
                      {modalLoading ? 'Updating State...' : 'Confirm State Transition'}
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 3: Immutable Audit Trail */}
              {modalTab === 'audit' && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 font-medium">
                    Immutable event ledger recorded by the deterministic state machine engine:
                  </div>

                  {modalLoading ? (
                    <div className="p-8 text-center text-xs text-slate-400">Loading audit trail...</div>
                  ) : auditLogs.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400">No audit events recorded yet.</div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {auditLogs.map((log) => (
                        <div
                          key={log.id}
                          className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900">{log.actionTaken}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-600 flex items-center gap-2">
                            <span>Actor: <strong className="text-slate-800">{log.actorRole}</strong> ({log.actorId})</span>
                            {log.fromState && log.toState && (
                              <span>
                                &bull; Transition: <code className="text-sky-800 font-mono">{log.fromState}</code> &rarr; <code className="text-emerald-800 font-mono">{log.toState}</code>
                              </span>
                            )}
                          </div>

                          {log.metadataJson && (
                            <pre className="text-[10px] font-mono bg-white p-2 rounded border border-slate-200 text-slate-700 overflow-x-auto">
                              {log.metadataJson}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedTask(null)}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
