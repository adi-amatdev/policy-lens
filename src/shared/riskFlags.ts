import type { RiskFlag } from './messages'

export const RISK_CATEGORIES: RiskFlag['category'][] = [
  'data-sharing',
  'arbitration',
  'auto-renewal',
  'unilateral-changes',
  'liability-waiver',
  'data-retention',
]

export const CATEGORY_LABELS: Record<RiskFlag['category'], string> = {
  'data-sharing': 'Data Sharing',
  'arbitration': 'Arbitration',
  'auto-renewal': 'Auto Renewal',
  'unilateral-changes': 'Unilateral Changes',
  'liability-waiver': 'Liability Waiver',
  'data-retention': 'Data Retention',
}

export const CATEGORY_COLORS: Record<RiskFlag['category'], string> = {
  'data-sharing': 'bg-red-100 text-red-800',
  'arbitration': 'bg-orange-100 text-orange-800',
  'auto-renewal': 'bg-yellow-100 text-yellow-800',
  'unilateral-changes': 'bg-purple-100 text-purple-800',
  'liability-waiver': 'bg-pink-100 text-pink-800',
  'data-retention': 'bg-blue-100 text-blue-800',
}

export const RISK_FLAG_PROMPT = `Read the following policy section. Identify which of these categories apply, if any:
data-sharing, arbitration, auto-renewal, unilateral-changes, liability-waiver, data-retention.
For each that applies, give a one-sentence reason referencing the specific language.
Respond ONLY as JSON: [{"category":"...","reason":"..."}]. If none apply, respond [].

Section text:
"""
{bodyText}
"""`
