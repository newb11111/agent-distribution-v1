import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import bcrypt from 'bcryptjs'
import cron from 'node-cron'
import XLSX from 'xlsx'
import {
  ADMIN_PERMISSION_KEYS,
  DEFAULT_LEADER_PERMISSIONS,
  audit,
  daysLeft,
  getAdminAnnualFeeAmount,
  getAdminContactSettings,
  getSetting,
  initDatabase,
  jsonValue,
  normalizeAdminPermissions,
  pool,
  query,
  roundMoney,
  setAdminContactSettings,
  setSetting,
  tx,
  uid
} from './db.js'
import {
  adminDataScopeId,
  adminHasPermission,
  requireActiveAgent,
  requireAdmin,
  requireAdminPermission,
  requireAgent,
  requireFulfillmentParty,
  requirePlanter,
  requireSuperAdmin,
  scopedAgentsWhere,
  signAdminToken,
  signAgentToken,
  signPlanterToken,
  toAdmin,
  toAgent,
  toPlanter
} from './auth.js'
import { createOtp, normalizeEmail, verifyOtp } from './mail.js'
import {
  activateAnnualFee,
  adjustRewardByAdmin,
  getAgentBalance,
  getRules,
  placeRewardOrder,
  runAnnualRenewalCheckOnce
} from './finance.js'

const app = express()
const PORT = Number(process.env.PORT || 5001)
const FRONTEND_URLS = String(process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map((x) => x.trim()).filter(Boolean)

app.use(cors({ origin: (origin, cb) => !origin || FRONTEND_URLS.includes(origin) ? cb(null, true) : cb(new Error('CORS_BLOCKED')), credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(morgan('dev'))

function cleanEmail(email) { return normalizeEmail(email) }
function cleanText(v) { return String(v || '').trim() }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback }
function isActiveStatus(s) { return String(s || '').toUpperCase() === 'ACTIVE' }

function rowToProduct(p) {
  return { id: p.id, sku: p.sku, name: p.name, description: p.description, price: Number(p.price || 0), cost: Number(p.cost || 0), isActive: Boolean(p.is_active), createdAt: p.created_at, updatedAt: p.updated_at }
}
function rowToOrder(o) {
  return { id: o.id, agentId: o.agent_id, productId: o.product_id, qty: Number(o.qty || 0), totalAmount: Number(o.total_amount || 0), customerName: o.customer_name, customerPhone: o.customer_phone, deliveryAddress: o.delivery_address, remark: o.remark, status: o.status, fulfillmentStatus: o.fulfillment_status, packedNote: o.packed_note, trackingNumber: o.tracking_number, courier: o.courier, approvedAt: o.approved_at, shippedAt: o.shipped_at, createdAt: o.created_at }
}
function rowToProof(p) {
  return { id: p.id, type: p.type, agentId: p.agent_id, orderId: p.order_id, amount: Number(p.amount || 0), proofText: p.proof_text, status: p.status, reviewedByAdminId: p.reviewed_by_admin_id, reviewedAt: p.reviewed_at, rejectReason: p.reject_reason, createdAt: p.created_at }
}
function rowToWithdrawal(w) {
  return { id: w.id, agentId: w.agent_id, amount: Number(w.amount || 0), bankSnapshot: jsonValue(w.bank_snapshot, {}), status: w.status, reviewedByAdminId: w.reviewed_by_admin_id, createdAt: w.created_at, paidAt: w.paid_at, rejectedAt: w.rejected_at, rejectReason: w.reject_reason }
}
function rowToLedger(w) {
  return {
    id: w.id,
    agentId: w.agent_id,
    type: w.type,
    amount: Number(w.amount || 0),
    sourceType: w.source_type,
    sourceId: w.source_id,
    status: w.status,
    note: w.note,
    createdByAdminId: w.created_by_admin_id,
    createdAt: w.created_at,
    commission: w.commission_id ? {
      id: w.commission_id,
      fromAgentId: w.commission_from_agent_id,
      toAgentId: w.commission_to_agent_id,
      generation: Number(w.commission_generation || 0),
      amount: Number(w.commission_amount || 0),
      ruleType: w.commission_rule_type,
      ruleValue: Number(w.commission_rule_value || 0),
      status: w.commission_status
    } : null,
    sourceAgent: w.source_agent_code ? { id: w.source_agent_id, agentCode: w.source_agent_code, name: w.source_agent_name } : null
  }
}
function rowToCompany(w) {
  return { id: w.id, ownerAdminId: w.owner_admin_id, fromAgentId: w.from_agent_id, amount: Number(w.amount || 0), sourceType: w.source_type, sourceId: w.source_id, note: w.note, createdAt: w.created_at, sourceAgent: w.source_agent_code ? { id: w.source_agent_id, agentCode: w.source_agent_code, name: w.source_agent_name } : null }
}

function normalizePhone(v) {
  return String(v || '').trim().replace(/[\s\-()]/g, '')
}
function rowToPlanterAdmin(r) {
  return toPlanter(r, {
    harvestRequestCount: Number(r.harvest_request_count || 0),
    latestHarvestAt: r.latest_harvest_at || null
  })
}

function rowToHarvestRequest(r, includePhotos = false) {
  const photos = r.photos === undefined || r.photos === null ? [] : jsonValue(r.photos, [])
  const photoCount = r.photo_count === undefined || r.photo_count === null
    ? (Array.isArray(photos) ? photos.length : 0)
    : Number(r.photo_count || 0)
  return {
    id: r.id,
    planterId: r.planter_id,
    fruitType: r.fruit_type,
    estimatedWeight: Number(r.estimated_weight || 0),
    maturityStatus: r.maturity_status,
    notes: r.notes,
    phone: r.phone,
    latitude: r.latitude === null || r.latitude === undefined ? null : Number(r.latitude),
    longitude: r.longitude === null || r.longitude === undefined ? null : Number(r.longitude),
    locationAccuracy: r.location_accuracy === null || r.location_accuracy === undefined ? null : Number(r.location_accuracy),
    locationAddress: r.location_address,
    status: r.status,
    adminRemark: r.admin_remark,
    reviewedByAdminId: r.reviewed_by_admin_id,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    photoCount,
    photos: includePhotos ? (Array.isArray(photos) ? photos : []) : undefined,
    planter: r.planter_name || r.planter_phone ? {
      id: r.planter_id,
      name: r.planter_name,
      phone: r.planter_phone,
      farmName: r.farm_name,
      farmAddress: r.farm_address
    } : undefined
  }
}
function requireHarvestAdmin(req, res, next) {
  if (['SUPER_ADMIN', 'FULFILLMENT'].includes(req.admin?.role)) return next()
  return res.status(403).json({ error: 'FULFILLMENT_ONLY' })
}
function cleanPhotos(value) {
  const list = Array.isArray(value) ? value : []
  return list
    .map((x) => String(x || '').trim())
    .filter((x) => x.startsWith('data:image/'))
    .slice(0, 5)
}

async function nextAgentCode(client = pool) {
  for (let i = 0; i < 20; i += 1) {
    const count = await client.query('SELECT COUNT(*)::int AS n FROM sales_advisers')
    const code = `AG${1001 + Number(count.rows[0].n || 0) + i}`
    const exists = await client.query('SELECT id FROM sales_advisers WHERE agent_code=$1 OR referral_code=$1', [code])
    if (!exists.rowCount) return code
  }
  return `AG${Date.now().toString().slice(-8)}`
}

async function findSponsor(client, sponsorCode) {
  const code = cleanText(sponsorCode).toUpperCase()
  if (!code) return null
  const res = await client.query('SELECT * FROM sales_advisers WHERE agent_code=$1 OR referral_code=$1', [code])
  return res.rows[0] || null
}

function ownerLabel(admins, ownerAdminId) {
  if (ownerAdminId === 'admin_super' || ownerAdminId === 'ALL') return 'HQ / Super Admin'
  return admins.find((a) => a.id === ownerAdminId)?.name || ownerAdminId || 'HQ / Super Admin'
}

async function ownerOptions() {
  const admins = await query("SELECT * FROM admin_users WHERE role IN ('SUPER_ADMIN','LEADER') AND status='ACTIVE' ORDER BY role DESC, created_at ASC")
  const rows = admins.rows.map(toAdmin)
  return [
    { id: 'admin_super', name: 'HQ / Super Admin' },
    ...rows.filter((a) => a.role === 'LEADER').map((a) => ({ id: a.id, name: a.name }))
  ]
}

async function hydrateAgent(row, admins = null) {
  const allAdmins = admins || (await query('SELECT id, name FROM admin_users')).rows
  const sponsor = row.sponsor_agent_id ? (await query('SELECT * FROM sales_advisers WHERE id=$1', [row.sponsor_agent_id])).rows[0] : null
  const balance = await getAgentBalance(row.id)
  return toAgent(row, {
    balance,
    annualFeeDaysLeft: daysLeft(row.annual_fee_expires_at),
    ownerName: ownerLabel(allAdmins, row.owner_admin_id),
    sponsor: sponsor ? toAgent(sponsor) : null
  })
}

async function scopedAgentIds(admin) {
  const where = scopedAgentsWhere(admin, 'a')
  const res = await query(`SELECT a.id FROM sales_advisers a WHERE ${where.sql}`, where.params)
  return res.rows.map((r) => r.id)
}

function makeInClause(ids, startIndex = 1) {
  if (!ids.length) return { sql: '(NULL)', params: [] }
  return { sql: `(${ids.map((_, i) => `$${i + startIndex}`).join(',')})`, params: ids }
}

function scopedCompanyLedgerWhere(admin, companyAlias = 'c', agentAlias = 'a') {
  if (admin?.role === 'SUPER_ADMIN') return { sql: 'TRUE', params: [] }
  const scope = adminDataScopeId(admin)
  if (!scope || scope === 'ALL') return { sql: 'TRUE', params: [] }
  return { sql: `(${companyAlias}.owner_admin_id = $1 OR ${agentAlias}.owner_admin_id = $1)`, params: [scope] }
}

function pageParams(req, defaultLimit = 50, maxLimit = 100) {
  const page = Math.max(1, Math.floor(num(req.query.page, 1)))
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(num(req.query.limit, defaultLimit))))
  const offset = (page - 1) * limit
  const search = cleanText(req.query.search).toLowerCase()
  return { page, limit, offset, search }
}

function paginationMeta(total, page, limit) {
  const safeTotal = Number(total || 0)
  return {
    page,
    limit,
    total: safeTotal,
    totalPages: Math.max(1, Math.ceil(safeTotal / limit))
  }
}

function emptyPage(page, limit) {
  return paginationMeta(0, page, limit)
}


function safeCountRow(result, key = 'n') {
  return Number(result?.rows?.[0]?.[key] || 0)
}

function backgroundTask(name, fn) {
  setTimeout(() => {
    Promise.resolve()
      .then(fn)
      .catch((err) => console.warn(`[background:${name}]`, err?.message || err))
  }, 0)
}

async function warmAdminAfterDashboard(admin) {
  if (process.env.ENABLE_ADMIN_DASHBOARD_WARMUP !== 'true') return
  const jobs = []

  if (adminHasPermission(admin, 'agents')) {
    jobs.push((async () => {
      const scoped = scopedAgentsWhere(admin, 'a')
      await query(
        `SELECT a.id
         FROM sales_advisers a
         WHERE ${scoped.sql}
         ORDER BY a.created_at DESC
         LIMIT 50`,
        scoped.params
      )
    })())
  }

  if (adminHasPermission(admin, 'orders')) {
    jobs.push((async () => {
      const scoped = scopedAgentsWhere(admin, 'a')
      await query(
        `SELECT o.id
         FROM orders o
         JOIN sales_advisers a ON a.id=o.agent_id
         WHERE ${scoped.sql}
         ORDER BY o.created_at DESC
         LIMIT 50`,
        scoped.params
      )
    })())
  }

  if (adminHasPermission(admin, 'reward')) {
    jobs.push((async () => {
      const scoped = scopedAgentsWhere(admin, 'a')
      await query(
        `SELECT w.id
         FROM reward_ledger w
         JOIN sales_advisers a ON a.id=w.agent_id
         WHERE ${scoped.sql}
         ORDER BY w.created_at DESC
         LIMIT 50`,
        scoped.params
      )
    })())
  }

  if (adminHasPermission(admin, 'withdrawals')) {
    jobs.push((async () => {
      const scoped = scopedAgentsWhere(admin, 'a')
      await query(
        `SELECT w.id
         FROM withdrawals w
         JOIN sales_advisers a ON a.id=w.agent_id
         WHERE ${scoped.sql}
         ORDER BY w.created_at DESC
         LIMIT 50`,
        scoped.params
      )
    })())
  }

  if (adminHasPermission(admin, 'reports')) {
    jobs.push((async () => {
      const scoped = scopedAgentsWhere(admin, 'a')
      await Promise.all([
        query(`SELECT COUNT(*)::int AS total FROM sales_advisers a WHERE ${scoped.sql}`, scoped.params),
        query(`SELECT COUNT(*)::int AS total FROM orders o JOIN sales_advisers a ON a.id=o.agent_id WHERE ${scoped.sql}`, scoped.params),
        query(`SELECT COUNT(*)::int AS total FROM withdrawals w JOIN sales_advisers a ON a.id=w.agent_id WHERE ${scoped.sql}`, scoped.params)
      ])
    })())
  }

  await Promise.allSettled(jobs)
}

async function canAccessAgent(admin, agentId) {
  if (admin.role === 'SUPER_ADMIN') return true
  const scope = adminDataScopeId(admin)
  if (scope === 'ALL') return true
  const res = await query('SELECT id FROM sales_advisers WHERE id=$1 AND owner_admin_id=$2', [agentId, scope])
  return Boolean(res.rowCount)
}

function commissionRuleOwnerId(admin, explicitOwnerAdminId = null) {
  if (admin?.role === 'SUPER_ADMIN') return cleanText(explicitOwnerAdminId) || 'admin_super'
  return adminDataScopeId(admin) || 'admin_super'
}

function requireOfficeAdmin(req, res, next) {
  if (['SUPER_ADMIN', 'LEADER', 'SUB_ADMIN'].includes(req.admin?.role)) return next()
  return res.status(403).json({ error: 'OFFICE_ADMIN_ONLY' })
}

app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'production-db', time: new Date().toISOString() }))

