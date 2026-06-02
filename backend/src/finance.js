import { addDays, audit, daysLeft, query, roundMoney, tx, uid } from './db.js'

export async function getAgentBalance(agentId, client = null) {
  const q = client || { query }
  const res = await q.query(
    `SELECT COALESCE(SUM(amount),0)::numeric AS balance FROM reward_ledger WHERE agent_id=$1 AND status='POSTED'`,
    [agentId]
  )
  return roundMoney(res.rows[0]?.balance || 0)
}

export async function lockAgentBalance(client, agentId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`agent-balance:${agentId}`])
}

export async function getUplineChain(client, agentId, maxLevels) {
  const chain = []
  let currentId = agentId
  for (let level = 1; level <= maxLevels; level += 1) {
    const current = await client.query('SELECT sponsor_agent_id FROM sales_advisers WHERE id=$1', [currentId])
    const sponsorId = current.rows[0]?.sponsor_agent_id
    if (!sponsorId) break
    const sponsor = await client.query('SELECT * FROM sales_advisers WHERE id=$1', [sponsorId])
    if (!sponsor.rows[0]) break
    chain.push({ level, agent: sponsor.rows[0] })
    currentId = sponsorId
  }
  return chain
}

export function calculateCommission(baseAmount, rule) {
  if (!rule || Number(rule.value || 0) <= 0) return 0
  if (rule.type === 'percent') return roundMoney(Number(baseAmount || 0) * Number(rule.value || 0) / 100)
  return roundMoney(Number(rule.value || 0))
}

async function creditAgent(client, { agentId, amount, sourceType, sourceId, type = 'CREDIT_IN', note, createdByAdminId = null }) {
  if (Number(amount) <= 0) return null
  const id = uid('reward')
  await client.query(
    `INSERT INTO reward_ledger (id, agent_id, type, amount, source_type, source_id, status, note, created_by_admin_id)
     VALUES ($1,$2,$3,$4,$5,$6,'POSTED',$7,$8)`,
    [id, agentId, type, roundMoney(amount), sourceType, sourceId, note || '', createdByAdminId]
  )
  return id
}

export async function debitAgent(client, { agentId, amount, sourceType, sourceId, type = 'CREDIT_OUT', note, createdByAdminId = null }) {
  if (Number(amount) <= 0) return null
  const id = uid('reward')
  await client.query(
    `INSERT INTO reward_ledger (id, agent_id, type, amount, source_type, source_id, status, note, created_by_admin_id)
     VALUES ($1,$2,$3,$4,$5,$6,'POSTED',$7,$8)`,
    [id, agentId, type, -roundMoney(amount), sourceType, sourceId, note || '', createdByAdminId]
  )
  return id
}

async function creditCompany(client, { amount, sourceType, sourceId, note }) {
  if (Number(amount) <= 0) return null
  const id = uid('company')
  await client.query(
    `INSERT INTO company_ledger (id, amount, source_type, source_id, note)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, roundMoney(amount), sourceType, sourceId, note || '']
  )
  return id
}

export async function getRules(client, kind, ownerAdminId = 'admin_super') {
  const owner = ownerAdminId || 'admin_super'
  const res = await client.query(
    `SELECT DISTINCT ON (generation) generation, type, value
     FROM (
       SELECT generation, type, value, 1 AS priority FROM commission_rules WHERE kind=$1 AND owner_admin_id=$2
       UNION ALL
       SELECT generation, type, value, 2 AS priority FROM commission_rules WHERE kind=$1 AND owner_admin_id='admin_super'
     ) x
     ORDER BY generation ASC, priority ASC`,
    [kind, owner]
  )
  return res.rows.map((r) => ({ generation: Number(r.generation), type: r.type, value: Number(r.value || 0) }))
}

export async function allocateCommission(client, { fromAgentId, baseAmount, sourceType, sourceId, maxLevels, kind, ownerAdminId = null }) {
  const ownerRes = ownerAdminId ? null : await client.query('SELECT owner_admin_id FROM sales_advisers WHERE id=$1', [fromAgentId])
  const ruleOwnerAdminId = ownerAdminId || ownerRes?.rows[0]?.owner_admin_id || 'admin_super'
  const rules = await getRules(client, kind, ruleOwnerAdminId)
  const chain = await getUplineChain(client, fromAgentId, maxLevels)
  let totalPaid = 0
  let totalForfeited = 0
  const rows = []

  for (const item of chain) {
    const rule = rules.find((r) => Number(r.generation) === Number(item.level))
    const amount = calculateCommission(baseAmount, rule)
    if (amount <= 0) continue

    const isEligible = item.agent.status === 'ACTIVE' && daysLeft(item.agent.annual_fee_expires_at) > 0
    const commissionId = uid('commission')
    await client.query(
      `INSERT INTO commission_ledger
       (id, owner_admin_id, source_type, source_id, from_agent_id, to_agent_id, generation, rule_type, rule_value, base_amount, amount, status, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        commissionId, ruleOwnerAdminId, sourceType, sourceId, fromAgentId, item.agent.id, item.level,
        rule?.type || 'percent', Number(rule?.value || 0), roundMoney(baseAmount), amount,
        isEligible ? 'PAID_TO_AGENT' : 'FORFEITED_TO_COMPANY',
        isEligible ? 'Commission credited to reward' : 'Sales Adviser frozen/expired; commission belongs to company'
      ]
    )
    rows.push(commissionId)

    if (isEligible) {
      await creditAgent(client, {
        agentId: item.agent.id,
        amount,
        sourceType,
        sourceId,
        type: sourceType === 'PRODUCT_ORDER' ? 'PRODUCT_COMMISSION_IN' : 'ANNUAL_FEE_COMMISSION_IN',
        note: `${sourceType} commission level ${item.level}`
      })
      totalPaid = roundMoney(totalPaid + amount)
    } else {
      await creditCompany(client, { amount, sourceType, sourceId, note: `Forfeited commission from level ${item.level}` })
      totalForfeited = roundMoney(totalForfeited + amount)
    }
  }

  const companyNet = roundMoney(Number(baseAmount) - totalPaid - totalForfeited)
  if (companyNet > 0) {
    await creditCompany(client, { amount: companyNet, sourceType, sourceId, note: 'Company net after paid and forfeited commissions' })
  }
  return { totalPaid, totalForfeited, companyNet, rows }
}

