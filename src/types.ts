export interface VoterRecord {
  slNo?: string
  voterId?: string
  nameMl?: string
  nameEn?: string
  age?: number | string
  gender?: string
  relationType?: string
  relationNameMl?: string
  relationNameEn?: string
  houseMl?: string
  houseEn?: string
  ward?: string
  mobile?: string | null
  mobile2?: string | null
  email?: string | null
  status?: string
  boothId?: { $oid: string } | string
  [key: string]: unknown
}

export interface FieldDiff {
  pdf: string
  json: string
}

export type AuditStatus = 'Match' | 'Mismatch' | 'Missing in Target' | 'Missing in Source'

export interface AuditResult {
  voterId: string
  slNo: string
  status: AuditStatus
  mismatches: Record<string, FieldDiff>
  pdf: VoterRecord | null
  json: VoterRecord | null
  corrected: VoterRecord
}

export interface AuditStats {
  total: number
  match: number
  mismatch: number
  missingTarget: number
  missingSource: number
}

export type SortField = 'slNo' | 'voterId' | 'nameEn' | 'status' | 'age'
export type SortDir = 'asc' | 'desc'

export interface WardStat {
  ward: string
  total: number
  match: number
  mismatch: number
  missing: number
}
