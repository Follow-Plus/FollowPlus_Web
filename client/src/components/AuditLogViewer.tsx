import { useState, useEffect } from 'react';
import { ShieldCheck, RefreshCw, ArrowRight } from 'lucide-react';
import { api } from '../services/api';
import { FollowUpTask, AuditLog } from '../types';

export function AuditLogViewer() {
  const [tasks, setTasks] = useState<FollowUpTask[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [logsLoading, setLogsLoading] = useState<boolean>(false);
  const [filterRole, setFilterRole] = useState<string>('ALL');

  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await api.getTasks();
      setTasks(data);
      if (data.length > 0 && !selectedTaskId) {
        setSelectedTaskId(data[0].id);
        loadAuditLogs(data[0].id);
      }
    } catch (err) {
      console.error('Failed to load tasks', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async (taskId: string) => {
    setLogsLoading(true);
    try {
      const logs = await api.getAuditTrail(taskId);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleSelectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    loadAuditLogs(taskId);
  };

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);
  const filteredLogs = auditLogs.filter((log) => {
    if (filterRole !== 'ALL' && log.actorRole !== filterRole) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Immutable Audit Trail & Regulatory Compliance Log
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Every clinical extraction, state transition, and patient communication is recorded with actor ID, timestamp, and metadata.
          </p>
        </div>

        <button
          type="button"
          onClick={loadTasks}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Audit Ledger</span>
        </button>
      </div>

      {/* Main Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Task Selector */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Select Follow-Up Task Lifecycle ({tasks.length})
            </h3>

            {loading ? (
              <div className="p-8 text-center text-xs text-slate-400">Loading tasks...</div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {tasks.map((task) => {
                  const isSelected = task.id === selectedTaskId;
                  return (
                    <div
                      key={task.id}
                      onClick={() => handleSelectTask(task.id)}
                      className={`p-3 rounded-lg border text-xs cursor-pointer transition-all space-y-1 ${
                        isSelected
                          ? 'bg-sky-50/80 border-sky-400 shadow-sm'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span>{task.patient.fullName}</span>
                        <span className="text-[10px] font-mono text-slate-500">{task.patient.mrn}</span>
                      </div>
                      <div className="text-sky-950 font-medium truncate">{task.followUpAction}</div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
                        <span className="font-semibold text-slate-600">State: {task.currentState}</span>
                        <span className="text-slate-400">
                          {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Detailed Audit Log Entries */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Audit Events for {selectedTask?.patient.fullName || 'Selected Task'}
                </h3>
                <p className="text-[11px] text-slate-500 font-mono">
                  Task ID: {selectedTaskId || 'None'}
                </p>
              </div>

              {/* Role Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500 font-medium">Actor:</span>
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="text-xs border border-slate-300 rounded-md p-1 text-slate-800"
                >
                  <option value="ALL">All Actors</option>
                  <option value="CLINICIAN">CLINICIAN</option>
                  <option value="RECORDS_STAFF">RECORDS_STAFF</option>
                  <option value="ADMIN">ADMIN / SYSTEM</option>
                  <option value="PATIENT">PATIENT</option>
                </select>
              </div>
            </div>

            {/* Task Summary Banner */}
            {selectedTask && (
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">Source Clinical Note:</span>
                  <span className="text-[11px] font-semibold text-sky-800">
                    Urgency: {selectedTask.urgencyLevel}
                  </span>
                </div>
                <p className="text-slate-600 italic">"{selectedTask.sourceInstructionText}"</p>
              </div>
            )}

            {/* Timeline View */}
            {logsLoading ? (
              <div className="p-12 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-emerald-600" />
                <span>Loading immutable ledger events...</span>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-400">
                No audit events recorded matching this filter.
              </div>
            ) : (
              <div className="space-y-3 relative pl-6 border-l-2 border-slate-200 ml-2">
                {filteredLogs.map((log) => (
                  <div key={log.id} className="relative space-y-1.5 text-xs">
                    {/* Timeline bullet */}
                    <div className="absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />

                    <div className="bg-slate-50/80 hover:bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-xs">
                          {log.actionTaken}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-2">
                        <span>
                          Actor Role: <strong className="text-slate-800">{log.actorRole}</strong>
                        </span>
                        <span>&bull;</span>
                        <span>ID: <code className="bg-slate-200 px-1 py-0.2 rounded font-mono text-slate-800">{log.actorId}</code></span>
                        {log.fromState && log.toState && (
                          <>
                            <span>&bull;</span>
                            <span className="flex items-center gap-1 font-semibold">
                              <span className="text-sky-800">{log.fromState}</span>
                              <ArrowRight className="h-3 w-3 text-slate-400" />
                              <span className="text-emerald-800">{log.toState}</span>
                            </span>
                          </>
                        )}
                      </div>

                      {log.metadataJson && (
                        <div className="pt-1">
                          <pre className="text-[10px] font-mono bg-white p-2 rounded border border-slate-200 text-slate-700 overflow-x-auto">
                            {log.metadataJson}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
