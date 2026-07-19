import { openDB, type IDBPDatabase } from 'idb'
import { type SectionRecord, type ChangeRecord, type DomainSummary } from './messages'

const DB_NAME = 'policylens'
const DB_VERSION = 1

interface PolicyLensDB {
  documents: {
    key: string
    value: {
      docId: string
      domain: string
      docUrl: string
      docType: string
      discoveredVia: 'user-visit' | 'crawler'
      firstSeenAt: number
      lastCheckedAt: number
      lastChangedAt: number | null
    }
  }
  sections: {
    key: string
    value: SectionRecord
    indexes: { 'by-docId': string }
  }
  changes: {
    key: number
    value: ChangeRecord
    indexes: { 'by-docId': string; 'by-changedAt': number }
  }
}

let db: IDBPDatabase<PolicyLensDB> | null = null

async function getDB(): Promise<IDBPDatabase<PolicyLensDB>> {
  if (db) return db
  db = (await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('documents')) {
        database.createObjectStore('documents', { keyPath: 'docId' })
      }
      if (!database.objectStoreNames.contains('sections')) {
        const store = database.createObjectStore('sections', { keyPath: 'sectionKey' })
        store.createIndex('by-docId', 'docId')
      }
      if (!database.objectStoreNames.contains('changes')) {
        const store = database.createObjectStore('changes', { autoIncrement: true })
        store.createIndex('by-docId', 'docId')
        store.createIndex('by-changedAt', 'changedAt')
      }
    },
  })) as unknown as IDBPDatabase<PolicyLensDB>
  return db
}

export async function upsertDocument(doc: {
  docId: string
  domain: string
  docUrl: string
  docType: string
  discoveredVia: 'user-visit' | 'crawler'
}): Promise<void> {
  const database = await getDB()
  const existing = await database.get('documents', doc.docId)
  if (existing) {
    existing.lastCheckedAt = Date.now()
    await database.put('documents', existing)
  } else {
    await database.put('documents', {
      ...doc,
      firstSeenAt: Date.now(),
      lastCheckedAt: Date.now(),
      lastChangedAt: null,
    })
  }
}

export async function saveSections(sections: SectionRecord[]): Promise<void> {
  const database = await getDB()
  const tx = database.transaction('sections', 'readwrite')
  for (const s of sections) {
    await tx.store.put(s)
  }
  await tx.done
}

export async function getSections(docId: string): Promise<SectionRecord[]> {
  const database = await getDB()
  const index = database.transaction('sections').store.index('by-docId')
  const results: SectionRecord[] = []
  let cursor = await index.openCursor(docId)
  while (cursor) {
    results.push(cursor.value)
    cursor = await cursor.continue()
  }
  return results
}

export async function getAllSections(): Promise<SectionRecord[]> {
  const database = await getDB()
  return database.getAll('sections')
}

export async function saveChange(change: ChangeRecord): Promise<void> {
  const database = await getDB()
  await database.add('changes', change)
}

export async function getChangesForDoc(docId: string): Promise<ChangeRecord[]> {
  const database = await getDB()
  const index = database.transaction('changes').store.index('by-docId')
  const results: ChangeRecord[] = []
  let cursor = await index.openCursor(docId)
  while (cursor) {
    results.push(cursor.value)
    cursor = await cursor.continue()
  }
  return results
}

export async function getAllDomains(): Promise<DomainSummary[]> {
  const database = await getDB()
  const docs = await database.getAll('documents')
  const allSections = await getAllSections()

  const sectionsByDoc = new Map<string, SectionRecord[]>()
  for (const s of allSections) {
    const list = sectionsByDoc.get(s.docId) || []
    list.push(s)
    sectionsByDoc.set(s.docId, list)
  }

  const domainMap = new Map<string, { docCount: number; riskScores: number[]; lastChanged: number | null }>()

  for (const doc of docs) {
    const entry = domainMap.get(doc.domain) || {
      docCount: 0,
      riskScores: [] as number[],
      lastChanged: null as number | null,
    }
    entry.docCount++
    if (doc.lastChangedAt && (!entry.lastChanged || doc.lastChangedAt > entry.lastChanged)) {
      entry.lastChanged = doc.lastChangedAt
    }
    const sections = sectionsByDoc.get(doc.docId) || []
    const riskCount = sections.reduce((sum, s) => sum + s.riskFlags.length, 0)
    entry.riskScores.push(riskCount)
    domainMap.set(doc.domain, entry)
  }

  return Array.from(domainMap.entries()).map(([domain, info]) => ({
    domain,
    docCount: info.docCount,
    riskScore: info.riskScores.length > 0 ? Math.round(info.riskScores.reduce((a, b) => a + b, 0) / info.riskScores.length) : 0,
    lastChangedAt: info.lastChanged,
  }))
}

export async function getAllChanges(): Promise<ChangeRecord[]> {
  const database = await getDB()
  const index = database.transaction('changes').store.index('by-changedAt')
  const results: ChangeRecord[] = []
  let cursor = await index.openCursor(null, 'prev')
  while (cursor) {
    results.push(cursor.value)
    cursor = await cursor.continue()
  }
  return results
}

export async function setDocLastChanged(docId: string, changedAt: number): Promise<void> {
  const database = await getDB()
  const doc = await database.get('documents', docId)
  if (doc) {
    doc.lastChangedAt = changedAt
    await database.put('documents', doc)
  }
}

export async function getDoc(docId: string): Promise<PolicyLensDB['documents']['value'] | undefined> {
  const database = await getDB()
  return database.get('documents', docId)
}

export async function clearAllData(): Promise<void> {
  const database = await getDB()
  const tx = database.transaction(['documents', 'sections', 'changes'], 'readwrite')
  await Promise.all([
    tx.objectStore('documents').clear(),
    tx.objectStore('sections').clear(),
    tx.objectStore('changes').clear(),
  ])
  await tx.done
  db = null
}
