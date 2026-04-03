import type { VoterRecord, AuditResult, FieldDiff, WardStat } from './types'
import { PDFDocument } from 'pdf-lib'
export const COMPARE_FIELDS: (keyof VoterRecord)[] = [
  'slNo', 'nameMl', 'nameEn', 'age', 'gender',
  'relationType', 'relationNameMl', 'relationNameEn',
  'houseMl', 'houseEn',
]
type ExtractedVoter = VoterRecord & {
  isDeleted?: boolean
}
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

// const API_BASE_URL = 'https://gemini-extractor-backend.onrender.com'
const API_BASE_URL = 'http://localhost:3001'    // for local testing


export function normalize(val: unknown): string {
  if (val === undefined || val === null) return ''
  return String(val).trim()
}

// function fixMalayalam(pdfVal: string, jsonVal: string, fallbackEn?: string) {
//   // 🔥 If corrupted → prefer JSON
//   if (pdfVal.includes('�')) {
//     return jsonVal || fallbackEn || pdfVal
//   }

//   // 🔥 If suspicious (partial corruption)
//   if (jsonVal && pdfVal.length < jsonVal.length * 0.7) {
//     return jsonVal
//   }

//   return pdfVal
// }

function fixMalayalam(pdfVal: string, jsonVal: string, fallbackEn?: string): string {
  const pdfCorrupted = pdfVal.includes('�')
  const jsonCorrupted = jsonVal.includes('�')

  if (pdfCorrupted && !jsonCorrupted && jsonVal) return jsonVal
  if (jsonCorrupted && !pdfCorrupted && pdfVal) return pdfVal
  if (pdfCorrupted && jsonCorrupted) return fallbackEn || pdfVal
  if (jsonVal && pdfVal.length < jsonVal.length * 0.7) return jsonVal

  return pdfVal
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
  const base: VoterRecord = { ...(json ?? {}), ...(pdf ?? {}) }
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
  // jsonRecords.forEach(r => {
  //   const bId = getBoothId(r)
  //   if (boothId && bId && bId !== boothId) return
  //   if (r.voterId) jsonMap.set(r.voterId, r)
  // })
  jsonRecords.forEach(r => {
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

// 🔥 Malayalam corruption fix
if (f === 'nameMl') {
  pv = fixMalayalam(pv, jv, normalize(pdf.nameEn))
}

if (f === 'relationNameMl') {
  pv = fixMalayalam(pv, jv, normalize(pdf.relationNameEn))
}

if (f === 'houseMl') {
  pv = fixMalayalam(pv, jv, normalize(pdf.houseEn))
}
if (pv !== normalize(pdf[f])) {
  console.warn(`🔧 Fixed corrupted ${f} for ${pdf.voterId}`)
}
        if (f === 'gender') { pv = normalizeGender(pv); jv = normalizeGender(jv) }
        if (f === 'age') {
  const pa = parseInt(pv); const ja = parseInt(jv)
  pv = isNaN(pa) ? '' : String(pa)
  jv = isNaN(ja) ? '' : String(ja)
}
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

// ─── PDF CHUNKING ─────────────────────────────────────────────────────────────
// Splits a base64 PDF into N-page chunks using pdf-lib (loaded via CDN in browser)
// Falls back to sending the full PDF if pdf-lib is unavailable

// async function splitPdfIntoChunks(base64Pdf: string, chunkSize: number): Promise<string[]> {
//   try {
//     // Dynamically import pdf-lib from CDN
//     // const { PDFDocument } = await (import { PDFDocument } from 'pdf-lib') as string) as { PDFDocument: { load: (b: Uint8Array) => Promise<{ getPageCount: () => number }> } }

//     const pdfBytes = Uint8Array.from(atob(base64Pdf), c => c.charCodeAt(0))
//     // @ts-expect-error dynamic cdn import
//     const { PDFDocument: PDFDoc } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js')
//     const srcDoc = await PDFDoc.load(pdfBytes)
//     const totalPages = srcDoc.getPageCount()
//     const chunks: string[] = []

//     for (let start = 0; start < totalPages; start += chunkSize) {
//       const end = Math.min(start + chunkSize, totalPages)
//       const newDoc = await PDFDoc.create()
//       const pages = await newDoc.copyPages(srcDoc, Array.from({ length: end - start }, (_, i) => start + i))
//       pages.forEach((p: unknown) => newDoc.addPage(p))
//       const chunkBytes = await newDoc.save()
//       const base64Chunk = btoa(String.fromCharCode(...new Uint8Array(chunkBytes)))
//       chunks.push(base64Chunk)
//     }

//     return chunks
//   }
//   //  catch {
//   //   // pdf-lib not available or failed — return full PDF as single chunk
//   //   return [base64Pdf]
//   // }
//   catch (err) {
//   throw new Error('PDF splitting failed — cannot guarantee full extraction')
// }
// }

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000 // 32KB chunks (prevents stack overflow)

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const subarray = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...subarray)
  }

  return btoa(binary)
}

