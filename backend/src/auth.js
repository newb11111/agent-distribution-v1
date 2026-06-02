import jwt from 'jsonwebtoken'
import { query, jsonValue, normalizeAdminPermissions } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-before-production'
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || '12h'

export function signAdminToken(admin) {
  return jwt.sign({ type: 'admin', id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN })
}

export function signAgentToken(agent) {
  return jwt.sign({ type: 'agent', id: agent.id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN })
}

function getBearerToken(req) {
  const auth = req.headers.authorization || ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : ''
}

export async function requireAdmin(req, res, next) {
  try {
    const token = getBearerToken(req)
    if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.type !== 'admin') return res.status(401).json({ error: 'UNAUTHORIZED' })
    const result = await query('SELECT * FROM admin_users WHERE id=$1 AND status=$2', [payload.id, 'ACTIVE'])
    const row = result.rows[0]
    if (!row) return res.status(401).json({ error: 'UNAUTHORIZED' })
    req.admin = toAdmin(row)
    next()
  } catch {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }
}

export async function requireAgent(req, res, next) {
  try {
    const token = getBearerToken(req)
    if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.type !== 'agent') return res.status(401).json({ error: 'UNAUTHORIZED' })
    const result = await query('SELECT * FROM sales_advisers WHERE id=$1', [payload.id])
    const row = result.rows[0]
    if (!row) return res.status(401).json({ error: 'UNAUTHORIZED' })
    req.agent = toAgent(row)
    next()
  } catch {
    return res.status(401).json({ error: 'UNAUTHORIZED' })
  }
}

export function requireSuperAdmin(req, res, next) {
  if (req.admin?.role === 'SUPER_ADMIN') return next()
  return res.status(403).json({ error: 'SUPER_ADMIN_ONLY' })
}

export function adminHasPermission(admin, permission) {
  if (!admin) return false
  if (admin.role === 'SUPER_ADMIN') return true
  return Array.isArray(admin.permissions) && admin.permissions.includes(permission)
}

export function requireAdminPermission(permission) {
  return (req, res, next) => {
    if (adminHasPermission(req.admin, permission)) return next()
    return res.status(403).json({ error: 'NO_PERMISSION' })
  }
}

export function requireActiveAgent(req, res, next) {
  const expires = req.agent?.annualFeeExpiresAt ? new Date(req.agent.annualFeeExpiresAt).getTime() : 0
  if (req.agent?.status !== 'ACTIVE' || expires <= Date.now()) {
    return res.status(403).json({ error: 'AGENT_NOT_ACTIVE_OR_EXPIRED' })
  }
  next()
}

export function requireFulfillmentParty(req, res, next) {
  if (['SUPER_ADMIN', 'FULFILLMENT'].includes(req.admin?.role)) return next()
  return res.status(403).json({ error: 'FULFILLMENT_ONLY' })
}

export function toAdmin(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    role: row.role,
    permissions: normalizeAdminPermissions(row.role, jsonValue(row.permissions, [])),
    status: row.status,
    scopeOwnerAdminId: row.scope_owner_admin_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function toAgent(row, extra = {}) {
  return {
    id: row.id,
    agentCode: row.agent_code,
    email: row.email,
    name: row.name,
    sponsorAgentId: row.sponsor_agent_id,
    ownerAdminId: row.owner_admin_id,
    status: row.status,
    referralCode: row.referral_code,
    annualFeePaidAt: row.annual_fee_paid_at,
    annualFeeExpiresAt: row.annual_fee_expires_at,
    profile: jsonValue(row.profile, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra
  }
}

export function adminDataScopeId(admin) {
  if (!admin) return null
  if (admin.role === 'SUPER_ADMIN') return 'ALL'
  if (admin.role === 'FULFILLMENT') return admin.scopeOwnerAdminId || 'ALL'
  return admin.id
}

export function scopedAgentsWhere(admin, alias = 'a') {
  const scope = adminDataScopeId(admin)
  if (admin?.role === 'SUPER_ADMIN' || scope === 'ALL') return { sql: 'TRUE', params: [] }
  return { sql: `${alias}.owner_admin_id = $1`, params: [scope] }
}
