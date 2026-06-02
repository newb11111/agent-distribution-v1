import 'dotenv/config'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export const ADMIN_PERMISSION_KEYS = ['dashboard', 'agents', 'products', 'paymentProofs', 'commissionRules', 'reward', 'withdrawals', 'orders', 'reports']
export const LEADER_PERMISSION_KEYS = ['dashboard', 'agents', 'commissionRules']
export const DEFAULT_LEADER_PERMISSIONS = ['dashboard', 'agents', 'commissionRules']

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.warn('WARNING: DATABASE_URL is missing. Production version needs Neon/PostgreSQL DATABASE_URL.')
}

export const pool = new Pool({
  connectionString,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 10)
})

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

export function addDays(dateValue, days) {
  const d = dateValue ? new Date(dateValue) : new Date()
  d.setDate(d.getDate() + Number(days || 0))
  return d.toISOString()
}

export function daysLeft(dateValue) {
  if (!dateValue) return 0
  const ms = new Date(dateValue).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86400000))
}

export function normalizeAdminPermissions(role, permissions = []) {
  if (role === 'SUPER_ADMIN') return [...ADMIN_PERMISSION_KEYS]
  if (role === 'FULFILLMENT') return ['fulfillmentOrders']
  const allowed = new Set(LEADER_PERMISSION_KEYS)
  const list = Array.isArray(permissions) && permissions.length ? permissions : DEFAULT_LEADER_PERMISSIONS
  return [...new Set([...list.filter((p) => allowed.has(p)), ...DEFAULT_LEADER_PERMISSIONS])]
}

export async function query(text, params = []) {
  return pool.query(text, params)
}