async function splitPdfIntoChunks(base64Pdf: string, chunkSize: number): Promise<string[]> {
  try {
    const pdfBytes = Uint8Array.from(atob(base64Pdf), c => c.charCodeAt(0))
    const srcDoc = await PDFDocument.load(pdfBytes)

    const totalPages = srcDoc.getPageCount()
    const chunks: string[] = []
    const OVERLAP = 1
    for (let start = 0; start < totalPages; start += chunkSize) {
      const end = Math.min(start + chunkSize+ OVERLAP, totalPages)

      const newDoc = await PDFDocument.create()
      const pages = await newDoc.copyPages(
        srcDoc,
        Array.from({ length: end - start }, (_, i) => start + i)
      )

      pages.forEach(p => newDoc.addPage(p))

      const chunkBytes = await newDoc.save()
      // const base64Chunk = btoa(
      //   String.fromCharCode(...new Uint8Array(chunkBytes))
      // )
      const base64Chunk = uint8ToBase64(new Uint8Array(chunkBytes))
      chunks.push(base64Chunk)
    }
    console.log('Total chunks:', chunks.length)
    return chunks
  } catch (err) {
    console.error('PDF split failed:', err)
    throw new Error('PDF splitting failed — cannot guarantee full extraction')
  }
}


// ─── GEMINI EXTRACTION (single chunk) ────────────────────────────────────────
async function extractChunk(base64Chunk: string, apiKey: string, chunkIndex: number, totalChunks: number): Promise<VoterRecord[]> {
//   const prompt = `Extract ALL voter records from this Kerala Electoral Roll PDF (Malayalam text).
// Each voter card has: serial number, voter ID (e.g. UAZ..., MST..., LJG..., HVK..., DLL..., etc.),
// name in Malayalam (പേര്), relation type (Father=അച്ഛൻ/Husband=ഭർത്താവ്/Mother=അമ്മ),
// relation name in Malayalam, house number/name, age (പ്രായം), gender.

// This is chunk ${chunkIndex + 1} of ${totalChunks}. Extract EVERY voter card visible — do not skip any.
// Gender: "Male" or "Female" based on column position (left=Male, right=Female).
// Transliterate ALL Malayalam text to English for nameEn, houseEn, relationNameEn fields.

// Return ONLY a raw JSON array (no markdown, no backticks, no explanation):
// [{"slNo":"1","voterId":"UAZ1489186","nameMl":"ബിബിൻ ബാബു","nameEn":"Bibin Babu","age":27,"gender":"Male","relationType":"Father","relationNameMl":"ബാബു","relationNameEn":"Babu","houseMl":"പാറയ്ക്കൽ","houseEn":"Parayakkal"}]`
const prompt = `Extract ALL voter records from this Kerala Electoral Roll PDF (Malayalam text).

Each voter card contains:
- Serial number (slNo)
- Voter ID (e.g. UAZ..., MST..., LJG..., HVK..., DLL..., etc.)
- Name in Malayalam (പേര്)
- Relation type (Father=അച്ഛൻ / Husband=ഭർത്താവ് / Mother=അമ്മ)
- Relation name in Malayalam
- House name/number
- Age (പ്രായം)
- Gender (based on column position)

⚠️ IMPORTANT — DELETED DETECTION:

For EACH voter card, also return:
"isDeleted": true | false
"deletionConfidence": "High" | "Medium" | "Low"

Set isDeleted = true if ANY of the following is present:
- The word "DELETED" appears anywhere
- A diagonal line crosses the voter card
- The entry is struck out or visually cancelled
- Any marking indicating removal

Otherwise:
"isDeleted": false

❗ DO NOT skip any voter cards.
Even deleted voters MUST be included, but marked correctly.

This is chunk ${chunkIndex + 1} of ${totalChunks}.
Extract EVERY voter card visible.

Gender Rules:
- Left column → Male
- Right column → Female

Transliteration Rules:
- Convert ALL Malayalam text into English for:
  - nameEn
  - relationNameEn
  - houseEn

Return BOTH Malayalam and English fields:
- nameMl + nameEn
- relationNameMl + relationNameEn
- houseMl + houseEn

⚠️ OUTPUT FORMAT (STRICT):

Return ONLY a raw JSON array.
NO markdown, NO explanation, NO backticks.

Example:
[
  {
    "slNo": "1",
    "voterId": "UAZ1489186",
    "nameMl": "ബിബിൻ ബാബു",
    "nameEn": "Bibin Babu",
    "age": 27,
    "gender": "Male",
    "relationType": "Father",
    "relationNameMl": "ബാബു",
    "relationNameEn": "Babu",
    "houseMl": "പാറയ്ക്കൽ",
    "houseEn": "Parayakkal",
    "isDeleted": false
  }
]`
  const resp = await fetch(`${API_BASE_URL}/api/gemini`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      contents: [{
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: base64Chunk } },
          { text: prompt },
        ],
      }],
      generationConfig: { maxOutputTokens: 32000, temperature: 0 },
    }),
  })

  if (!resp.ok) {
    const err = await resp.json() as { error?: { message?: string } }
    throw new Error('Gemini API error: ' + (err.error?.message ?? resp.status))
  }

  const data = await resp.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>
  }

  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    return JSON.parse(clean) as VoterRecord[]
  } catch {
    // Salvage truncated JSON
    const lastComma = clean.lastIndexOf('},')
    if (lastComma > 0) {
      const salvaged = (clean.startsWith('[') ? '' : '[') + clean.slice(0, lastComma + 1) + ']'
      try { return JSON.parse(salvaged) as VoterRecord[] } catch { /* fall through */ }
    }
    console.warn(`Chunk ${chunkIndex + 1} parse failed, returning empty`)
    return []
  }
}

