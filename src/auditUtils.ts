import type { VoterRecord, AuditResult, FieldDiff, WardStat } from './types'

export const COMPARE_FIELDS: (keyof VoterRecord)[] = [
  'slNo', 'nameMl', 'nameEn', 'age', 'gender',
  'relationType', 'relationNameMl', 'relationNameEn',
  'houseMl', 'houseEn',
]

export const FIELD_LABELS: Record<string, string> = {
  slNo: 'Serial No',
  nameMl: 'Name (Malayalam)',
  nameEn: 'Name (English)',
  age: 'Age',
  gender: 'Gender',
  relationType: 'Relation Type',
  relationNameMl: 'Relation Name (ML)',
  relationNameEn: 'Relation Name (EN)',
  houseMl: 'House (Malayalam)',
  houseEn: 'House (English)',
}

export function normalize(val: unknown): string {
  if (val === undefined || val === null) return ''
  return String(val).trim()
}

export function normalizeGender(v: string): string {
  const s = v.toLowerCase()
  if (s === 'male' || s === 'm' || s === 'പുരുഷൻ') return 'Male'
  if (s === 'female' || s === 'f' || s === 'സ്ത്രീ') return 'Female'
  return v
}

export function getBoothId(r: VoterRecord): string {
  if (!r.boothId) return ''
  if (typeof r.boothId === 'object' && '$oid' in r.boothId) return r.boothId.$oid
  return String(r.boothId)
}

export function buildCorrected(pdf: VoterRecord | null, json: VoterRecord | null, mismatches: Record<string, FieldDiff>): VoterRecord {
  // Start from json record (has extra DB fields like mobile, ward, email)
  // Override fields where PDF is the source of truth
  const base: VoterRecord = { ...(json ?? {}), ...(pdf ?? {}) }
  // For any mismatch, PDF wins
  Object.entries(mismatches).forEach(([f, diff]) => {
    if (diff.pdf) base[f] = diff.pdf
  })
  return base
}

export function compareRecords(
  pdfRecords: VoterRecord[],
  jsonRecords: VoterRecord[],
  boothId: string
): AuditResult[] {
  const pdfMap = new Map<string, VoterRecord>()
  pdfRecords.forEach(r => { if (r.voterId) pdfMap.set(r.voterId, r) })

  const jsonMap = new Map<string, VoterRecord>()
  jsonRecords.forEach(r => {
    const bId = getBoothId(r)
    if (boothId && bId && bId !== boothId) return
    if (r.voterId) jsonMap.set(r.voterId, r)
  })

  const allIds = new Set([...pdfMap.keys(), ...jsonMap.keys()])
  const results: AuditResult[] = []

  allIds.forEach(id => {
    const pdf = pdfMap.get(id) ?? null
    const jsn = jsonMap.get(id) ?? null

    if (pdf && !jsn) {
      results.push({
        voterId: id, slNo: pdf.slNo ?? '',
        status: 'Missing in Target', mismatches: {},
        pdf, json: null, corrected: { ...pdf },
      })
      return
    }
    if (!pdf && jsn) {
      results.push({
        voterId: id, slNo: jsn.slNo ?? '',
        status: 'Missing in Source', mismatches: {},
        pdf: null, json: jsn, corrected: { ...jsn },
      })
      return
    }
    if (pdf && jsn) {
      const mismatches: Record<string, FieldDiff> = {}
      COMPARE_FIELDS.forEach(f => {
        let pv = normalize(pdf[f])
        let jv = normalize(jsn[f])
        if (f === 'gender') { pv = normalizeGender(pv); jv = normalizeGender(jv) }
        if (f === 'age') { pv = String(parseInt(pv) || ''); jv = String(parseInt(jv) || '') }
        if (pv !== jv && (pv || jv)) mismatches[String(f)] = { pdf: pv, json: jv }
      })
      results.push({
        voterId: id,
        slNo: pdf.slNo ?? '',
        status: Object.keys(mismatches).length ? 'Mismatch' : 'Match',
        mismatches, pdf, json: jsn,
        corrected: buildCorrected(pdf, jsn, mismatches),
      })
    }
  })

  return results.sort((a, b) => (parseInt(a.slNo) || 0) - (parseInt(b.slNo) || 0))
}

