import React, { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import { createRoot } from 'react-dom/client'
import Layout from './components/Layout'
import { Card, Empty, Field, StatCard, StatusBadge, Table } from './components/UI'
import { createTranslator } from './lib/i18n'
import { api, clearToken, dateText, downloadFile, money, setToken } from './lib/api'
import './styles.css'

function useLang() {
  const [lang, setLangState] = useState(localStorage.getItem('lang') || 'zh')
  const setLang = (value) => {
    localStorage.setItem('lang', value)
    setLangState(value)
  }
  return [lang, setLang]
}

function getCleanPathFromWindow() {
  const hash = String(window.location.hash || '')
  if (hash.startsWith('#/')) {
    const cleanPath = hash.slice(1) || '/'
    window.history.replaceState(null, '', cleanPath)
    return window.location.pathname || '/'
  }
  return window.location.pathname || '/'
}

function useRoutePath() {
  const [route, setRoute] = useState(getCleanPathFromWindow())
  useEffect(() => {
    const onRoute = () => setRoute(getCleanPathFromWindow())
    window.addEventListener('popstate', onRoute)
    window.addEventListener('hashchange', onRoute)
    return () => {
      window.removeEventListener('popstate', onRoute)
      window.removeEventListener('hashchange', onRoute)
    }
  }, [])
  return route
}


function getQueryParam(name) {
  return new URLSearchParams(window.location.search || '').get(name) || ''
}

function buildRegisterLink(agentCode) {
  const origin = window.location.origin
  return `${origin}/register?sponsor=${encodeURIComponent(agentCode || '')}`
}


function statusText(t, status) {
  const keyMap = {
    ACTIVE: 'active',
    FROZEN: 'frozen',
    PENDING_FEE: 'pendingFee',
    HIDDEN: 'hidden',
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    PAID: 'paid',
    PAID_BY_REWARD: 'paidByReward',
    PAID_TO_AGENT: 'paidToAgent',
    FORFEITED_TO_COMPANY: 'forfeitedToCompany',
    SKIPPED_INACTIVE_COMPRESSED: 'skippedInactiveCompressed',
    WAITING_PAYMENT_APPROVAL: 'waitingPaymentApproval',
    PENDING_PACK: 'pendingPack',
    PACKED_SHIPPED: 'packedShipped'
  }
  return keyMap[status] ? t(keyMap[status]) : (status || '-')
}

function translatedCode(t, prefix, value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const key = `${prefix}_${raw}`
  const translated = t(key)
  return translated && translated !== key ? translated : raw.replaceAll('_', ' ')
}

function sourceTypeText(t, value) { return translatedCode(t, 'source', value) }
function ledgerTypeText(t, value) { return translatedCode(t, 'ledger', value) }
function proofTypeText(t, value) { return translatedCode(t, 'type', value) }
function noteText(t, value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const compressedLedger = raw.match(/^(PRODUCT_ORDER|ANNUAL_FEE_[A-Z_]+) commission level (\d+) \(compressed from level (\d+)\)$/i)
  if (compressedLedger) return `${t('note_CommissionCompressed')} · ${t('level')} ${compressedLedger[2]} ← ${t('level')} ${compressedLedger[3]}`
  if (/^PRODUCT_ORDER commission level /i.test(raw)) return `${t('note_CommissionCredited')} · ${t('level')} ${raw.split(' ').pop()}`
  if (/^ANNUAL_FEE_/i.test(raw) && /commission level /i.test(raw)) return `${t('note_CommissionCredited')} · ${t('level')} ${raw.split(' ').pop()}`
  const compressedCommission = raw.match(/^Commission credited to reward; compressed from level (\d+) to level (\d+)$/i)
  if (compressedCommission) return `${t('note_CommissionCompressed')} · ${t('level')} ${compressedCommission[2]} ← ${t('level')} ${compressedCommission[1]}`
  if (raw === 'Sales Adviser inactive/expired; commission compressed to active upline') return t('note_SkippedCompressed')
  if (/^Forfeited commission from level /i.test(raw)) return `${t('note_ForfeitedCommission')} · ${t('level')} ${raw.split(' ').pop()}`
  if (raw === 'Company net after paid and forfeited commissions' || raw === 'Company net after paid commissions') return t('note_CompanyNet')
  if (raw === 'Product order paid by Reward') return t('note_ProductOrderPaidByReward')
  if (raw === 'Withdrawal requested; amount held') return t('note_WithdrawalRequested')
  if (raw === 'Withdrawal rejected; Reward refunded') return t('note_WithdrawalRejectedRefunded')
  return raw
}

function Button({ children, variant = 'primary', ...props }) {
  return <button className={`btn ${variant}`} type="button" {...props}>{children}</button>
}

function ErrorBox({ error }) {
  if (!error) return null
  return <div className="error-box">{error}</div>
}

const TAC_COOLDOWN_SECONDS = 60

function useTacCooldown(seconds = TAC_COOLDOWN_SECONDS) {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return undefined
    const timer = window.setInterval(() => {
      setLeft((value) => value <= 1 ? 0 : value - 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [left])
  return [left, () => setLeft(seconds)]
}

function TacSendControl({ t, onSend, disabled = false }) {
  const [left, startCooldown] = useTacCooldown()
  const [sending, setSending] = useState(false)
  const locked = disabled || sending || left > 0

  async function handleSend() {
    if (locked) return
    setSending(true)
    try {
      const ok = await onSend?.()
      if (ok !== false) startCooldown()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="tac-send-wrap">
      <Button variant={left > 0 ? 'cooldown' : 'secondary'} onClick={handleSend} disabled={locked}>
        {sending ? `${t('sendTac')}...` : t('sendTac')}
      </Button>
      {left > 0 && <span className="tac-countdown">{left}s</span>}
    </div>
  )
}

function normalizeWhatsappNumber(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const waMatch = raw.match(/wa\.me\/([^?\s]+)/i)
  let digits = (waMatch ? waMatch[1] : raw).replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `60${digits.slice(1)}`
  return digits
}

function buildWhatsappUrl(phone, text) {
  const digits = normalizeWhatsappNumber(phone)
  if (!digits) return ''
  return `https://wa.me/${digits}?text=${encodeURIComponent(text || '')}`
}


function buildAdminWhatsappMessage(template, { amount, agentCode, agentName }) {
  const base = String(template || '你好管理员，我要处理年费 {金额}。销售顾问：{顾问编号}（{顾问名字}）')
  return base
    .replaceAll('{amount}', money(amount))
    .replaceAll('{金额}', money(amount))
    .replaceAll('{agentCode}', agentCode || '')
    .replaceAll('{顾问编号}', agentCode || '')
    .replaceAll('{agentName}', agentName || '')
    .replaceAll('{顾问名字}', agentName || '')
}

function CenterNotice({ open, title, message, type = 'info', onClose, children }) {
  if (!open) return null
  return (
    <div className="center-modal-backdrop" onClick={onClose}>
      <div className={`center-modal ${type}`} onClick={(e) => e.stopPropagation()}>
        <div className="center-modal-head">
          <strong>{title}</strong>
          <button type="button" onClick={onClose}>×</button>
        </div>
        {message && <p>{message}</p>}
        {children}
      </div>
    </div>
  )
}

function readableError(t, err) {
  const code = err?.message || String(err || 'API_ERROR')
  const translated = t(code)
  return translated && translated !== code ? translated : code
}

function showSuccess(setNotice, t, messageKey = 'saved') {
  setNotice({ title: t('success'), message: t(messageKey), type: 'success' })
}

function showError(setNotice, t, err, titleKey = 'operationFailed') {
  setNotice({ title: t(titleKey), message: readableError(t, err), type: 'danger' })
}



function buildQuery(params = {}) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    qs.set(key, String(value))
  })
  const text = qs.toString()
  return text ? `?${text}` : ''
}

function pageOf(payload = {}) {
  return payload?.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 }
}

function PaginationControls({ t, pagination, onPage }) {
  const meta = pageOf({ pagination })
  if (!meta || Number(meta.total || 0) <= Number(meta.limit || 50)) {
    return <div className="pagination muted">{t('showing')} {Number(meta.total || 0)} / {Number(meta.total || 0)}</div>
  }
  const page = Number(meta.page || 1)
  const totalPages = Number(meta.totalPages || 1)
  return (
    <div className="pagination">
      <span>{t('page')} {page} / {totalPages} · {t('total')} {meta.total}</span>
      <div className="row gap">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('previous')}</Button>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>{t('next')}</Button>
      </div>
    </div>
  )
}

function SearchBar({ t, value, onChange, onSearch }) {
  return (
    <div className="list-search">
      <input placeholder={t('search')} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSearch?.() }} />
      <Button variant="secondary" onClick={onSearch}>{t('search')}</Button>
    </div>
  )
}