app.post('/api/dev/reset', (req, res) => {
  if (process.env.ENABLE_DEV_RESET !== 'true') return res.status(404).json({ error: 'NOT_AVAILABLE_IN_PRODUCTION' })
  res.status(410).json({ error: 'DEV_RESET_REMOVED_USE_DATABASE_MIGRATION' })
})

app.post('/api/auth/admin-login', async (req, res, next) => {
  try {
    const code = cleanText(req.body.code)
    const password = String(req.body.password || '')
    const result = await query('SELECT * FROM admin_users WHERE code=$1 AND status=$2', [code, 'ACTIVE'])
    const row = result.rows[0]
    if (!row) return res.status(401).json({ error: 'INVALID_LOGIN' })
    const ok = await bcrypt.compare(password, row.password_hash)
    if (!ok) return res.status(401).json({ error: 'INVALID_LOGIN' })
    const admin = toAdmin(row)
    await audit({ actorType: 'ADMIN', actorId: admin.id, action: 'ADMIN_LOGIN', entityType: 'ADMIN_USER', entityId: admin.id })
    res.json({ token: signAdminToken(admin), admin })
  } catch (err) { next(err) }
})

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ admin: req.admin }))


function canManageAdminUsers(admin) {
  return ['SUPER_ADMIN', 'LEADER'].includes(admin?.role)
}

function requireAdminUserManager(req, res, next) {
  if (canManageAdminUsers(req.admin)) return next()
  return res.status(403).json({ error: 'ADMIN_USER_MANAGER_ONLY' })
}

function adminUsersScopeFilter(admin, params, search) {
  const clauses = []
  if (admin?.role !== 'SUPER_ADMIN') {
    params.push(adminDataScopeId(admin))
    clauses.push(`au.role='SUB_ADMIN' AND au.scope_owner_admin_id=$${params.length}`)
  }
  if (search) {
    params.push(`%${search}%`)
    clauses.push(`(LOWER(au.code) LIKE $${params.length} OR LOWER(au.name) LIKE $${params.length} OR LOWER(au.role) LIKE $${params.length} OR LOWER(au.status) LIKE $${params.length})`)
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
}

function canAccessAdminUserTarget(actor, target) {
  if (!actor || !target) return false
  if (actor.role === 'SUPER_ADMIN') return true
  if (actor.role === 'LEADER') {
    return target.role === 'SUB_ADMIN' && target.scope_owner_admin_id === adminDataScopeId(actor)
  }
  return false
}

async function getAdminUserTarget(id) {
  const existing = await query('SELECT * FROM admin_users WHERE id=$1', [id])
  return existing.rows[0] || null
}

app.get('/api/admin/admin-users', requireAdmin, requireAdminUserManager, async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const params = []
    const where = adminUsersScopeFilter(req.admin, params, search)
    params.push(limit, offset)
    const result = await query(
      `SELECT au.*,
          owner.name AS scope_owner_name,
          CASE
            WHEN au.id='admin_super' THEN (SELECT COUNT(*)::int FROM sales_advisers sa WHERE sa.owner_admin_id='admin_super')
            WHEN au.role IN ('LEADER','SUB_ADMIN') THEN (SELECT COUNT(*)::int FROM sales_advisers sa WHERE sa.owner_admin_id=au.scope_owner_admin_id)
            ELSE 0
          END AS downline_count,
          COUNT(*) OVER() AS total_count
       FROM admin_users au
       LEFT JOIN admin_users owner ON owner.id=au.scope_owner_admin_id
       ${where}
       ORDER BY au.created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    const total = result.rows[0]?.total_count || 0
    const admins = result.rows.map(toAdmin)
    res.json({ admins: admins.map((a, idx) => ({ ...a, scopeOwnerName: result.rows[idx]?.scope_owner_name || '', downlineCount: Number(result.rows[idx]?.downline_count || 0), passwordHash: undefined })), pagination: paginationMeta(total, page, limit) })
  } catch (err) { next(err) }
})

app.post('/api/admin/admin-users', requireAdmin, requireAdminUserManager, async (req, res, next) => {
  try {
    const code = cleanText(req.body.code)
    const password = String(req.body.password || '')
    const name = cleanText(req.body.name) || code
    const requestedRole = String(req.body.role || '').toUpperCase()
    const role = req.admin.role === 'SUPER_ADMIN'
      ? (['LEADER', 'SUB_ADMIN', 'FULFILLMENT'].includes(requestedRole) ? requestedRole : 'LEADER')
      : 'SUB_ADMIN'
    if (!code || password.length < 6) return res.status(400).json({ error: 'CODE_AND_PASSWORD_REQUIRED' })

    const id = uid(role === 'LEADER' ? 'leader' : (role === 'FULFILLMENT' ? 'fulfillment' : 'subadmin'))
    const permissions = normalizeAdminPermissions(role, req.body.permissions)
    const hash = await bcrypt.hash(password, 12)
    let scope = 'ALL'
    if (role === 'LEADER') scope = id
    if (role === 'SUB_ADMIN') scope = req.admin.role === 'SUPER_ADMIN' ? (cleanText(req.body.scopeOwnerAdminId) || 'admin_super') : adminDataScopeId(req.admin)
    if (role === 'FULFILLMENT') scope = req.admin.role === 'SUPER_ADMIN' ? (cleanText(req.body.scopeOwnerAdminId) || 'ALL') : adminDataScopeId(req.admin)
    await query(
      `INSERT INTO admin_users (id, code, password_hash, name, role, permissions, status, scope_owner_admin_id)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)`,
      [id, code, hash, name, role, JSON.stringify(permissions), scope]
    )
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'CREATE_ADMIN_USER', entityType: 'ADMIN_USER', entityId: id, metadata: { role, permissions, scopeOwnerAdminId: scope } })
    res.json({ ok: true, id })
  } catch (err) { next(err) }
})

app.patch('/api/admin/admin-users/:id/status', requireAdmin, requireAdminUserManager, async (req, res, next) => {
  try {
    const status = req.body.status === 'ACTIVE' ? 'ACTIVE' : 'HIDDEN'
    const target = await getAdminUserTarget(req.params.id)
    if (!target || target.id === 'admin_super' || !canAccessAdminUserTarget(req.admin, target)) return res.status(400).json({ error: 'INVALID_ADMIN_USER' })
    await query('UPDATE admin_users SET status=$2, updated_at=NOW() WHERE id=$1', [req.params.id, status])
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'UPDATE_ADMIN_STATUS', entityType: 'ADMIN_USER', entityId: req.params.id, metadata: { status } })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.patch('/api/admin/admin-users/:id/permissions', requireAdmin, requireAdminUserManager, async (req, res, next) => {
  try {
    const target = await getAdminUserTarget(req.params.id)
    if (!target || target.role === 'SUPER_ADMIN' || target.role === 'FULFILLMENT' || !canAccessAdminUserTarget(req.admin, target)) return res.status(400).json({ error: 'INVALID_ADMIN_USER' })
    const permissions = normalizeAdminPermissions(target.role, req.body.permissions)
    await query('UPDATE admin_users SET permissions=$2, updated_at=NOW() WHERE id=$1', [req.params.id, JSON.stringify(permissions)])
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'UPDATE_ADMIN_PERMISSIONS', entityType: 'ADMIN_USER', entityId: req.params.id, metadata: { permissions } })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.patch('/api/admin/admin-users/:id/password', requireAdmin, requireAdminUserManager, async (req, res, next) => {
  try {
    const password = String(req.body.password || '')
    if (password.length < 6) return res.status(400).json({ error: 'PASSWORD_MIN_6' })
    const target = await getAdminUserTarget(req.params.id)
    if (!target || target.role === 'SUPER_ADMIN' || !canAccessAdminUserTarget(req.admin, target)) return res.status(400).json({ error: 'INVALID_ADMIN_USER' })
    const hash = await bcrypt.hash(password, 12)
    await query('UPDATE admin_users SET password_hash=$2, updated_at=NOW() WHERE id=$1', [req.params.id, hash])
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'UPDATE_ADMIN_PASSWORD', entityType: 'ADMIN_USER', entityId: req.params.id, metadata: { role: target.role } })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.post('/api/auth/request-tac', async (req, res, next) => {
  try {
    const result = await createOtp(req.body.email, 'LOGIN_REGISTER')
    res.json({ ok: true, devTac: result.devTac })
  } catch (err) { next(err) }
})

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const email = cleanEmail(req.body.email)
    const name = cleanText(req.body.name) || email
    const sponsorCode = cleanText(req.body.sponsorCode).toUpperCase()
    if (!sponsorCode) return res.status(400).json({ error: 'SPONSOR_CODE_REQUIRED' })
    await verifyOtp(email, req.body.tac, 'LOGIN_REGISTER')
    const result = await tx(async (client) => {
      const exists = await client.query('SELECT id FROM sales_advisers WHERE email=$1', [email])
      if (exists.rowCount) throw new Error('EMAIL_ALREADY_REGISTERED')
      const sponsor = await findSponsor(client, sponsorCode)
      if (!sponsor) throw new Error('INVALID_SPONSOR_CODE')
      if (!isActiveStatus(sponsor.status) || daysLeft(sponsor.annual_fee_expires_at) <= 0) throw new Error('SPONSOR_NOT_ACTIVE')
      const code = await nextAgentCode(client)
      const id = uid('agent')
      const ownerAdminId = sponsor.owner_admin_id || 'admin_super'
      await client.query(
        `INSERT INTO sales_advisers (id, agent_code, email, name, sponsor_agent_id, owner_admin_id, status, referral_code, profile)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING_FEE',$2,'{}')`,
        [id, code, email, name, sponsor.id, ownerAdminId]
      )
      await audit({ actorType: 'SALES_ADVISER', actorId: id, action: 'REGISTER', entityType: 'SALES_ADVISER', entityId: id, metadata: { sponsorCode, ownerAdminId }, client })
      const row = (await client.query('SELECT * FROM sales_advisers WHERE id=$1', [id])).rows[0]
      return row
    })
    const agent = toAgent(result, { balance: 0, annualFeeDaysLeft: 0 })
    res.json({ token: signAgentToken(agent), agent })
  } catch (err) { next(err) }
})

