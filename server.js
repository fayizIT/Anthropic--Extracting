// server.js — Anthropic Proxy + MongoDB Voter Update API
// Run: node server.js
// Then in another terminal: npm run dev

const express         = require('express')
const cors            = require('cors')
const https           = require('https')
const { MongoClient } = require('mongodb')

const app  = express()
const PORT = 3001

// ─── CONFIG — edit these 3 lines to match your setup ─────────────────────────
const MONGO_URI  = process.env.MONGO_URI  || 'mongodb+srv://Voter-List:Voter-List@voter-list.hx0pqbh.mongodb.net'
const DB_NAME    = process.env.DB_NAME    || 'test'
const COLLECTION = process.env.COLLECTION || 'voters'
// ─────────────────────────────────────────────────────────────────────────────

app.use(cors({
  origin: [
    'http://localhost:5173', 'http://127.0.0.1:5173',
    'http://localhost:3000', 'http://127.0.0.1:3000',
  ]
}))
app.use(express.json({ limit: '50mb' }))

// ─── DB helper ────────────────────────────────────────────────────────────────
async function getDb() {
  const client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  })
  await client.connect()
  return { client, col: client.db(DB_NAME).collection(COLLECTION) }
}

// ─── Allowed voter fields (safety guard — nothing else can be overwritten) ───
const ALLOWED = new Set([
  'nameMl', 'nameEn',
  'age',
  'gender',
  'relationType',
  'relationNameMl', 'relationNameEn',
  'houseMl', 'houseEn',
  'slNo',
])

function sanitize(fields) {
  const safe = {}, rejected = []
  for (const [k, v] of Object.entries(fields)) {
    if (ALLOWED.has(k)) safe[k] = k === 'age' ? (parseInt(v) || v) : String(v).trim()
    else rejected.push(k)
  }
  return { safe, rejected }
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
// Open in browser → http://localhost:3001/api/health
// This tells you exactly what is wrong if MongoDB isn't connecting
app.get('/api/health', async (_req, res) => {
  let mongoStatus = 'ERROR ❌'
  let allDatabases = []
  let voterCount = null
  let errorMsg = null

  try {
    const { client, col } = await getDb()
    await client.db().admin().command({ ping: 1 })
    mongoStatus = 'connected ✅'

    // List ALL databases — use this to confirm your DB_NAME is correct
    const list = await client.db().admin().listDatabases()
    allDatabases = list.databases.map(d => `${d.name} (${d.sizeOnDisk} bytes)`)

    // Count documents in your collection
    voterCount = await col.countDocuments()
    await client.close()
  } catch (err) {
    errorMsg = err.message
  }

  res.json({
    server:       'running ✅',
    configured: {
      MONGO_URI:  MONGO_URI.replace(/:\/\/([^:@]+:[^@]+)@/, '://***:***@'),
      DB_NAME,
      COLLECTION,
    },
    mongo:        mongoStatus,
    voterCount,
    allDatabases, // ← check this list — your DB_NAME must match exactly
    error:        errorMsg,
    fix: errorMsg ? [
      '1. Is MongoDB running?  →  run: mongod  (or check Services on Windows)',
      '2. Wrong URI?  →  edit MONGO_URI at top of server.js',
      '3. Atlas?  →  set MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/',
      '4. Auth required?  →  mongodb://username:password@127.0.0.1:27017',
    ] : null,
  })
})

// ─── DEBUG: list first 10 voters ──────────────────────────────────────────────
// Open in browser → http://localhost:3001/api/voters
app.get('/api/voters', async (_req, res) => {
  let client
  try {
    const conn = await getDb()
    client = conn.client
    const voters = await conn.col
      .find({})
      .limit(10)
      .project({ voterId: 1, nameEn: 1, boothId: 1, auditStatus: 1, _id: 0 })
      .toArray()
    const total = await conn.col.countDocuments()
    res.json({ total, sample: voters })
  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    if (client) await client.close()
  }
})

// ─── ANTHROPIC PROXY (fixes CORS) ────────────────────────────────────────────
app.post('/api/anthropic', (req, res) => {
  const apiKey = req.headers['x-api-key']
  if (!apiKey) return res.status(400).json({ error: 'Missing x-api-key header' })

  const body = JSON.stringify(req.body)
  const opts = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'Content-Type':      'application/json',
      'Content-Length':    Buffer.byteLength(body),
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
  }

  const pr = https.request(opts, (upstream) => {
    res.status(upstream.statusCode).setHeader('Content-Type', 'application/json')
    let data = ''
    upstream.on('data', c => { data += c })
    upstream.on('end', () => res.send(data))
  })
  pr.on('error', err => res.status(500).json({ error: err.message }))
  pr.write(body)
  pr.end()
})

