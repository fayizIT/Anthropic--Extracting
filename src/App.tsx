import { useState, useCallback, useRef, useMemo } from 'react'
import {
  FileText, FileJson, CheckCircle2, AlertTriangle, XCircle,
  Upload, Loader2, Eye, Download, X, ChevronDown, BarChart3,
  Search, ArrowUpDown, Pencil, Save, Printer, RefreshCw,
  Database, CloudUpload, UserPlus,
  type LucideIcon,
} from 'lucide-react'
import type { AuditResult, AuditStats, AuditStatus, VoterRecord, SortField, SortDir, WardStat } from './types'
import {
  compareRecords, extractPdfVoters, fileToBase64, fileToText,
  normalize, computeWardStats, FIELD_LABELS, COMPARE_FIELDS,
  pushSingleToDb, insertSingleToDb, pushBulkToDb, buildUpdatePayload, buildInsertPayload,
  type BulkUpdateResult,
} from './auditUtils'
import { exportToExcel, exportToCSV, exportToJSON } from './exportUtils'
import s from './App.module.css'

type FilterType = 'all' | AuditStatus

// ─── StatusBadge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: AuditStatus }) {
  const map: Record<AuditStatus, { label: string; cls: string }> = {
    Match: { label: '✓ Match', cls: s.badgeMatch },
    Mismatch: { label: '⚠ Mismatch', cls: s.badgeMismatch },
    'Missing in Target': { label: '✕ Missing', cls: s.badgeMissing },
    'Missing in Source': { label: '+ Extra', cls: s.badgeExtra },
  }
  const { label, cls } = map[status]
  return <span className={`${s.badge} ${cls}`}>{label}</span>
}