export function computeWardStats(results: AuditResult[]): WardStat[] {
  const map = new Map<string, WardStat>()
  results.forEach(r => {
    const src = r.json ?? r.pdf ?? {}
    const ward = normalize(src.ward) || 'Unknown'
    if (!map.has(ward)) map.set(ward, { ward, total: 0, match: 0, mismatch: 0, missing: 0 })
    const s = map.get(ward)!
    s.total++
    if (r.status === 'Match') s.match++
    else if (r.status === 'Mismatch') s.mismatch++
    else s.missing++
  })
  return Array.from(map.values()).sort((a, b) => a.ward.localeCompare(b.ward))
}

// export async function extractPdfVoters(base64Pdf: string, apiKey: string): Promise<VoterRecord[]> {
//   const prompt = `Extract ALL voter records from this Kerala Electoral Roll PDF (Malayalam text, Booth 56).
// Each voter card has: serial number, voter ID (e.g. UAZ..., MST..., LJG..., HVK..., DLL..., etc.),
// name in Malayalam (പേര്), relation type (Father=അച്ഛൻ/Husband=ഭർത്താവ്/Mother=അമ്മ),
// relation name in Malayalam, house number/name, age (പ്രായം), gender.

// Gender: explicitly "Male" or "Female" based on position (male=left column, female=right column pattern, or ഫോട്ടോ ലഭ്യമണ്/ലഭ്യമില്ല label).
// Transliterate ALL Malayalam text to English for nameEn, houseEn, relationNameEn fields.

// Return ONLY a raw JSON array (no markdown, no backticks, no explanation):
// [{"slNo":"1","voterId":"UAZ1489186","nameMl":"ബിബിൻ ബാബു","nameEn":"Bibin Babu","age":27,"gender":"Male","relationType":"Father","relationNameMl":"ബാബു","relationNameEn":"Babu","houseMl":"പാറയ്ക്കൽ","houseEn":"Parayakkal"}]`

//   // Calls local proxy (server.js) to avoid CORS
//   const resp = await fetch('http://localhost:3001/api/anthropic', {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       'x-api-key': apiKey,
//     },
//     body: JSON.stringify({
//       model: 'claude-opus-4-5',
//       max_tokens: 16000,
//       messages: [{
//         role: 'user',
//         content: [
//           { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
//           { type: 'text', text: prompt },
//         ],
//       }],
//     }),
//   })

//   if (!resp.ok) {
//     const err = await resp.json() as { error?: { message?: string } }
//     throw new Error('API error: ' + (err.error?.message ?? resp.status))
//   }

//   const data = await resp.json() as { content: Array<{ type: string; text?: string }> }
//   const text = data.content.map(b => b.text ?? '').join('')
//   const clean = text.replace(/```json|```/g, '').trim()

//   try {
//     return JSON.parse(clean) as VoterRecord[]
//   } catch {
//     // Salvage truncated JSON
//     const lastComma = clean.lastIndexOf('},')
//     if (lastComma > 0) {
//       const salvaged = (clean.startsWith('[') ? '' : '[') + clean.slice(0, lastComma + 1) + ']'
//       try { return JSON.parse(salvaged) as VoterRecord[] } catch { /* fall through */ }
//     }
//     throw new Error('Failed to parse AI response. The PDF may be too large — try splitting pages.')
//   }
// }