export async function activateAnnualFee(client, { agentId, amount, sourceId, isAutoRenewal = false, sourceType = null }) {
  const agentRes = await client.query('SELECT * FROM sales_advisers WHERE id=$1 FOR UPDATE', [agentId])
  const agent = agentRes.rows[0]
  if (!agent) throw new Error('AGENT_NOT_FOUND')
  const currentExpiry = daysLeft(agent.annual_fee_expires_at) > 0 ? agent.annual_fee_expires_at : new Date()
  const newExpiry = addDays(currentExpiry, 365)
  await client.query(
    `UPDATE sales_advisers SET status='ACTIVE', annual_fee_paid_at=NOW(), annual_fee_expires_at=$2, updated_at=NOW() WHERE id=$1`,
    [agentId, newExpiry]
  )
  const result = await allocateCommission(client, {
    fromAgentId: agentId,
    baseAmount: amount,
    sourceType: sourceType || (isAutoRenewal ? 'ANNUAL_FEE_AUTO_RENEWAL' : 'ANNUAL_FEE_PAYMENT'),
    sourceId,
    maxLevels: 5,
    kind: 'annualFee'
  })
  return { result, annualFeeExpiresAt: newExpiry }
}

export async function placeRewardOrder({ agentId, productId, qty, customerName, customerPhone, deliveryAddress, remark }) {
  return tx(async (client) => {
    await lockAgentBalance(client, agentId)
    const agentRes = await client.query('SELECT * FROM sales_advisers WHERE id=$1 FOR UPDATE', [agentId])
    const agent = agentRes.rows[0]
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    if (agent.status !== 'ACTIVE' || daysLeft(agent.annual_fee_expires_at) <= 0) throw new Error('AGENT_NOT_ACTIVE_OR_EXPIRED')

    const productRes = await client.query('SELECT * FROM products WHERE id=$1 AND is_active=TRUE', [productId])
    const product = productRes.rows[0]
    if (!product) throw new Error('PRODUCT_NOT_FOUND')
    const cleanQty = Math.max(1, Number.parseInt(qty || 1, 10))
    const totalAmount = roundMoney(Number(product.price || 0) * cleanQty)
    const balance = await getAgentBalance(agentId, client)
    if (balance < totalAmount) {
      const err = new Error('INSUFFICIENT_REWARD')
      err.details = { required: totalAmount, balance }
      throw err
    }

    const orderId = uid('order')
    await client.query(
      `INSERT INTO orders (id, agent_id, product_id, qty, total_amount, customer_name, customer_phone, delivery_address, remark, status, fulfillment_status, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PAID_BY_REWARD','PENDING_PACK',NOW())`,
      [orderId, agentId, productId, cleanQty, totalAmount, customerName || '', customerPhone || '', deliveryAddress || '', remark || '']
    )
    await debitAgent(client, {
      agentId,
      amount: totalAmount,
      sourceType: 'PRODUCT_ORDER',
      sourceId: orderId,
      type: 'ORDER_DEDUCT',
      note: 'Product order paid by Reward'
    })
    const commission = await allocateCommission(client, {
      fromAgentId: agentId,
      baseAmount: totalAmount,
      sourceType: 'PRODUCT_ORDER',
      sourceId: orderId,
      maxLevels: 10,
      kind: 'product'
    })
    await audit({ actorType: 'SALES_ADVISER', actorId: agentId, action: 'CREATE_REWARD_ORDER', entityType: 'ORDER', entityId: orderId, metadata: { totalAmount }, client })
    return { orderId, totalAmount, commission }
  })
}