export async function tx(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function initDatabase() {
  await query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','LEADER','FULFILLMENT')),
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      scope_owner_admin_id TEXT NOT NULL DEFAULT 'ALL',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sales_advisers (
      id TEXT PRIMARY KEY,
      agent_code TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      sponsor_agent_id TEXT REFERENCES sales_advisers(id) ON DELETE SET NULL,
      owner_admin_id TEXT NOT NULL DEFAULT 'admin_super',
      status TEXT NOT NULL DEFAULT 'PENDING_FEE',
      referral_code TEXT UNIQUE NOT NULL,
      annual_fee_paid_at TIMESTAMPTZ,
      annual_fee_expires_at TIMESTAMPTZ,
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sales_advisers_sponsor ON sales_advisers(sponsor_agent_id);
    CREATE TABLE IF NOT EXISTS otp_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      tac_hash TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'LOGIN_REGISTER',
      expires_at TIMESTAMPTZ NOT NULL,
      attempt_count INT NOT NULL DEFAULT 0,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_otp_email_created ON otp_codes(email, created_at DESC);

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS commission_rules (
      id TEXT PRIMARY KEY,
      owner_admin_id TEXT NOT NULL DEFAULT 'admin_super',
      kind TEXT NOT NULL CHECK (kind IN ('product','annualFee')),
      generation INT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('percent','amount')),
      value NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS payment_proofs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      agent_id TEXT NOT NULL REFERENCES sales_advisers(id) ON DELETE RESTRICT,
      order_id TEXT,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      proof_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      reviewed_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      reject_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_payment_proofs_agent ON payment_proofs(agent_id);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES sales_advisers(id) ON DELETE RESTRICT,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      qty INT NOT NULL DEFAULT 1,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      delivery_address TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      fulfillment_status TEXT NOT NULL DEFAULT 'WAITING_PAYMENT_APPROVAL',
      packed_note TEXT,
      tracking_number TEXT,
      courier TEXT,
      approved_at TIMESTAMPTZ,
      shipped_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_orders_agent ON orders(agent_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

    CREATE TABLE IF NOT EXISTS reward_ledger (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES sales_advisers(id) ON DELETE RESTRICT,
      type TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'POSTED',
      note TEXT NOT NULL DEFAULT '',
      created_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_reward_ledger_agent ON reward_ledger(agent_id);
    CREATE INDEX IF NOT EXISTS idx_reward_ledger_source ON reward_ledger(source_type, source_id);

    CREATE TABLE IF NOT EXISTS commission_ledger (
      id TEXT PRIMARY KEY,
      owner_admin_id TEXT NOT NULL DEFAULT 'admin_super',
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      from_agent_id TEXT NOT NULL REFERENCES sales_advisers(id) ON DELETE RESTRICT,
      to_agent_id TEXT REFERENCES sales_advisers(id) ON DELETE SET NULL,
      generation INT NOT NULL,
      rule_type TEXT NOT NULL,
      rule_value NUMERIC(12,2) NOT NULL,
      base_amount NUMERIC(12,2) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_commission_source ON commission_ledger(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_commission_to_agent ON commission_ledger(to_agent_id);
    CREATE INDEX IF NOT EXISTS idx_commission_from_agent ON commission_ledger(from_agent_id);

    CREATE TABLE IF NOT EXISTS company_ledger (
      id TEXT PRIMARY KEY,
      amount NUMERIC(12,2) NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS financial_transactions (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      base_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source_type, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_financial_transactions_source ON financial_transactions(source_type, source_id);

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES sales_advisers(id) ON DELETE RESTRICT,
      amount NUMERIC(12,2) NOT NULL,
      bank_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'PENDING',
      reviewed_by_admin_id TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,
      reject_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_withdrawals_agent ON withdrawals(agent_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
  `)

  // Migrations for existing databases. Keep these before indexes/seed because older DBs may not have the new columns yet.
  await query(`ALTER TABLE sales_advisers ADD COLUMN IF NOT EXISTS owner_admin_id TEXT NOT NULL DEFAULT 'admin_super'`)
  await query(`ALTER TABLE commission_rules ADD COLUMN IF NOT EXISTS owner_admin_id TEXT NOT NULL DEFAULT 'admin_super'`)
  await query(`ALTER TABLE commission_ledger ADD COLUMN IF NOT EXISTS owner_admin_id TEXT NOT NULL DEFAULT 'admin_super'`)
  await query(`ALTER TABLE commission_rules DROP CONSTRAINT IF EXISTS commission_rules_kind_generation_key`)

  await query(`CREATE INDEX IF NOT EXISTS idx_sales_advisers_owner ON sales_advisers(owner_admin_id)`)
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_rules_owner_kind_generation ON commission_rules(owner_admin_id, kind, generation)`)

  await seedDefaultData()
}

async function seedDefaultData() {
  const annualFeeAmount = Number(process.env.ANNUAL_FEE_AMOUNT || 365)
  const adminWhatsapp = process.env.ADMIN_WHATSAPP || '60123456789'
  await setSetting('annualFeeAmount', annualFeeAmount)
  await setSetting('adminWhatsapp', adminWhatsapp)
  await setAdminContactSettings('admin_super', { whatsapp: adminWhatsapp })

  const adminCode = process.env.ADMIN_CODE || 'admin'
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  const exists = await query('SELECT id FROM admin_users WHERE code=$1', [adminCode])
  if (!exists.rowCount) {
    const hash = await bcrypt.hash(adminPassword, 12)
    await query(
      `INSERT INTO admin_users (id, code, password_hash, name, role, permissions, status, scope_owner_admin_id)
       VALUES ($1,$2,$3,$4,'SUPER_ADMIN',$5,'ACTIVE','ALL')`,
      ['admin_super', adminCode, hash, 'Super Admin', JSON.stringify(normalizeAdminPermissions('SUPER_ADMIN'))]
    )
  }

  const leader = await query('SELECT id FROM admin_users WHERE code=$1', ['ops'])
  if (!leader.rowCount && process.env.SEED_DEMO_DATA !== 'false') {
    const id = 'admin_leader_demo'
    const hash = await bcrypt.hash('ops123', 12)
    await query(
      `INSERT INTO admin_users (id, code, password_hash, name, role, permissions, status, scope_owner_admin_id)
       VALUES ($1,'ops',$2,'Demo Leader','LEADER',$3,'ACTIVE',$1)`,
      [id, hash, JSON.stringify(normalizeAdminPermissions('LEADER'))]
    )
  }

  const packer = await query('SELECT id FROM admin_users WHERE code=$1', ['packing'])
  if (!packer.rowCount && process.env.SEED_DEMO_DATA !== 'false') {
    const hash = await bcrypt.hash('pack123', 12)
    await query(
      `INSERT INTO admin_users (id, code, password_hash, name, role, permissions, status, scope_owner_admin_id)
       VALUES ('admin_fulfillment_demo','packing',$1,'Demo Fulfillment','FULFILLMENT',$2,'ACTIVE','ALL')`,
      [hash, JSON.stringify(normalizeAdminPermissions('FULFILLMENT'))]
    )
  }

  for (let i = 1; i <= 10; i += 1) {
    await query(
      `INSERT INTO commission_rules (id, owner_admin_id, kind, generation, type, value)
       VALUES ($1,'admin_super','product',$2,'percent',$3)
       ON CONFLICT (owner_admin_id, kind, generation) DO NOTHING`,
      [uid('rule'), i, i === 1 ? 10 : i === 2 ? 5 : i === 3 ? 3 : 0]
    )
  }
  for (let i = 1; i <= 5; i += 1) {
    await query(
      `INSERT INTO commission_rules (id, owner_admin_id, kind, generation, type, value)
       VALUES ($1,'admin_super','annualFee',$2,'percent',$3)
       ON CONFLICT (owner_admin_id, kind, generation) DO NOTHING`,
      [uid('rule'), i, i === 1 ? 20 : i === 2 ? 10 : i === 3 ? 5 : 0]
    )
  }

  const leaders = await query("SELECT id FROM admin_users WHERE role='LEADER'")
  for (const row of leaders.rows) await copyDefaultCommissionRulesToOwner(row.id)

  const demoProduct = await query('SELECT id FROM products WHERE sku=$1', ['DEMO-001'])
  if (!demoProduct.rowCount && process.env.SEED_DEMO_DATA !== 'false') {
    await query(
      `INSERT INTO products (id, sku, name, description, price, cost, is_active)
       VALUES ($1,'DEMO-001','Demo Product','Demo product for testing.',188,80,TRUE)`,
      ['product_demo']
    )
  }

  const root = await query('SELECT id FROM sales_advisers WHERE agent_code=$1', ['HQ0001'])
  if (!root.rowCount && process.env.SEED_DEMO_DATA !== 'false') {
    await query(
      `INSERT INTO sales_advisers (id, agent_code, email, name, sponsor_agent_id, owner_admin_id, status, referral_code, annual_fee_paid_at, annual_fee_expires_at, profile)
       VALUES ('agent_root','HQ0001','root@example.com','HQ Root Sales Adviser',NULL,'admin_super','ACTIVE','HQ0001',NOW(),NOW()+INTERVAL '365 days','{}')`
    )
    await query(
      `INSERT INTO reward_ledger (id, agent_id, type, amount, source_type, source_id, status, note)
       VALUES ($1,'agent_root','MANUAL_SEED',1000,'DEMO_SEED','seed','POSTED','Demo opening reward credit')`,
      [uid('reward')]
    )
  }

  const agent = await query('SELECT id FROM sales_advisers WHERE email=$1', ['agent@example.com'])
  if (!agent.rowCount && process.env.SEED_DEMO_DATA !== 'false') {
    await query(
      `INSERT INTO sales_advisers (id, agent_code, email, name, sponsor_agent_id, owner_admin_id, status, referral_code, annual_fee_paid_at, annual_fee_expires_at, profile)
       VALUES ('agent_demo','AG1001','agent@example.com','Demo Sales Adviser','agent_root','admin_leader_demo','ACTIVE','AG1001',NOW(),NOW()+INTERVAL '365 days','{}')`
    )
    await query(
      `INSERT INTO reward_ledger (id, agent_id, type, amount, source_type, source_id, status, note)
       VALUES ($1,'agent_demo','MANUAL_SEED',100,'DEMO_SEED','seed','POSTED','Demo opening reward credit')`,
      [uid('reward')]
    )
  }
}

export async function copyDefaultCommissionRulesToOwner(ownerAdminId, client = null) {
  if (!ownerAdminId || ownerAdminId === 'admin_super' || ownerAdminId === 'ALL') return
  const q = client || { query }
  const existing = await q.query('SELECT COUNT(*)::int AS n FROM commission_rules WHERE owner_admin_id=$1', [ownerAdminId])
  if (Number(existing.rows[0]?.n || 0) > 0) return
  const defaults = await q.query("SELECT kind, generation, type, value FROM commission_rules WHERE owner_admin_id='admin_super' ORDER BY kind, generation")
  for (const r of defaults.rows) {
    await q.query(
      `INSERT INTO commission_rules (id, owner_admin_id, kind, generation, type, value)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (owner_admin_id, kind, generation) DO NOTHING`,
      [uid('rule'), ownerAdminId, r.kind, Number(r.generation), r.type, Number(r.value || 0)]
    )
  }
}



export function adminContactSettingKey(ownerAdminId = 'admin_super') {
  const owner = String(ownerAdminId || 'admin_super').trim() || 'admin_super'
  return `adminContact:${owner}`
}

export function defaultAdminContact(whatsapp = null) {
  return {
    whatsapp: String(whatsapp || process.env.ADMIN_WHATSAPP || '60123456789').trim(),
    whatsappText: 'Hi Admin, I want to pay annual fee {amount}. Sales Adviser: {agentCode} ({agentName})',
    paymentInstructions: '',
    paymentQrImage: ''
  }
}

export async function getAdminContactSettings(ownerAdminId = 'admin_super', client = null) {
  const q = client || pool
  const key = adminContactSettingKey(ownerAdminId)
  const own = await q.query('SELECT value FROM system_settings WHERE key=$1', [key])
  const legacy = await q.query("SELECT value FROM system_settings WHERE key='adminWhatsapp'")
  const legacyWhatsapp = legacy.rows[0]?.value || process.env.ADMIN_WHATSAPP || '60123456789'
  const fallback = defaultAdminContact(legacyWhatsapp)
  const saved = jsonValue(own.rows[0]?.value, {})
  return {
    ...fallback,
    ...saved,
    whatsapp: String(saved.whatsapp || fallback.whatsapp || '').trim(),
    whatsappText: String(saved.whatsappText || fallback.whatsappText || '').trim(),
    paymentInstructions: String(saved.paymentInstructions || '').trim(),
    paymentQrImage: String(saved.paymentQrImage || '').trim()
  }
}

export async function setAdminContactSettings(ownerAdminId = 'admin_super', settings = {}, client = null) {
  const q = client || pool
  const key = adminContactSettingKey(ownerAdminId)
  const current = await getAdminContactSettings(ownerAdminId, q)
  const next = {
    ...current,
    whatsapp: String(settings.whatsapp ?? current.whatsapp ?? '').trim(),
    whatsappText: String(settings.whatsappText ?? current.whatsappText ?? '').trim(),
    paymentInstructions: String(settings.paymentInstructions ?? current.paymentInstructions ?? '').trim(),
    paymentQrImage: String(settings.paymentQrImage ?? current.paymentQrImage ?? '').trim()
  }
  await q.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [key, JSON.stringify(next)]
  )
  return next
}

export async function getSetting(key, fallback = null) {
  const res = await query('SELECT value FROM system_settings WHERE key=$1', [key])
  return res.rows[0]?.value ?? fallback
}

export async function setSetting(key, value) {
  await query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
    [key, JSON.stringify(value)]
  )
}

export async function audit({ actorType, actorId, action, entityType, entityId, metadata = {}, client = null }) {
  const q = client || pool
  await q.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uid('audit'), actorType, actorId, action, entityType, entityId, JSON.stringify(metadata)]
  )
}

export function jsonValue(value, fallback = {}) {
  if (value == null) return fallback
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return fallback }
  }
  return value
}