app.post('/api/auth/agent-login', async (req, res, next) => {
  try {
    const email = cleanEmail(req.body.email)
    await verifyOtp(email, req.body.tac, 'LOGIN_REGISTER')
    const result = await query('SELECT * FROM sales_advisers WHERE email=$1', [email])
    const row = result.rows[0]
    if (!row) return res.status(404).json({ error: 'AGENT_NOT_FOUND' })
    const agent = await hydrateAgent(row)
    res.json({ token: signAgentToken(agent), agent })
  } catch (err) { next(err) }
})


app.post('/api/auth/planter-register', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    const password = String(req.body.password || '')
    const name = cleanText(req.body.name)
    const farmName = cleanText(req.body.farmName)
    const farmAddress = cleanText(req.body.farmAddress)
    if (!phone || !name || password.length < 6) return res.status(400).json({ error: 'PLANTER_REGISTER_REQUIRED' })
    const exists = await query('SELECT id FROM planters WHERE phone=$1', [phone])
    if (exists.rowCount) return res.status(400).json({ error: 'PLANTER_PHONE_EXISTS' })
    const id = uid('planter')
    const hash = await bcrypt.hash(password, 12)
    await query(
      `INSERT INTO planters (id, phone, password_hash, name, farm_name, farm_address, status, profile)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE','{}')`,
      [id, phone, hash, name, farmName, farmAddress]
    )
    const row = (await query('SELECT * FROM planters WHERE id=$1', [id])).rows[0]
    const planter = toPlanter(row)
    await audit({ actorType: 'PLANTER', actorId: id, action: 'PLANTER_REGISTER', entityType: 'PLANTER', entityId: id })
    res.json({ token: signPlanterToken(planter), planter })
  } catch (err) { next(err) }
})

app.post('/api/auth/planter-login', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    const password = String(req.body.password || '')
    const result = await query('SELECT * FROM planters WHERE phone=$1 AND status=$2', [phone, 'ACTIVE'])
    const row = result.rows[0]
    if (!row) return res.status(401).json({ error: 'INVALID_PLANTER_LOGIN' })
    const ok = await bcrypt.compare(password, row.password_hash)
    if (!ok) return res.status(401).json({ error: 'INVALID_PLANTER_LOGIN' })
    const planter = toPlanter(row)
    await audit({ actorType: 'PLANTER', actorId: planter.id, action: 'PLANTER_LOGIN', entityType: 'PLANTER', entityId: planter.id })
    res.json({ token: signPlanterToken(planter), planter })
  } catch (err) { next(err) }
})

app.get('/api/planter/me', requirePlanter, async (req, res, next) => {
  try {
    const row = (await query('SELECT * FROM planters WHERE id=$1', [req.planter.id])).rows[0]
    res.json({ planter: toPlanter(row) })
  } catch (err) { next(err) }
})

app.patch('/api/planter/profile', requirePlanter, async (req, res, next) => {
  try {
    await query(
      `UPDATE planters SET name=$2, farm_name=$3, farm_address=$4, updated_at=NOW() WHERE id=$1`,
      [req.planter.id, cleanText(req.body.name) || req.planter.name, cleanText(req.body.farmName), cleanText(req.body.farmAddress)]
    )
    await audit({ actorType: 'PLANTER', actorId: req.planter.id, action: 'UPDATE_PLANTER_PROFILE', entityType: 'PLANTER', entityId: req.planter.id })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.get('/api/planter/harvest-requests', requirePlanter, async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 30, 80)
    const params = [req.planter.id]
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `AND (LOWER(h.fruit_type) LIKE $${i} OR LOWER(h.maturity_status) LIKE $${i} OR LOWER(h.status) LIKE $${i} OR LOWER(h.notes) LIKE $${i})`
    }
    params.push(limit, offset)
    const result = await query(
      `SELECT h.*, p.name AS planter_name, p.phone AS planter_phone, p.farm_name, p.farm_address, COUNT(*) OVER() AS total_count
       FROM harvest_requests h
       JOIN planters p ON p.id=h.planter_id
       WHERE h.planter_id=$1 ${searchSql}
       ORDER BY h.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ requests: result.rows.map((r) => rowToHarvestRequest(r, true)), pagination: paginationMeta(result.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.post('/api/planter/harvest-requests', requirePlanter, async (req, res, next) => {
  try {
    const fruitType = cleanText(req.body.fruitType)
    const estimatedWeight = roundMoney(req.body.estimatedWeight)
    const maturityStatus = cleanText(req.body.maturityStatus)
    const notes = cleanText(req.body.notes)
    const phone = normalizePhone(req.body.phone) || req.planter.phone
    const latitude = req.body.latitude === null || req.body.latitude === undefined || req.body.latitude === '' ? null : Number(req.body.latitude)
    const longitude = req.body.longitude === null || req.body.longitude === undefined || req.body.longitude === '' ? null : Number(req.body.longitude)
    const locationAccuracy = req.body.locationAccuracy === null || req.body.locationAccuracy === undefined || req.body.locationAccuracy === '' ? null : Number(req.body.locationAccuracy)
    const locationAddress = cleanText(req.body.locationAddress)
    const photos = cleanPhotos(req.body.photos)
    if (!fruitType || estimatedWeight <= 0 || !phone) return res.status(400).json({ error: 'HARVEST_REQUIRED_FIELDS' })
    if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return res.status(400).json({ error: 'LOCATION_REQUIRED' })
    if (!photos.length) return res.status(400).json({ error: 'HARVEST_PHOTO_REQUIRED' })
    const id = uid('harvest')
    await query(
      `INSERT INTO harvest_requests (id, planter_id, fruit_type, estimated_weight, maturity_status, notes, phone, latitude, longitude, location_accuracy, location_address, photos, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING')`,
      [id, req.planter.id, fruitType, estimatedWeight, maturityStatus, notes, phone, latitude, longitude, locationAccuracy, locationAddress, JSON.stringify(photos)]
    )
    await audit({ actorType: 'PLANTER', actorId: req.planter.id, action: 'CREATE_HARVEST_REQUEST', entityType: 'HARVEST_REQUEST', entityId: id, metadata: { fruitType, estimatedWeight } })
    res.json({ ok: true, id })
  } catch (err) { next(err) }
})

app.get('/api/admin/planters', requireAdmin, requireSuperAdmin, async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const params = []
    let searchSql = "WHERE p.status <> 'DELETED'"
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql += ` AND (LOWER(p.id) LIKE $${i} OR LOWER(p.name) LIKE $${i} OR LOWER(p.phone) LIKE $${i} OR LOWER(p.farm_name) LIKE $${i} OR LOWER(p.farm_address) LIKE $${i} OR LOWER(p.status) LIKE $${i})`
    }
    params.push(limit, offset)
    const result = await query(
      `SELECT p.*, COUNT(h.id)::int AS harvest_request_count, MAX(h.created_at) AS latest_harvest_at, COUNT(*) OVER() AS total_count
       FROM planters p
       LEFT JOIN harvest_requests h ON h.planter_id=p.id
       ${searchSql}
       GROUP BY p.id
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ planters: result.rows.map(rowToPlanterAdmin), pagination: paginationMeta(result.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.post('/api/admin/planters', requireAdmin, requireSuperAdmin, async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    const password = String(req.body.password || '')
    const name = cleanText(req.body.name)
    const farmName = cleanText(req.body.farmName)
    const farmAddress = cleanText(req.body.farmAddress)
    if (!phone || !name || password.length < 6) return res.status(400).json({ error: 'PLANTER_REGISTER_REQUIRED' })
    const exists = await query("SELECT id FROM planters WHERE phone=$1 AND status <> 'DELETED'", [phone])
    if (exists.rowCount) return res.status(400).json({ error: 'PLANTER_PHONE_EXISTS' })
    const id = uid('planter')
    const hash = await bcrypt.hash(password, 12)
    await query(
      `INSERT INTO planters (id, phone, password_hash, name, farm_name, farm_address, status, profile)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE','{}')`,
      [id, phone, hash, name, farmName, farmAddress]
    )
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'CREATE_PLANTER', entityType: 'PLANTER', entityId: id, metadata: { phone, name } })
    const row = (await query('SELECT p.*, 0::int AS harvest_request_count, NULL::timestamptz AS latest_harvest_at FROM planters p WHERE p.id=$1', [id])).rows[0]
    res.json({ ok: true, planter: rowToPlanterAdmin(row) })
  } catch (err) { next(err) }
})