export async function adjustRewardBySuperAdmin({ adminId, agentId, amount, note }) {
  return tx(async (client) => {
    await lockAgentBalance(client, agentId)
    const cleanAmount = roundMoney(Number(amount || 0))
    if (!Number.isFinite(cleanAmount) || cleanAmount === 0) throw new Error('AMOUNT_CANNOT_BE_ZERO')
    const agent = await client.query('SELECT id FROM sales_advisers WHERE id=$1 FOR UPDATE', [agentId])
    if (!agent.rowCount) throw new Error('AGENT_NOT_FOUND')
    if (cleanAmount < 0) {
      const balance = await getAgentBalance(agentId, client)
      if (balance + cleanAmount < 0) {
        const err = new Error('INSUFFICIENT_REWARD_TO_DEDUCT')
        err.details = { balance, amount: cleanAmount }
        throw err
      }
    }
    const sourceId = uid('adjust')
    if (cleanAmount > 0) {
      await creditAgent(client, { agentId, amount: cleanAmount, sourceType: 'SUPER_ADMIN_ADJUST', sourceId, type: 'SUPER_ADMIN_CREDIT_IN', note: note || 'Super Admin manual Reward adjustment', createdByAdminId: adminId })
    } else {
      await debitAgent(client, { agentId, amount: Math.abs(cleanAmount), sourceType: 'SUPER_ADMIN_ADJUST', sourceId, type: 'SUPER_ADMIN_CREDIT_OUT', note: note || 'Super Admin manual Reward adjustment', createdByAdminId: adminId })
    }
    await audit({ actorType: 'ADMIN', actorId: adminId, action: 'SUPER_ADMIN_REWARD_ADJUST', entityType: 'SALES_ADVISER', entityId: agentId, metadata: { amount: cleanAmount, note }, client })
    return { sourceId, amount: cleanAmount }
  })
}

export async function runAnnualRenewalCheckOnce(actorAdminId = 'system') {
  return tx(async (client) => {
    const feeRes = await client.query("SELECT value FROM system_settings WHERE key='annualFeeAmount'")
    const fee = roundMoney(feeRes.rows[0]?.value || 365)
    const due = await client.query(
      `SELECT * FROM sales_advisers
       WHERE status <> 'PENDING_FEE' AND (annual_fee_expires_at IS NULL OR annual_fee_expires_at <= NOW())
       FOR UPDATE`
    )
    const rows = []
    for (const agent of due.rows) {
      await lockAgentBalance(client, agent.id)
      const balance = await getAgentBalance(agent.id, client)
      if (balance >= fee) {
        const renewalId = uid('renewal')
        await debitAgent(client, { agentId: agent.id, amount: fee, sourceType: 'ANNUAL_FEE_AUTO_RENEWAL', sourceId: renewalId, type: 'ANNUAL_FEE_DEDUCT', note: 'Annual fee auto deducted from Reward' })
        const result = await activateAnnualFee(client, { agentId: agent.id, amount: fee, sourceId: renewalId, isAutoRenewal: true })
        await audit({ actorType: 'SYSTEM', actorId: actorAdminId, action: 'ANNUAL_FEE_AUTO_RENEWED', entityType: 'SALES_ADVISER', entityId: agent.id, metadata: { fee, balanceBefore: balance }, client })
        rows.push({ agentId: agent.id, status: 'RENEWED', balanceBefore: balance, result })
      } else {
        await client.query('UPDATE sales_advisers SET status=$2, updated_at=NOW() WHERE id=$1', [agent.id, 'FROZEN'])
        await audit({ actorType: 'SYSTEM', actorId: actorAdminId, action: 'ANNUAL_FEE_FROZEN_INSUFFICIENT_REWARD', entityType: 'SALES_ADVISER', entityId: agent.id, metadata: { fee, balanceBefore: balance }, client })
        rows.push({ agentId: agent.id, status: 'FROZEN_INSUFFICIENT_CREDIT', balanceBefore: balance })
      }
    }
    return rows
  })
}