// ─── SINGLE VOTER UPDATE ──────────────────────────────────────────────────────
// POST /api/update-voter
// Body: { "voterId": "UAZ1489186", "fields": { "houseMl": "...", "houseEn": "..." } }
app.post('/api/update-voter', async (req, res) => {
  const { voterId, fields } = req.body
  if (!voterId) return res.status(400).json({ error: 'Missing voterId' })
  if (!fields || !Object.keys(fields).length)
    return res.status(400).json({ error: 'Missing fields' })

  const { safe, rejected } = sanitize(fields)
  if (!Object.keys(safe).length)
    return res.status(400).json({ error: 'No allowed fields', rejected, allowed: [...ALLOWED] })

  let client
  try {
    const conn = await getDb()
    client = conn.client

    const result = await conn.col.updateOne(
      { voterId },
      {
        $set: {
          ...safe,
          auditStatus:   'corrected',
          lastAuditedAt: new Date().toISOString(),
          updatedAt:     new Date().toISOString(),
        },
      }
    )

    if (result.matchedCount === 0)
      return res.status(404).json({ error: `Voter not found: ${voterId}` })

    console.log(`✅ Updated ${voterId} — ${Object.keys(safe).join(', ')}`)
    res.json({
      success:       true,
      voterId,
      modifiedCount: result.modifiedCount,
      updatedFields: Object.keys(safe),
      rejectedFields: rejected,
    })
  } catch (err) {
    console.error('Single update error:', err.message)
    res.status(500).json({ error: err.message })
  } finally {
    if (client) await client.close()
  }
})

// ─── BULK UPDATE — all mismatches in one click ────────────────────────────────
// POST /api/update-voters-bulk
// Body: { "updates": [{ "voterId": "UAZ...", "fields": { ... } }, ...] }
app.post('/api/update-voters-bulk', async (req, res) => {
  const { updates } = req.body
  if (!Array.isArray(updates) || !updates.length)
    return res.status(400).json({ error: 'updates must be a non-empty array' })

  let client
  try {
    const conn    = await getDb()
    client        = conn.client
    const col     = conn.col
    let success   = 0, notFound = 0, failed = 0
    const errors  = []

    for (const { voterId, fields } of updates) {
      if (!voterId || !fields) { failed++; errors.push({ voterId, error: 'Missing voterId/fields' }); continue }

      const { safe } = sanitize(fields)
      if (!Object.keys(safe).length) continue

      try {
        const r = await col.updateOne(
          { voterId },
          {
            $set: {
              ...safe,
              auditStatus:   'corrected',
              lastAuditedAt: new Date().toISOString(),
              updatedAt:     new Date().toISOString(),
            },
          }
        )
        if (r.matchedCount === 0) { notFound++; errors.push({ voterId, error: 'Not found' }) }
        else success++
      } catch (e) {
        failed++
        errors.push({ voterId, error: e.message })
      }
    }

    console.log(`✅ Bulk done — ${success} updated | ${notFound} not found | ${failed} errors`)
    res.json({
      success: true,
      successCount:  success,
      notFoundCount: notFound,
      errorCount:    failed,
      totalSent:     updates.length,
      errors:        errors.slice(0, 20),
    })
  } catch (err) {
    console.error('Bulk error:', err.message)
    res.status(500).json({ error: err.message })
  } finally {
    if (client) await client.close()
  }
})

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║        Voter Audit Proxy Server — http://localhost:${PORT}  ║
╚══════════════════════════════════════════════════════════╝

  MongoDB  : ${MONGO_URI.replace(/:\/\/([^:@]+:[^@]+)@/, '://***@')}
  Database : ${DB_NAME}
  Collection: ${COLLECTION}

  Endpoints:
  GET  /api/health              → Check MongoDB connection & DB list
  GET  /api/voters              → Preview first 10 voters
  POST /api/anthropic           → Anthropic Claude proxy
  POST /api/update-voter        → Update single voter
  POST /api/update-voters-bulk  → Bulk update all mismatches

  ✅ Open http://localhost:3001/api/health in browser to diagnose DB issues

  Start React:  npm run dev
`)
})