app.patch('/api/admin/planters/:id', requireAdmin, requireSuperAdmin, async (req, res, next) => {
  try {
    const id = cleanText(req.params.id)
    const current = (await query("SELECT * FROM planters WHERE id=$1 AND status <> 'DELETED'", [id])).rows[0]
    if (!current) return res.status(404).json({ error: 'PLANTER_NOT_FOUND' })
    const phone = normalizePhone(req.body.phone) || current.phone
    const name = cleanText(req.body.name) || current.name
    const farmName = cleanText(req.body.farmName)
    const farmAddress = cleanText(req.body.farmAddress)
    const status = ['ACTIVE', 'DISABLED'].includes(String(req.body.status || '').toUpperCase()) ? String(req.body.status).toUpperCase() : current.status
    const password = String(req.body.password || '')
    const dup = await query("SELECT id FROM planters WHERE phone=$1 AND id<>$2 AND status <> 'DELETED'", [phone, id])
    if (dup.rowCount) return res.status(400).json({ error: 'PLANTER_PHONE_EXISTS' })
    if (password && password.length < 6) return res.status(400).json({ error: 'PASSWORD_MIN_6' })
    if (password) {
      const hash = await bcrypt.hash(password, 12)
      await query(
        `UPDATE planters SET phone=$2, name=$3, farm_name=$4, farm_address=$5, status=$6, password_hash=$7, updated_at=NOW() WHERE id=$1`,
        [id, phone, name, farmName, farmAddress, status, hash]
      )
    } else {
      await query(
        `UPDATE planters SET phone=$2, name=$3, farm_name=$4, farm_address=$5, status=$6, updated_at=NOW() WHERE id=$1`,
        [id, phone, name, farmName, farmAddress, status]
      )
    }
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'UPDATE_PLANTER', entityType: 'PLANTER', entityId: id, metadata: { status } })
    const row = (await query(
      `SELECT p.*, COUNT(h.id)::int AS harvest_request_count, MAX(h.created_at) AS latest_harvest_at
       FROM planters p LEFT JOIN harvest_requests h ON h.planter_id=p.id WHERE p.id=$1 GROUP BY p.id`,
      [id]
    )).rows[0]
    res.json({ ok: true, planter: rowToPlanterAdmin(row) })
  } catch (err) { next(err) }
})

app.delete('/api/admin/planters/:id', requireAdmin, requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await query("UPDATE planters SET status='DELETED', updated_at=NOW() WHERE id=$1 AND status <> 'DELETED' RETURNING id", [req.params.id])
    if (!result.rowCount) return res.status(404).json({ error: 'PLANTER_NOT_FOUND' })
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'DELETE_PLANTER', entityType: 'PLANTER', entityId: req.params.id })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.get('/api/admin/harvest-requests', requireAdmin, requireHarvestAdmin, async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const params = []
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `WHERE (LOWER(h.id) LIKE $${i} OR LOWER(h.fruit_type) LIKE $${i} OR LOWER(h.maturity_status) LIKE $${i} OR LOWER(h.status) LIKE $${i} OR LOWER(p.name) LIKE $${i} OR LOWER(p.phone) LIKE $${i} OR LOWER(p.farm_name) LIKE $${i})`
    }
    params.push(limit, offset)
    const result = await query(
      `SELECT
         h.id,
         h.planter_id,
         h.fruit_type,
         h.estimated_weight,
         h.maturity_status,
         h.notes,
         h.phone,
         h.latitude,
         h.longitude,
         h.location_accuracy,
         h.location_address,
         h.status,
         h.admin_remark,
         h.reviewed_by_admin_id,
         h.reviewed_at,
         h.created_at,
         h.updated_at,
         CASE WHEN jsonb_typeof(h.photos) = 'array' THEN jsonb_array_length(h.photos) ELSE 0 END::int AS photo_count,
         p.name AS planter_name,
         p.phone AS planter_phone,
         p.farm_name,
         p.farm_address,
         COUNT(*) OVER() AS total_count
       FROM harvest_requests h
       JOIN planters p ON p.id=h.planter_id
       ${searchSql}
       ORDER BY h.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ requests: result.rows.map((r) => rowToHarvestRequest(r, false)), pagination: paginationMeta(result.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.get('/api/admin/harvest-requests/:id', requireAdmin, requireHarvestAdmin, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT h.*, p.name AS planter_name, p.phone AS planter_phone, p.farm_name, p.farm_address
       FROM harvest_requests h
       JOIN planters p ON p.id=h.planter_id
       WHERE h.id=$1`,
      [req.params.id]
    )
    const row = result.rows[0]
    if (!row) return res.status(404).json({ error: 'HARVEST_REQUEST_NOT_FOUND' })
    res.json({ request: rowToHarvestRequest(row, true) })
  } catch (err) { next(err) }
})

app.patch('/api/admin/harvest-requests/:id/status', requireAdmin, requireHarvestAdmin, async (req, res, next) => {
  try {
    const status = ['PENDING', 'SCHEDULED', 'COLLECTED', 'REJECTED'].includes(String(req.body.status || '').toUpperCase()) ? String(req.body.status).toUpperCase() : 'PENDING'
    const remark = cleanText(req.body.adminRemark)
    const result = await query(
      `UPDATE harvest_requests
       SET status=$2, admin_remark=$3, reviewed_by_admin_id=$4, reviewed_at=NOW(), updated_at=NOW()
       WHERE id=$1
       RETURNING id`,
      [req.params.id, status, remark, req.admin.id]
    )
    if (!result.rowCount) return res.status(404).json({ error: 'HARVEST_REQUEST_NOT_FOUND' })
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'UPDATE_HARVEST_STATUS', entityType: 'HARVEST_REQUEST', entityId: req.params.id, metadata: { status } })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.get('/api/config', async (req, res, next) => {
  try {
    
    const adminContact = await getAdminContactSettings('admin_super')
    res.json({ annualFeeAmount: adminContact.annualFeeAmount, adminWhatsapp: adminContact.whatsapp, adminContact })
  } catch (err) { next(err) }
})

app.get('/api/admin/dashboard', requireAdmin, requireOfficeAdmin, requireAdminPermission('dashboard'), async (req, res, next) => {
  try {
    const scoped = scopedAgentsWhere(req.admin, 'a')
    const companyScoped = scopedCompanyLedgerWhere(req.admin, 'c', 'ca')
    const recentScoped = scopedAgentsWhere(req.admin, 'ra')
    const [agentStats, proofs, withdrawals, company, recent, harvestPending] = await Promise.all([
      query(
        `SELECT
           COUNT(*)::int AS total_agents,
           COUNT(*) FILTER (WHERE a.status='ACTIVE')::int AS active_agents,
           COUNT(*) FILTER (WHERE a.status='FROZEN')::int AS frozen_agents
         FROM sales_advisers a
         WHERE ${scoped.sql}`,
        scoped.params
      ),
      query(
        `SELECT COUNT(*)::int AS n
         FROM payment_proofs p
         JOIN sales_advisers a ON a.id=p.agent_id
         WHERE ${scoped.sql} AND p.status='PENDING'`,
        scoped.params
      ),
      query(
        `SELECT COUNT(*)::int AS n
         FROM withdrawals w
         JOIN sales_advisers a ON a.id=w.agent_id
         WHERE ${scoped.sql} AND w.status='PENDING'`,
        scoped.params
      ),
      query(
        `SELECT COALESCE(SUM(c.amount),0)::numeric AS total
         FROM company_ledger c
         LEFT JOIN sales_advisers ca ON ca.id=c.from_agent_id
         WHERE ${companyScoped.sql}`,
        companyScoped.params
      ),
      query(
        `SELECT c.*
         FROM commission_ledger c
         LEFT JOIN sales_advisers ra ON ra.id=c.to_agent_id
         WHERE ${recentScoped.sql}
         ORDER BY c.created_at DESC
         LIMIT 20`,
        recentScoped.params
      ),
      query(`SELECT COUNT(*)::int AS n FROM harvest_requests WHERE status='PENDING'`)
    ])

    const statsRow = agentStats.rows[0] || {}
    const payload = {
      stats: {
        totalAgents: Number(statsRow.total_agents || 0),
        activeAgents: Number(statsRow.active_agents || 0),
        frozenAgents: Number(statsRow.frozen_agents || 0),
        pendingProofs: safeCountRow(proofs),
        pendingWithdrawals: safeCountRow(withdrawals),
        pendingHarvestRequests: safeCountRow(harvestPending),
        totalCompanyIncome: Number(company.rows[0]?.total || 0)
      },
      recentCommissions: recent.rows.map((r) => ({ id: r.id, generation: r.generation, sourceType: r.source_type, amount: Number(r.amount), status: r.status }))
    }

    res.json(payload)
    backgroundTask('admin-dashboard-warmup', () => warmAdminAfterDashboard(req.admin))
  } catch (err) { next(err) }
})


app.get('/api/admin/member-tree', requireAdmin, requireOfficeAdmin, requireAdminPermission('agents'), async (req, res, next) => {
  try {
    const scoped = scopedAgentsWhere(req.admin, 'a')
    const params = [...scoped.params]
    let ownerSql = ''
    const requestedOwner = cleanText(req.query.ownerAdminId)
    if (req.admin.role === 'SUPER_ADMIN' && requestedOwner && requestedOwner !== 'ALL') {
      params.push(requestedOwner)
      ownerSql = `AND a.owner_admin_id = $${params.length}`
    }
    let searchSql = ''
    const search = cleanText(req.query.search).toLowerCase()
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `AND (LOWER(a.agent_code) LIKE $${i} OR LOWER(a.referral_code) LIKE $${i} OR LOWER(a.name) LIKE $${i} OR LOWER(a.email) LIKE $${i} OR LOWER(a.status) LIKE $${i} OR LOWER(COALESCE(a.profile->>'phone','')) LIKE $${i} OR LOWER(COALESCE(au.name,'')) LIKE $${i} OR LOWER(COALESCE(s.agent_code,'')) LIKE $${i})`
    }
    const result = await query(
      `SELECT
          a.*,
          s.agent_code AS sponsor_agent_code,
          s.name AS sponsor_name,
          CASE WHEN a.owner_admin_id='admin_super' THEN 'HQ / Super Admin' ELSE COALESCE(au.name, a.owner_admin_id, 'HQ / Super Admin') END AS owner_name,
          COALESCE(b.balance,0)::numeric AS balance
       FROM sales_advisers a
       LEFT JOIN sales_advisers s ON s.id=a.sponsor_agent_id
       LEFT JOIN admin_users au ON au.id=a.owner_admin_id
       LEFT JOIN (
         SELECT agent_id, COALESCE(SUM(amount),0)::numeric AS balance
         FROM reward_ledger
         WHERE status='POSTED'
         GROUP BY agent_id
       ) b ON b.agent_id=a.id
       WHERE ${scoped.sql} ${ownerSql} ${searchSql}
       ORDER BY a.owner_admin_id ASC, a.created_at ASC`,
      params
    )
    const agents = result.rows.map((row) => toAgent(row, {
      balance: Number(row.balance || 0),
      annualFeeDaysLeft: daysLeft(row.annual_fee_expires_at),
      phone: jsonValue(row.profile, {}).phone || '',
      ownerName: row.owner_name,
      sponsor: row.sponsor_agent_id ? { id: row.sponsor_agent_id, agentCode: row.sponsor_agent_code, name: row.sponsor_name } : null
    }))
    res.json({ agents, ownerOptions: [{ id: 'ALL', name: 'All Admins' }, ...(await ownerOptions())] })
  } catch (err) { next(err) }
})

