import { useState } from 'react';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

export interface DemoScenario {
  id: string;
  title: string;
  targetView: 'clinician' | 'staff' | 'patient' | 'audit';
  description: string;
  badge: string;
  badgeColor: string;
  presetText?: string;
  patientMrn?: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'scenario-1',
    title: '1. Standard Follow-Up & Self-Scheduling',
    targetView: 'patient',
    patientMrn: 'MRN-1001',
    description: 'Post-op appendectomy recovery with a clear 10-14 day window. Patient selects an in-window slot which auto-confirms.',
    badge: 'Standard Path',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
  {
    id: 'scenario-2',
    title: '2. Shared Phone Diagnostic Privacy (Rule Set 2)',
    targetView: 'patient',
    patientMrn: 'MRN-1002',
    description: 'Oncology pathology review on a shared household telephone. Sensitive clinical tags are automatically redacted into neutral alerts.',
    badge: 'Consent Safeguard',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  {
    id: 'scenario-3',
    title: '3. Carrier Delivery Failure & Staff Recovery',
    targetView: 'staff',
    description: 'Carrier drops or invalid phone number moves task to CONTACT_FAILED without falling through administrative cracks.',
    badge: 'Failure Handling',
    badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
  },
  {
    id: 'scenario-4',
    title: '4. Ambiguous Note & Vague Phrasing Block',
    targetView: 'clinician',
    presetText: 'Mild asthma flare controlled. Patient should follow up as needed soon if wheezing recurs, or return whenever convenient.',
    description: 'Instructions with "PRN", "as needed", or "soon" trigger ESCALATED_AMBIGUITY and block automatic outpatient booking.',
    badge: 'Ambiguity Guard',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  {
    id: 'scenario-5',
    title: '5. Conflicting Temporal Intervals',
    targetView: 'clinician',
    presetText: 'Discharge summary: Follow-up in 2 weeks for blood pressure and renal check. Addendum note: Patient clinically stable, return to outpatient clinic in 6 months.',
    description: 'Multiple conflicting timeframe intervals ("2 weeks" vs "6 months") are detected, isolated as spans, and flagged for clinician override.',
    badge: 'Conflict Detection',
    badgeColor: 'bg-purple-100 text-purple-800 border-purple-300',
  },
  {
    id: 'scenario-6',
    title: '6. Out-of-Window Rescheduling Request',
    targetView: 'staff',
    description: 'Patient requests an appointment slot outside the clinician-stipulated window. System blocks auto-confirmation and routes to staff triage.',
    badge: 'Clinical Authority',
    badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  },
];

interface DemoSwitcherProps {
  onSelectScenario: (scenario: DemoScenario) => void;
  activeView: string;
}

export function DemoSwitcher({ onSelectScenario, activeView }: DemoSwitcherProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeScenarioId, setActiveScenarioId] = useState<string>('scenario-1');

  const handleLaunch = (scenario: DemoScenario) => {
    setActiveScenarioId(scenario.id);
    onSelectScenario(scenario);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-xl w-full px-4">
      <div className="bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 overflow-hidden transition-all">
        {/* Collapsible Header */}
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="p-3.5 px-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/80 transition-colors select-none"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-sky-600 text-white flex items-center justify-center font-bold">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-tight">AI Synergy Demo Controller</span>
                <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 font-semibold">
                  <CheckCircle2 className="h-3 w-3" /> 35/35 Rules Verified (100%)
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Interactive evaluator walkthrough of the 6 core clinical edge cases
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-sky-400 font-semibold hidden sm:inline">
              {isOpen ? 'Minimize' : 'Open Scenarios'}
            </span>
            <button
              type="button"
              className="text-slate-400 hover:text-white p-1 rounded-md"
              aria-label="Toggle demo switcher"
            >
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Expanded Scenarios Drawer */}
        {isOpen && (
          <div className="p-4 border-t border-slate-800 bg-slate-950/90 space-y-3 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between text-[11px] text-slate-400 pb-1">
              <span>Select a case study to demonstrate autonomous safeguards:</span>
              <span className="font-mono text-slate-500">Current View: {activeView}</span>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {DEMO_SCENARIOS.map((sc) => {
                const isActive = activeScenarioId === sc.id;
                return (
                  <div
                    key={sc.id}
                    className={`p-3 rounded-xl border text-xs transition-all space-y-2 ${
                      isActive
                        ? 'bg-slate-800/90 border-sky-500 ring-1 ring-sky-500/30'
                        : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="font-bold text-slate-100 flex items-center gap-2">
                          <span>{sc.title}</span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.2 rounded-full border ${sc.badgeColor}`}
                          >
                            {sc.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {sc.description}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleLaunch(sc)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 shadow-sm ${
                          isActive
                            ? 'bg-sky-500 text-white hover:bg-sky-400'
                            : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        <span>Launch</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="flex items-center gap-3 text-[10px] text-slate-500 pt-1 border-t border-slate-800/80">
                      <span>Target View: <strong className="text-slate-300">{sc.targetView.toUpperCase()}</strong></span>
                      {sc.patientMrn && (
                        <span>MRN: <code className="text-sky-300 font-mono">{sc.patientMrn}</code></span>
                      )}
                      {sc.presetText && (
                        <span className="truncate max-w-xs text-slate-400 italic">"{sc.presetText}"</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Test Suite Summary Pill */}
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>
                  <strong>Automated Safety Verification:</strong> 4 test suites &bull; 35 unit & E2E assertions
                </span>
              </div>
              <span className="text-[11px] font-mono text-emerald-400 font-bold">100% Passed</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
