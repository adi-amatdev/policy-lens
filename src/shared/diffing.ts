import { diffWordsWithSpace } from 'diff'

export interface WordDiff {
  value: string
  added?: boolean
  removed?: boolean
}

export function getWordDiff(oldText: string, newText: string): WordDiff[] {
  return diffWordsWithSpace(oldText, newText) as WordDiff[]
}

export function headingSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.8
  const aWords = new Set(na.split(/\s+/))
  const bWords = new Set(nb.split(/\s+/))
  if (aWords.size === 0 || bWords.size === 0) return 0
  let intersection = 0
  for (const w of aWords) {
    if (bWords.has(w)) intersection++
  }
  const union = aWords.size + bWords.size - intersection
  return union === 0 ? 0 : intersection / union
}