app.get('/api/admin/agents', requireAdmin, requireOfficeAdmin, requireAdminPermission('agents'), async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const scoped = scopedAgentsWhere(req.admin, 'a')
    const params = [...scoped.params]
    let ownerSql = ''
    const requestedOwner = cleanText(req.query.ownerAdminId)
    if (req.admin.role === 'SUPER_ADMIN' && requestedOwner && requestedOwner !== 'ALL') {
      params.push(requestedOwner)
      ownerSql = `AND a.owner_admin_id = $${params.length}`
    }
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `AND (LOWER(a.agent_code) LIKE $${i} OR LOWER(a.referral_code) LIKE $${i} OR LOWER(a.name) LIKE $${i} OR LOWER(a.email) LIKE $${i} OR LOWER(a.status) LIKE $${i} OR LOWER(COALESCE(a.profile->>'phone','')) LIKE $${i} OR LOWER(COALESCE(au.name,'')) LIKE $${i} OR LOWER(COALESCE(s.agent_code,'')) LIKE $${i})`
    }
    params.push(limit, offset)
    const limitIndex = params.length - 1
    const offsetIndex = params.length
    const result = await query(
      `SELECT
          a.*,
          s.agent_code AS sponsor_agent_code,
          s.name AS sponsor_name,
          CASE WHEN a.owner_admin_id='admin_super' THEN 'HQ / Super Admin' ELSE COALESCE(au.name, a.owner_admin_id, 'HQ / Super Admin') END AS owner_name,
          COALESCE(b.balance,0)::numeric AS balance,
          COUNT(*) OVER() AS total_count
       FROM sales_advisers a
       LEFT JOIN sales_advisers s ON s.id=a.sponsor_agent_id
       LEFT JOIN admin_users au ON au.id=a.owner_admin_id
       LEFT JOIN (
         SELECT agent_id, COALESCE(SUM(amount),0)::numeric AS balance
         FROM reward_ledger
         WHERE status='POSTED'
         GROUP BY agent_id
       ) b ON b.agent_id=a.id
       WHERE ${scoped.sql} ${ownerSql} ${searchSql}
       ORDER BY a.created_at DESC
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      params
    )
    const total = result.rows[0]?.total_count || 0
    const agents = result.rows.map((row) => toAgent(row, {
      balance: Number(row.balance || 0),
      annualFeeDaysLeft: daysLeft(row.annual_fee_expires_at),
      phone: jsonValue(row.profile, {}).phone || '',
      ownerName: row.owner_name,
      sponsor: row.sponsor_agent_id ? { id: row.sponsor_agent_id, agentCode: row.sponsor_agent_code, name: row.sponsor_name } : null
    }))
    res.json({ agents, ownerOptions: [{ id: 'ALL', name: 'All Admins' }, ...(await ownerOptions())], pagination: paginationMeta(total, page, limit) })
  } catch (err) { next(err) }
})

app.post('/api/admin/agents', requireAdmin, requireOfficeAdmin, requireAdminPermission('agents'), async (req, res, next) => {
  try {
    const email = cleanEmail(req.body.email)
    const name = cleanText(req.body.name) || email
    if (!email) return res.status(400).json({ error: 'EMAIL_REQUIRED' })
    const id = await tx(async (client) => {
      const exists = await client.query('SELECT id FROM sales_advisers WHERE email=$1', [email])
      if (exists.rowCount) throw new Error('EMAIL_ALREADY_REGISTERED')
      const sponsorCode = cleanText(req.body.sponsorCode).toUpperCase()
      const sponsor = sponsorCode ? await findSponsor(client, sponsorCode) : null
      if (sponsorCode && !sponsor) throw new Error('INVALID_SPONSOR_CODE')
      let ownerAdminId = req.admin.role === 'SUPER_ADMIN' ? (req.body.ownerAdminId || 'admin_super') : req.admin.id
      if (req.admin.role !== 'SUPER_ADMIN') ownerAdminId = req.admin.id
      if (sponsor) {
        if (req.admin.role !== 'SUPER_ADMIN' && sponsor.owner_admin_id !== req.admin.id) throw new Error('NO_SCOPE')
        if (req.admin.role === 'SUPER_ADMIN' && ownerAdminId !== sponsor.owner_admin_id) throw new Error('SPONSOR_OWNER_MISMATCH')
        if (!isActiveStatus(sponsor.status) || daysLeft(sponsor.annual_fee_expires_at) <= 0) throw new Error('SPONSOR_NOT_ACTIVE')
      }
      const code = await nextAgentCode(client)
      const agentId = uid('agent')
      await client.query(
        `INSERT INTO sales_advisers (id, agent_code, email, name, sponsor_agent_id, owner_admin_id, status, referral_code, annual_fee_expires_at, profile)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING_FEE',$2,NULL,'{}')`,
        [agentId, code, email, name, sponsor?.id || null, ownerAdminId]
      )
      await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'CREATE_SALES_ADVISER', entityType: 'SALES_ADVISER', entityId: agentId, metadata: { ownerAdminId }, client })
      return agentId
    })
    res.json({ ok: true, id })
  } catch (err) { next(err) }
})

app.patch('/api/admin/agents/:id/status', requireAdmin, requireOfficeAdmin, requireAdminPermission('agents'), async (req, res, next) => {
  try {
    if (!(await canAccessAgent(req.admin, req.params.id))) return res.status(403).json({ error: 'NO_SCOPE' })
    const status = ['ACTIVE', 'FROZEN', 'PENDING_FEE', 'HIDDEN'].includes(req.body.status) ? req.body.status : 'FROZEN'
    const result = await tx(async (client) => {
      const agentRes = await client.query('SELECT * FROM sales_advisers WHERE id=$1 FOR UPDATE', [req.params.id])
      const agent = agentRes.rows[0]
      if (!agent) throw new Error('AGENT_NOT_FOUND')
      let activation = null
      if (status === 'ACTIVE') {
        const hasValidAnnualFee = daysLeft(agent.annual_fee_expires_at) > 0
        if (!hasValidAnnualFee) {
          const amount = roundMoney(await getAdminAnnualFeeAmount(agent.owner_admin_id || 'admin_super', client))
          if (amount <= 0) throw new Error('ANNUAL_FEE_NOT_SET')
          activation = await activateAnnualFee(client, {
            agentId: agent.id,
            amount,
            sourceId: uid('manualfee'),
            sourceType: 'ANNUAL_FEE_MANUAL_ACTIVATION',
            isAutoRenewal: false
          })
        } else if (agent.status !== 'ACTIVE') {
          await client.query('UPDATE sales_advisers SET status=$2, updated_at=NOW() WHERE id=$1', [agent.id, status])
        }
      } else {
        await client.query('UPDATE sales_advisers SET status=$2, updated_at=NOW() WHERE id=$1', [agent.id, status])
      }
      await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'UPDATE_SALES_ADVISER_STATUS', entityType: 'SALES_ADVISER', entityId: req.params.id, metadata: { status, activationSource: activation ? 'ANNUAL_FEE_MANUAL_ACTIVATION' : null }, client })
      return { ok: true, activation }
    })
    res.json(result)
  } catch (err) { next(err) }
})

app.post('/api/admin/agents/:id/reward-credit', requireAdmin, requireOfficeAdmin, requireAdminPermission('agents'), async (req, res, next) => {
  try {
    if (!(await canAccessAgent(req.admin, req.params.id))) return res.status(403).json({ error: 'NO_SCOPE' })
    const result = await adjustRewardByAdmin({ adminId: req.admin.id, agentId: req.params.id, amount: req.body.amount, note: req.body.note })
    res.json({ ok: true, result })
  } catch (err) { next(err) }
})

app.get('/api/admin/products', requireAdmin, requireOfficeAdmin, requireAdminPermission('products'), async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const params = []
    let where = ''
    if (search) {
      params.push(`%${search}%`)
      where = `WHERE LOWER(sku) LIKE $1 OR LOWER(name) LIKE $1 OR LOWER(description) LIKE $1`
    }
    params.push(limit, offset)
    const result = await query(
      `SELECT *, COUNT(*) OVER() AS total_count FROM products ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ products: result.rows.map(rowToProduct), pagination: paginationMeta(result.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.post('/api/admin/products', requireAdmin, requireOfficeAdmin, requireAdminPermission('products'), async (req, res, next) => {
  try {
    const id = uid('product')
    const sku = cleanText(req.body.sku) || `SKU-${Date.now()}`
    await query(
      `INSERT INTO products (id, sku, name, description, price, cost, is_active) VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
      [id, sku, cleanText(req.body.name) || sku, cleanText(req.body.description), roundMoney(req.body.price), roundMoney(req.body.cost)]
    )
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'CREATE_PRODUCT', entityType: 'PRODUCT', entityId: id })
    res.json({ ok: true, id })
  } catch (err) { next(err) }
})

