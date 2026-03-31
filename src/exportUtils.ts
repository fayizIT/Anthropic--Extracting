import * as XLSX from 'xlsx'
import type { AuditResult } from './types'
import { normalize } from './auditUtils'

export function flattenResult(r: AuditResult) {
  const src = r.corrected
  const mis = r.mismatches
  return {
    slNo: r.slNo,
    voterId: r.voterId,
    status: r.status,
    nameMl: normalize(src.nameMl),
    nameEn: normalize(src.nameEn),
    age: normalize(src.age),
    gender: normalize(src.gender),
    relationType: normalize(src.relationType),
    relationNameMl: normalize(src.relationNameMl),
    relationNameEn: normalize(src.relationNameEn),
    houseMl: normalize(src.houseMl),
    houseEn: normalize(src.houseEn),
    ward: normalize(src.ward),
    mobile: normalize(src.mobile),
    mobile2: normalize(src.mobile2),
    email: normalize(src.email),
    mismatch_fields: Object.keys(mis).join(', '),
    ...Object.fromEntries(
      Object.entries(mis).flatMap(([f, v]) => [
        [`${f}_PDF`, v.pdf],
        [`${f}_JSON`, v.json],
      ])
    ),
  }
}

export function exportToExcel(results: AuditResult[], filename = 'voter_audit_report.xlsx') {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.map(flattenResult)), 'All Records')

  const mis = results.filter(r => r.status === 'Mismatch')
  if (mis.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mis.map(flattenResult)), 'Mismatches')

  const missing = results.filter(r => r.status === 'Missing in Target')
  if (missing.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(missing.map(flattenResult)), 'Missing in JSON')

  const extra = results.filter(r => r.status === 'Missing in Source')
  if (extra.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(extra.map(flattenResult)), 'Extra in JSON')

  XLSX.writeFile(wb, filename)
}

export function exportToCSV(results: AuditResult[], filename = 'voter_audit_report.csv') {
  const rows = results.map(flattenResult)
  const keys = Object.keys(rows[0] ?? {})
  const csv = [
    keys.join(','),
    ...rows.map(r => keys.map(k => JSON.stringify((r as Record<string, unknown>)[k] ?? '')).join(',')),
  ].join('\n')
  triggerDownload('data:text/csv;charset=utf-8,' + encodeURIComponent(csv), filename)
}

export function exportToJSON(results: AuditResult[], filename = 'voter_audit_corrected.json') {
  const out = results
    .filter(r => r.status !== 'Missing in Source')
    .map(r => r.corrected)
  triggerDownload(
    'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(out, null, 2)),
    filename
  )
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href; a.download = filename; a.click()
}