function MobileTabs({ t, tabs, tab, setTab }) {
  const pickTab = (x) => (event) => {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    setTab(x)
  }
  return (
    <>
      <div className="tabs desktop-tabs">
        {tabs.map((x) => <button type="button" key={x} className={tab === x ? 'active' : ''} onClick={pickTab(x)}>{t(normalizeTab(x))}</button>)}
      </div>
      <div className="mobile-inline-tabs" aria-label={t('menu')}>
        {tabs.map((x) => <button type="button" key={x} className={tab === x ? 'active' : ''} onClick={pickTab(x)}>{t(normalizeTab(x))}</button>)}
      </div>
    </>
  )
}

function ActionMenu({ t, actions = [] }) {
  const [open, setOpen] = useState(false)
  const visibleActions = actions.filter(Boolean).filter((item) => !item.hidden)
  if (!visibleActions.length) return <span className="muted">-</span>
  const run = async (item) => {
    setOpen(false)
    await item.onClick?.()
  }
  return (
    <div className="action-menu">
      <button className="icon-action" type="button" onClick={() => setOpen(true)}>⋯</button>
      {open && (
        <div className="drawer-backdrop action-backdrop" onClick={() => setOpen(false)}>
          <div className="action-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <strong>{t('actions')}</strong>
              <button type="button" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="action-sheet-list">
              {visibleActions.map((item, idx) => (
                <Button key={idx} variant={item.variant || 'secondary'} onClick={() => run(item)}>{item.label}</Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


const ADMIN_PERMISSION_KEYS = ['dashboard', 'agents', 'commissionRules', 'reward', 'withdrawals', 'orders', 'reports']
const DEFAULT_LEADER_PERMISSIONS = ['dashboard', 'agents', 'commissionRules', 'reward', 'withdrawals', 'orders', 'reports']
const REPORT_TYPES = ['orders', 'commissions', 'rewardLedger', 'withdrawals', 'salesAdvisers', 'companyLedger']

function hasAdminPermission(admin, key) {
  if (admin?.role === 'SUPER_ADMIN') return true
  if (admin?.role === 'LEADER' && !ADMIN_PERMISSION_KEYS.includes(key)) return false
  if (admin?.role === 'LEADER' && DEFAULT_LEADER_PERMISSIONS.includes(key)) return true
  return Array.isArray(admin?.permissions) && admin.permissions.includes(key)
}

function normalizeTab(tab) {
  return tab === 'adminUsers' ? 'adminUsers' : tab
}

function Landing({ lang, setLang, t }) {
  return (
    <Layout lang={lang} setLang={setLang} t={t} title={t('agentLogin')} subtitle={t('agentIntro')}>
      <div className="single-landing">
        <Card className="hero-card dark agent-only-card">
          <h2>{t('agentLogin')}</h2>
          <p>{t('agentIntro')}</p>
          <div className="row gap">
            <a className="btn light" href="/agent">{t('agentLogin')}</a>
            <a className="btn ghost-light" href="/register">{t('registerAgent')}</a>
          </div>
        </Card>
      </div>
    </Layout>
  )
}

function AdminLogin({ lang, setLang, t, onLogin }) {
  const [form, setForm] = useState({ code: '', password: '' })
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    try {
      const data = await api('/api/auth/admin-login', { method: 'POST', body: form })
      setToken('admin', data.token)
      localStorage.setItem('admin_profile', JSON.stringify(data.admin || {}))
      onLogin(data.admin)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Layout lang={lang} setLang={setLang} t={t} title={t('adminLogin')} right={<a className="btn secondary" href="/">{t('home')}</a>}>
      <Card className="narrow">
        <ErrorBox error={error} />
        <Field label={t('adminCode')}><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
        <Field label={t('password')}><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Button onClick={submit}>{t('login')}</Button>
      </Card>
    </Layout>
  )
}

function TacLogin({ t, mode, onSuccess }) {
  const [email, setEmail] = useState('')
  const [tac, setTac] = useState('')
  const [error, setError] = useState('')

  async function sendTac() {
    setError('')
    try {
      await api('/api/auth/request-tac', { method: 'POST', body: { email } })
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  async function login() {
    setError('')
    try {
      const data = await api('/api/auth/agent-login', { method: 'POST', body: { email, tac } })
      setToken('agent', data.token)
      onSuccess()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Card className="narrow">
      <ErrorBox error={error} />
      <Field label={t('email')}><input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <div className="row gap align-end">
        <Field label={t('tac')}><input value={tac} onChange={(e) => setTac(e.target.value)} /></Field>
        <TacSendControl t={t} onSend={sendTac} disabled={!email} />
      </div>
      <Button onClick={login}>{t('login')}</Button>
    </Card>
  )
}

function Register({ lang, setLang, t }) {
  const [form, setForm] = useState({ email: '', tac: '', name: '', sponsorCode: getQueryParam('sponsor').toUpperCase() })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function sendTac() {
    setError('')
    try {
      await api('/api/auth/request-tac', { method: 'POST', body: { email: form.email } })
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }

  async function register() {
    setError('')
    setSuccess('')
    try {
      const data = await api('/api/auth/register', { method: 'POST', body: form })
      setToken('agent', data.token)
      setSuccess(t('registeredSubmitAnnualFee'))
      window.location.href = '/agent'
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Layout lang={lang} setLang={setLang} t={t} title={t('registerAgent')} right={<a className="btn secondary" href="/">{t('home')}</a>}>
      <Card className="narrow">
        <ErrorBox error={error} />
        {success && <div className="success-box">{success}</div>}
        <Field label={t('email')}><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <div className="row gap align-end">
          <Field label={t('tac')}><input value={form.tac} onChange={(e) => setForm({ ...form, tac: e.target.value })} /></Field>
          <TacSendControl t={t} onSend={sendTac} disabled={!form.email} />
        </div>
          <Field label={t('name')}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={t('sponsorCode')}><input value={form.sponsorCode} onChange={(e) => setForm({ ...form, sponsorCode: e.target.value.toUpperCase() })} placeholder={t('sponsorPlaceholder')} /></Field>
        <Button onClick={register}>{t('register')}</Button>
      </Card>
    </Layout>
  )
}

function AdminApp({ lang, setLang, t }) {
  const [logged, setLogged] = useState(Boolean(localStorage.getItem('admin_token')))
  const [admin, setAdmin] = useState(() => {
    try { return JSON.parse(localStorage.getItem('admin_profile') || '{}') } catch { return {} }
  })
  if (!logged) return <AdminLogin lang={lang} setLang={setLang} t={t} onLogin={(profile) => { setAdmin(profile || {}); setLogged(true) }} />
  return <AdminDashboard lang={lang} setLang={setLang} t={t} admin={admin} onLogout={() => { clearToken('admin'); localStorage.removeItem('admin_profile'); setLogged(false) }} />
}

function AdminDashboard({ lang, setLang, t, admin, onLogout }) {
  if (admin?.role === 'FULFILLMENT') {
    return <FulfillmentDashboard lang={lang} setLang={setLang} t={t} admin={admin} onLogout={onLogout} />
  }

  const isSuper = admin?.role === 'SUPER_ADMIN'
  const baseTabs = ['dashboard', 'adminUsers', 'agents', 'products', 'commissionRules', 'reward', 'withdrawals', 'orders', 'reports']
  const tabs = baseTabs.filter((x) => x === 'adminUsers' ? isSuper : hasAdminPermission(admin, x))
  const [tab, setTab] = useState(tabs[0] || 'dashboard')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState({})
  const [error, setError] = useState('')

  function adminPathFor(key, params = {}) {
    const query = buildQuery(params)
    const map = {
      dashboard: '/api/admin/dashboard',
      adminUsers: '/api/admin/admin-users',
      agents: '/api/admin/agents',
      products: '/api/admin/products',
      commissionRules: '/api/admin/commission-rules',
      reward: '/api/admin/wallet-ledger',
      withdrawals: '/api/admin/withdrawals',
      orders: '/api/admin/orders',
      reports: '/api/admin/reports/summary'
    }
    return `${map[key] || map.dashboard}${query}`
  }

  async function loadTab(key = tab, params = {}, force = false) {
    if (!key) return
    if (key === 'adminUsers' && !isSuper) return
    if (key !== 'adminUsers' && !hasAdminPermission(admin, key)) return
    if (data[key] && !force && !Object.keys(params).length) return
    setError('')
    setLoading((x) => ({ ...x, [key]: true }))
    try {
      const payload = await api(adminPathFor(key, params), {}, 'admin')
      setData((x) => ({ ...x, [key]: payload }))
    } catch (err) {
      setError(err.message)
      if (err.message === 'UNAUTHORIZED') onLogout()
    } finally {
      setLoading((x) => ({ ...x, [key]: false }))
    }
  }

  useEffect(() => { loadTab('dashboard') }, [])
  useEffect(() => { loadTab(tab) }, [tab])
  useEffect(() => { if (!tabs.includes(tab)) setTab(tabs[0] || 'dashboard') }, [admin?.permissions?.join(','), admin?.role])

  const refreshActive = () => loadTab(tab, {}, true)
  const currentData = data[tab]
  const isLoading = Boolean(loading[tab])

  return (
    <Layout
      lang={lang}
      setLang={setLang}
      t={t}
      title={isSuper ? t('superAdminHq') : t('LEADER')}
      right={<><Button variant="secondary" onClick={refreshActive}>{t('refresh')}</Button><Button variant="danger" onClick={onLogout}>{t('logout')}</Button></>}
      navTabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
    >
      <ErrorBox error={error} />
      <MobileTabs t={t} tabs={tabs} tab={tab} setTab={setTab} />
      {isLoading && !currentData ? <Card>{t('loading')}...</Card> : (
        <>
          {tab === 'dashboard' && currentData && <AdminHome t={t} data={currentData} isSuper={isSuper || hasAdminPermission(admin, 'reward')} />}
          {tab === 'adminUsers' && isSuper && currentData && <AdminUsers t={t} admins={currentData.admins || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('adminUsers', params, true)} />}
          {tab === 'agents' && currentData && <AdminAgents t={t} agents={currentData.agents || []} pagination={currentData.pagination} ownerOptions={currentData.ownerOptions || []} admin={admin} reload={(params = {}) => loadTab('agents', params, true)} />}
          {tab === 'products' && currentData && <AdminProducts t={t} products={currentData.products || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('products', params, true)} />}
          {tab === 'commissionRules' && currentData && <AdminRules t={t} rulesData={currentData} reload={(params = {}) => loadTab('commissionRules', params, true)} isSuper={isSuper} />}
          {tab === 'reward' && currentData && <AdminWallet t={t} wallet={currentData} pagination={currentData.pagination} reload={(params = {}) => loadTab('reward', params, true)} />}
          {tab === 'withdrawals' && currentData && <AdminWithdrawals t={t} withdrawals={currentData.withdrawals || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('withdrawals', params, true)} />}
          {tab === 'orders' && currentData && <AdminOrders t={t} orders={currentData.orders || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('orders', params, true)} />}
          {tab === 'reports' && currentData && <AdminReports t={t} summary={currentData} />}
        </>
      )}
    </Layout>
  )
}

function PermissionChecklist({ t, value, onChange, disabled = false }) {
  const current = Array.isArray(value) ? value : []
  function toggle(key) {
    if (disabled) return
    const next = current.includes(key) ? current.filter((x) => x !== key) : [...current, key]
    onChange(next)
  }
  return (
    <div className="permission-grid">
      {ADMIN_PERMISSION_KEYS.map((key) => (
        <label key={key} className="permission-pill">
          <input type="checkbox" checked={current.includes(key)} disabled={disabled} onChange={() => toggle(key)} />
          <span>{t(`permission_${key}`)}</span>
        </label>
      ))}
    </div>
  )
}

function AdminUsers({ t, admins, pagination, reload }) {
  const [search, setSearch] = useState('')
  const runSearch = (page = 1) => reload({ search, page })
  const [form, setForm] = useState({ code: '', password: '', name: '', role: 'LEADER', permissions: DEFAULT_LEADER_PERMISSIONS })
  const [permissionModal, setPermissionModal] = useState(null)
  const [passwordModal, setPasswordModal] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [notice, setNotice] = useState(null)

  function updateRole(role) {
    setForm({ ...form, role, permissions: role === 'FULFILLMENT' ? ['fulfillmentOrders'] : DEFAULT_LEADER_PERMISSIONS })
  }

  async function create() {
    try {
      await api('/api/admin/admin-users', { method: 'POST', body: form }, 'admin')
      setForm({ code: '', password: '', name: '', role: 'LEADER', permissions: DEFAULT_LEADER_PERMISSIONS })
      showSuccess(setNotice, t, 'saved')
      reload({ search, page: 1 })
    } catch (err) { showError(setNotice, t, err) }
  }

  async function setStatus(id, status) {
    try {
      await api(`/api/admin/admin-users/${id}/status`, { method: 'PATCH', body: { status } }, 'admin')
      showSuccess(setNotice, t, 'saved')
      reload({ search, page: pageOf({ pagination }).page })
    } catch (err) { showError(setNotice, t, err) }
  }

  async function savePermissions() {
    if (!permissionModal?.admin?.id) return
    try {
      await api(`/api/admin/admin-users/${permissionModal.admin.id}/permissions`, { method: 'PATCH', body: { permissions: permissionModal.permissions || [] } }, 'admin')
      setPermissionModal(null)
      showSuccess(setNotice, t, 'saved')
      reload({ search, page: pageOf({ pagination }).page })
    } catch (err) { showError(setNotice, t, err) }
  }

  function openPermissions(a) {
    setPermissionModal({ admin: a, permissions: Array.isArray(a.permissions) ? [...a.permissions] : [] })
  }

  function openPassword(a) {
    setPasswordModal(a)
    setNewPassword('')
  }

  async function savePassword() {
    if (!passwordModal?.id) return
    try {
      await api(`/api/admin/admin-users/${passwordModal.id}/password`, { method: 'PATCH', body: { password: newPassword } }, 'admin')
      setPasswordModal(null)
      setNewPassword('')
      showSuccess(setNotice, t, 'passwordUpdated')
      reload({ search, page: pageOf({ pagination }).page })
    } catch (err) { showError(setNotice, t, err) }
  }

  return (
    <>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <Card>
        <h3>{t('createAdminUser')}</h3>
        <div className="form-grid">
          <Field label={t('adminCode')}><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label={t('password')}><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label={t('name')}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('role')}><select value={form.role} onChange={(e) => updateRole(e.target.value)}><option value="LEADER">{t('LEADER')}</option><option value="FULFILLMENT">{t('FULFILLMENT')}</option></select></Field>
        </div>
        {form.role === 'LEADER' && <PermissionChecklist t={t} value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} />}
        <Button onClick={create}>{t('save')}</Button>
      </Card>
      <Card>
        <div className="section-head"><h3>{t('adminUsers')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
        <Table><thead><tr><th>{t('adminCode')}</th><th>{t('name')}</th><th>{t('role')}</th><th>{t('ownerScope')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead><tbody>{admins.map((a) => {
          const actions = [
            { label: t('permissions'), variant: 'secondary', onClick: () => openPermissions(a), hidden: a.role !== 'LEADER' },
            { label: t('changePassword'), variant: 'secondary', onClick: () => openPassword(a), hidden: a.role === 'SUPER_ADMIN' },
            { label: a.status === 'ACTIVE' ? t('hidden') : t('active'), onClick: () => setStatus(a.id, a.status === 'ACTIVE' ? 'HIDDEN' : 'ACTIVE'), hidden: a.role === 'SUPER_ADMIN' }
          ]
          return <tr key={a.id}><td>{a.code}</td><td>{a.name}</td><td>{t(a.role)}</td><td>{a.role === 'SUPER_ADMIN' ? t('hqOwner') : (a.scopeOwnerAdminId === 'ALL' ? t('allPermissions') : a.name)}</td><td><StatusBadge t={t} status={a.status} /></td><td><ActionMenu t={t} actions={actions} /></td></tr>
        })}</tbody></Table>
        <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
      </Card>
      <CenterNotice open={Boolean(permissionModal)} title={`${t('permissions')} · ${permissionModal?.admin?.name || ''}`} type="info" onClose={() => setPermissionModal(null)}>
        <div className="modal-form">
          <PermissionChecklist t={t} value={permissionModal?.permissions || []} onChange={(permissions) => setPermissionModal({ ...permissionModal, permissions })} />
          <div className="row gap">
            <Button onClick={savePermissions}>{t('savePermissions')}</Button>
            <Button variant="secondary" onClick={() => setPermissionModal(null)}>{t('cancel')}</Button>
          </div>
        </div>
      </CenterNotice>
      <CenterNotice open={Boolean(passwordModal)} title={`${t('changePassword')} · ${passwordModal?.name || ''}`} message={t('passwordMinHint')} type="info" onClose={() => setPasswordModal(null)}>
        <div className="modal-form">
          <Field label={t('newPassword')}><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field>
          <div className="row gap">
            <Button onClick={savePassword}>{t('save')}</Button>
            <Button variant="secondary" onClick={() => setPasswordModal(null)}>{t('cancel')}</Button>
          </div>
        </div>
      </CenterNotice>
    </>
  )
}

function FulfillmentDashboard({ lang, setLang, t, admin, onLogout }) {
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [shipModal, setShipModal] = useState(null)
  const [shipForm, setShipForm] = useState({ trackingNumber: '', courier: '', note: '' })

  async function load() {
    setError('')
    try {
      const data = await api('/api/fulfillment/orders', {}, 'admin')
      setOrders(data.orders)
    } catch (err) {
      setError(readableError(t, err))
      if (err.message === 'UNAUTHORIZED') onLogout()
    }
  }

  function openShip(order) {
    setShipModal(order)
    setShipForm({ trackingNumber: order.trackingNumber || '', courier: order.courier || '', note: order.packedNote || '' })
  }

  async function approve() {
    if (!shipModal?.id) return
    try {
      await api(`/api/fulfillment/orders/${shipModal.id}/approve`, { method: 'POST', body: shipForm }, 'admin')
      setShipModal(null)
      showSuccess(setNotice, t, 'trackingUpdated')
      load()
    } catch (err) { showError(setNotice, t, err) }
  }

  useEffect(() => { load() }, [])

  return (
    <Layout lang={lang} setLang={setLang} t={t} title={t('fulfillmentParty')} right={<><Button variant="secondary" onClick={load}>{t('refresh')}</Button><Button variant="danger" onClick={onLogout}>{t('logout')}</Button></>}>
      <ErrorBox error={error} />
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <Card>
        <h3>{t('orders')}</h3>
        <Table><thead><tr><th>{t('orderId')}</th><th>{t('productName')}</th><th>{t('qty')}</th><th>{t('customerName')}</th><th>{t('customerPhone')}</th><th>{t('deliveryAddress')}</th><th>{t('remark')}</th><th>{t('trackingNumber')}</th><th>{t('courier')}</th><th>{t('fulfillmentStatus')}</th><th>{t('action')}</th></tr></thead><tbody>{orders.length ? orders.map((o) => <tr key={o.id}><td>{o.id.slice(-8)}</td><td>{o.product?.name}</td><td>{o.qty}</td><td>{o.customerName}</td><td>{o.customerPhone}</td><td>{o.deliveryAddress || '-'}</td><td>{o.remark || '-'}</td><td>{o.trackingNumber || '-'}</td><td>{o.courier || '-'}</td><td><StatusBadge t={t} status={o.fulfillmentStatus} /></td><td><ActionMenu t={t} actions={[{ label: t('fillTrackingAndShip'), onClick: () => openShip(o), hidden: o.fulfillmentStatus === 'PACKED_SHIPPED' }]} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
      </Card>
      <CenterNotice open={Boolean(shipModal)} title={t('fillTrackingAndShip')} message={t('trackingConfirmHint')} type="info" onClose={() => setShipModal(null)}>
        <div className="modal-form">
          <Field label={t('trackingNumber')}><input value={shipForm.trackingNumber} onChange={(e) => setShipForm({ ...shipForm, trackingNumber: e.target.value })} /></Field>
          <Field label={t('courier')}><input value={shipForm.courier} onChange={(e) => setShipForm({ ...shipForm, courier: e.target.value })} /></Field>
          <Field label={t('remark')}><textarea rows="3" value={shipForm.note} onChange={(e) => setShipForm({ ...shipForm, note: e.target.value })} /></Field>
          <div className="row gap">
            <Button onClick={approve}>{t('confirmSubmit')}</Button>
            <Button variant="secondary" onClick={() => setShipModal(null)}>{t('cancel')}</Button>
          </div>
        </div>
      </CenterNotice>
    </Layout>
  )
}

function AdminHome({ t, data, isSuper }) {
  const s = data.stats
  return (
    <>
      <div className="stats-grid">
        <StatCard label={t('totalAgents')} value={s.totalAgents} />
        <StatCard label={t('activeAgents')} value={s.activeAgents} />
        <StatCard label={t('frozenAgents')} value={s.frozenAgents} />
        <StatCard label={t('pendingWithdrawals')} value={s.pendingWithdrawals} />
        {isSuper && <StatCard label={t('companyIncome')} value={money(s.totalCompanyIncome)} />}
      </div>
      {isSuper && <Card>
        <h3>{t('commissionHistory')}</h3>
        <Table><tbody>{data.recentCommissions.length ? data.recentCommissions.map((r) => <tr key={r.id}><td>{t('level')} {r.generation}</td><td>{sourceTypeText(t, r.sourceType)}</td><td>{money(r.amount)}</td><td><StatusBadge t={t} status={r.status} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
      </Card>}
    </>
  )
}

function AdminAgents({ t, agents, pagination, ownerOptions = [], admin, reload }) {
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ email: '', name: '', sponsorCode: '', ownerAdminId: ownerOptions[0]?.id || 'admin_super' })
  const [notice, setNotice] = useState(null)
  const [creditModal, setCreditModal] = useState(null)
  const [creditForm, setCreditForm] = useState({ amount: '', note: '' })
  const rows = agents
  const runSearch = (page = 1) => reload({ search, page })
  const isSuper = admin?.role === 'SUPER_ADMIN'

  async function createSalesAdviser() {
    try {
      await api('/api/admin/agents', { method: 'POST', body: form }, 'admin')
      setForm({ email: '', name: '', sponsorCode: '', ownerAdminId: ownerOptions[0]?.id || 'admin_super' })
      showSuccess(setNotice, t, 'saved')
      reload({ search, page: 1 })
    } catch (err) { showError(setNotice, t, err) }
  }

  async function setStatus(id, status) {
    try {
      await api(`/api/admin/agents/${id}/status`, { method: 'PATCH', body: { status } }, 'admin')
      showSuccess(setNotice, t, 'saved')
      reload({ search, page: pageOf({ pagination }).page })
    } catch (err) { showError(setNotice, t, err) }
  }

  function openCreditModal(agent) {
    setCreditModal(agent)
    setCreditForm({ amount: '', note: '' })
  }

  async function addRewardCredit() {
    if (!creditModal) return
    try {
      await api(`/api/admin/agents/${creditModal.id}/reward-credit`, {
        method: 'POST',
        body: { amount: creditForm.amount, note: creditForm.note }
      }, 'admin')
      setCreditModal(null)
      setCreditForm({ amount: '', note: '' })
      showSuccess(setNotice, t, 'rewardAdjustSuccess')
      reload({ search, page: pageOf({ pagination }).page })
    } catch (err) { showError(setNotice, t, err) }
  }

  return (
    <>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <Card>
        <h3>{t('createSalesAdviser')}</h3>
        <div className="form-grid">
          <Field label={t('email')}><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label={t('name')}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('sponsorOptional')}><input value={form.sponsorCode} onChange={(e) => setForm({ ...form, sponsorCode: e.target.value.toUpperCase() })} /></Field>
          {isSuper && <Field label={t('ownerScope')}><select value={form.ownerAdminId} onChange={(e) => setForm({ ...form, ownerAdminId: e.target.value })}>{ownerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
        </div>
        <Button onClick={createSalesAdviser}>{t('save')}</Button>
      </Card>
      <Card>
        <div className="section-head"><h3>{t('agents')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
        <Table>
          <thead><tr><th>{t('agentCode')}</th><th>{t('name')}</th><th>{t('email')}</th><th>{t('owner')}</th><th>{t('sponsor')}</th><th>{t('balance')}</th><th>{t('annualFeeReminder')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((a) => (
              <tr key={a.id}>
                <td>{a.agentCode}</td><td>{a.name}</td><td>{a.email}</td><td>{a.ownerName || '-'}</td><td>{a.sponsor?.agentCode || '-'}</td><td>{money(a.balance)}</td><td>{a.annualFeeDaysLeft} {t('days')}</td><td><StatusBadge t={t} status={a.status} /></td>
                <td><ActionMenu t={t} actions={[{ label: t('addRewardCredit'), onClick: () => openCreditModal(a), hidden: !isSuper }, { label: t('active'), onClick: () => setStatus(a.id, 'ACTIVE') }, { label: t('frozen'), onClick: () => setStatus(a.id, 'FROZEN') }]} /></td>
              </tr>
            )) : <tr><td><Empty t={t} /></td></tr>}
          </tbody>
        </Table>
        <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
      </Card>

      <CenterNotice
        open={Boolean(creditModal)}
        title={t('addRewardCredit')}
        message={creditModal ? `${creditModal.agentCode} · ${creditModal.name} · ${t('currentReward')}: ${money(creditModal.balance)}` : ''}
        type="info"
        onClose={() => setCreditModal(null)}
      >
        <div className="modal-form">
          <p className="muted">{t('topUpRewardHint')}</p>
          <Field label={t('creditAmount')}><input type="number" step="0.01" value={creditForm.amount} onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })} placeholder={t('creditAmountPlaceholder')} /></Field>
          <Field label={t('creditNote')}><textarea rows="3" value={creditForm.note} onChange={(e) => setCreditForm({ ...creditForm, note: e.target.value })} placeholder={t('optional')} /></Field>
          <div className="row gap">
            <Button onClick={addRewardCredit}>{t('confirmAddCredit')}</Button>
            <Button variant="secondary" onClick={() => setCreditModal(null)}>{t('cancel')}</Button>
          </div>
        </div>
      </CenterNotice>
    </>
  )
}

function AdminProducts({ t, products, pagination, reload }) {
  const [form, setForm] = useState({ sku: '', name: '', description: '', price: '', cost: '' })
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState(null)
  const runSearch = (page = 1) => reload({ search, page })

  async function add() {
    try {
      await api('/api/admin/products', { method: 'POST', body: form }, 'admin')
      setForm({ sku: '', name: '', description: '', price: '', cost: '' })
      showSuccess(setNotice, t, 'saved')
      reload({ search, page: 1 })
    } catch (err) { showError(setNotice, t, err) }
  }

  async function toggle(p) {
    try {
      await api(`/api/admin/products/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } }, 'admin')
      showSuccess(setNotice, t, 'saved')
      reload({ search, page: pageOf({ pagination }).page })
    } catch (err) { showError(setNotice, t, err) }
  }

  return (
    <>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <Card>
        <h3>{t('addProduct')}</h3>
        <div className="form-grid">
          <Field label={t('sku')}><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
          <Field label={t('productName')}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('price')}><input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
          <Field label={t('cost')}><input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
          <Field label={t('description')}><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        <Button onClick={add}>{t('save')}</Button>
      </Card>
      <Card>
        <div className="section-head"><h3>{t('products')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
        <Table><thead><tr><th>{t('sku')}</th><th>{t('productName')}</th><th>{t('price')}</th><th>{t('cost')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead><tbody>{products.length ? products.map((p) => <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{money(p.price)}</td><td>{money(p.cost)}</td><td><StatusBadge t={t} status={p.isActive ? 'ACTIVE' : 'HIDDEN'} /></td><td><ActionMenu t={t} actions={[{ label: p.isActive ? t('hidden') : t('active'), onClick: () => toggle(p) }]} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
        <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
      </Card>
    </>
  )
}

function AdminProofs({ t, proofs, pagination, reload }) {
  const [search, setSearch] = useState('')
  const runSearch = (page = 1) => reload({ search, page })
  async function approve(id) { await api(`/api/admin/payment-proofs/${id}/approve`, { method: 'POST' }, 'admin'); reload({ search, page: pageOf({ pagination }).page }) }
  async function reject(id) { await api(`/api/admin/payment-proofs/${id}/reject`, { method: 'POST', body: { reason: 'Rejected by admin' } }, 'admin'); reload({ search, page: pageOf({ pagination }).page }) }
  return (
    <Card>
      <div className="section-head"><h3>{t('paymentProofs')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
      <Table>
        <thead><tr><th>{t('type')}</th><th>{t('submittedBy')}</th><th>{t('amount')}</th><th>{t('proof')}</th><th>{t('status')}</th><th>{t('createdAt')}</th><th>{t('action')}</th></tr></thead>
        <tbody>{proofs.length ? proofs.map((p) => <tr key={p.id}><td>{proofTypeText(t, p.type)}</td><td>{p.agent?.name || '-'}</td><td>{money(p.amount)}</td><td>{p.proofText}</td><td><StatusBadge t={t} status={p.status} /></td><td>{dateText(p.createdAt)}</td><td><ActionMenu t={t} actions={[{ label: t('approve'), onClick: () => approve(p.id), hidden: p.status !== 'PENDING' }, { label: t('reject'), variant: 'danger', onClick: () => reject(p.id), hidden: p.status !== 'PENDING' }]} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody>
      </Table>
      <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
    </Card>
  )
}

function AdminRules({ t, rulesData, reload, isSuper = false }) {
  const adminContact = rulesData.adminContact || {}
  const [product, setProduct] = useState(rulesData.rules.product)
  const [annualFee, setAnnualFee] = useState(rulesData.rules.annualFee)
  const [annualFeeAmount, setAnnualFeeAmount] = useState(rulesData.annualFeeAmount)
  const [adminWhatsapp, setAdminWhatsapp] = useState(adminContact.whatsapp || rulesData.adminWhatsapp || '')
  const [whatsappText, setWhatsappText] = useState(adminContact.whatsappText || '')
  const [paymentInstructions, setPaymentInstructions] = useState(adminContact.paymentInstructions || '')
  const [paymentQrImage, setPaymentQrImage] = useState(adminContact.paymentQrImage || '')
  const [notice, setNotice] = useState(null)

  function updateRule(kind, idx, patch) {
    const setter = kind === 'product' ? setProduct : setAnnualFee
    const list = kind === 'product' ? product : annualFee
    setter(list.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function uploadQr(file) {
    if (!file) return
    if (file.size > 1500 * 1024) {
      setNotice({ title: t('operationFailed'), message: t('qrImageTooLarge'), type: 'danger' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setPaymentQrImage(String(reader.result || ''))
    reader.onerror = () => setNotice({ title: t('operationFailed'), message: t('qrImageUploadFailed'), type: 'danger' })
    reader.readAsDataURL(file)
  }

  async function save() {
    try {
      await api('/api/admin/commission-rules', {
        method: 'PUT',
        body: { product, annualFee, annualFeeAmount, adminWhatsapp, whatsappText, paymentInstructions, paymentQrImage }
      }, 'admin')
      showSuccess(setNotice, t, 'saved')
      reload()
    } catch (err) { showError(setNotice, t, err) }
  }

  async function runRenewal() {
    try {
      const data = await api('/api/admin/run-annual-renewal-check', { method: 'POST' }, 'admin')
      setNotice({ title: t('success'), message: `${t('renewalCheckDone')}: ${data.result.length}`, type: 'success' })
      reload()
    } catch (err) { showError(setNotice, t, err) }
  }

  const editor = (title, kind, list) => (
    <div>
      <h4>{title}</h4>
      <Table><thead><tr><th>{t('generation')}</th><th>{t('type')}</th><th>{t('value')}</th></tr></thead><tbody>{list.map((r, idx) => <tr key={r.generation}><td>{t('level')} {r.generation}</td><td><select value={r.type} onChange={(e) => updateRule(kind, idx, { type: e.target.value })}><option value="percent">{t('percent')}</option><option value="amount">{t('fixedAmount')}</option></select></td><td><input type="number" value={r.value} onChange={(e) => updateRule(kind, idx, { value: e.target.value })} /></td></tr>)}</tbody></Table>
    </div>
  )

  return (
    <Card>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <div className="section-head"><h3>{t('commissionRules')}</h3><div className="row gap">{isSuper && <Button variant="secondary" onClick={runRenewal}>{t('runRenewalCheck')}</Button>}<Button onClick={save}>{t('save')}</Button></div></div>
      <div className="notice">{t('adminContactSettingsHint')}</div>
      <div className="form-grid small">
        <Field label={t('annualFeeAmount')}><input type="number" value={annualFeeAmount} onChange={(e) => setAnnualFeeAmount(e.target.value)} /></Field>
        <Field label={t('adminWhatsapp')}><input value={adminWhatsapp} onChange={(e) => setAdminWhatsapp(e.target.value)} placeholder="60123456789" /></Field>
        <Field label={t('whatsappText')}><textarea value={whatsappText} onChange={(e) => setWhatsappText(e.target.value)} placeholder={t('whatsappTextPlaceholder')} /></Field>
        <Field label={t('paymentInstructions')}><textarea value={paymentInstructions} onChange={(e) => setPaymentInstructions(e.target.value)} placeholder={t('paymentInstructionsPlaceholder')} /></Field>
        <Field label={t('paymentQrImage')}>
          <input value={paymentQrImage} onChange={(e) => setPaymentQrImage(e.target.value)} placeholder={t('qrImageUrlOrUpload')} />
        </Field>
        <Field label={t('uploadPaymentQr')}>
          <input type="file" accept="image/*" onChange={(e) => uploadQr(e.target.files?.[0])} />
        </Field>
      </div>
      {paymentQrImage && <div className="payment-qr-admin-preview"><img src={paymentQrImage} alt={t('paymentQrImage')} /><Button variant="secondary" onClick={() => setPaymentQrImage('')}>{t('removeQrImage')}</Button></div>}
      <div className="two-col">
        {editor(t('productCommission'), 'product', product)}
        {editor(t('annualFeeCommission'), 'annualFee', annualFee)}
      </div>
    </Card>
  )
}

function AdminWallet({ t, wallet, pagination, reload }) {
  const [search, setSearch] = useState('')
  const runSearch = (page = 1) => reload({ search, page })
  const rows = Array.isArray(wallet.rows) ? wallet.rows : []
  const companyRows = Array.isArray(wallet.companyLedger) ? wallet.companyLedger : []
  return (
    <div className="two-col">
      <Card>
        <div className="section-head"><h3>{t('rewardLedger')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
        <Table><tbody>{rows.length ? rows.map((w) => <tr key={w.id}><td>{w.agent?.agentCode}</td><td>{ledgerTypeText(t, w.type)}</td><td>{money(w.amount)}</td><td>{noteText(t, w.note)}</td><td>{dateText(w.createdAt)}</td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
        <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
      </Card>
      <Card><h3>{t('companyLedger')}</h3><Table><tbody>{companyRows.length ? companyRows.map((w) => <tr key={w.id}><td>{sourceTypeText(t, w.sourceType)}</td><td>{money(w.amount)}</td><td>{noteText(t, w.note)}</td><td>{dateText(w.createdAt)}</td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table></Card>
    </div>
  )
}

function AdminWithdrawals({ t, withdrawals, pagination, reload }) {
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState(null)
  const runSearch = (page = 1) => reload({ search, page })
  async function paid(id) {
    try {
      await api(`/api/admin/withdrawals/${id}/mark-paid`, { method: 'POST' }, 'admin')
      showSuccess(setNotice, t, 'saved')
      reload({ search, page: pageOf({ pagination }).page })
    } catch (err) { showError(setNotice, t, err) }
  }
  async function reject(id) {
    try {
      await api(`/api/admin/withdrawals/${id}/reject`, { method: 'POST', body: { reason: 'Rejected by admin' } }, 'admin')
      showSuccess(setNotice, t, 'saved')
      reload({ search, page: pageOf({ pagination }).page })
    } catch (err) { showError(setNotice, t, err) }
  }
  return (
    <Card>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <div className="section-head"><h3>{t('withdrawals')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
      <Table><thead><tr><th>{t('submittedBy')}</th><th>{t('amount')}</th><th>{t('bankName')}</th><th>{t('bankAccountNo')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead><tbody>{withdrawals.length ? withdrawals.map((w) => <tr key={w.id}><td>{w.agent?.name}</td><td>{money(w.amount)}</td><td>{w.bankSnapshot?.bankName}</td><td>{w.bankSnapshot?.bankAccountNo}</td><td><StatusBadge t={t} status={w.status} /></td><td><ActionMenu t={t} actions={[{ label: t('markPaid'), onClick: () => paid(w.id), hidden: w.status !== 'PENDING' }, { label: t('reject'), variant: 'danger', onClick: () => reject(w.id), hidden: w.status !== 'PENDING' }]} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
      <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
    </Card>
  )
}

function AdminOrders({ t, orders, pagination, reload }) {
  const [search, setSearch] = useState('')
  const runSearch = (page = 1) => reload({ search, page })
  return (
    <Card>
      <div className="section-head"><h3>{t('orders')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
      <Table><thead><tr><th>{t('orderId')}</th><th>{t('submittedBy')}</th><th>{t('productName')}</th><th>{t('qty')}</th><th>{t('amount')}</th><th>{t('customerName')}</th><th>{t('customerPhone')}</th><th>{t('deliveryAddress')}</th><th>{t('paymentStatus')}</th><th>{t('fulfillmentStatus')}</th><th>{t('courier')}</th><th>{t('trackingNumber')}</th><th>{t('createdAt')}</th></tr></thead><tbody>{orders.length ? orders.map((o) => <tr key={o.id}><td>{o.id.slice(-8)}</td><td>{o.agent?.name}</td><td>{o.product?.name}</td><td>{o.qty}</td><td>{money(o.totalAmount)}</td><td>{o.customerName}</td><td>{o.customerPhone}</td><td>{o.deliveryAddress || '-'}</td><td><StatusBadge t={t} status={o.status} /></td><td><StatusBadge t={t} status={o.fulfillmentStatus} /></td><td>{o.courier || '-'}</td><td>{o.trackingNumber || '-'}</td><td>{dateText(o.createdAt)}</td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
      <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
    </Card>
  )
}

function AdminReports({ t, summary }) {
  const [error, setError] = useState('')
  async function download(type) {
    setError('')
    try {
      await downloadFile(`/api/admin/reports/${type}.xls`, `${type}.xls`, 'admin')
    } catch (err) {
      setError(err.message)
    }
  }

  const s = summary.stats || {}
  return (
    <>
      <ErrorBox error={error} />
      <div className="stats-grid">
        <StatCard label={t('totalSales')} value={money(s.totalSales)} />
        <StatCard label={t('totalOrders')} value={s.totalOrders || 0} />
        <StatCard label={t('approvedOrders')} value={s.approvedOrders || 0} />
        <StatCard label={t('totalCommission')} value={money(s.totalCommission)} />
        <StatCard label={t('totalWithdrawalsPaid')} value={money(s.totalWithdrawalsPaid)} />
        <StatCard label={t('companyIncome')} value={money(s.totalCompanyIncome)} />
        <StatCard label={t('totalSalesAdvisers')} value={s.totalSalesAdvisers || 0} />
        <StatCard label={t('activeSalesAdvisers')} value={s.activeSalesAdvisers || 0} />
      </div>
      <Card>
        <h3>{t('reports')}</h3>
        <p>{t('reportDownloadHint')}</p>
        <div className="report-grid">
          {(summary.reportTypes || REPORT_TYPES).map((type) => <Button key={type} variant="secondary" onClick={() => download(type)}>{t(`report_${type}`)}</Button>)}
        </div>
      </Card>
    </>
  )
}

function AgentApp({ lang, setLang, t }) {
  const [logged, setLogged] = useState(Boolean(localStorage.getItem('agent_token')))
  if (!logged) {
    return (
      <Layout lang={lang} setLang={setLang} t={t} title={t('agentLogin')} right={<a className="btn secondary" href="/">{t('home')}</a>}>
        <TacLogin t={t} mode="agent" onSuccess={() => setLogged(true)} />
      </Layout>
    )
  }
  return <AgentDashboard lang={lang} setLang={setLang} t={t} onLogout={() => { clearToken('agent'); setLogged(false) }} />
}

function AgentDashboard({ lang, setLang, t, onLogout }) {
  const tabs = ['dashboard', 'profile', 'team', 'products', 'orders', 'reward', 'withdrawals']
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState({})
  const [error, setError] = useState('')

  function agentPathFor(key, params = {}) {
    const query = buildQuery(params)
    const map = {
      me: '/api/agent/me',
      dashboard: '/api/agent/me',
      profile: '/api/agent/me',
      team: '/api/agent/team',
      products: '/api/agent/products',
      orders: '/api/agent/orders',
      reward: '/api/agent/wallet',
      withdrawals: '/api/agent/wallet'
    }
    return `${map[key] || map.dashboard}${query}`
  }

  async function loadMe(force = false) {
    if (data.me && !force) return data.me
    const me = await api(agentPathFor('me'), {}, 'agent')
    setData((x) => ({ ...x, me }))
    return me
  }

  async function loadTab(key = tab, params = {}, force = false) {
    if (data[key] && !force && !Object.keys(params).length) return
    setError('')
    setLoading((x) => ({ ...x, [key]: true }))
    try {
      const needsMe = ['dashboard', 'profile', 'team', 'products', 'reward', 'withdrawals'].includes(key)
      const mePayload = needsMe ? await loadMe(force && ['dashboard', 'profile'].includes(key)) : data.me
      const payload = key === 'dashboard' || key === 'profile'
        ? mePayload
        : await api(agentPathFor(key, params), {}, 'agent')
      setData((x) => {
        if (key === 'dashboard' || key === 'profile') return { ...x, me: payload, [key]: payload }
        return { ...x, [key]: payload }
      })
    } catch (err) {
      setError(err.message)
      if (err.message === 'UNAUTHORIZED') onLogout()
    } finally {
      setLoading((x) => ({ ...x, [key]: false }))
    }
  }

  useEffect(() => { loadTab('dashboard') }, [])
  useEffect(() => { loadTab(tab) }, [tab])

  const refreshActive = () => loadTab(tab, {}, true)
  const currentData = data[tab]
  const meData = data.me || data.dashboard || data.profile
  const isLoading = Boolean(loading[tab])

  return (
    <Layout
      lang={lang}
      setLang={setLang}
      t={t}
      title={t('salesAdviser')}
      subtitle={t('agentIntro')}
      right={<><Button variant="secondary" onClick={refreshActive}>{t('refresh')}</Button><Button variant="danger" onClick={onLogout}>{t('logout')}</Button></>}
      navTabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
    >
      <ErrorBox error={error} />
      <MobileTabs t={t} tabs={tabs} tab={tab} setTab={setTab} />
      {isLoading && !currentData ? <Card>{t('loading')}...</Card> : (
        <>
          {tab === 'dashboard' && meData && <AgentHome t={t} data={{ me: meData }} reload={refreshActive} />}
          {tab === 'profile' && meData && <AgentProfile t={t} me={meData.agent} reload={refreshActive} />}
          {tab === 'team' && currentData && meData && <AgentTeam t={t} team={currentData} me={meData.agent} />}
          {tab === 'products' && currentData && meData && <AgentProducts t={t} products={currentData.products || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('products', params, true)} agent={meData.agent} />}
          {tab === 'orders' && currentData && <AgentOrders t={t} orders={currentData.orders || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('orders', params, true)} />}
          {tab === 'reward' && currentData && meData && <AgentReward t={t} wallet={currentData} me={meData.agent} reload={(params = {}) => loadTab('reward', params, true)} />}
          {tab === 'withdrawals' && currentData && meData && <AgentWithdrawals t={t} wallet={currentData} me={meData.agent} reload={(params = {}) => loadTab('withdrawals', params, true)} />}
        </>
      )}
    </Layout>
  )
}

function AgentHome({ t, data, reload }) {
  const agent = data.me.agent
  const adminContact = data.me.adminContact || { whatsapp: data.me.adminWhatsapp }
  const annualFeeAmount = data.me.annualFeeAmount
  const whatsappMessage = buildAdminWhatsappMessage(adminContact.whatsappText, { amount: annualFeeAmount, agentCode: agent.agentCode, agentName: agent.name })
  const whatsappUrl = buildWhatsappUrl(adminContact.whatsapp, whatsappMessage)
  return (
    <>
      {agent.status !== 'ACTIVE' && <div className="warning-box">{t('frozenWarning')}</div>}
      <div className="stats-grid">
        <StatCard label={t('rewardCredit')} value={money(agent.balance)} hint={t('creditEqualRm')} />
        <StatCard label={t('agentCode')} value={agent.agentCode} hint={agent.referralCode} />
        <StatCard label={t('annualFeeReminder')} value={`${agent.annualFeeDaysLeft} ${t('days')}`} hint={t('renewalWarning')} />
        <StatCard label={t('status')} value={statusText(t, agent.status)} />
      </div>
      <Card>
        <h3>{t('annualFee')}</h3>
        <p>{t('manualBankTransfer')}</p>
        <p>{t('annualFeeAmount')}: <strong>{money(annualFeeAmount)}</strong></p>
        {adminContact.paymentInstructions && <div className="notice contact-instructions">{adminContact.paymentInstructions}</div>}
        {adminContact.paymentQrImage && <div className="agent-payment-qr"><img src={adminContact.paymentQrImage} alt={t('paymentQrImage')} /></div>}
        {whatsappUrl ? <a className="btn primary" href={whatsappUrl} target="_blank" rel="noreferrer">{t('contactAdminWhatsapp')}</a> : <span className="muted">{t('adminWhatsapp')}: -</span>}
      </Card>
    </>
  )
}


function AgentProfile({ t, me, reload }) {
  const [form, setForm] = useState({ name: me.name, ...me.profile })
  const [notice, setNotice] = useState(null)
  async function save() {
    try {
      await api('/api/agent/profile', { method: 'PATCH', body: form }, 'agent')
      showSuccess(setNotice, t, 'saved')
      reload()
    } catch (err) { showError(setNotice, t, err) }
  }
  return (
    <Card>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <h3>{t('profile')}</h3>
      <div className="form-grid">
        <Field label={t('name')}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={t('phone')}><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label={t('bankName')}><input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></Field>
        <Field label={t('bankAccountName')}><input value={form.bankAccountName} onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })} /></Field>
        <Field label={t('bankAccountNo')}><input value={form.bankAccountNo} onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })} /></Field>
      </div>
      <Button onClick={save}>{t('updateProfile')}</Button>
    </Card>
  )
}

function AgentTeam({ t, team, me }) {
  const referralLink = buildRegisterLink(me.referralCode || me.agentCode)
  const [notice, setNotice] = useState(null)
  const qrRef = useRef(null)

  async function copyLink() {
    await navigator.clipboard.writeText(referralLink)
    setNotice({ title: t('copied'), message: t('linkCopied'), type: 'success' })
  }

  function downloadQrCode() {
    const canvas = qrRef.current?.querySelector('canvas')
    if (!canvas) {
      setNotice({ title: t('downloadQrCode'), message: t('qrDownloadFailed'), type: 'danger' })
      return
    }
    const link = document.createElement('a')
    link.download = `${me.agentCode || 'sales-adviser'}-qr.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    setNotice({ title: t('downloadQrCode'), message: t('qrDownloaded'), type: 'success' })
  }

  const list = (title, rows) => <Card><h3>{title}</h3><Table><tbody>{rows.length ? rows.map((a) => <tr key={a.id}><td>{a.agentCode}</td><td>{a.name}</td><td>{a.email}</td><td><StatusBadge t={t} status={a.status} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table></Card>
  return (
    <>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <Card className="qr-referral-card">
        <h3>{t('myReferralLink')}</h3>
        <p>{t('referralLinkHint')}</p>
        <div className="referral-box">
          <div>
            <div className="copy-link">{referralLink}</div>
            <div className="row gap"><Button onClick={copyLink}>{t('copyLink')}</Button><a className="btn secondary" href={referralLink}>{t('openLink')}</a></div>
          </div>
          <div className="qr-panel">
            <div ref={qrRef} className="qr-img qr-local"><QRCodeCanvas value={referralLink} size={220} includeMargin /></div>
            <div className="qr-actions">
              <Button variant="secondary" onClick={downloadQrCode}>{t('downloadQrCode')}</Button>
              <Button variant="secondary" onClick={copyLink}>{t('copyLink')}</Button>
            </div>
          </div>
        </div>
      </Card>
      <div className="two-col">
        {list(t('firstGeneration'), team.first)}
        {list(t('secondGeneration'), team.second)}
      </div>
    </>
  )
}

function AgentProducts({ t, products, pagination, reload, agent }) {
  const [selected, setSelected] = useState(products[0]?.id || '')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ qty: 1, customerName: '', customerPhone: '', deliveryAddress: '', remark: '' })
  const [notice, setNotice] = useState(null)
  const [confirmOrder, setConfirmOrder] = useState(false)
  const selectedProduct = products.find((p) => p.id === selected) || products[0]
  const totalAmount = Number(selectedProduct?.price || 0) * Number(form.qty || 0)
  const runSearch = (page = 1) => reload({ search, page })

  useEffect(() => {
    if (!selected && products[0]?.id) setSelected(products[0].id)
    if (selected && products.length && !products.some((p) => p.id === selected)) setSelected(products[0].id)
  }, [products.map((p) => p.id).join(','), selected])

  function openOrderConfirm() {
    if (!selectedProduct?.id || Number(form.qty || 0) <= 0) {
      setNotice({ title: t('orderFailedTitle'), message: t('PRODUCT_QTY_REQUIRED'), type: 'danger' })
      return
    }
    setConfirmOrder(true)
  }

  async function submit() {
    setNotice(null)
    setConfirmOrder(false)
    try {
      await api('/api/agent/orders', { method: 'POST', body: { ...form, productId: selectedProduct?.id || selected } }, 'agent')
      setForm({ qty: 1, customerName: '', customerPhone: '', deliveryAddress: '', remark: '' })
      setNotice({ title: t('orderPaidSuccessTitle'), message: t('orderPaidSuccessMessage'), type: 'success' })
      reload({ search, page: pageOf({ pagination }).page })
    } catch (err) {
      if (err.message === 'INSUFFICIENT_REWARD_CREDIT' || err.message === 'INSUFFICIENT_REWARD') {
        const required = err.data?.required ?? totalAmount
        const balance = err.data?.balance ?? agent.balance
        setNotice({
          title: t('insufficientRewardTitle'),
          message: `${t('insufficientRewardMessage')} ${t('required')}: ${money(required)} · ${t('currentReward')}: ${money(balance)}`,
          type: 'danger'
        })
      } else {
        setNotice({ title: t('orderFailedTitle'), message: readableError(t, err), type: 'danger' })
      }
    }
  }
  return (
    <>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <CenterNotice open={confirmOrder} title={t('confirmOrderTitle')} message={t('confirmOrderMessage')} type="info" onClose={() => setConfirmOrder(false)}>
        <div className="modal-form confirm-list">
          <p><strong>{t('productName')}:</strong> {selectedProduct?.name || '-'}</p>
          <p><strong>{t('qty')}:</strong> {form.qty}</p>
          <p><strong>{t('orderTotal')}:</strong> {money(totalAmount)}</p>
          <p><strong>{t('customerName')}:</strong> {form.customerName || '-'}</p>
          <p><strong>{t('customerPhone')}:</strong> {form.customerPhone || '-'}</p>
          <p><strong>{t('deliveryAddress')}:</strong> {form.deliveryAddress || '-'}</p>
          <p><strong>{t('remark')}:</strong> {form.remark || '-'}</p>
          <div className="warning-box small-warning">{t('orderCannotChangeHint')}</div>
          <div className="row gap">
            <Button onClick={submit}>{t('confirmSubmit')}</Button>
            <Button variant="secondary" onClick={() => setConfirmOrder(false)}>{t('cancel')}</Button>
          </div>
        </div>
      </CenterNotice>
      {agent.status !== 'ACTIVE' && <div className="warning-box">{t('frozenWarning')}</div>}
      <Card>
        <h3>{t('orderProduct')}</h3>
        <div className="notice order-balance-notice">
          <strong>{t('currentReward')}: {money(agent.balance)}</strong>
          <span>{t('orderDeductRewardHint')}</span>
          <span>{t('orderTotal')}: {money(totalAmount)}</span>
        </div>
        <div className="form-grid">
          <Field label={t('chooseProduct')}><select value={selectedProduct?.id || ''} onChange={(e) => setSelected(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name} - {money(p.price)}</option>)}</select></Field>
          <Field label={t('qty')}><input type="number" min="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></Field>
          <Field label={t('customerName')}><input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
          <Field label={t('customerPhone')}><input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} /></Field>
          <Field label={t('deliveryAddress')}><textarea value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} /></Field>
          <Field label={t('remark')}><textarea value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} /></Field>
        </div>
        <Button onClick={openOrderConfirm}>{t('payWithRewardAndSubmit')}</Button>
      </Card>
      <Card>
        <div className="section-head"><h3>{t('productList')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
        <Table><tbody>{products.length ? products.map((p) => <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.description}</td><td>{money(p.price)}</td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
        <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
      </Card>
    </>
  )
}

function AgentOrders({ t, orders, pagination, reload }) {
  const [search, setSearch] = useState('')
  const runSearch = (page = 1) => reload({ search, page })
  return (
    <Card>
      <div className="section-head"><h3>{t('myOrders')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
      <Table><thead><tr><th>{t('productName')}</th><th>{t('qty')}</th><th>{t('amount')}</th><th>{t('customerName')}</th><th>{t('customerPhone')}</th><th>{t('deliveryAddress')}</th><th>{t('paymentStatus')}</th><th>{t('fulfillmentStatus')}</th><th>{t('courier')}</th><th>{t('trackingNumber')}</th><th>{t('createdAt')}</th></tr></thead><tbody>{orders.length ? orders.map((o) => <tr key={o.id}><td>{o.product?.name}</td><td>{o.qty}</td><td>{money(o.totalAmount)}</td><td>{o.customerName}</td><td>{o.customerPhone}</td><td>{o.deliveryAddress || '-'}</td><td><StatusBadge t={t} status={o.status} /></td><td><StatusBadge t={t} status={o.fulfillmentStatus} /></td><td>{o.courier || '-'}</td><td>{o.trackingNumber || '-'}</td><td>{dateText(o.createdAt)}</td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
      <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
    </Card>
  )
}

function AgentReward({ t, wallet = {}, me = {}, reload }) {
  const [search, setSearch] = useState('')
  const runSearch = (page = 1) => reload({ search, page })
  const ledger = Array.isArray(wallet.ledger)
    ? wallet.ledger
    : Array.isArray(wallet.rows)
      ? wallet.rows
      : []
  const commissions = Array.isArray(wallet.commissions) ? wallet.commissions : []

  return (
    <>
      <div className="stats-grid">
        <StatCard label={t('rewardCredit')} value={money(wallet.balance || 0)} hint={t('creditEqualRm')} />
        <StatCard label={t('annualFeeReminder')} value={`${me.annualFeeDaysLeft ?? 0} ${t('days')}`} />
      </div>
      <div className="two-col">
        <Card><div className="section-head"><h3>{t('rewardLedger')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div><Table><tbody>{ledger.length ? ledger.map((w) => <tr key={w.id}><td>{ledgerTypeText(t, w.type)}</td><td>{money(w.amount)}</td><td>{noteText(t, w.note)}</td><td>{dateText(w.createdAt)}</td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table><PaginationControls t={t} pagination={wallet.pagination} onPage={runSearch} /></Card>
        <Card><h3>{t('commissionHistory')}</h3><Table><tbody>{commissions.length ? commissions.map((c) => <tr key={c.id}><td>{t('level')} {c.generation}</td><td>{sourceTypeText(t, c.sourceType)}</td><td>{money(c.amount)}</td><td><StatusBadge t={t} status={c.status} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table></Card>
      </div>
    </>
  )
}

function AgentWithdrawals({ t, wallet = {}, me = {}, reload }) {
  const [amount, setAmount] = useState('')
  const [notice, setNotice] = useState(null)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const profile = me.profile || {}
  const hasBank = Boolean(String(profile.bankName || '').trim() && String(profile.bankAccountName || '').trim() && String(profile.bankAccountNo || '').trim())

  function openWithdrawConfirm() {
    if (!hasBank) {
      setNotice({ title: t('bankInfoRequiredTitle'), message: t('withdrawBankInfoPrompt'), type: 'danger' })
      return
    }
    if (Number(amount || 0) <= 0) {
      setNotice({ title: t('operationFailed'), message: t('INVALID_AMOUNT'), type: 'danger' })
      return
    }
    setConfirmWithdraw(true)
  }

  async function withdraw() {
    setConfirmWithdraw(false)
    try {
      await api('/api/agent/withdrawals', { method: 'POST', body: { amount } }, 'agent')
      setAmount('')
      setNotice({ title: t('success'), message: t('withdrawalSubmitted'), type: 'success' })
      reload()
    } catch (err) { showError(setNotice, t, err) }
  }
  const withdrawalRows = Array.isArray(wallet.withdrawals) ? wallet.withdrawals : []
  return (
    <>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <CenterNotice open={confirmWithdraw} title={t('confirmWithdrawalTitle')} message={t('confirmWithdrawalMessage')} type="info" onClose={() => setConfirmWithdraw(false)}>
        <div className="modal-form">
          <p><strong>{t('amount')}:</strong> {money(amount)}</p>
          <p><strong>{t('bankName')}:</strong> {profile.bankName}</p>
          <p><strong>{t('bankAccountName')}:</strong> {profile.bankAccountName}</p>
          <p><strong>{t('bankAccountNo')}:</strong> {profile.bankAccountNo}</p>
          <div className="row gap">
            <Button onClick={withdraw}>{t('confirmSubmit')}</Button>
            <Button variant="secondary" onClick={() => setConfirmWithdraw(false)}>{t('cancel')}</Button>
          </div>
        </div>
      </CenterNotice>
      <div className="stats-grid">
        <StatCard label={t('rewardCredit')} value={money(wallet.balance || 0)} hint={t('creditEqualRm')} />
        <StatCard label={t('annualFeeReminder')} value={`${me.annualFeeDaysLeft ?? 0} ${t('days')}`} />
      </div>
      <Card>
        <h3>{t('requestWithdrawal')}</h3>
        <p className="muted">{t('withdrawProfileHint')}</p>
        <div className="row gap align-end withdrawal-form"><Field label={t('amount')}><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Button onClick={openWithdrawConfirm}>{t('requestWithdrawal')}</Button></div>
      </Card>
      <Card><h3>{t('withdrawals')}</h3><Table><tbody>{withdrawalRows.length ? withdrawalRows.map((w) => <tr key={w.id}><td>{money(w.amount)}</td><td><StatusBadge t={t} status={w.status} /></td><td>{dateText(w.createdAt)}</td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table></Card>
    </>
  )
}

function App() {
  const [lang, setLang] = useLang()
  const route = useRoutePath()
  const t = useMemo(() => createTranslator(lang), [lang])

  if (route.startsWith('/admin')) return <AdminApp lang={lang} setLang={setLang} t={t} />
  if (route.startsWith('/agent')) return <AgentApp lang={lang} setLang={setLang} t={t} />
  if (route.startsWith('/register')) return <Register lang={lang} setLang={setLang} t={t} />
  return <Landing lang={lang} setLang={setLang} t={t} />
}

createRoot(document.getElementById('root')).render(<App />)
