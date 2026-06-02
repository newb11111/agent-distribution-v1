import React from 'react'
export function Card({ children, className = '' }) {
  return <section className={`card ${className}`}>{children}</section>
}

export function StatCard({ label, value, hint }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function StatusBadge({ status, t }) {
  const cls = String(status || '').toLowerCase().replaceAll('_', '-')
  const keyMap = {
    ACTIVE: 'active',
    FROZEN: 'frozen',
    PENDING_FEE: 'pendingFee',
    HIDDEN: 'hidden',
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    PAID: 'paid',
    PENDING_PROOF: 'pending',
    PROOF_SUBMITTED: 'pending',
    PAID_BY_REWARD: 'paidByReward',
    PAID_TO_AGENT: 'paidToAgent',
    FORFEITED_TO_COMPANY: 'forfeitedToCompany',
    SKIPPED_INACTIVE_COMPRESSED: 'skippedInactiveCompressed',
    WAITING_PAYMENT_APPROVAL: 'waitingPaymentApproval',
    PENDING_PACK: 'pendingPack',
    PACKED_SHIPPED: 'packedShipped'
  }
  const label = t && keyMap[status] ? t(keyMap[status]) : (status || '-')
  return <span className={`badge ${cls}`}>{label}</span>
}

export function Empty({ t }) {
  return <div className="empty">{t('noData')}</div>
}

export function Table({ children }) {
  return <div className="table-wrap"><table>{children}</table></div>
}