async function extractChunkWithRetry(
  chunk: string,
  apiKey: string,
  chunkIndex: number,
  totalChunks: number,
  retries = 2
): Promise<VoterRecord[]> {
  try {
    return await extractChunk(chunk, apiKey, chunkIndex, totalChunks)
  } catch (err) {
    if (retries > 0) {
      return extractChunkWithRetry(chunk, apiKey, chunkIndex, totalChunks, retries - 1)
    }
    console.warn(`Chunk ${chunkIndex + 1} failed after retries`)
    return []
  }
}


async function processChunksParallel(
  chunks: string[],
  apiKey: string,
  onProgress?: (msg: string, pct: number) => void
): Promise<VoterRecord[]> {
  const CONCURRENCY = 3 // safe for Gemini

  const allRecords: VoterRecord[] = []
  const seen = new Set<string>()

  let index = 0

  async function worker(workerId: number) {
    while (index < chunks.length) {
      const i = index++
      const pct = 10 + Math.round((i / chunks.length) * 70)

      onProgress?.(
        `Worker ${workerId} → Chunk ${i + 1}/${chunks.length}...`,
        pct
      )

      try {
        // const records = await extractChunk(chunks[i], apiKey, i, chunks.length)
const records = await extractChunkWithRetry(
  chunks[i],
  apiKey,
  i,
  chunks.length
)
        let added = 0
        for (const r of records) {
          if (r.voterId && !seen.has(r.voterId)) {
            seen.add(r.voterId)
            allRecords.push(r)
            added++
          }
        }

        onProgress?.(
          `✓ Chunk ${i + 1}: +${added} voters (total: ${allRecords.length})`,
          pct + Math.round(70 / chunks.length)
        )

      } catch (e) {
        onProgress?.(
          `⚠️ Chunk ${i + 1} failed — retrying skipped`,
          pct
        )
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1))
  )

  return allRecords
}