export async function extractPdfVoters(base64Pdf: string, apiKey: string): Promise<VoterRecord[]> {
  const prompt = `Extract ALL voter records from this Kerala Electoral Roll PDF (Malayalam text, Booth 56).
Each voter card has: serial number, voter ID (e.g. UAZ..., MST..., LJG..., HVK..., DLL..., etc.),
name in Malayalam (പേര്), relation type (Father=അച്ഛൻ/Husband=ഭർത്താവ്/Mother=അമ്മ),
relation name in Malayalam, house number/name, age (പ്രായം), gender.

Gender: explicitly "Male" or "Female" based on position (male=left column, female=right column pattern).
Transliterate ALL Malayalam text to English for nameEn, houseEn, relationNameEn fields.

Return ONLY a raw JSON array (no markdown, no backticks, no explanation):
[{"slNo":"1","voterId":"UAZ1489186","nameMl":"ബിബിൻ ബാബു","nameEn":"Bibin Babu","age":27,"gender":"Male","relationType":"Father","relationNameMl":"ബാബു","relationNameEn":"Babu","houseMl":"പാറയ്ക്കൽ","houseEn":"Parayakkal"}]`

  const resp = await fetch('http://localhost:3001/api/gemini', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
     model: 'gemini-2.5-flash',        
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: 'application/pdf',
              data: base64Pdf,
            },
          },
          { text: prompt },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 16000,
        temperature: 0,
      },
    }),
  })

  if (!resp.ok) {
    const err = await resp.json() as { error?: { message?: string } }
    throw new Error('Gemini API error: ' + (err.error?.message ?? resp.status))
  }

  const data = await resp.json() as {
    candidates: Array<{
      content: { parts: Array<{ text: string }> }
    }>
  }

  const text = data.candidates?.[0]?.content?.parts
    ?.map(p => p.text ?? '')
    .join('') ?? ''

  const clean = text.replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(clean) as VoterRecord[]
  } catch {
    const lastComma = clean.lastIndexOf('},')
    if (lastComma > 0) {
      const salvaged = (clean.startsWith('[') ? '' : '[') + clean.slice(0, lastComma + 1) + ']'
      try { return JSON.parse(salvaged) as VoterRecord[] } catch { /* fall through */ }
    }
    throw new Error('Failed to parse Gemini response. Try splitting the PDF into fewer pages.')
  }
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.readAsDataURL(file)
    r.onload = () => resolve((r.result as string).split(',')[1])
    r.onerror = reject
  })
}

export async function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.readAsText(file)
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
  })
}

// ─── DB UPDATE HELPERS ────────────────────────────────────────────────────────

export interface UpdateResult {
  success: boolean
  voterId: string
  updatedFields?: string[]
  error?: string
}

export interface BulkUpdateResult {
  success: boolean
  successCount: number
  notFoundCount: number
  errorCount: number
  totalSent: number
  errors: Array<{ voterId: string; error: string }>
}

/** Build fields-to-update object from an AuditResult (only mismatched fields, PDF values) */
// export function buildUpdatePayload(result: AuditResult): Record<string, unknown> {
//   const payload: Record<string, unknown> = {}
//   for (const field of Object.keys(result.mismatches)) {
//     const correctedVal = result.corrected[field as keyof VoterRecord]
//     if (correctedVal !== undefined && correctedVal !== null && correctedVal !== '') {
//       payload[field] = correctedVal  // ✅ uses edited corrected value
//     }
//   }
//   return payload
// }

export function buildUpdatePayload(result: AuditResult): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  for (const field of Object.keys(result.mismatches)) {
    const correctedVal = result.corrected[field as keyof VoterRecord]
    if (correctedVal !== undefined && correctedVal !== null && correctedVal !== '') {
      payload[field] = correctedVal  // PDF value OR manually edited value
    }
  }
  return payload
}

/** Update a single voter — only mismatched fields */
export async function pushSingleToDb(
  voterId: string,
  fields: Record<string, unknown>
): Promise<UpdateResult> {
  const resp = await fetch('http://localhost:3001/api/update-voter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voterId, fields }),
  })
  const data = await resp.json() as UpdateResult & { error?: string }
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`)
  return data
}

/** Bulk update all mismatched voters */
export async function pushBulkToDb(
  results: import('./types').AuditResult[]
): Promise<BulkUpdateResult> {
  const updates = results
    .filter(r => r.status === 'Mismatch' && Object.keys(r.mismatches).length > 0)
    .map(r => ({ voterId: r.voterId, fields: buildUpdatePayload(r) }))
    .filter(u => Object.keys(u.fields).length > 0)

  if (updates.length === 0) throw new Error('No mismatch records to update')

  const resp = await fetch('http://localhost:3001/api/update-voters-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  })
  const data = await resp.json() as BulkUpdateResult & { error?: string }
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`)
  return data
}
