import { useState, useEffect } from 'react'
import type { ExtensionMessage, SectionRecord, ChangeRecord, RiskFlag } from '../shared/messages'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../shared/riskFlags'

type Tab = 'summary' | 'risks' | 'changes'

export default function Popup() {
  const [activeTab, setActiveTab] = useState<Tab>('summary')
  const [sections, setSections] = useState<SectionRecord[]>([])
  const [changes, setChanges] = useState<ChangeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.url) {
        setError('No active tab')
        setLoading(false)
        return
      }

      chrome.runtime.sendMessage(
        { type: 'GET_ANALYSIS_FOR_TAB', tabUrl: tabs[0].url } as ExtensionMessage,
        (response: any) => {
          if (response?.type === 'ANALYSIS_RESULT') {
            setSections(response.sections || [])
            setChanges(response.changes || [])
            if (response.changes?.length > 0) {
              setHasChanges(true)
              setActiveTab('changes')
            }
          }
          if (!response?.sections || response.sections.length === 0) {
            setError('No policy data for this page yet. Try visiting a Terms & Conditions or Privacy Policy page.')
          }
          setLoading(false)
        }
      )
    })
  }, [])

  if (loading) {
    return (
      <div className="w-[380px] p-4 text-center text-gray-500 text-sm">
        <div className="animate-pulse">Loading analysis...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-[380px] p-4">
        <Disclaimer />
        <p className="text-gray-500 text-sm mt-2">{error}</p>
      </div>
    )
  }

  const allRiskFlags = sections.flatMap((s) => s.riskFlags)

  return (
    <div className="w-[380px] p-3">
      <Disclaimer />
      <div className="flex gap-1 mb-3 border-b pb-2">
        <TabButton
          label="Summary"
          isActive={activeTab === 'summary'}
          onClick={() => setActiveTab('summary')}
        />
        <TabButton
          label="Risk Flags"
          isActive={activeTab === 'risks'}
          onClick={() => setActiveTab('risks')}
          count={allRiskFlags.length}
        />
        <TabButton
          label="Changes"
          isActive={activeTab === 'changes'}
          onClick={() => setActiveTab('changes')}
          count={changes.length}
          highlight={hasChanges}
        />
      </div>

      {activeTab === 'summary' && <SummaryTab sections={sections} />}
      {activeTab === 'risks' && <RiskTab sections={sections} />}
      {activeTab === 'changes' && <ChangesTab changes={changes} />}

      <div className="mt-3 pt-2 border-t text-center">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            chrome.runtime.openOptionsPage()
          }}
          className="text-xs text-indigo-600 hover:underline"
        >
          Open full dashboard →
        </a>
      </div>
    </div>
  )
}

function Disclaimer() {
  return (
    <p className="text-xs text-gray-400 italic mb-2">
      AI-generated summary, not legal advice.
    </p>
  )
}

function TabButton({
  label,
  isActive,
  onClick,
  count,
  highlight,
}: {
  label: string
  isActive: boolean
  onClick: () => void
  count?: number
  highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1 rounded-full transition-colors ${
        isActive
          ? 'bg-indigo-100 text-indigo-700 font-medium'
          : 'text-gray-500 hover:bg-gray-100'
      } ${highlight && !isActive ? 'animate-pulse text-orange-600' : ''}`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className="ml-1 text-xs bg-gray-200 px-1.5 rounded-full">{count}</span>
      )}
    </button>
  )
}

function SummaryTab({ sections }: { sections: SectionRecord[] }) {
  if (sections.length === 0) {
    return <p className="text-sm text-gray-400">No summarized sections yet.</p>
  }
  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto">
      {sections.map((s) => (
        <div key={s.sectionKey} className="text-sm">
          <div className="flex flex-wrap gap-1 mb-1">
            {s.riskFlags.map((rf, i) => (
              <span
                key={i}
                className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLORS[rf.category]}`}
              >
                {CATEGORY_LABELS[rf.category]}
              </span>
            ))}
          </div>
          <p className="text-gray-700 leading-relaxed">{s.summary}</p>
        </div>
      ))}
    </div>
  )
}

function RiskTab({ sections }: { sections: SectionRecord[] }) {
  const flags = sections.flatMap((s) =>
    s.riskFlags.map((rf) => ({ ...rf, sectionId: s.sectionId, heading: s.headingText || s.sectionId }))
  )
  if (flags.length === 0) {
    return <p className="text-sm text-gray-400">No risk flags detected in this document.</p>
  }
  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {flags.map((f, i) => (
        <div key={i} className="text-sm p-2 bg-gray-50 rounded">
          <span
            className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[f.category]}`}
          >
            {CATEGORY_LABELS[f.category]}
          </span>
          <p className="text-gray-600 mt-1">{f.reason}</p>
        </div>
      ))}
    </div>
  )
}

function ChangesTab({ changes }: { changes: ChangeRecord[] }) {
  if (changes.length === 0) {
    return <p className="text-sm text-gray-400">No changes detected since last visit.</p>
  }
  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {changes.map((c, i) => (
        <div key={c.id || i} className="text-sm p-2 bg-orange-50 rounded border border-orange-200">
          <p className="text-orange-700 font-medium text-xs mb-1">
            {new Date(c.changedAt).toLocaleDateString()}
          </p>
          <p className="text-gray-700">{c.diffSummary}</p>
        </div>
      ))}
    </div>
  )
}