app.patch('/api/admin/products/:id', requireAdmin, requireOfficeAdmin, requireAdminPermission('products'), async (req, res, next) => {
  try {
    await query('UPDATE products SET is_active=COALESCE($2,is_active), updated_at=NOW() WHERE id=$1', [req.params.id, typeof req.body.isActive === 'boolean' ? req.body.isActive : null])
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'UPDATE_PRODUCT', entityType: 'PRODUCT', entityId: req.params.id, metadata: req.body })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.get('/api/admin/commission-rules', requireAdmin, requireOfficeAdmin, requireAdminPermission('commissionRules'), async (req, res, next) => {
  try {
    const ownerAdminId = commissionRuleOwnerId(req.admin, req.query.ownerAdminId)
    const product = await getRules({ query }, 'product', ownerAdminId)
    const annualFee = await getRules({ query }, 'annualFee', ownerAdminId)
    const adminContact = await getAdminContactSettings(ownerAdminId)
    res.json({
      ownerAdminId,
      ownerOptions: req.admin.role === 'SUPER_ADMIN' ? await ownerOptions() : [],
      rules: { product, annualFee },
      annualFeeAmount: adminContact.annualFeeAmount,
      adminWhatsapp: adminContact.whatsapp,
      adminContact
    })
  } catch (err) { next(err) }
})

app.put('/api/admin/commission-rules', requireAdmin, requireOfficeAdmin, requireAdminPermission('commissionRules'), async (req, res, next) => {
  try {
    const ownerAdminId = commissionRuleOwnerId(req.admin, req.body.ownerAdminId)
    await tx(async (client) => {
      for (const kind of ['product', 'annualFee']) {
        const list = Array.isArray(req.body[kind]) ? req.body[kind] : []
        for (const r of list) {
          const generation = Number(r.generation)
          if (!Number.isFinite(generation) || generation < 0) continue
          const type = r.type === 'amount' ? 'amount' : 'percent'
          const value = Math.max(0, num(r.value))
          await client.query(
            `INSERT INTO commission_rules (id, owner_admin_id, kind, generation, type, value, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW())
             ON CONFLICT (owner_admin_id, kind, generation) DO UPDATE SET type=EXCLUDED.type, value=EXCLUDED.value, updated_at=NOW()`,
            [uid('rule'), ownerAdminId, kind, generation, type, value]
          )
        }
      }
      const savedContact = await setAdminContactSettings(ownerAdminId, {
        annualFeeAmount: roundMoney(req.body.annualFeeAmount || 0),
        whatsapp: cleanText(req.body.adminWhatsapp),
        whatsappText: cleanText(req.body.whatsappText),
        paymentInstructions: cleanText(req.body.paymentInstructions),
        paymentQrImage: cleanText(req.body.paymentQrImage)
      }, client)
      if (ownerAdminId === 'admin_super') {
        await client.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ('adminWhatsapp',$1,NOW())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
          [JSON.stringify(savedContact.whatsapp || '')]
        )
      }
      await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'UPDATE_COMMISSION_RULES', entityType: 'COMMISSION_RULES', entityId: ownerAdminId, metadata: { ownerAdminId }, client })
    })
    res.json({ ok: true, ownerAdminId })
  } catch (err) { next(err) }
})

