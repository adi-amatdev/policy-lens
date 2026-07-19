import { useState, useEffect } from 'react'
import type { ExtensionMessage, SectionRecord, ChangeRecord } from '../shared/messages'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../shared/riskFlags'
import { getWordDiff, type WordDiff } from '../shared/diffing'

type Tab = 'summary' | 'risks' | 'changes'
type PageState = 'loading' | 'no-data' | 'analyzing' | 'results'
const FIRST_RUN_ACK_KEY = 'termsNoConditions.firstRunAcknowledged'

const ANALYZING_STEPS = [
  'Extracting page content...',
  'Running on-device ML analysis...',
  'Saving results...',
]

const DOT_COLORS: Record<string, string> = {
  'data-sharing': 'bg-red-500',
  arbitration: 'bg-orange-500',
  'auto-renewal': 'bg-yellow-500',
  'unilateral-changes': 'bg-purple-500',
  'liability-waiver': 'bg-pink-500',
  'data-retention': 'bg-blue-500',
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function promisifySendMessage(msg: ExtensionMessage): Promise<any> {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve))
}

export default function Popup() {
  const [pageState, setPageState] = useState<PageState>('loading')
  const [activeTab, setActiveTab] = useState<Tab>('summary')
  const [sections, setSections] = useState<SectionRecord[]>([])
  const [changes, setChanges] = useState<ChangeRecord[]>([])
  const [hasChanges, setHasChanges] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [tabDomain, setTabDomain] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeStep, setAnalyzeStep] = useState(0)
  const [analyzeError, setAnalyzeError] = useState('')

  useEffect(() => {
    chrome.storage.local.get(FIRST_RUN_ACK_KEY).then((stored) => {
      if (stored[FIRST_RUN_ACK_KEY] !== true) setShowOnboarding(true)
    })
  }, [])

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url
      if (!url) { setPageState('no-data'); return }
      try { setTabDomain(new URL(url).hostname) } catch {}
      promisifySendMessage({ type: 'GET_ANALYSIS_FOR_TAB', tabUrl: url } as ExtensionMessage).then((response: any) => {
        if (response?.type === 'ANALYSIS_RESULT') {
          const s = response.sections || []
          const c = response.changes || []
          if (s.length > 0) {
            setSections(s); setChanges(c); setPageState('results')
            if (c.length > 0) { setHasChanges(true); setActiveTab('changes') }
            return
          }
        }
        setPageState('no-data')
      })
    })
  }, [])

  async function handleAnalyze() {
    setAnalyzing(true); setPageState('analyzing'); setAnalyzeError('')

    try {
      setAnalyzeStep(0)
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tabs[0]?.id) { fail('No active tab'); return }

      setAnalyzeStep(1)
      const response: any = await promisifySendMessage({ type: 'ANALYZE_PAGE', tabId: tabs[0].id } as ExtensionMessage)

      setAnalyzeStep(2)
      if (response?.ok && response.sections?.length > 0) {
        setSections(response.sections || [])
        setChanges(response.changes || [])
        if (response.changes?.length > 0) { setHasChanges(true); setActiveTab('changes') }
        setAnalyzing(false); setPageState('results')
      } else {
        fail(response?.error || 'No policy content found on this page')
      }
    } catch (e) {
      console.error('[Popup] Analyze failed:', e)
      fail(String(e))
    }

    function fail(msg: string) { setAnalyzing(false); setAnalyzeError(msg); setPageState('no-data') }
  }

  const allRiskFlags = sections.flatMap((s) => s.riskFlags)

  return (
    <div className="w-[440px] max-h-[600px] flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">PolicyLens</span>
          <span className="text-[10px] text-gray-400">AI summary, not legal advice</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => chrome.runtime.openOptionsPage()}
            className="text-xs text-gray-500 hover:text-indigo-600 px-2 py-1 rounded hover:bg-gray-100 transition-colors">
            Dashboard
          </button>
          <button onClick={() => setShowSettings(!showSettings)}
            className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-1 rounded hover:bg-gray-100 transition-colors" title="Settings">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {pageState === 'results' && (
        <div className="shrink-0 px-4 pt-2 pb-1.5 border-b">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex gap-1">
              <TabBtn label="Summary" active={activeTab === 'summary'} onClick={() => setActiveTab('summary')} />
              <TabBtn label="Risks" active={activeTab === 'risks'} onClick={() => setActiveTab('risks')}
                count={allRiskFlags.length} danger={allRiskFlags.length > 0 && activeTab !== 'risks'} />
              {hasChanges && (
                <TabBtn label="Changes" active={activeTab === 'changes'} onClick={() => setActiveTab('changes')}
                  count={changes.length} orange />
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Analyzed {sections[0]?.savedAt ? timeAgo(sections[0].savedAt) : ''}</span>
            <span className="text-gray-300">&middot;</span>
            <span>Re-analyze to detect changes</span>
          </div>
          <ModelStatusBadge sections={sections} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3">
        {pageState === 'loading' && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-pulse text-sm text-gray-400">Loading...</div>
          </div>
        )}

        {pageState === 'results' && (
          <>
            {activeTab === 'summary' && <SummaryTab sections={sections} />}
            {activeTab === 'risks' && <RiskTab sections={sections} />}
            {activeTab === 'changes' && <ChangesTab changes={changes} />}
          </>
        )}

        {pageState === 'no-data' && (
          <div className="py-6 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-0.5">No Analysis Yet</p>
            {tabDomain && <p className="text-xs text-gray-500 mb-0.5">Current page: <span className="font-medium text-gray-600">{tabDomain}</span></p>}
            <p className="text-xs text-gray-400 mb-3 max-w-[320px] leading-relaxed">
              Scan this page for a breakdown of terms, privacy risks, and policy changes.
            </p>
            {analyzeError && (
              <p className="text-xs text-red-500 mb-2">{analyzeError}</p>
            )}
            <button onClick={handleAnalyze} disabled={analyzing}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-lg transition-colors">
              Analyze This Page
            </button>
            <p className="text-[10px] text-gray-300 mt-2">Runs locally in your browser</p>
          </div>
        )}

        {pageState === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-10">
            <div className="relative mb-4">
              <svg className="animate-spin h-8 w-8 text-indigo-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] font-bold text-indigo-600">{analyzeStep + 1}/{ANALYZING_STEPS.length}</span>
              </div>
            </div>
            <p className="text-sm text-gray-700 font-medium mb-1">{ANALYZING_STEPS[analyzeStep]}</p>
            <div className="flex gap-1.5 mt-2">
              {ANALYZING_STEPS.map((_, i) => (
                <span key={i} className={`w-2 h-2 rounded-full transition-colors duration-300 ${i <= analyzeStep ? 'bg-indigo-500' : 'bg-gray-200'}`} />
              ))}
            </div>
          </div>
        )}
      </div>

      {pageState === 'results' && (
        <div className="px-4 py-2 border-t shrink-0">
          <div className="flex items-center justify-between">
            <button onClick={handleAnalyze} disabled={analyzing}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Re-analyze
            </button>
            <button onClick={() => chrome.runtime.openOptionsPage()}
              className="text-xs text-gray-400 hover:text-gray-600">
              All policies
            </button>
          </div>
          <p className="text-[9px] text-gray-300 mt-1">Re-analyzing compares against the previous version</p>
        </div>
      )}

      {showOnboarding && <OnboardingDialog onDismiss={() => setShowOnboarding(false)} />}
    </div>
  )
}