// ─── UploadCard ───────────────────────────────────────────────────────────────
interface UploadCardProps { type: 'pdf' | 'json'; file: File | null; onFile: (f: File) => void }
function UploadCard({ type, file, onFile }: UploadCardProps) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const accept = type === 'pdf' ? '.pdf,application/pdf' : '.json,application/json'

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]; if (f) onFile(f)
  }, [onFile])

  return (
    <div
      className={`${s.uploadCard} ${file ? s.uploadCardActive : ''} ${drag ? s.uploadCardDrag : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
    >
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      <div className={s.uploadIcon}>
        {file ? <CheckCircle2 size={18} color="var(--match)" />
          : type === 'pdf' ? <FileText size={18} color="var(--text3)" />
          : <FileJson size={18} color="var(--text3)" />}
      </div>
      <div className={s.uploadInfo}>
        <div className={s.uploadTitle}>{type === 'pdf' ? 'Electoral Roll PDF' : 'Voter JSON'}</div>
        <div className={s.uploadSub}>{file ? file.name : type === 'pdf' ? 'Official PDF source' : 'MongoDB records array'}</div>
      </div>
      {!file && <Upload size={14} className={s.uploadArrow} />}
    </div>
  )
}

// ─── StatCard ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, icon: Icon, onClick, active }: {
  label: string; value: number; color: string; icon: LucideIcon
  onClick?: () => void; active?: boolean
}) {
  return (
    <div className={`${s.statCard} ${onClick ? s.statCardClickable : ''} ${active ? s.statCardActive : ''}`}
      onClick={onClick} style={active ? { borderColor: color } : {}}>
      <div className={s.statTop}><Icon size={13} color={color} /><span className={s.statLabel}>{label}</span></div>
      <div className={s.statValue} style={{ color }}>{value}</div>
    </div>
  )
}

// ─── WardChart ────────────────────────────────────────────────────────────────
function WardChart({ stats }: { stats: WardStat[] }) {
  const maxVal = Math.max(...stats.map(w => w.total), 1)
  return (
    <div className={s.wardChart}>
      <div className={s.wardChartTitle}>Ward-wise Breakdown</div>
      <div className={s.wardBars}>
        {stats.map(w => (
          <div key={w.ward} className={s.wardRow}>
            <div className={s.wardLabel}>{w.ward}</div>
            <div className={s.wardBarTrack}>
              <div className={s.wardBarMatch} style={{ width: `${(w.match / maxVal) * 100}%` }} />
              <div className={s.wardBarMismatch} style={{ width: `${(w.mismatch / maxVal) * 100}%` }} />
              <div className={s.wardBarMissing} style={{ width: `${(w.missing / maxVal) * 100}%` }} />
            </div>
            <div className={s.wardTotal}>{w.total}</div>
          </div>
        ))}
      </div>
      <div className={s.wardLegend}>
        <span><span className={s.legendDot} style={{ background: 'var(--match)' }} />Match</span>
        <span><span className={s.legendDot} style={{ background: 'var(--mismatch)' }} />Mismatch</span>
        <span><span className={s.legendDot} style={{ background: 'var(--missing)' }} />Missing</span>
      </div>
    </div>
  )
}

// ─── InlineEditor ─────────────────────────────────────────────────────────────
function InlineEditor({ result, onSave, onClose }: {
  result: AuditResult
  onSave: (updated: VoterRecord) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<VoterRecord>({ ...result.corrected })
  const fields = COMPARE_FIELDS as string[]

  return (
    <div className={s.modalOverlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>
        <div className={s.modalHeader}>
          <div>
            <div className={s.modalTitle}>
              <Pencil size={14} color="var(--accent2)" />
              <span className={s.monoText}>{result.voterId}</span>
              <StatusBadge status={result.status} />
            </div>
            <div className={s.modalSub}>Edit corrected record — PDF is source of truth</div>
          </div>
          <button className={s.modalClose} onClick={onClose}><X size={16} /></button>
        </div>

        <div className={s.editorGrid}>
          {fields.map(f => {
            const diff = result.mismatches[f]
            const label = FIELD_LABELS[f] ?? f
            return (
              <div key={f} className={`${s.editorRow} ${diff ? s.editorRowDiff : ''}`}>
                <div className={s.editorLabel}>{label}</div>
                {diff && (
                  <div className={s.editorSources}>
                    <span className={s.srcJson}>JSON: {diff.json || '—'}</span>
                    <span className={s.srcPdf}>PDF: {diff.pdf || '—'}</span>
                  </div>
                )}
                <input
                  className={s.editorInput}
                  value={(draft[f] as string) ?? ''}
                  onChange={e => setDraft(prev => ({ ...prev, [f]: e.target.value }))}
                />
              </div>
            )
          })}
        </div>

        <div className={s.modalSection}>
          <div className={s.modalSectionTitle}>Database-only fields (preserved)</div>
          <div className={s.modalGrid}>
            {(['ward', 'mobile', 'mobile2', 'email'] as const).map(f => (
              <div key={f} className={s.modalField}>
                <div className={s.modalFieldKey}>{f}</div>
                <div className={s.modalFieldVal}>{normalize(result.json?.[f]) || '—'}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={s.editorActions}>
          <button className={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={s.saveBtn} onClick={() => onSave(draft)}>
            <Save size={13} /> Save Correction
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── RecordModal (view-only) ──────────────────────────────────────────────────
function RecordModal({ result, onClose, onEdit }: {
  result: AuditResult; onClose: () => void; onEdit: () => void
}) {
  const src = result.corrected

  return (
    <div className={s.modalOverlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>
        <div className={s.modalHeader}>
          <div>
            <div className={s.modalTitle}>
              <span className={s.monoText}>{result.voterId}</span>
              <StatusBadge status={result.status} />
            </div>
            <div className={s.modalSub}>Sl.No: {result.slNo} · Corrected record view</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={s.editBtn} onClick={onEdit}><Pencil size={13} /> Edit</button>
            <button className={s.modalClose} onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {result.status === 'Mismatch' && (
          <div className={s.diffSummary}>
            <AlertTriangle size={13} color="var(--mismatch)" />
            <span>{Object.keys(result.mismatches).length} field(s) differ — PDF overrides JSON below</span>
          </div>
        )}

        {result.status === 'Missing in Target' && (
          <div className={s.diffSummary}>
            <UserPlus size={13} color="var(--missing)" />
            <span>This voter exists in PDF but not in MongoDB — push to insert</span>
          </div>
        )}

        <div className={s.modalGrid}>
          {(COMPARE_FIELDS as string[]).map(f => {
            const diff = result.mismatches[f]
            const val = normalize(src[f])
            return (
              <div key={f} className={`${s.modalField} ${diff ? s.modalFieldDiff : ''}`}>
                <div className={s.modalFieldKey}>{FIELD_LABELS[f] ?? f}</div>
                {diff ? (
                  <>
                    <div className={s.modalFieldOld}>was: {diff.json || '(empty)'}</div>
                    <div className={s.modalFieldNew}>{diff.pdf || '(empty)'}</div>
                  </>
                ) : (
                  <div className={s.modalFieldVal}>{val || '—'}</div>
                )}
              </div>
            )
          })}
        </div>

        {result.json && (
          <div className={s.modalSection}>
            <div className={s.modalSectionTitle}>Database fields</div>
            <div className={s.modalGrid}>
              {(['ward', 'mobile', 'mobile2', 'email', 'status'] as const).map(f => (
                <div key={f} className={s.modalField}>
                  <div className={s.modalFieldKey}>{f}</div>
                  <div className={s.modalFieldVal}>{normalize(result.json?.[f]) || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [jsonFile, setJsonFile] = useState<File | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [boothId, setBoothId] = useState('')

  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [results, setResults] = useState<AuditResult[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('slNo')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [showWard, setShowWard] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const [viewResult, setViewResult] = useState<AuditResult | null>(null)
  const [editResult, setEditResult] = useState<AuditResult | null>(null)
  const [pushingVoterId, setPushingVoterId] = useState<string | null>(null)
  const [bulkPushing, setBulkPushing] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkUpdateResult | null>(null)
  const [pushedIds, setPushedIds] = useState<Set<string>>(new Set())

  const stats: AuditStats = useMemo(() => ({
    total: results.length,
    match: results.filter(r => r.status === 'Match').length,
    mismatch: results.filter(r => r.status === 'Mismatch').length,
    missingTarget: results.filter(r => r.status === 'Missing in Target').length,
    missingSource: results.filter(r => r.status === 'Missing in Source').length,
  }), [results])

  const wardStats: WardStat[] = useMemo(() => computeWardStats(results), [results])

  const filtered = useMemo(() => {
    let data = filter === 'all' ? results : results.filter(r => r.status === filter)

    if (search.trim()) {
      const q = search.toLowerCase()
      data = data.filter(r =>
        r.voterId.toLowerCase().includes(q) ||
        r.slNo.includes(q) ||
        normalize(r.pdf?.nameEn ?? r.json?.nameEn).toLowerCase().includes(q) ||
        normalize(r.pdf?.nameMl ?? r.json?.nameMl).includes(q) ||
        normalize(r.pdf?.houseEn ?? r.json?.houseEn).toLowerCase().includes(q)
      )
    }

    return [...data].sort((a, b) => {
      const srcA = a.corrected; const srcB = b.corrected
      let va = '', vb = ''
      if (sortField === 'slNo') { va = a.slNo; vb = b.slNo; return (sortDir === 'asc' ? 1 : -1) * ((parseInt(va) || 0) - (parseInt(vb) || 0)) }
      if (sortField === 'age') { va = normalize(srcA.age); vb = normalize(srcB.age); return (sortDir === 'asc' ? 1 : -1) * ((parseInt(va) || 0) - (parseInt(vb) || 0)) }
      if (sortField === 'voterId') { va = a.voterId; vb = b.voterId }
      if (sortField === 'nameEn') { va = normalize(srcA.nameEn); vb = normalize(srcB.nameEn) }
      if (sortField === 'status') { va = a.status; vb = b.status }
      return (sortDir === 'asc' ? 1 : -1) * va.localeCompare(vb)
    })
  }, [results, filter, search, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function handleSaveEdit(updated: VoterRecord) {
    if (!editResult) return
    setResults(prev => prev.map(r => {
      if (r.voterId !== editResult.voterId) return r

      // Rebuild mismatches based on edited values vs original JSON
      const newMismatches: typeof r.mismatches = {}
      for (const [field, diff] of Object.entries(r.mismatches)) {
        const editedVal = String(updated[field as keyof VoterRecord] ?? '').trim()
        if (editedVal !== diff.json) {
          newMismatches[field] = { pdf: editedVal, json: diff.json }
        }
      }

      return {
        ...r,
        corrected: updated,
        mismatches: newMismatches,
        status: Object.keys(newMismatches).length === 0 ? 'Match' : 'Mismatch',
      }
    }))

    // Re-enable push after re-edit
    setPushedIds(prev => {
      const next = new Set(prev)
      next.delete(editResult.voterId)
      return next
    })

    setEditResult(null)
  }

  async function runAudit() {
    if (!pdfFile) { setError('Upload the electoral roll PDF.'); return }
    if (!jsonFile) { setError('Upload the JSON voter records.'); return }
    if (!apiKey) { setError('Enter your Gemini API key.'); return }

    setError(null); setIsRunning(true); setResults([])
    setFilter('all'); setSearch('')
    setPushedIds(new Set())

    try {
      setProgress(5); setProgressMsg('Reading PDF...')
      const b64 = await fileToBase64(pdfFile)

      // Pass progress callback so chunk-by-chunk updates show in UI
      const pdfRecords = await extractPdfVoters(b64, apiKey, (msg, pct) => {
        setProgressMsg(msg)
        setProgress(pct)
      })

      setProgress(82); setProgressMsg(`Extracted ${pdfRecords.length} records from PDF. Loading JSON...`)
      const txt = await fileToText(jsonFile)
      let jsonRecords: VoterRecord[] = JSON.parse(txt)
      if (!Array.isArray(jsonRecords)) jsonRecords = [jsonRecords]

      setProgress(90); setProgressMsg(`Loaded ${jsonRecords.length} JSON records. Comparing...`)
      const auditResults = compareRecords(pdfRecords, jsonRecords, boothId)

      setProgress(100)
      const m = auditResults.filter(r => r.status === 'Mismatch').length
      const mt = auditResults.filter(r => r.status === 'Missing in Target').length
      setProgressMsg(`Done — ${auditResults.length} records · ${m} mismatches · ${mt} missing in DB`)
      setResults(auditResults)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error occurred.')
    } finally {
      setIsRunning(false)
    }
  }

  // Push a single mismatch correction OR insert a missing voter
  async function pushSingle(result: AuditResult) {
    const latest = results.find(r => r.voterId === result.voterId) ?? result
    setPushingVoterId(result.voterId)

    try {
      if (latest.status === 'Missing in Target') {
        // Insert PDF-only voter into MongoDB
        const payload = buildInsertPayload(latest)
        await insertSingleToDb(payload)
      } else if (latest.status === 'Mismatch') {
        // Update existing voter with corrected fields
        const fields = buildUpdatePayload(latest)
        if (Object.keys(fields).length === 0) return
        await pushSingleToDb(result.voterId, fields)
      }
      setPushedIds(prev => new Set([...prev, result.voterId]))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'DB push failed')
    } finally {
      setPushingVoterId(null)
    }
  }

  // Bulk push: update all mismatches + insert all Missing in Target
  async function pushAllToDb() {
    setBulkPushing(true)
    setBulkResult(null)
    try {
      const res = await pushBulkToDb(results)
      setBulkResult(res)

      // Mark all mismatches and missing-in-target as pushed
      const pushed = results
        .filter(r => r.status === 'Mismatch' || r.status === 'Missing in Target')
        .map(r => r.voterId)
      setPushedIds(prev => new Set([...prev, ...pushed]))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk push failed')
    } finally {
      setBulkPushing(false)
    }
  }

  function handlePrint() { window.print() }

  const hasResults = results.length > 0
  const pushableCount = stats.mismatch + stats.missingTarget

  const SortBtn = ({ field, label }: { field: SortField; label: string }) => (
    <button className={`${s.sortBtn} ${sortField === field ? s.sortBtnActive : ''}`}
      onClick={() => toggleSort(field)}>
      {label} <ArrowUpDown size={10} />
    </button>
  )

  return (
    <div className={s.app}>
      {/* HEADER */}
      <header className={s.header}>
        <div className={s.headerLeft}>
          <div className={s.logo}><span className={s.logoAccent}>CANARY</span><span className={s.logoDot}> · </span>POLL PULSE</div>
          <div className={s.logoSub}>Voter Roll Audit  ·  PDF × JSON × MongoDB</div>
        </div>
        <div className={s.headerRight}>
          {hasResults && (
            <>
              <button className={s.iconBtn} onClick={() => setShowWard(v => !v)} title="Ward breakdown">
                <BarChart3 size={15} color={showWard ? 'var(--accent)' : undefined} />
              </button>
              <button className={s.iconBtn} onClick={handlePrint} title="Print report">
                <Printer size={15} />
              </button>
              <div className={s.exportWrap}>
                <button className={s.exportTrigger} onClick={() => setShowExport(v => !v)}>
                  <Download size={14} /> Export <ChevronDown size={11} />
                </button>
                {showExport && (
                  <div className={s.exportDropdown}>
                    <button onClick={() => { exportToExcel(results); setShowExport(false) }}>📊 Excel — 4 worksheets</button>
                    <button onClick={() => { exportToCSV(results); setShowExport(false) }}>📄 CSV — flat</button>
                    <button onClick={() => { exportToJSON(results); setShowExport(false) }}>🗂 JSON — corrected data</button>
                  </div>
                )}
              </div>
              {/* Bulk push: mismatches + missing-in-target */}
              <button
                className={s.pushAllBtn}
                onClick={pushAllToDb}
                disabled={bulkPushing || pushableCount === 0}
                title={`Push ${stats.mismatch} mismatches + insert ${stats.missingTarget} missing voters`}
              >
                {bulkPushing
                  ? <><Loader2 size={13} className={s.spin} /> Pushing...</>
                  : <><CloudUpload size={13} /> Push {pushableCount} to DB</>}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Bulk result banner */}
      {bulkResult && (
        <div className={`${s.bulkBanner} ${bulkResult.errorCount === 0 ? s.bulkSuccess : s.bulkPartial}`}>
          <Database size={14} />
          <span>
            <strong>{bulkResult.successCount}</strong> updated
            {(bulkResult.insertedCount ?? 0) > 0 && <> · <strong>{bulkResult.insertedCount}</strong> inserted</>}
            {bulkResult.notFoundCount > 0 && <> · <strong>{bulkResult.notFoundCount}</strong> not found</>}
            {bulkResult.errorCount > 0 && <> · <strong>{bulkResult.errorCount}</strong> errors</>}
          </span>
          <button className={s.bannerClose} onClick={() => setBulkResult(null)}><X size={12} /></button>
        </div>
      )}

      <div className={s.layout}>
        {/* LEFT PANEL */}
        <aside className={s.sidebar}>
          <div className={s.sectionLabel}><Upload size={11} /> Files</div>
          <div className={s.uploadCol}>
            <UploadCard type="pdf" file={pdfFile} onFile={setPdfFile} />
            <UploadCard type="json" file={jsonFile} onFile={setJsonFile} />
          </div>

          <div className={s.sectionLabel} style={{ marginTop: 18 }}><BarChart3 size={11} /> Config</div>
          <div className={s.configStack}>
            <div className={s.field}>
              <label className={s.fieldLabel}>Booth MongoDB ID</label>
              <input className={s.input} value={boothId} onChange={e => setBoothId(e.target.value)} placeholder="69c57f7db65ab7300128dc53" />
            </div>
            <div className={s.field}>
              <label className={s.fieldLabel}>Gemini API Key</label>
              <input className={s.input} type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIza..." />
            </div>
          </div>

          <button className={s.runBtn} onClick={runAudit} disabled={isRunning}>
            {isRunning
              ? <><Loader2 size={14} className={s.spin} /> {progressMsg}</>
              : '▶  Run Audit'}
          </button>

          {isRunning && (
            <div className={s.progressWrap}>
              <div className={s.progressTrack}>
                <div className={s.progressFill} style={{ width: `${progress}%` }} />
              </div>
              <div className={s.progressLabel}>{progress}%</div>
            </div>
          )}

          {error && (
            <div className={s.errorBox}><XCircle size={13} /> {error}</div>
          )}

          {hasResults && (
            <>
              <div className={s.divider} />
              <div className={s.sectionLabel}><BarChart3 size={11} /> Summary</div>
              <div className={s.sideStats}>
                <StatCard label="Total" value={stats.total} color="var(--text2)" icon={BarChart3}
                  onClick={() => setFilter('all')} active={filter === 'all'} />
                <StatCard label="Match" value={stats.match} color="var(--match)" icon={CheckCircle2}
                  onClick={() => setFilter('Match')} active={filter === 'Match'} />
                <StatCard label="Mismatch" value={stats.mismatch} color="var(--mismatch)" icon={AlertTriangle}
                  onClick={() => setFilter('Mismatch')} active={filter === 'Mismatch'} />
                <StatCard label="Missing" value={stats.missingTarget} color="var(--missing)" icon={XCircle}
                  onClick={() => setFilter('Missing in Target')} active={filter === 'Missing in Target'} />
                <StatCard label="Extra" value={stats.missingSource} color="var(--extra)" icon={FileJson}
                  onClick={() => setFilter('Missing in Source')} active={filter === 'Missing in Source'} />
              </div>

              <button className={s.resetBtn} onClick={() => { setResults([]); setPdfFile(null); setJsonFile(null); setPushedIds(new Set()) }}>
                <RefreshCw size={12} /> New Audit
              </button>
            </>
          )}
        </aside>

        {/* RIGHT — Results */}
        <main className={s.main}>
          {!hasResults && !isRunning && (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}><FileText size={40} strokeWidth={1} /></div>
              <div className={s.emptyTitle}>Upload files and run audit</div>
              <div className={s.emptySub}>
                Gemini AI will extract ALL voters from the full PDF (chunked automatically),
                compare against your JSON database by Voter ID, and show mismatches + missing voters ready to push to MongoDB.
              </div>
            </div>
          )}

          {hasResults && (
            <>
              {showWard && wardStats.length > 0 && <WardChart stats={wardStats} />}

              <div className={s.tableToolbar}>
                <div className={s.searchWrap}>
                  <Search size={13} className={s.searchIcon} />
                  <input
                    className={s.searchInput}
                    placeholder="Search voter ID, name, house..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  {search && <button className={s.searchClear} onClick={() => setSearch('')}><X size={12} /></button>}
                </div>
                <div className={s.sortRow}>
                  <span className={s.sortLabel}>Sort:</span>
                  <SortBtn field="slNo" label="Sl" />
                  <SortBtn field="nameEn" label="Name" />
                  <SortBtn field="age" label="Age" />
                  <SortBtn field="status" label="Status" />
                </div>
                <span className={s.countBadge}>{filtered.length} / {results.length}</span>
              </div>

              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.thNum}>#</th>
                      <th>Sl No</th>
                      <th>Voter ID</th>
                      <th>Name (ML)</th>
                      <th>Name (EN)</th>
                      <th className={s.thCenter}>Age</th>
                      <th className={s.thCenter}>Gender</th>
                      <th>House (ML)</th>
                      <th>House (EN)</th>
                      <th>Relation</th>
                      <th>Status</th>
                      <th>Mismatches</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => {
                      const src = r.corrected
                      const isMissing = r.status === 'Missing in Target'
                      const isMismatch = r.status === 'Mismatch'
                      const isPushable = isMismatch || isMissing

                      return (
                        <tr key={r.voterId} className={`${s.tr} ${s[`tr${r.status.replace(/ /g, '')}`] ?? ''}`}>
                          <td className={s.tdNum}>{i + 1}</td>
                          <td><span className={s.mono}>{r.slNo || '—'}</span></td>
                          <td><span className={s.monoAccent}>{r.voterId}</span></td>
                          <td className={s.tdMl}>{normalize(src.nameMl) || '—'}</td>
                          <td>{normalize(src.nameEn) || '—'}</td>
                          <td className={s.tdCenter}>{normalize(src.age) || '—'}</td>
                          <td className={s.tdCenter}>
                            <span className={normalize(src.gender) === 'Female' ? s.genderF : s.genderM}>
                              {normalize(src.gender)?.[0] || '—'}
                            </span>
                          </td>
                          <td className={s.tdMl}>{normalize(src.houseMl) || '—'}</td>
                          <td>{normalize(src.houseEn) || '—'}</td>
                          <td className={s.tdRelation}>
                            {normalize(src.relationType) && <span className={s.relType}>{normalize(src.relationType)[0]}</span>}
                            {normalize(src.relationNameEn) || '—'}
                          </td>
                          <td><StatusBadge status={r.status} /></td>
                          <td className={s.tdIssues}>
                            {isMismatch && Object.entries(r.mismatches).map(([f, d]) => (
                              <div key={f} className={s.miniDiff}>
                                <span className={s.miniField}>{f}</span>
                                <span className={s.miniOld}>{d.json || '∅'}</span>
                                <span className={s.miniArrow}>→</span>
                                <span className={s.miniNew}>{d.pdf || '∅'}</span>
                              </div>
                            ))}
                            {isMissing && (
                              <span className={s.missingLabel}>Not in MongoDB — will insert</span>
                            )}
                            {!isMismatch && !isMissing && <span className={s.noIssue}>—</span>}
                          </td>
                          <td>
                            <div className={s.actionBtns}>
                              <button className={s.viewBtn} onClick={() => setViewResult(r)} title="View"><Eye size={12} /></button>
                              <button className={s.editIconBtn} onClick={() => setEditResult(r)} title="Edit"><Pencil size={12} /></button>
                              {isPushable && (
                                <button
                                  className={`${s.pushBtn} ${pushedIds.has(r.voterId) ? s.pushBtnDone : ''} ${isMissing ? s.pushBtnInsert : ''}`}
                                  onClick={() => pushSingle(r)}
                                  disabled={pushingVoterId === r.voterId}
                                  title={isMissing ? 'Insert this voter into MongoDB' : 'Push corrected fields to MongoDB'}
                                >
                                  {pushingVoterId === r.voterId
                                    ? <Loader2 size={11} className={s.spin} />
                                    : pushedIds.has(r.voterId)
                                    ? <CheckCircle2 size={11} color="var(--match)" />
                                    : isMissing
                                    ? <UserPlus size={11} />
                                    : <Database size={11} />}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <div className={s.noRows}>No records match the current filter / search.</div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {viewResult && (
        <RecordModal
          result={results.find(r => r.voterId === viewResult.voterId) ?? viewResult}
          onClose={() => setViewResult(null)}
          onEdit={() => { setEditResult(viewResult); setViewResult(null) }}
        />
      )}
      {editResult && (
        <InlineEditor
          result={editResult}
          onSave={handleSaveEdit}
          onClose={() => setEditResult(null)}
        />
      )}
    </div>
  )
}