// ─── MAIN EXTRACTION — chunks full PDF, merges all records ───────────────────
export async function extractPdfVoters(
  base64Pdf: string,
  apiKey: string,
  boothNumber: string,
  onProgress?: (msg: string, pct: number) => void
): Promise<VoterRecord[]> {
  const CHUNK_PAGES = 2 // Process 30 pages at a time — safe for Gemini token limits

  onProgress?.('Splitting PDF into chunks...', 5)
  const chunks = await splitPdfIntoChunks(base64Pdf, CHUNK_PAGES)

  onProgress?.(`PDF split into ${chunks.length} chunk(s). Starting extraction...`, 10)

  // const allRecords: VoterRecord[] = []
  // const seenVoterIds = new Set<string>()

  // for (let i = 0; i < chunks.length; i++) {
  //   const pct = 10 + Math.round((i / chunks.length) * 70)
  //   onProgress?.(
  //     `Extracting chunk ${i + 1} of ${chunks.length} (pages ${i * CHUNK_PAGES + 1}–${(i + 1) * CHUNK_PAGES})...`,
  //     pct
  //   )

  //   const records = await extractChunk(chunks[i], apiKey, i, chunks.length)

  //   // Deduplicate by voterId across chunks (page boundaries may overlap)
  //   for (const r of records) {
  //     if (r.voterId && !seenVoterIds.has(r.voterId)) {
  //       seenVoterIds.add(r.voterId)
  //       allRecords.push(r)
  //     }
  //   }

  //   onProgress?.(
  //     `Chunk ${i + 1}/${chunks.length} done — ${records.length} voters extracted (total so far: ${allRecords.length})`,
  //     pct + Math.round(70 / chunks.length)
  //   )
  // }

  // return allRecords

function exportDeletedVoters(
  deleted: { slNo?: string; voterId?: string }[],
  boothNumber: string
) {
  const data = JSON.stringify(deleted, null, 2)

  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `deleted_voters_booth_${boothNumber}.json`
  a.click()

  URL.revokeObjectURL(url)
}

const allRecords = await processChunksParallel(chunks, apiKey, onProgress)
if (allRecords.length === 0) {
  throw new Error('No voters extracted — possible Gemini failure')
}

if (chunks.length > 1 && allRecords.length < chunks.length * 5) {
  console.warn('⚠️ Low extraction count — possible missed pages')
}
const validVoters: VoterRecord[] = []
const deletedVoters: { slNo?: string; voterId?: string }[] = []

for (const r of allRecords as ExtractedVoter[]) {

  // 🔍 Fallback detection (in case Gemini misses)
  const fallbackDeleted =
    (r.nameEn || '').toLowerCase().includes('deleted') ||
    (r.houseEn || '').toLowerCase().includes('deleted')

  const isDeleted = r.isDeleted || fallbackDeleted

  if (isDeleted) {
    deletedVoters.push({
      slNo: r.slNo,
      voterId: r.voterId
    })
  } else {
    validVoters.push(r)
  }
}

console.log("Total:", allRecords.length)
console.log("Valid:", validVoters.length)
console.log("Deleted:", deletedVoters.length)

// 👉 export JSON automatically
if (deletedVoters.length > 0) {
  exportDeletedVoters(deletedVoters, boothNumber)
}

return validVoters
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

export interface InsertResult {
  success: boolean
  voterId: string
  inserted?: boolean
  error?: string
}

export interface BulkUpdateResult {
  success: boolean
  successCount: number
  notFoundCount: number
  errorCount: number
  insertedCount: number
  totalSent: number
  errors: Array<{ voterId: string; error: string }>
}

/** Build fields-to-update object from an AuditResult (only mismatched fields, PDF values) */
export function buildUpdatePayload(result: AuditResult): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of Object.keys(result.mismatches)) {
    const correctedVal = result.corrected[field as keyof VoterRecord]
    if (correctedVal !== undefined && correctedVal !== null && correctedVal !== '') {
      payload[field] = correctedVal
    }
  }
  return payload
}