function ModelStatusBadge({ sections }: { sections: SectionRecord[] }) {
  const allUsedModel = sections.length > 0 && sections.every((s) => s.modelUsed)
  const noneUsedModel = sections.length > 0 && sections.every((s) => !s.modelUsed)

  if (sections.length === 0) return null

  return (
    <div className="mt-1 flex items-center gap-1.5">
      {allUsedModel ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <span className="text-[10px] text-emerald-600 font-medium">ML model active</span>
          <span className="text-[10px] text-gray-400">&middot; semantic analysis + keyword detection</span>
        </>
      ) : noneUsedModel ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          <span className="text-[10px] text-amber-600 font-medium">Keyword-only mode</span>
          <span className="text-[10px] text-gray-400">&middot; model unavailable, deterministic fallback</span>
        </>
      ) : (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
          <span className="text-[10px] text-blue-600 font-medium">Mixed</span>
          <span className="text-[10px] text-gray-400">&middot; some sections used ML</span>
        </>
      )}
    </div>
  )
}

function TabBtn({ label, active, onClick, count, danger, orange }: {
  label: string; active: boolean; onClick: () => void; count?: number; danger?: boolean; orange?: boolean
}) {
  return (
    <button onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-md transition-colors ${active ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-gray-500 hover:bg-gray-100'} ${orange && !active ? 'text-orange-600 font-medium' : ''}`}>
      {label}
      {count !== undefined && count > 0 && (
        <span className={`ml-1 text-[10px] px-1.5 py-px rounded-full font-medium ${danger ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600'}`}>
          {count}
        </span>
      )}
    </button>
  )
}

function SummaryTab({ sections }: { sections: SectionRecord[] }) {
  if (sections.length === 0) return <p className="text-sm text-gray-400 py-4">No summary available.</p>
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <div key={s.sectionKey} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <h4 className="font-semibold text-gray-800 text-xs mb-1.5">{s.headingText || s.sectionId}</h4>
          <p className="text-gray-600 text-xs leading-relaxed">{s.summary}</p>
          {s.riskFlags.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {s.riskFlags.map((rf, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${DOT_COLORS[rf.category]}`} />
                  <div className="min-w-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[rf.category]}`}>
                      {CATEGORY_LABELS[rf.category]}
                    </span>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{rf.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function RiskTab({ sections }: { sections: SectionRecord[] }) {
  const flags = sections.flatMap((s) => s.riskFlags.map((rf) => ({ ...rf, heading: s.headingText || s.sectionId })))
  if (flags.length === 0) return <p className="text-sm text-gray-400 py-4">No risk flags detected.</p>
  return (
    <div className="space-y-2.5">
      {flags.map((f, i) => (
        <div key={i} className="p-3 rounded-lg border border-gray-100 bg-gray-50/60">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${DOT_COLORS[f.category]}`} />
            <span className={`px-1.5 py-0.5 rounded font-medium text-[10px] ${CATEGORY_COLORS[f.category]}`}>
              {CATEGORY_LABELS[f.category]}
            </span>
            <span className="text-gray-400 text-[10px] truncate ml-auto">{f.heading}</span>
          </div>
          <p className="text-gray-700 text-xs leading-relaxed mb-1.5">{f.reason}</p>
          {f.snippet && (
            <div className="bg-white rounded border border-gray-100 px-2 py-1.5 text-[11px] text-gray-500 italic leading-relaxed">
              &ldquo;{f.snippet}&rdquo;
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function ChangesTab({ changes }: { changes: ChangeRecord[] }) {
  if (changes.length === 0) return <p className="text-sm text-gray-400 py-4">No changes detected.</p>
  return (
    <div className="space-y-2">
      {changes.map((c, i) => (
        <div key={c.id || i} className="p-3 bg-orange-50 rounded-lg border border-orange-200">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-orange-700 font-medium text-[10px]">{new Date(c.changedAt).toLocaleDateString()}</span>
            {c.headingText && <span className="text-gray-400 text-[10px] truncate">{c.headingText}</span>}
          </div>
          <p className="text-gray-700 text-xs">{c.diffSummary}</p>
          {c.oldText && c.newText && <WordDiffView oldText={c.oldText} newText={c.newText} />}
        </div>
      ))}
    </div>
  )
}

function WordDiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const diff = getWordDiff(oldText, newText)
  return (
    <div className="mt-1.5 text-[10px] bg-white rounded border border-gray-200 p-1.5 max-h-20 overflow-y-auto font-mono leading-relaxed">
      {diff.map((part: WordDiff, i: number) => (
        <span key={i} className={part.added ? 'bg-green-100 text-green-800' : part.removed ? 'bg-red-100 text-red-800 line-through' : 'text-gray-500'}>
          {part.value}
        </span>
      ))}
    </div>
  )
}

function OnboardingDialog({ onDismiss }: { onDismiss: () => void }) {
  const [saving, setSaving] = useState(false)
  async function handleDismiss() {
    setSaving(true)
    try { await chrome.storage.local.set({ [FIRST_RUN_ACK_KEY]: true }) } catch {}
    onDismiss()
  }
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-gray-900">Welcome to PolicyLens</h2>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">
          Reads Terms &amp; Conditions and privacy policies on your device, flags risky clauses, and shows what changed since you last agreed.
        </p>
        <p className="mt-2 text-sm text-gray-600 leading-relaxed">Everything runs locally. No policy text leaves your browser.</p>
        <p className="mt-3 text-[11px] text-gray-400 italic">AI-generated summaries are not legal advice.</p>
        <button onClick={handleDismiss} disabled={saving}
          className="mt-4 w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60">
          Get Started
        </button>
      </div>
    </div>
  )
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  function handleDeleteData() {
    if (!confirm('Delete all stored policy data?')) return
    setDeleting(true)
    chrome.runtime.sendMessage({ type: 'DELETE_ALL_DATA' } as ExtensionMessage, () => { setDeleting(false); setDeleted(true) })
  }
  return (
    <div className="px-4 py-3 border-b bg-gray-50 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-700">Settings</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xs">Done</button>
      </div>
      <div className="flex items-center justify-between">
        <div><p className="text-xs text-gray-700">Delete all data</p><p className="text-[10px] text-gray-400">Clears all stored policies</p></div>
        <button onClick={handleDeleteData} disabled={deleting || deleted}
          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50 px-2 py-1 rounded border border-red-200 hover:bg-red-50">
          {deleted ? 'Done' : deleting ? '...' : 'Delete'}
        </button>
      </div>
    </div>
  )
}
