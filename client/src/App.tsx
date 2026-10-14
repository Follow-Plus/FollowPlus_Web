import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Stethoscope,
  ClipboardList,
  UserCheck,
} from 'lucide-react';
import { api } from './services/api';
import { ClinicianEditor } from './components/ClinicianEditor';
import { StaffDashboard } from './components/StaffDashboard';
import { AuditLogViewer } from './components/AuditLogViewer';
import { PatientPortal } from './components/PatientPortal';
import { DemoSwitcher, DemoScenario } from './components/DemoSwitcher';

export default function App() {
  const [currentView, setCurrentView] = useState<'clinician' | 'staff' | 'patient' | 'audit'>('clinician');
  const [activeScenario, setActiveScenario] = useState<DemoScenario | null>(null);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [urgentCount, setUrgentCount] = useState<number>(0);
  const [outstandingCount, setOutstandingCount] = useState<number>(0);

  const fetchCounts = async () => {
    try {
      const [urgent, outstanding] = await Promise.all([
        api.getUrgentQueue(),
        api.getOutstandingQueue(),
      ]);
      setUrgentCount(urgent.length);
      setOutstandingCount(outstanding.length);
      setBackendStatus('connected');
    } catch (_) {
      setBackendStatus('disconnected');
    }
  };

  useEffect(() => {
    fetchCounts();
    const interval = setInterval(fetchCounts, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Logo & Platform Info */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-sky-700 text-white rounded-xl flex items-center justify-center font-bold text-xl shadow-inner flex-shrink-0">
              +
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">FollowUp</h1>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200">
                  AI Synergy 2026
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Closed-Loop
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Hospital Outpatient Follow-Up Coordination Platform
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setCurrentView('clinician')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                currentView === 'clinician'
                  ? 'bg-white text-sky-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Stethoscope className="h-4 w-4" />
              <span>Clinician Editor</span>
            </button>

            <button
              type="button"
              onClick={() => setCurrentView('staff')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all relative ${
                currentView === 'staff'
                  ? 'bg-white text-sky-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ClipboardList className="h-4 w-4" />
              <span>Staff Worklist</span>
              {urgentCount + outstandingCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-600 text-white font-mono">
                  {urgentCount + outstandingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setCurrentView('patient')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                currentView === 'patient'
                  ? 'bg-white text-sky-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserCheck className="h-4 w-4" />
              <span>Patient Portal</span>
            </button>

            <button
              type="button"
              onClick={() => setCurrentView('audit')}
              className={`px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                currentView === 'audit'
                  ? 'bg-white text-sky-800 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="h-4 w-4" />
              <span>Audit Trail</span>
            </button>
          </div>

          {/* Backend Status Pill */}
          <div className="hidden lg:flex items-center gap-2 text-xs font-medium text-slate-600">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                backendStatus === 'connected'
                  ? 'bg-emerald-500 animate-pulse'
                  : backendStatus === 'checking'
                  ? 'bg-amber-400'
                  : 'bg-rose-500'
              }`}
            />
            {backendStatus === 'connected' && 'API Synced'}
            {backendStatus === 'checking' && 'Connecting...'}
            {backendStatus === 'disconnected' && 'Backend Offline'}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Core Architectural Guarantees Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex items-start gap-3">
            <div className="p-2 bg-blue-50 text-blue-700 rounded-lg flex-shrink-0">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800">Source Traceability</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Character-level highlighted spans link directly to clinician note text.
              </p>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex items-start gap-3">
            <div className="p-2 bg-amber-50 text-amber-700 rounded-lg flex-shrink-0">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800">Ambiguity Blocking</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Missing timeframes & PRN phrasing block auto-booking to triage.
              </p>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex items-start gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg flex-shrink-0">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800">Bounded Rescheduling</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Strict adherence to clinician intervals; out-of-window escalates.
              </p>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex items-start gap-3">
            <div className="p-2 bg-emerald-50 text-emerald-700 rounded-lg flex-shrink-0">
              <Activity className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800">Closed-Loop Lifecycle</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Sent != Delivered != Booked != Verified Attendance.
              </p>
            </div>
          </div>
        </div>

        {/* View Switcher */}
        {currentView === 'clinician' && (
          <ClinicianEditor
            initialText={activeScenario?.presetText}
            onTaskCreated={() => {
              fetchCounts();
              setCurrentView('staff');
            }}
          />
        )}

        {currentView === 'staff' && <StaffDashboard />}

        {currentView === 'patient' && <PatientPortal />}

        {currentView === 'audit' && <AuditLogViewer />}
      </main>

      {/* Interactive Hackathon Demo Controls Toolbar */}
      <DemoSwitcher
        activeView={currentView}
        onSelectScenario={(sc) => {
          setActiveScenario(sc);
          setCurrentView(sc.targetView);
        }}
      />

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-6 text-center text-xs text-slate-500 mt-auto">
        FollowUp Platform &bull; Zero autonomous clinical risk scoring &bull; Deterministic State Engine &bull; Fastify + SQLite (Prisma) + React + Vite + Tailwind CSS
      </footer>
    </div>
  );
}