/** Build full insert payload from a PDF-only record (Missing in Target) */
export function buildInsertPayload(result: AuditResult, boothId?: string): Record<string, unknown> {
  const pdf = result.pdf ?? result.corrected
  const resolvedBoothId = boothId ?? getBoothId(pdf as VoterRecord) ?? undefined
  return {
    voterId:       pdf.voterId,
    slNo:          pdf.slNo,
    nameMl:        pdf.nameMl,
    nameEn:        pdf.nameEn,
    age:           pdf.age !== undefined ? parseInt(String(pdf.age)) || pdf.age : undefined,
    gender:        pdf.gender,
    relationType:  pdf.relationType,
    relationNameMl: pdf.relationNameMl,
    relationNameEn: pdf.relationNameEn,
    houseMl:       pdf.houseMl,
    houseEn:       pdf.houseEn,
    ...(resolvedBoothId ? { boothId: resolvedBoothId } : {}),
    auditStatus:   'new_from_pdf',
    lastAuditedAt: new Date().toISOString(),
    createdAt:     new Date().toISOString(),
  }
}

/** Update a single mismatch voter */
export async function pushSingleToDb(
  voterId: string,
  fields: Record<string,  unknown>,
  boothId?: string,
): Promise<UpdateResult> {
  const resp = await fetch(`${API_BASE_URL}/api/update-voter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voterId,
      fields: {
        ...fields,
        ...(boothId ? { boothId } : {}),   // ← always send boothId
      },
    }),
  })
  const data = await resp.json() as UpdateResult & { error?: string }
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`)
  return data
}

/** Insert a single PDF-only voter into MongoDB */
export async function insertSingleToDb(
  record: Record<string, unknown>,
  boothId?: string 
): Promise<InsertResult> {
  const resp = await fetch(`${API_BASE_URL}/api/insert-voter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({
      record: {
        ...record,
        ...(boothId ? { boothId } : {}),   // ← ensure boothId is always sent
      },
    }),
  })
  const data = await resp.json() as InsertResult & { error?: string }
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`)
  return data
}

/** Bulk update mismatches + insert Missing-in-Target in one call */
export async function pushBulkToDb(
  results: AuditResult[],
  boothId: string
): Promise<BulkUpdateResult> {
  const updates = results
    .filter(r => r.status === 'Mismatch' && Object.keys(r.mismatches).length > 0)
    .map(r => ({ voterId: r.voterId, fields: buildUpdatePayload(r) }))
    .filter(u => Object.keys(u.fields).length > 0)

//   const inserts = results
//     .filter(r => r.status === 'Missing in Target').map(r => ({
//   ...buildInsertPayload(r),
//   boothId: boothId   // 🔥 ADD THIS
// }))
//     // .map(r => buildInsertPayload(r))
//     .filter(p => p.voterId)
const inserts = results
  .filter(r => r.status === 'Missing in Target')
  .map(r => {
    const payload = buildInsertPayload(r,boothId) as VoterRecord

    return {
      ...payload,
      boothId: boothId
    }
  })
  .filter(p => p.voterId)

  if (updates.length === 0 && inserts.length === 0) {
    throw new Error('No mismatch or missing records to push')
  }

  const resp = await fetch(`${API_BASE_URL}/api/update-voters-bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates, inserts }),
  })
  const data = await resp.json() as BulkUpdateResult & { error?: string }
  if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`)
  return data
}