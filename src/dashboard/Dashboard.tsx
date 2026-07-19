import { useState, useEffect, useRef, useMemo } from 'react'
import type { ExtensionMessage, SectionRecord, ChangeRecord, RiskFlag } from '../shared/messages'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../shared/riskFlags'
import { getWordDiff, type WordDiff } from '../shared/diffing'
import { getAllSections, getChangesForDoc, getAllDocs, type DocRecord } from '../shared/storage'

type View = 'list' | 'detail'
type SortMode = 'latest-read' | 'latest-change'

const DOT_COLORS: Record<string, string> = {
  'data-sharing': 'bg-red-500',
  arbitration: 'bg-orange-500',
  'auto-renewal': 'bg-yellow-500',
  'unilateral-changes': 'bg-purple-500',
  'liability-waiver': 'bg-pink-500',
  'data-retention': 'bg-blue-500',
}

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  sections?: { heading: string; summary: string; bodySnippet: string; risks: RiskFlag[] }[]
}

function searchSections(query: string, allSections: SectionRecord[]): { heading: string; summary: string; bodySnippet: string; risks: RiskFlag[] }[] {
  const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'against', 'it', 'its', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their'])

  const queryTokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((t) => t.length > 2 && !stopWords.has(t))
  if (queryTokens.length === 0) return []

  const scored = allSections.map((s) => {
    const text = `${s.headingText} ${s.summary} ${s.bodyText}`.toLowerCase()
    let score = 0
    for (const token of queryTokens) {
      const regex = new RegExp(`\\b${token}`, 'gi')
      const matches = text.match(regex)
      if (matches) {
        score += matches.length
        if (s.headingText.toLowerCase().includes(token)) score += 5
      }
    }
    return { section: s, score }
  })

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ section: s }) => {
      const bodyLower = s.bodyText.toLowerCase()
      let bestSnippet = s.bodyText.slice(0, 300)
      for (const token of queryTokens) {
        const idx = bodyLower.indexOf(token)
        if (idx !== -1) {
          const start = Math.max(0, idx - 80)
          const end = Math.min(s.bodyText.length, idx + 200)
          bestSnippet = (start > 0 ? '...' : '') + s.bodyText.slice(start, end).trim() + (end < s.bodyText.length ? '...' : '')
          break
        }
      }
      return { heading: s.headingText, summary: s.summary, bodySnippet: bestSnippet, risks: s.riskFlags }
    })
}