app.get('/api/admin/payment-proofs', requireAdmin, requireOfficeAdmin, requireAdminPermission('paymentProofs'), async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const scoped = scopedAgentsWhere(req.admin, 'a')
    const params = [...scoped.params]
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `AND (LOWER(p.type) LIKE $${i} OR LOWER(p.status) LIKE $${i} OR LOWER(COALESCE(p.proof_text,'')) LIKE $${i} OR LOWER(a.name) LIKE $${i} OR LOWER(a.agent_code) LIKE $${i})`
    }
    params.push(limit, offset)
    const result = await query(
      `SELECT p.*, a.name AS agent_name, a.agent_code, COUNT(*) OVER() AS total_count
       FROM payment_proofs p
       JOIN sales_advisers a ON a.id=p.agent_id
       WHERE ${scoped.sql} ${searchSql}
       ORDER BY p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ proofs: result.rows.map((p) => ({ ...rowToProof(p), agent: { name: p.agent_name, agentCode: p.agent_code } })), pagination: paginationMeta(result.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.post('/api/admin/payment-proofs/:id/approve', requireAdmin, requireOfficeAdmin, requireAdminPermission('paymentProofs'), async (req, res, next) => {
  try {
    const result = await tx(async (client) => {
      const proofRes = await client.query('SELECT * FROM payment_proofs WHERE id=$1 FOR UPDATE', [req.params.id])
      const proof = proofRes.rows[0]
      if (!proof) throw new Error('PROOF_NOT_FOUND')
      if (!(await canAccessAgent(req.admin, proof.agent_id))) throw new Error('NO_SCOPE')
      if (proof.status !== 'PENDING') return { alreadyReviewed: true }
      await client.query('UPDATE payment_proofs SET status=$2, reviewed_by_admin_id=$3, reviewed_at=NOW() WHERE id=$1', [proof.id, 'APPROVED', req.admin.id])
      if (proof.type === 'ANNUAL_FEE') await activateAnnualFee(client, { agentId: proof.agent_id, amount: Number(proof.amount), sourceId: proof.id, isAutoRenewal: false })
      await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'APPROVE_PAYMENT_PROOF', entityType: 'PAYMENT_PROOF', entityId: proof.id, metadata: { type: proof.type }, client })
      return { ok: true }
    })
    res.json(result)
  } catch (err) { next(err) }
})

app.post('/api/admin/payment-proofs/:id/reject', requireAdmin, requireOfficeAdmin, requireAdminPermission('paymentProofs'), async (req, res, next) => {
  try {
    const result = await tx(async (client) => {
      const proof = (await client.query('SELECT * FROM payment_proofs WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0]
      if (!proof) throw new Error('PROOF_NOT_FOUND')
      if (!(await canAccessAgent(req.admin, proof.agent_id))) throw new Error('NO_SCOPE')
      if (proof.status !== 'PENDING') return { alreadyReviewed: true }
      await client.query('UPDATE payment_proofs SET status=$2, reviewed_by_admin_id=$3, reviewed_at=NOW(), reject_reason=$4 WHERE id=$1', [proof.id, 'REJECTED', req.admin.id, cleanText(req.body.reason)])
      await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'REJECT_PAYMENT_PROOF', entityType: 'PAYMENT_PROOF', entityId: proof.id, client })
      return { ok: true }
    })
    res.json(result)
  } catch (err) { next(err) }
})

app.get('/api/admin/orders', requireAdmin, requireOfficeAdmin, requireAdminPermission('orders'), async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const scoped = scopedAgentsWhere(req.admin, 'a')
    const params = [...scoped.params]
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `AND (LOWER(o.id) LIKE $${i} OR LOWER(o.status) LIKE $${i} OR LOWER(o.fulfillment_status) LIKE $${i} OR LOWER(COALESCE(o.customer_name,'')) LIKE $${i} OR LOWER(COALESCE(o.customer_phone,'')) LIKE $${i} OR LOWER(a.name) LIKE $${i} OR LOWER(a.agent_code) LIKE $${i} OR LOWER(p.name) LIKE $${i})`
    }
    params.push(limit, offset)
    const result = await query(
      `SELECT o.*, a.name AS agent_name, a.agent_code, p.name AS product_name, COUNT(*) OVER() AS total_count
       FROM orders o
       JOIN sales_advisers a ON a.id=o.agent_id
       JOIN products p ON p.id=o.product_id
       WHERE ${scoped.sql} ${searchSql}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ orders: result.rows.map((o) => ({ ...rowToOrder(o), agent: { name: o.agent_name, agentCode: o.agent_code }, product: { name: o.product_name } })), pagination: paginationMeta(result.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.get('/api/admin/wallet-ledger', requireAdmin, requireOfficeAdmin, requireAdminPermission('reward'), async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const scoped = scopedAgentsWhere(req.admin, 'a')
    const params = [...scoped.params]
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `AND (LOWER(w.type) LIKE $${i} OR LOWER(w.source_type) LIKE $${i} OR LOWER(COALESCE(w.note,'')) LIKE $${i} OR LOWER(a.name) LIKE $${i} OR LOWER(a.agent_code) LIKE $${i} OR LOWER(COALESCE(f.name,'')) LIKE $${i} OR LOWER(COALESCE(f.agent_code,'')) LIKE $${i})`
    }
    params.push(limit, offset)
    const [reward, company] = await Promise.all([
      query(
        `SELECT
           w.*,
           a.name AS agent_name,
           a.agent_code,
           c.id AS commission_id,
           c.from_agent_id AS commission_from_agent_id,
           c.to_agent_id AS commission_to_agent_id,
           c.generation AS commission_generation,
           c.amount AS commission_amount,
           c.rule_type AS commission_rule_type,
           c.rule_value AS commission_rule_value,
           c.status AS commission_status,
           f.id AS source_agent_id,
           f.agent_code AS source_agent_code,
           f.name AS source_agent_name,
           COUNT(*) OVER() AS total_count
         FROM reward_ledger w
         JOIN sales_advisers a ON a.id=w.agent_id
         LEFT JOIN commission_ledger c
           ON c.source_type=w.source_type
          AND c.source_id=w.source_id
          AND c.to_agent_id=w.agent_id
          AND c.amount=w.amount
         LEFT JOIN sales_advisers f ON f.id=c.from_agent_id
         WHERE ${scoped.sql} ${searchSql}
         ORDER BY w.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      ),
      (() => {
        const companyScoped = scopedCompanyLedgerWhere(req.admin, 'c', 'ca')
        return query(
          `SELECT c.*, ca.id AS source_agent_id, ca.agent_code AS source_agent_code, ca.name AS source_agent_name
           FROM company_ledger c
           LEFT JOIN sales_advisers ca ON ca.id=c.from_agent_id
           WHERE ${companyScoped.sql}
           ORDER BY c.created_at DESC
           LIMIT 100`,
          companyScoped.params
        )
      })()
    ])
    const rows = reward.rows.map((w) => ({ ...rowToLedger(w), agent: { name: w.agent_name, agentCode: w.agent_code } }))
    res.json({ rows, companyLedger: company.rows.map(rowToCompany), pagination: paginationMeta(reward.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.get('/api/admin/withdrawals', requireAdmin, requireOfficeAdmin, requireAdminPermission('withdrawals'), async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const scoped = scopedAgentsWhere(req.admin, 'a')
    const params = [...scoped.params]
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `AND (LOWER(w.status) LIKE $${i} OR LOWER(COALESCE(w.reject_reason,'')) LIKE $${i} OR LOWER(a.name) LIKE $${i} OR LOWER(a.agent_code) LIKE $${i})`
    }
    params.push(limit, offset)
    const result = await query(
      `SELECT w.*, a.name AS agent_name, a.agent_code, COUNT(*) OVER() AS total_count
       FROM withdrawals w
       JOIN sales_advisers a ON a.id=w.agent_id
       WHERE ${scoped.sql} ${searchSql}
       ORDER BY w.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ withdrawals: result.rows.map((w) => ({ ...rowToWithdrawal(w), agent: { name: w.agent_name, agentCode: w.agent_code } })), pagination: paginationMeta(result.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.post('/api/admin/withdrawals/:id/mark-paid', requireAdmin, requireOfficeAdmin, requireAdminPermission('withdrawals'), async (req, res, next) => {
  try {
    const result = await tx(async (client) => {
      const w = (await client.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0]
      if (!w) throw new Error('WITHDRAWAL_NOT_FOUND', 'HARVEST_REQUEST_NOT_FOUND')
      if (!(await canAccessAgent(req.admin, w.agent_id))) throw new Error('NO_SCOPE')
      if (w.status !== 'PENDING') return { alreadyReviewed: true }
      await client.query('UPDATE withdrawals SET status=$2, reviewed_by_admin_id=$3, paid_at=NOW() WHERE id=$1', [w.id, 'PAID', req.admin.id])
      await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'WITHDRAWAL_MARK_PAID', entityType: 'WITHDRAWAL', entityId: w.id, client })
      return { ok: true }
    })
    res.json(result)
  } catch (err) { next(err) }
})

app.post('/api/admin/withdrawals/:id/reject', requireAdmin, requireOfficeAdmin, requireAdminPermission('withdrawals'), async (req, res, next) => {
  try {
    await tx(async (client) => {
      const w = (await client.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0]
      if (!w) throw new Error('WITHDRAWAL_NOT_FOUND', 'HARVEST_REQUEST_NOT_FOUND')
      if (!(await canAccessAgent(req.admin, w.agent_id))) throw new Error('NO_SCOPE')
      if (w.status !== 'PENDING') return
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`agent-balance:${w.agent_id}`])
      await client.query('UPDATE withdrawals SET status=$2, reviewed_by_admin_id=$3, rejected_at=NOW(), reject_reason=$4 WHERE id=$1', [w.id, 'REJECTED', req.admin.id, cleanText(req.body.reason)])
      await client.query(
        `INSERT INTO reward_ledger (id, agent_id, type, amount, source_type, source_id, status, note, created_by_admin_id)
         VALUES ($1,$2,'WITHDRAWAL_REFUND',$3,'WITHDRAWAL',$4,'POSTED',$5,$6)`,
        [uid('reward'), w.agent_id, Number(w.amount), w.id, 'Withdrawal rejected; Reward refunded', req.admin.id]
      )
      await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'WITHDRAWAL_REJECT', entityType: 'WITHDRAWAL', entityId: w.id, client })
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.post('/api/admin/run-annual-renewal-check', requireAdmin, requireSuperAdmin, async (req, res, next) => {
  try { res.json({ result: await runAnnualRenewalCheckOnce(req.admin.id) }) } catch (err) { next(err) }
})

async function reportData(type, admin) {
  const ids = await scopedAgentIds(admin)
  const inClause = makeInClause(ids)
  const rows = []
  if (type === 'orders') {
    rows.push(['Order ID','Sales Adviser','Agent Code','Product','Qty','Total RM','Customer','Phone','Address','Status','Fulfillment','Courier','Tracking Number','Created At'])
    const data = ids.length ? await query(`SELECT o.*, a.name agent_name, a.agent_code, p.name product_name FROM orders o JOIN sales_advisers a ON a.id=o.agent_id JOIN products p ON p.id=o.product_id WHERE o.agent_id IN ${inClause.sql} ORDER BY o.created_at DESC`, inClause.params) : { rows: [] }
    data.rows.forEach((o) => rows.push([o.id, o.agent_name, o.agent_code, o.product_name, o.qty, Number(o.total_amount), o.customer_name, o.customer_phone, o.delivery_address, o.status, o.fulfillment_status, o.courier, o.tracking_number, o.created_at]))
  } else if (type === 'salesAdvisers') {
    rows.push(['Agent Code','Name','Email','Status','Owner Admin ID','Sponsor ID','Annual Fee Expire','Created At'])
    const data = ids.length ? await query(`SELECT * FROM sales_advisers WHERE id IN ${inClause.sql} ORDER BY created_at DESC`, inClause.params) : { rows: [] }
    data.rows.forEach((a) => rows.push([a.agent_code, a.name, a.email, a.status, a.owner_admin_id, a.sponsor_agent_id, a.annual_fee_expires_at, a.created_at]))
  } else if (type === 'paymentProofs') {
    rows.push(['Proof ID','Type','Sales Adviser','Amount RM','Proof','Status','Created At','Reviewed At'])
    const data = ids.length ? await query(`SELECT p.*, a.name agent_name FROM payment_proofs p JOIN sales_advisers a ON a.id=p.agent_id WHERE p.agent_id IN ${inClause.sql} ORDER BY p.created_at DESC`, inClause.params) : { rows: [] }
    data.rows.forEach((p) => rows.push([p.id, p.type, p.agent_name, Number(p.amount), p.proof_text, p.status, p.created_at, p.reviewed_at]))
  } else if (type === 'rewardLedger') {
    rows.push(['Ledger ID','Sales Adviser','Type','Amount RM','Source Type','Source ID','Note','Created At'])
    const data = ids.length ? await query(`SELECT w.*, a.name agent_name FROM reward_ledger w JOIN sales_advisers a ON a.id=w.agent_id WHERE w.agent_id IN ${inClause.sql} ORDER BY w.created_at DESC`, inClause.params) : { rows: [] }
    data.rows.forEach((w) => rows.push([w.id, w.agent_name, w.type, Number(w.amount), w.source_type, w.source_id, w.note, w.created_at]))
  } else if (type === 'withdrawals') {
    rows.push(['Withdrawal ID','Sales Adviser','Amount RM','Bank','Account Name','Account No','Status','Created At','Paid At'])
    const data = ids.length ? await query(`SELECT w.*, a.name agent_name FROM withdrawals w JOIN sales_advisers a ON a.id=w.agent_id WHERE w.agent_id IN ${inClause.sql} ORDER BY w.created_at DESC`, inClause.params) : { rows: [] }
    data.rows.forEach((w) => { const b = jsonValue(w.bank_snapshot, {}); rows.push([w.id, w.agent_name, Number(w.amount), b.bankName, b.bankAccountName, b.bankAccountNo, w.status, w.created_at, w.paid_at]) })
  } else if (type === 'commissions') {
    rows.push(['Commission ID','From Agent','To Agent','Generation','Source Type','Amount RM','Status','Created At'])
    const data = ids.length ? await query(`SELECT c.*, f.agent_code from_code, t.agent_code to_code FROM commission_ledger c LEFT JOIN sales_advisers f ON f.id=c.from_agent_id LEFT JOIN sales_advisers t ON t.id=c.to_agent_id WHERE c.from_agent_id IN ${inClause.sql} OR c.to_agent_id IN ${inClause.sql} ORDER BY c.created_at DESC`, inClause.params) : { rows: [] }
    data.rows.forEach((c) => rows.push([c.id, c.from_code, c.to_code, c.generation, c.source_type, Number(c.amount), c.status, c.created_at]))
  } else if (type === 'companyLedger') {
    rows.push(['Ledger ID','Owner Admin ID','From Agent ID','Amount RM','Source Type','Source ID','Note','Created At'])
    const companyScoped = scopedCompanyLedgerWhere(admin, 'c', 'a')
    const data = await query(
      `SELECT c.*
       FROM company_ledger c
       LEFT JOIN sales_advisers a ON a.id=c.from_agent_id
       WHERE ${companyScoped.sql}
       ORDER BY c.created_at DESC`,
      companyScoped.params
    )
    data.rows.forEach((c) => rows.push([c.id, c.owner_admin_id, c.from_agent_id, Number(c.amount), c.source_type, c.source_id, c.note, c.created_at]))
  } else {
    rows.push(['No data'])
  }
  return rows
}

app.get('/api/admin/reports/summary', requireAdmin, requireOfficeAdmin, requireAdminPermission('reports'), async (req, res, next) => {
  try {
    const scoped = scopedAgentsWhere(req.admin, 'a')
    const types = ['orders', 'commissions', 'rewardLedger', 'withdrawals', 'salesAdvisers', 'companyLedger']
    const [agentStats, orderStats, comm, wd, company] = await Promise.all([
      query(
        `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE a.status='ACTIVE')::int active
         FROM sales_advisers a
         WHERE ${scoped.sql}`,
        scoped.params
      ),
      query(
        `SELECT COUNT(*)::int total_orders,
                COUNT(*) FILTER (WHERE o.status IN ('APPROVED','PAID_BY_REWARD'))::int approved_orders,
                COALESCE(SUM(o.total_amount) FILTER (WHERE o.status IN ('APPROVED','PAID_BY_REWARD')),0)::numeric total_sales
         FROM orders o
         JOIN sales_advisers a ON a.id=o.agent_id
         WHERE ${scoped.sql}`,
        scoped.params
      ),
      query(
        `SELECT COALESCE(SUM(c.amount),0)::numeric total
         FROM commission_ledger c
         JOIN sales_advisers a ON a.id=c.to_agent_id
         WHERE ${scoped.sql} AND c.status='PAID_TO_AGENT'`,
        scoped.params
      ),
      query(
        `SELECT COALESCE(SUM(w.amount),0)::numeric total
         FROM withdrawals w
         JOIN sales_advisers a ON a.id=w.agent_id
         WHERE ${scoped.sql} AND w.status='PAID'`,
        scoped.params
      ),
      (() => {
        const companyScoped = scopedCompanyLedgerWhere(req.admin, 'c', 'ca')
        return query(
          `SELECT COALESCE(SUM(c.amount),0)::numeric total
           FROM company_ledger c
           LEFT JOIN sales_advisers ca ON ca.id=c.from_agent_id
           WHERE ${companyScoped.sql}`,
          companyScoped.params
        )
      })()
    ])

    const stats = {
      totalSales: Number(orderStats.rows[0]?.total_sales || 0),
      totalOrders: Number(orderStats.rows[0]?.total_orders || 0),
      approvedOrders: Number(orderStats.rows[0]?.approved_orders || 0),
      totalCommission: Number(comm.rows[0]?.total || 0),
      totalWithdrawalsPaid: Number(wd.rows[0]?.total || 0),
      totalCompanyIncome: Number(company.rows[0]?.total || 0),
      totalSalesAdvisers: Number(agentStats.rows[0]?.total || 0),
      activeSalesAdvisers: Number(agentStats.rows[0]?.active || 0)
    }
    res.json({ types, reportTypes: types, stats })
  } catch (err) { next(err) }
})

app.get('/api/admin/reports/:type.xls', requireAdmin, requireOfficeAdmin, requireAdminPermission('reports'), async (req, res, next) => {
  try {
    const type = req.params.type
    const rows = await reportData(type, req.admin)
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, type.slice(0, 31))
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'DOWNLOAD_REPORT', entityType: 'REPORT', entityId: type })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${type}.xlsx"`)
    res.send(buf)
  } catch (err) { next(err) }
})

app.get('/api/fulfillment/orders', requireAdmin, requireFulfillmentParty, async (req, res, next) => {
  try {
    const ids = await scopedAgentIds(req.admin)
    const inClause = makeInClause(ids)
    const result = ids.length ? await query(`SELECT o.*, a.name AS agent_name, a.agent_code, p.name AS product_name FROM orders o JOIN sales_advisers a ON a.id=o.agent_id JOIN products p ON p.id=o.product_id WHERE o.agent_id IN ${inClause.sql} AND o.status IN ('APPROVED','PAID_BY_REWARD') ORDER BY o.created_at DESC`, inClause.params) : { rows: [] }
    res.json({ orders: result.rows.map((o) => ({ ...rowToOrder(o), agent: { name: o.agent_name, agentCode: o.agent_code }, product: { name: o.product_name } })) })
  } catch (err) { next(err) }
})

app.post('/api/fulfillment/orders/:id/approve', requireAdmin, requireFulfillmentParty, async (req, res, next) => {
  try {
    const order = await query('SELECT * FROM orders WHERE id=$1', [req.params.id])
    if (!order.rows[0]) return res.status(404).json({ error: 'ORDER_NOT_FOUND' })
    if (!(await canAccessAgent(req.admin, order.rows[0].agent_id))) return res.status(403).json({ error: 'NO_SCOPE' })
    await query(`UPDATE orders SET fulfillment_status='PACKED_SHIPPED', packed_note=$2, tracking_number=$3, courier=$4, shipped_at=NOW() WHERE id=$1`, [req.params.id, cleanText(req.body.note), cleanText(req.body.trackingNumber), cleanText(req.body.courier)])
    await audit({ actorType: 'ADMIN', actorId: req.admin.id, action: 'FULFILLMENT_APPROVE', entityType: 'ORDER', entityId: req.params.id })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.get('/api/agent/me', requireAgent, async (req, res, next) => {
  try {
    const row = (await query('SELECT * FROM sales_advisers WHERE id=$1', [req.agent.id])).rows[0]
    const adminContact = await getAdminContactSettings(row?.owner_admin_id || 'admin_super')
    res.json({
      agent: await hydrateAgent(row),
      annualFeeAmount: adminContact.annualFeeAmount,
      adminWhatsapp: adminContact.whatsapp,
      adminContact
    })
  } catch (err) { next(err) }
})

app.patch('/api/agent/profile', requireAgent, async (req, res, next) => {
  try {
    const profile = { phone: cleanText(req.body.phone), bankName: cleanText(req.body.bankName), bankAccountName: cleanText(req.body.bankAccountName), bankAccountNo: cleanText(req.body.bankAccountNo) }
    await query('UPDATE sales_advisers SET name=$2, profile=$3, updated_at=NOW() WHERE id=$1', [req.agent.id, cleanText(req.body.name) || req.agent.name, JSON.stringify(profile)])
    await audit({ actorType: 'SALES_ADVISER', actorId: req.agent.id, action: 'UPDATE_PROFILE', entityType: 'SALES_ADVISER', entityId: req.agent.id })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.get('/api/agent/team', requireAgent, async (req, res, next) => {
  try {
    const first = await query('SELECT * FROM sales_advisers WHERE sponsor_agent_id=$1 ORDER BY created_at DESC', [req.agent.id])
    const firstIds = first.rows.map((r) => r.id)
    let secondRows = []
    if (firstIds.length) {
      const inClause = makeInClause(firstIds)
      secondRows = (await query(`SELECT * FROM sales_advisers WHERE sponsor_agent_id IN ${inClause.sql} ORDER BY created_at DESC`, inClause.params)).rows
    }
    res.json({ first: first.rows.map((r) => toAgent(r)), second: secondRows.map((r) => toAgent(r)) })
  } catch (err) { next(err) }
})

app.post('/api/agent/invite-code', requireAgent, requireActiveAgent, async (req, res) => res.json({ code: req.agent.referralCode || req.agent.agentCode }))

app.get('/api/agent/products', requireAgent, async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const params = []
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      searchSql = `AND (LOWER(sku) LIKE $1 OR LOWER(name) LIKE $1 OR LOWER(description) LIKE $1)`
    }
    params.push(limit, offset)
    const result = await query(
      `SELECT *, COUNT(*) OVER() AS total_count FROM products WHERE is_active=TRUE ${searchSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ products: result.rows.map(rowToProduct), pagination: paginationMeta(result.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.post('/api/agent/payment-proof/annual-fee', requireAgent, async (req, res, next) => {
  try {
    const proofText = cleanText(req.body.proofText)
    const result = await tx(async (client) => {
      const agent = (await client.query('SELECT * FROM sales_advisers WHERE id=$1 FOR UPDATE', [req.agent.id])).rows[0]
      if (!agent) throw new Error('AGENT_NOT_FOUND')
      const amount = roundMoney(await getAdminAnnualFeeAmount(agent.owner_admin_id || 'admin_super', client))
      if (amount <= 0) throw new Error('ANNUAL_FEE_NOT_SET')
      if (agent.status === 'ACTIVE' && daysLeft(agent.annual_fee_expires_at) > 0) throw new Error('ANNUAL_FEE_ALREADY_ACTIVE')
      const pending = await client.query(
        `SELECT id FROM payment_proofs WHERE agent_id=$1 AND type='ANNUAL_FEE' AND status='PENDING' LIMIT 1`,
        [req.agent.id]
      )
      if (pending.rowCount) throw new Error('PENDING_ANNUAL_FEE_PROOF_EXISTS')
      const id = uid('proof')
      await client.query(`INSERT INTO payment_proofs (id, type, agent_id, amount, proof_text, status) VALUES ($1,'ANNUAL_FEE',$2,$3,$4,'PENDING')`, [id, req.agent.id, amount, proofText])
      await audit({ actorType: 'SALES_ADVISER', actorId: req.agent.id, action: 'SUBMIT_ANNUAL_FEE_PROOF', entityType: 'PAYMENT_PROOF', entityId: id, client })
      return { id, amount }
    })
    res.json({ ok: true, ...result })
  } catch (err) { next(err) }
})

app.post('/api/agent/orders', requireAgent, requireActiveAgent, async (req, res, next) => {
  try {
    const result = await placeRewardOrder({
      agentId: req.agent.id,
      productId: req.body.productId,
      qty: req.body.qty,
      customerName: req.body.customerName,
      customerPhone: req.body.customerPhone,
      deliveryAddress: req.body.deliveryAddress,
      remark: req.body.remark
    })
    res.json({ ok: true, ...result })
  } catch (err) { next(err) }
})

app.get('/api/agent/orders', requireAgent, async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const params = [req.agent.id]
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `AND (LOWER(o.id) LIKE $${i} OR LOWER(o.status) LIKE $${i} OR LOWER(o.fulfillment_status) LIKE $${i} OR LOWER(COALESCE(o.customer_name,'')) LIKE $${i} OR LOWER(COALESCE(o.customer_phone,'')) LIKE $${i} OR LOWER(p.name) LIKE $${i})`
    }
    params.push(limit, offset)
    const result = await query(
      `SELECT o.*, p.name product_name, COUNT(*) OVER() AS total_count
       FROM orders o
       JOIN products p ON p.id=o.product_id
       WHERE o.agent_id=$1 ${searchSql}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ orders: result.rows.map((o) => ({ ...rowToOrder(o), product: { name: o.product_name } })), pagination: paginationMeta(result.rows[0]?.total_count || 0, page, limit) })
  } catch (err) { next(err) }
})

app.get('/api/agent/wallet', requireAgent, async (req, res, next) => {
  try {
    const { page, limit, offset, search } = pageParams(req, 50, 100)
    const params = [req.agent.id]
    let searchSql = ''
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      searchSql = `AND (LOWER(type) LIKE $${i} OR LOWER(source_type) LIKE $${i} OR LOWER(COALESCE(note,'')) LIKE $${i})`
    }
    params.push(limit, offset)
    const rows = await query(
      `SELECT *, COUNT(*) OVER() AS total_count
       FROM reward_ledger
       WHERE agent_id=$1 ${searchSql}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    const commission = await query('SELECT * FROM commission_ledger WHERE to_agent_id=$1 ORDER BY created_at DESC LIMIT 100', [req.agent.id])
    const withdrawals = await query('SELECT * FROM withdrawals WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 100', [req.agent.id])
    const ledger = rows.rows.map(rowToLedger)
    res.json({
      balance: await getAgentBalance(req.agent.id),
      ledger,
      rows: ledger,
      commissions: commission.rows.map((c) => ({ id: c.id, generation: c.generation, sourceType: c.source_type, amount: Number(c.amount), status: c.status, createdAt: c.created_at })),
      withdrawals: withdrawals.rows.map(rowToWithdrawal),
      pagination: paginationMeta(rows.rows[0]?.total_count || 0, page, limit)
    })
  } catch (err) { next(err) }
})

app.post('/api/agent/withdrawals', requireAgent, async (req, res, next) => {
  try {
    await tx(async (client) => {
      const amount = roundMoney(req.body.amount)
      if (amount <= 0) throw new Error('INVALID_AMOUNT')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`agent-balance:${req.agent.id}`])
      const balance = await getAgentBalance(req.agent.id, client)
      if (balance < amount) {
        const err = new Error('INSUFFICIENT_REWARD')
        err.details = { required: amount, balance }
        throw err
      }
      const agent = (await client.query('SELECT profile FROM sales_advisers WHERE id=$1 FOR UPDATE', [req.agent.id])).rows[0]
      const bank = jsonValue(agent.profile, {})
      if (!cleanText(bank.bankName) || !cleanText(bank.bankAccountName) || !cleanText(bank.bankAccountNo)) throw new Error('BANK_INFO_REQUIRED')
      const id = uid('withdrawal')
      await client.query('INSERT INTO withdrawals (id, agent_id, amount, bank_snapshot, status) VALUES ($1,$2,$3,$4,$5)', [id, req.agent.id, amount, JSON.stringify(bank), 'PENDING'])
      await client.query(`INSERT INTO reward_ledger (id, agent_id, type, amount, source_type, source_id, status, note) VALUES ($1,$2,'WITHDRAWAL_HOLD',$3,'WITHDRAWAL',$4,'POSTED','Withdrawal requested; amount held')`, [uid('reward'), req.agent.id, -amount, id])
      await audit({ actorType: 'SALES_ADVISER', actorId: req.agent.id, action: 'REQUEST_WITHDRAWAL', entityType: 'WITHDRAWAL', entityId: id, metadata: { amount }, client })
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

app.use((err, req, res, next) => {
  const message = err?.message || 'SERVER_ERROR'
  const status = ['NO_SCOPE', 'NO_PERMISSION', 'SUPER_ADMIN_ONLY', 'OFFICE_ADMIN_ONLY', 'ADMIN_USER_MANAGER_ONLY'].includes(message) ? 403
    : ['UNAUTHORIZED', 'INVALID_LOGIN', 'INVALID_PLANTER_LOGIN'].includes(message) ? 401
    : ['AGENT_NOT_FOUND', 'PRODUCT_NOT_FOUND', 'PROOF_NOT_FOUND', 'ORDER_NOT_FOUND', 'WITHDRAWAL_NOT_FOUND', 'HARVEST_REQUEST_NOT_FOUND', 'PLANTER_NOT_FOUND'].includes(message) ? 404
    : 400
  console.error(message, err.details || '')
  res.status(status).json({
    error: message,
    ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
    ...(err.details ? { details: err.details } : {})
  })
})

async function start() {
  await initDatabase()
  if (process.env.ENABLE_ANNUAL_FEE_CRON !== 'false') {
    const requestedSchedule = String(process.env.ANNUAL_FEE_CRON || '').trim() || '10 0 * * *'
    const schedule = cron.validate(requestedSchedule) ? requestedSchedule : '10 0 * * *'
    if (schedule !== requestedSchedule) console.warn(`Invalid ANNUAL_FEE_CRON "${requestedSchedule}". Using default ${schedule}.`)
    cron.schedule(schedule, async () => {
      try { await runAnnualRenewalCheckOnce('cron') } catch (err) { console.error('Annual renewal cron failed:', err) }
    })
    console.log(`Annual renewal cron enabled: ${schedule}`)
  }
  app.listen(PORT, () => console.log(`Agent Distribution Production backend running on http://localhost:${PORT}`))
}

start().catch((err) => { console.error('Failed to start backend:', err); process.exit(1) })
