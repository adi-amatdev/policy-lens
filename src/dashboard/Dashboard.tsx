import { useState, useEffect } from 'react'
import type { ExtensionMessage, DomainSummary, ChangeRecord } from '../shared/messages'
import { getAllChanges } from '../shared/storage'

export default function Dashboard() {
  const [domains, setDomains] = useState<DomainSummary[]>([])
  const [recentChanges, setRecentChanges] = useState<ChangeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [deleted, setDeleted] = useState(false)
  const [cacheCleared, setCacheCleared] = useState(false)

  useEffect(() => {
    async function load() {
      chrome.runtime.sendMessage(
        { type: 'GET_DASHBOARD_DATA' } as ExtensionMessage,
        (response: any) => {
          if (response?.type === 'DASHBOARD_DATA') {
            setDomains(response.domains || [])
          }
        }
      )
      try {
        const changes = await getAllChanges()
        setRecentChanges(changes.slice(0, 50))
      } catch {}
      setLoading(false)
    }
    load()
  }, [])

  function handleDeleteData() {
    if (!confirm('Delete ALL stored policy data? This cannot be undone.')) return
    chrome.runtime.sendMessage({ type: 'DELETE_ALL_DATA' } as ExtensionMessage, () => {
      setDeleted(true)
      setDomains([])
      setRecentChanges([])
    })
  }

  function handleClearCache() {
    chrome.runtime.sendMessage({ type: 'DELETE_MODEL_CACHE' } as ExtensionMessage, () => {
      setCacheCleared(true)
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500 animate-pulse">Loading dashboard...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">PolicyLens Dashboard</h1>
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-400 italic">AI-generated summaries, not legal advice</p>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={handleDeleteData}
            disabled={deleted}
            className="text-xs px-3 py-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleted ? '✓ Data Deleted' : 'Delete All Data'}
          </button>
          <button
            onClick={handleClearCache}
            disabled={cacheCleared}
            className="text-xs px-3 py-1.5 rounded border border-orange-200 text-orange-600 hover:bg-orange-50 disabled:opacity-50"
          >
            {cacheCleared ? '✓ Cache Cleared' : 'Clear Model Cache'}
          </button>
        </div>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Tracked Domains</h2>
          {domains.length === 0 ? (
            <p className="text-gray-400 text-sm">
              No domains analyzed yet. Visit a Terms & Conditions or Privacy Policy page to get started.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {domains.map((d) => (
                <DomainCard key={d.domain} domain={d} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Recent Changes</h2>
          {recentChanges.length === 0 ? (
            <p className="text-gray-400 text-sm">No changes detected yet.</p>
          ) : (
            <div className="space-y-2">
              {recentChanges.map((c, i) => (
                <div key={c.id || i} className="bg-white p-3 rounded-lg border border-orange-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-800">{c.domain}</span>
                    {c.headingText && (
                      <span className="text-xs text-gray-400">: {c.headingText}</span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">
                      {new Date(c.changedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">{c.diffSummary}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function DomainCard({ domain }: { domain: DomainSummary }) {
  const riskColor = domain.riskScore === 0 ? 'bg-green-100 text-green-800' :
    domain.riskScore <= 3 ? 'bg-yellow-100 text-yellow-800' :
    'bg-red-100 text-red-800'

  return (
    <div className="bg-white rounded-lg border p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <h3 className="font-medium text-gray-900">{domain.domain}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskColor}`}>
          Risk: {domain.riskScore}
        </span>
      </div>
      <div className="mt-2 flex gap-4 text-sm text-gray-500">
        <span>{domain.docCount} document{domain.docCount !== 1 ? 's' : ''}</span>
        {domain.lastChangedAt && (
          <span>
            Changed: {new Date(domain.lastChangedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  )
}