export default function Dashboard() {
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [allSections, setAllSections] = useState<SectionRecord[]>([])
  const [sectionsMap, setSectionsMap] = useState<Map<string, SectionRecord[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('list')
  const [selectedDoc, setSelectedDoc] = useState<DocRecord | null>(null)
  const [detailSections, setDetailSections] = useState<SectionRecord[]>([])
  const [detailChanges, setDetailChanges] = useState<ChangeRecord[]>([])
  const [detailTab, setDetailTab] = useState<'summary' | 'risks' | 'changes'>('summary')
  const [sortMode, setSortMode] = useState<SortMode>('latest-read')
  const [deleted, setDeleted] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  async function loadDashboard() {
    setLoading(true)
    const allDocs = await getAllDocs()
    setDocs(allDocs)
    const sm = new Map<string, SectionRecord[]>()
    for (const d of allDocs) {
      sm.set(d.docId, await getAllSectionsFor(d.docId))
    }
    setSectionsMap(sm)
    setAllSections(await getAllSections())
    setLoading(false)
  }

  useEffect(() => { loadDashboard() }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  async function getAllSectionsFor(docId: string): Promise<SectionRecord[]> {
    const all = await getAllSections()
    return all.filter((s) => s.docId === docId)
  }

  async function openDetail(doc: DocRecord) {
    setSelectedDoc(doc)
    const secs = await getAllSections()
    setDetailSections(secs.filter((s) => s.docId === doc.docId))
    setDetailChanges(await getChangesForDoc(doc.docId))
    setDetailTab('summary')
    setView('detail')
  }

  function handleChat() {
    const q = chatInput.trim()
    if (!q || chatLoading) return

    setChatMessages((prev) => [...prev, { role: 'user', text: q }])
    setChatInput('')
    setChatLoading(true)

    setTimeout(() => {
      const results = searchSections(q, allSections)
      let reply: string
      if (results.length === 0) {
        reply = `No matching sections found for "${q}". Try different keywords or make sure you've analyzed a page first.`
      } else {
        reply = `Found ${results.length} relevant section${results.length > 1 ? 's' : ''} across your analyzed policies:`
      }
      setChatMessages((prev) => [...prev, { role: 'assistant', text: reply, sections: results }])
      setChatLoading(false)
    }, 300)
  }

  function handleDeleteData() {
    if (!confirm('Delete ALL stored policy data?')) return
    chrome.runtime.sendMessage({ type: 'DELETE_ALL_DATA' } as ExtensionMessage, () => {
      setDeleted(true); setDocs([]); setSectionsMap(new Map()); setAllSections([])
    })
  }

  function handleClearCache() {
    chrome.runtime.sendMessage({ type: 'DELETE_MODEL_CACHE' } as ExtensionMessage, () => {})
  }

  const sortedDocs = useMemo(() => {
    const arr = [...docs]
    if (sortMode === 'latest-read') {
      arr.sort((a, b) => b.lastCheckedAt - a.lastCheckedAt)
    } else {
      arr.sort((a, b) => {
        const aTime = a.lastChangedAt || 0
        const bTime = b.lastChangedAt || 0
        if (bTime !== aTime) return bTime - aTime
        return b.lastCheckedAt - a.lastCheckedAt
      })
    }
    return arr
  }, [docs, sortMode])

  const domainGroups = useMemo(() => {
    const map = new Map<string, { docs: DocRecord[]; totalRisks: number }>()
    for (const doc of docs) {
      const existing = map.get(doc.domain) || { docs: [], totalRisks: 0 }
      existing.docs.push(doc)
      const secs = sectionsMap.get(doc.docId) || []
      existing.totalRisks += secs.reduce((sum, s) => sum + s.riskFlags.length, 0)
      map.set(doc.domain, existing)
    }
    return map
  }, [docs, sectionsMap])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-sm text-gray-400">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            {view === 'detail' && (
              <button onClick={() => setView('list')} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h1 className="text-2xl font-bold text-gray-900">
              {view === 'detail' ? selectedDoc?.domain || 'Report' : 'PolicyLens Dashboard'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-400 italic">Not legal advice</p>
            {view === 'list' && (
              <div className="flex gap-2">
                <button onClick={handleDeleteData} disabled={deleted}
                  className="text-xs px-3 py-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
                  {deleted ? 'Deleted' : 'Delete All'}
                </button>
                <button onClick={handleClearCache}
                  className="text-xs px-3 py-1.5 rounded border border-orange-200 text-orange-600 hover:bg-orange-50">
                  Clear Cache
                </button>
              </div>
            )}
          </div>
        </div>

        {view === 'list' && (
          <>
            {/* Domain cards */}
            {domainGroups.size > 0 && (
              <section className="mb-8">
                <h2 className="text-lg font-semibold text-gray-800 mb-3">Tracked Domains</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from(domainGroups.entries()).map(([domain, info]) => (
                    <DomainCard key={domain} domain={domain} docs={info.docs} totalRisks={info.totalRisks}
                      sectionsMap={sectionsMap} onClick={() => openDetail(info.docs[0])} />
                  ))}
                </div>
              </section>
            )}

            {/* Reports list with sort */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-800">Reports ({docs.length})</h2>
                {docs.length > 0 && (
                  <div className="flex bg-gray-100 rounded-lg p-0.5">
                    <button onClick={() => setSortMode('latest-read')}
                      className={`text-[11px] px-2.5 py-1 rounded-md transition-colors font-medium ${sortMode === 'latest-read' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                      Latest Read
                    </button>
                    <button onClick={() => setSortMode('latest-change')}
                      className={`text-[11px] px-2.5 py-1 rounded-md transition-colors font-medium ${sortMode === 'latest-change' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                      Latest Change
                    </button>
                  </div>
                )}
              </div>
              {sortedDocs.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
                  <p className="text-gray-400 text-sm">No reports yet.</p>
                  <p className="text-gray-300 text-xs mt-1">Visit a Terms &amp; Conditions or Privacy Policy page to get started.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedDocs.map((doc) => {
                    const secs = sectionsMap.get(doc.docId) || []
                    const riskCount = secs.reduce((sum, s) => sum + s.riskFlags.length, 0)
                    const url = doc.docUrl.replace(/^https?:\/\//, '').slice(0, 70)
                    return (
                      <button key={doc.docId} onClick={() => openDetail(doc)}
                        className="w-full text-left bg-white p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-sm transition-all">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-800">{doc.domain}</span>
                          <span className="text-xs text-gray-400 truncate flex-1">{url}</span>
                          {riskCount > 0 ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium shrink-0">
                              {riskCount} risk{riskCount > 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium shrink-0">Clean</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span className="capitalize">{doc.docType}</span>
                          <span>{secs.length} sections</span>
                          <span>Read {new Date(doc.lastCheckedAt).toLocaleDateString()}</span>
                          {doc.lastChangedAt && <span className="text-orange-500">Changed {new Date(doc.lastChangedAt).toLocaleDateString()}</span>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {view === 'detail' && selectedDoc && (
          <DetailReport doc={selectedDoc} sections={detailSections} changes={detailChanges}
            tab={detailTab} setTab={setDetailTab} />
        )}
      </div>

      {/* Chat toggle button */}
      {view === 'list' && allSections.length > 0 && (
        <button onClick={() => setChatOpen(!chatOpen)}
          className={`fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all z-50 ${chatOpen ? 'bg-gray-600 hover:bg-gray-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
          {chatOpen ? (
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          )}
        </button>
      )}

      {/* Chat panel */}
      {chatOpen && (
        <div className="fixed bottom-24 right-6 w-[420px] max-h-[520px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-50 overflow-hidden">
          <div className="px-4 py-3 border-b bg-indigo-600 text-white shrink-0">
            <h3 className="text-sm font-semibold">PolicyLens Chat</h3>
            <p className="text-[10px] text-indigo-200">Ask questions about your analyzed policies</p>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-center py-8">
                <p className="text-xs text-gray-400 mb-3">Ask anything about your analyzed terms</p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {['What data do they collect?', 'Is there arbitration?', 'Can they share my data?', 'What are the liability terms?'].map((q) => (
                    <button key={q} onClick={() => { setChatInput(q); setTimeout(handleChat, 0) }}
                      className="text-[11px] px-2.5 py-1.5 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
                  <p>{msg.text}</p>
                  {msg.sections && msg.sections.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {msg.sections.map((s, j) => (
                        <div key={j} className="bg-white rounded-lg p-2 border border-gray-200 text-left">
                          <p className="font-medium text-gray-800 text-[11px] mb-0.5">{s.heading}</p>
                          <p className="text-gray-600 text-[11px] leading-relaxed">{s.summary}</p>
                          {s.bodySnippet && (
                            <p className="text-[10px] text-gray-400 italic mt-1 leading-relaxed">"{s.bodySnippet}"</p>
                          )}
                          {s.risks.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {s.risks.map((rf, k) => (
                                <span key={k} className={`text-[9px] px-1 py-0.5 rounded ${CATEGORY_COLORS[rf.category]}`}>
                                  {CATEGORY_LABELS[rf.category]}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-xl px-3 py-2 text-xs text-gray-400">
                  Searching policies...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="px-3 py-2 border-t shrink-0">
            <form onSubmit={(e) => { e.preventDefault(); handleChat() }} className="flex gap-2">
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about terms, data, risks..."
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300" />
              <button type="submit" disabled={!chatInput.trim() || chatLoading}
                className="px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function DomainCard({ domain, docs, totalRisks, sectionsMap, onClick }: {
  domain: string; docs: DocRecord[]; totalRisks: number;
  sectionsMap: Map<string, SectionRecord[]>; onClick: () => void
}) {
  const riskColor = totalRisks === 0 ? 'bg-green-100 text-green-800' :
    totalRisks <= 3 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'

  const allRisks = docs.flatMap((d) => (sectionsMap.get(d.docId) || []).flatMap((s) => s.riskFlags))
  const categories = [...new Set(allRisks.map((r) => r.category))]

  return (
    <button onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm text-left hover:border-indigo-300 hover:shadow-md transition-all w-full">
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-medium text-gray-900">{domain}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskColor}`}>
          Risk: {totalRisks}
        </span>
      </div>
      <div className="flex gap-4 text-xs text-gray-500 mb-2">
        <span>{docs.length} document{docs.length !== 1 ? 's' : ''}</span>
        {categories.length > 0 && (
          <span className="flex items-center gap-1">
            {categories.slice(0, 4).map((c) => (
              <span key={c} className={`w-2 h-2 rounded-full ${DOT_COLORS[c]}`} />
            ))}
          </span>
        )}
      </div>
      <p className="text-xs text-indigo-500 font-medium">View full report &rarr;</p>
    </button>
  )
}

function DetailReport({ doc, sections, changes, tab, setTab }: {
  doc: DocRecord; sections: SectionRecord[]; changes: ChangeRecord[];
  tab: 'summary' | 'risks' | 'changes'; setTab: (t: 'summary' | 'risks' | 'changes') => void
}) {
  const allRiskFlags = sections.flatMap((s) => s.riskFlags)
  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium capitalize">{doc.docType}</span>
          <span className="text-xs text-gray-400">{new Date(doc.firstSeenAt).toLocaleString()}</span>
        </div>
        <p className="text-xs text-gray-500 break-all">{doc.docUrl}</p>
        {doc.lastChangedAt && (
          <p className="text-xs text-orange-500 mt-1">Last changed: {new Date(doc.lastChangedAt).toLocaleString()}</p>
        )}
      </div>

      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        <DetailTabBtn label="Summary" active={tab === 'summary'} onClick={() => setTab('summary')} />
        <DetailTabBtn label={`Risks (${allRiskFlags.length})`} active={tab === 'risks'} onClick={() => setTab('risks')}
          danger={allRiskFlags.length > 0 && tab !== 'risks'} />
        <DetailTabBtn label={`Changes (${changes.length})`} active={tab === 'changes'} onClick={() => setTab('changes')}
          orange={changes.length > 0 && tab !== 'changes'} />
      </div>

      <div className="space-y-3">
        {tab === 'summary' && (
          sections.length === 0 ? <EmptyState text="No sections analyzed." /> :
          sections.map((s) => (
            <div key={s.sectionKey} className="bg-white rounded-xl border border-gray-200 p-4">
              <h4 className="font-semibold text-gray-800 text-sm mb-2">{s.headingText || s.sectionId}</h4>
              <p className="text-gray-600 text-sm leading-relaxed mb-3">{s.summary}</p>
              {s.riskFlags.length > 0 && (
                <div className="space-y-1.5">
                  {s.riskFlags.map((rf, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${DOT_COLORS[rf.category]}`} />
                      <div>
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[rf.category]}`}>
                          {CATEGORY_LABELS[rf.category]}
                        </span>
                        <p className="text-xs text-gray-500 mt-0.5">{rf.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {tab === 'risks' && (
          allRiskFlags.length === 0 ? <EmptyState text="No risk flags detected." /> :
          (() => {
            const flags = sections.flatMap((s) => s.riskFlags.map((rf) => ({ ...rf, heading: s.headingText || s.sectionId })))
            return flags.map((f, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-3 h-3 rounded-full shrink-0 ${DOT_COLORS[f.category]}`} />
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[f.category]}`}>
                    {CATEGORY_LABELS[f.category]}
                  </span>
                  <span className="text-gray-400 text-xs ml-auto">{f.heading}</span>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed mb-2">{f.reason}</p>
                {f.snippet && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 italic leading-relaxed border border-gray-100">
                    "{f.snippet}"
                  </div>
                )}
              </div>
            ))
          })()
        )}

        {tab === 'changes' && (
          changes.length === 0 ? <EmptyState text="No changes detected." /> :
          changes.map((c, i) => (
            <div key={c.id || i} className="bg-white rounded-xl border border-orange-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-orange-700 font-medium text-xs">{new Date(c.changedAt).toLocaleString()}</span>
                {c.headingText && <span className="text-gray-400 text-xs">{c.headingText}</span>}
              </div>
              <p className="text-sm text-gray-700 mb-2">{c.diffSummary}</p>
              {c.oldText && c.newText && (
                <div className="text-xs bg-gray-50 rounded-lg border border-gray-200 p-2 max-h-32 overflow-y-auto font-mono leading-relaxed">
                  {getWordDiff(c.oldText, c.newText).map((part: WordDiff, j: number) => (
                    <span key={j} className={part.added ? 'bg-green-100 text-green-800' : part.removed ? 'bg-red-100 text-red-800 line-through' : 'text-gray-500'}>
                      {part.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function DetailTabBtn({ label, active, onClick, danger, orange }: {
  label: string; active: boolean; onClick: () => void; danger?: boolean; orange?: boolean
}) {
  return (
    <button onClick={onClick}
      className={`flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${active ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'} ${danger && !active ? 'text-red-600' : ''} ${orange && !active ? 'text-orange-600' : ''}`}>
      {label}
    </button>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
      <p className="text-gray-400 text-sm">{text}</p>
    </div>
  )
}
