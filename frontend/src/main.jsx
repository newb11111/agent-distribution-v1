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
    PACKED_SHIPPED: 'packedShipped',
    SCHEDULED: 'scheduled',
    COLLECTED: 'collected',
    DISABLED: 'disabled',
    DELETED: 'deleted'
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
function generationText(t, value) { return Number(value) === 0 ? t('selfCommission') : `${t('level')} ${value}` }
function ownerNameText(t, ownerId, name) {
  const id = String(ownerId || '').trim()
  const label = String(name || '').trim()
  if (id === 'ALL' || label === 'All Admins') return t('allAdmins')
  if (id === 'admin_super' || id === 'ALL' || label === 'HQ / Super Admin') return t('hqOwner')
  return label || id || '-'
}

function roleText(t, role) {
  const raw = String(role || '').trim()
  if (!raw) return '-'
  const translated = t(raw)
  return translated && translated !== raw ? translated : raw.replaceAll('_', ' ')
}

function noteText(t, value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const compressedLedger = raw.match(/^(PRODUCT_ORDER|ANNUAL_FEE_[A-Z_]+) commission level (\d+) \(compressed from level (\d+)\)$/i)
  if (compressedLedger) return `${t('note_CommissionCompressed')} · ${t('level')} ${compressedLedger[2]} ← ${t('level')} ${compressedLedger[3]}`
  if (/^PRODUCT_ORDER self commission/i.test(raw)) return t('note_SelfCommissionCredited')
  if (/^PRODUCT_ORDER commission level /i.test(raw)) return `${t('note_CommissionCredited')} · ${t('level')} ${raw.split(' ').pop()}`
  if (/^ANNUAL_FEE_/i.test(raw) && /self commission/i.test(raw)) return t('note_SelfCommissionCredited')
  if (/^ANNUAL_FEE_/i.test(raw) && /commission level /i.test(raw)) return `${t('note_CommissionCredited')} · ${t('level')} ${raw.split(' ').pop()}`
  const compressedCommission = raw.match(/^Commission credited to reward; compressed from level (\d+) to level (\d+)$/i)
  if (compressedCommission) return `${t('note_CommissionCompressed')} · ${t('level')} ${compressedCommission[2]} ← ${t('level')} ${compressedCommission[1]}`
  if (raw === 'Self commission credited to reward') return t('note_SelfCommissionCredited')
  if (raw === 'Sales Adviser inactive/expired; commission compressed to active upline') return t('note_SkippedCompressed')
  if (/^Forfeited commission from level /i.test(raw)) return `${t('note_ForfeitedCommission')} · ${t('level')} ${raw.split(' ').pop()}`
  if (raw === 'Company net after paid and forfeited commissions' || raw === 'Company net after paid commissions') return t('note_CompanyNet')
  if (raw === 'Admin manual Reward adjustment' || raw === 'Super Admin manual Reward adjustment') return t('note_AdminRewardAdjustment')
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function compressImageFile(file, maxSize = 900, quality = 0.66) {
  const raw = await readFileAsDataUrl(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = raw
    })
    const scale = Math.min(1, maxSize / Math.max(img.width || maxSize, img.height || maxSize))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round((img.width || maxSize) * scale))
    canvas.height = Math.max(1, Math.round((img.height || maxSize) * scale))
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return raw
  }
}

function mapsLink(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return ''
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`
}

function whatsappLink(phone, text = '') {
  const clean = String(phone || '').replace(/[^0-9]/g, '')
  if (!clean) return '#'
  const msg = text ? `?text=${encodeURIComponent(text)}` : ''
  return `https://wa.me/${clean}${msg}`
}

function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('LOCATION_NOT_SUPPORTED'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, locationAccuracy: pos.coords.accuracy }),
      () => reject(new Error('LOCATION_PERMISSION_DENIED')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
  })
}

const TAC_COOLDOWN_SECONDS = 180

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function runWhenIdle(fn, timeout = 5000) {
  if (typeof window === 'undefined') return
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(fn, { timeout })
  } else {
    window.setTimeout(fn, Math.min(timeout, 2500))
  }
}

function tacCooldownKey(value) {
  const email = String(value || '').trim().toLowerCase()
  return email ? `tac_cooldown_until:${email}` : ''
}

function getTacCooldownLeft(key) {
  if (!key) return 0
  const until = Number(localStorage.getItem(key) || 0)
  if (!until) return 0
  const left = Math.ceil((until - Date.now()) / 1000)
  if (left <= 0) {
    localStorage.removeItem(key)
    return 0
  }
  return left
}

function useTacCooldown(identifier, seconds = TAC_COOLDOWN_SECONDS) {
  const key = tacCooldownKey(identifier)
  const [left, setLeft] = useState(() => getTacCooldownLeft(key))

  useEffect(() => {
    setLeft(getTacCooldownLeft(key))
  }, [key])

  useEffect(() => {
    if (!key || left <= 0) return undefined
    const timer = window.setInterval(() => {
      setLeft(getTacCooldownLeft(key))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [key, left])

  function startCooldown(customSeconds = seconds) {
    if (!key) return
    const duration = Math.max(1, Number(customSeconds || seconds))
    localStorage.setItem(key, String(Date.now() + duration * 1000))
    setLeft(duration)
  }

  return [left, startCooldown]
}

function TacSendControl({ t, onSend, disabled = false, cooldownKey = '' }) {
  const [left, startCooldown] = useTacCooldown(cooldownKey)
  const [sending, setSending] = useState(false)
  const locked = disabled || sending || left > 0

  async function handleSend() {
    if (locked) return
    setSending(true)
    try {
      const result = await onSend?.()
      if (typeof result === 'number') startCooldown(result)
      else if (result && typeof result.cooldownSeconds === 'number') startCooldown(result.cooldownSeconds)
      else if (result !== false) startCooldown()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="tac-send-wrap">
      <Button variant={left > 0 ? 'cooldown' : 'secondary'} onClick={handleSend} disabled={locked}>
        {left > 0 ? `${left}s` : (sending ? `${t('sendTac')}...` : t('sendTac'))}
      </Button>
      {left > 0 && <span className="tac-countdown">{t('pleaseWait') || 'Please wait'}</span>}
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


function buildAdminWhatsappMessage(template, { amount, agentCode, agentName, fallbackTemplate }) {
  const base = String(template || fallbackTemplate || '')
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


const ADMIN_PERMISSION_KEYS = ['dashboard', 'agents', 'products', 'paymentProofs', 'commissionRules', 'reward', 'withdrawals', 'orders', 'reports']
const DEFAULT_LEADER_PERMISSIONS = ['dashboard', 'agents', 'products', 'paymentProofs', 'commissionRules', 'reward', 'withdrawals', 'orders', 'reports']
const REPORT_TYPES = ['orders', 'commissions', 'rewardLedger', 'withdrawals', 'salesAdvisers', 'companyLedger']

function hasAdminPermission(admin, key) {
  if (admin?.role === 'SUPER_ADMIN') return true
  if (['LEADER', 'SUB_ADMIN'].includes(admin?.role) && !ADMIN_PERMISSION_KEYS.includes(key)) return false
  return Array.isArray(admin?.permissions) && admin.permissions.includes(key)
}

function normalizeTab(tab) {
  return tab === 'teamManagement' ? 'teamManagement' : (tab === 'adminUsers' ? 'adminUsers' : tab)
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
      if (err.message === 'TAC_TOO_FREQUENT') {
        return { cooldownSeconds: err.data?.retryAfterSeconds || err.data?.details?.retryAfterSeconds || TAC_COOLDOWN_SECONDS }
      }
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
        <TacSendControl t={t} onSend={sendTac} disabled={!email} cooldownKey={email} />
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
      if (err.message === 'TAC_TOO_FREQUENT') {
        return { cooldownSeconds: err.data?.retryAfterSeconds || err.data?.details?.retryAfterSeconds || TAC_COOLDOWN_SECONDS }
      }
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
        <Field label={t('email')}><input required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <div className="row gap align-end">
          <Field label={t('tac')}><input required value={form.tac} onChange={(e) => setForm({ ...form, tac: e.target.value })} /></Field>
          <TacSendControl t={t} onSend={sendTac} disabled={!form.email} cooldownKey={form.email} />
        </div>
          <Field label={t('name')}><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={t('sponsorCode')}><input required value={form.sponsorCode} onChange={(e) => setForm({ ...form, sponsorCode: e.target.value.toUpperCase() })} placeholder={t('sponsorPlaceholder')} /></Field>
        <p className="muted small-text">{t('sponsorCodeRequiredHint')}</p>
        <Button onClick={register} disabled={!form.sponsorCode.trim()}>{t('register')}</Button>
      </Card>
    </Layout>
  )
}

function AdminApp({ lang, setLang, t }) {
  const [logged, setLogged] = useState(Boolean(localStorage.getItem('admin_token')))
  const [checking, setChecking] = useState(Boolean(localStorage.getItem('admin_token')))
  const [admin, setAdmin] = useState(() => {
    try { return JSON.parse(localStorage.getItem('admin_profile') || '{}') } catch { return {} }
  })

  const logout = () => {
    clearToken('admin')
    localStorage.removeItem('admin_profile')
    setAdmin({})
    setLogged(false)
    setChecking(false)
  }

  useEffect(() => {
    if (!logged) {
      setChecking(false)
      return undefined
    }
    let alive = true
    setChecking(true)
    api('/api/admin/me', {}, 'admin')
      .then((data) => {
        if (!alive) return
        const profile = data.admin || {}
        setAdmin(profile)
        localStorage.setItem('admin_profile', JSON.stringify(profile))
      })
      .catch(() => { if (alive) logout() })
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [logged])

  if (!logged) return <AdminLogin lang={lang} setLang={setLang} t={t} onLogin={(profile) => { setAdmin(profile || {}); setLogged(true) }} />
  if (checking && !admin?.id) return <Layout lang={lang} setLang={setLang} t={t}><Card>{t('loading')}...</Card></Layout>
  return <AdminDashboard lang={lang} setLang={setLang} t={t} admin={admin} onLogout={logout} />
}

function AdminDashboard({ lang, setLang, t, admin, onLogout }) {
  if (admin?.role === 'FULFILLMENT') {
    return <FulfillmentDashboard lang={lang} setLang={setLang} t={t} admin={admin} onLogout={onLogout} />
  }

  const isSuper = admin?.role === 'SUPER_ADMIN'
  const baseTabs = ['products', 'dashboard', 'teamManagement', 'commissionRules', 'reports', 'planters', 'orders', 'withdrawals', 'reward', 'harvestRequests']
  const tabs = baseTabs.filter((x) => x === 'teamManagement' ? (isSuper || admin?.role === 'LEADER' || hasAdminPermission(admin, 'agents')) : hasAdminPermission(admin, x))
  const [tab, setTab] = useState(() => tabs.includes('products') ? 'products' : (tabs[0] || ''))
  const [data, setData] = useState({})
  const dataRef = useRef({})
  const inflightRef = useRef({})
  const warmupStartedRef = useRef(false)
  const [loading, setLoading] = useState({})
  const [error, setError] = useState('')
  const [teamRefreshToken, setTeamRefreshToken] = useState(0)

  useEffect(() => { dataRef.current = data }, [data])

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
      reports: '/api/admin/reports/summary',
      harvestRequests: '/api/admin/harvest-requests',
      planters: '/api/admin/planters'
    }
    return `${map[key] || map.dashboard}${query}`
  }

  function scheduleAdminWarmup(currentKey = tab) {
    if (warmupStartedRef.current) return
    warmupStartedRef.current = true

    const preloadPlan = [
      { key: 'commissionRules', params: {} },
      { key: 'reports', params: {} },
      { key: 'dashboard', params: {} },
      { key: 'planters', params: { limit: 20 } },
      { key: 'orders', params: { limit: 20 } },
      { key: 'withdrawals', params: { limit: 20 } }
    ].filter((item) => item.key !== currentKey && tabs.includes(item.key) && hasAdminPermission(admin, item.key))

    runWhenIdle(async () => {
      await delay(1500)
      for (const item of preloadPlan) {
        if (!dataRef.current[item.key]) {
          await loadTab(item.key, item.params, false, { background: true }).catch(() => null)
        }
        await delay(800)
      }
    })
  }

  async function loadTab(key = tab, params = {}, force = false, options = {}) {
    if (!key) return null
    if (key === 'teamManagement') return null
    if (!hasAdminPermission(admin, key)) return null

    const hasParams = Boolean(Object.keys(params || {}).length)
    const requestKey = `${key}:${buildQuery(params)}`
    if (dataRef.current[key] && !force && !hasParams) return dataRef.current[key]
    if (inflightRef.current[requestKey] && !force) return inflightRef.current[requestKey]

    if (!options.background) setError('')
    setLoading((x) => ({ ...x, [key]: true }))

    const request = api(adminPathFor(key, params), {}, 'admin')
      .then((payload) => {
        setData((x) => {
          const next = { ...x, [key]: payload }
          dataRef.current = next
          return next
        })
        if (!options.background) scheduleAdminWarmup(key)
        return payload
      })
      .catch((err) => {
        if (!options.background) setError(err.message)
        if (err.message === 'UNAUTHORIZED') onLogout()
        throw err
      })
      .finally(() => {
        delete inflightRef.current[requestKey]
        setLoading((x) => ({ ...x, [key]: false }))
      })

    inflightRef.current[requestKey] = request
    return request
  }

  useEffect(() => { if (tab && tab !== 'teamManagement') loadTab(tab) }, [tab])
  useEffect(() => { if (!tabs.includes(tab)) setTab(tabs.includes('products') ? 'products' : (tabs[0] || '')) }, [admin?.permissions?.join(','), admin?.role])

  if (!tabs.length) {
    return (
      <Layout
        lang={lang}
        setLang={setLang}
        t={t}
        title={isSuper ? t('superAdminHq') : roleText(t, admin?.role || 'LEADER')}
        right={<Button variant="danger" onClick={onLogout}>{t('logout')}</Button>}
      >
        <Card>{t('noAdminPermission')}</Card>
      </Layout>
    )
  }

  const refreshActive = () => {
    if (tab === 'teamManagement') {
      setTeamRefreshToken((x) => x + 1)
      return
    }
    loadTab(tab, {}, true)
  }
  const currentData = data[tab]
  const isLoading = Boolean(loading[tab])

  return (
    <Layout
      lang={lang}
      setLang={setLang}
      t={t}
      title={isSuper ? t('superAdminHq') : roleText(t, admin?.role || 'LEADER')}
      right={<><Button variant="secondary" onClick={refreshActive}>{t('refresh')}</Button><Button variant="danger" onClick={onLogout}>{t('logout')}</Button></>}
      navTabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
    >
      <ErrorBox error={error} />
      <MobileTabs t={t} tabs={tabs} tab={tab} setTab={setTab} />
      {isLoading && !currentData ? <Card>{t('loading')}...</Card> : (
        <>
          {tab === 'dashboard' && currentData && <AdminHome t={t} data={currentData} isSuper={isSuper} />}
          {tab === 'teamManagement' && <AdminTeamManagement t={t} admin={admin} isSuper={isSuper} refreshToken={teamRefreshToken} />}
          {tab === 'products' && currentData && <AdminProducts t={t} products={currentData.products || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('products', params, true)} />}
          {tab === 'commissionRules' && currentData && <AdminRules t={t} rulesData={currentData} reload={(params = {}) => loadTab('commissionRules', params, true)} isSuper={isSuper} />}
          {tab === 'reward' && currentData && <AdminWallet t={t} wallet={currentData} pagination={currentData.pagination} reload={(params = {}) => loadTab('reward', params, true)} isSuper={isSuper} />}
          {tab === 'withdrawals' && currentData && <AdminWithdrawals t={t} withdrawals={currentData.withdrawals || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('withdrawals', params, true)} />}
          {tab === 'orders' && currentData && <AdminOrders t={t} orders={currentData.orders || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('orders', params, true)} />}
          {tab === 'planters' && currentData && <AdminPlanters t={t} planters={currentData.planters || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('planters', params, true)} />}
          {tab === 'harvestRequests' && currentData && <AdminHarvestRequests t={t} requests={currentData.requests || []} pagination={currentData.pagination} reload={(params = {}) => loadTab('harvestRequests', params, true)} />}
          {tab === 'reports' && currentData && <AdminReports t={t} summary={currentData} isSuper={isSuper} />}
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


function AdminTeamManagement({ t, admin, isSuper, refreshToken = 0 }) {
  const canManageAdminUsers = isSuper || admin?.role === 'LEADER'
  const canManageAgents = isSuper || hasAdminPermission(admin, 'agents')
  const innerTabs = [
    ...(canManageAdminUsers ? ['adminUsers'] : []),
    ...(canManageAgents ? ['agents', 'memberTree'] : [])
  ]
  const [innerTab, setInnerTab] = useState(innerTabs[0])
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadInner(key = innerTab, params = {}) {
    setError('')
    setLoading(true)
    try {
      const query = buildQuery(params)
      const map = {
        adminUsers: '/api/admin/admin-users',
        agents: '/api/admin/agents',
        memberTree: '/api/admin/member-tree'
      }
      const payload = await api(`${map[key]}${query}`, {}, 'admin')
      setData((x) => ({ ...x, [key]: payload }))
      return payload
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadInner(innerTab).catch(() => null) }, [innerTab])
  useEffect(() => { if (refreshToken > 0) loadInner(innerTab).catch(() => null) }, [refreshToken])
  useEffect(() => { if (!innerTabs.includes(innerTab)) setInnerTab(innerTabs[0]) }, [admin?.role])

  const current = data[innerTab]
  return (
    <>
      <Card>
        <div className="section-head">
          <div>
            <h3>{t('teamManagement')}</h3>
            <p className="muted">{t('teamManagementSubtitle')}</p>
          </div>
        </div>
        <MobileTabs t={t} tabs={innerTabs} tab={innerTab} setTab={setInnerTab} />
      </Card>
      <ErrorBox error={error} />
      {loading && !current ? <Card>{t('loading')}...</Card> : (
        <>
          {innerTab === 'adminUsers' && canManageAdminUsers && current && <AdminUsers t={t} admin={admin} admins={current.admins || []} pagination={current.pagination} reload={(params = {}) => loadInner('adminUsers', params)} />}
          {innerTab === 'agents' && current && <AdminAgents t={t} agents={current.agents || []} pagination={current.pagination} ownerOptions={current.ownerOptions || []} admin={admin} reload={(params = {}) => loadInner('agents', params)} />}
          {innerTab === 'memberTree' && current && <AdminMemberTree t={t} tree={current} reload={(params = {}) => loadInner('memberTree', params)} isSuper={isSuper} />}
        </>
      )}
    </>
  )
}

function buildMemberTree(agents = []) {
  const bySponsor = new Map()
  agents.forEach((agent) => {
    const key = agent.sponsorAgentId || 'ROOT'
    if (!bySponsor.has(key)) bySponsor.set(key, [])
    bySponsor.get(key).push(agent)
  })
  const sortRows = (rows) => [...rows].sort((a, b) => String(a.agentCode || '').localeCompare(String(b.agentCode || '')))
  function childrenOf(id) {
    return sortRows(bySponsor.get(id) || [])
  }
  return { roots: sortRows(bySponsor.get('ROOT') || []), childrenOf }
}

function AdminMemberTree({ t, tree, reload, isSuper }) {
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('ALL')
  const [selected, setSelected] = useState(null)
  const agents = tree.agents || []
  const ownerOptions = tree.ownerOptions || []
  const { roots, childrenOf } = buildMemberTree(agents)
  const selectedAgent = selected || agents[0] || null

  function runSearch(nextOwner = ownerFilter) {
    reload({ search, ownerAdminId: isSuper ? nextOwner : undefined })
  }

  function MemberNode({ agent, level = 0 }) {
    const children = childrenOf(agent.id)
    return (
      <div className="member-tree-node">
        <button type="button" className={`member-tree-row ${selectedAgent?.id === agent.id ? 'selected' : ''}`} onClick={() => setSelected(agent)}>
          <span className="member-indent" style={{ width: `${level * 22}px` }} />
          <span className="member-branch">{children.length ? '▾' : '•'}</span>
          <span className="member-name"><strong>{agent.agentCode}</strong> {agent.name}</span>
          <StatusBadge t={t} status={agent.status} />
        </button>
        {children.map((child) => <MemberNode key={child.id} agent={child} level={level + 1} />)}
      </div>
    )
  }

  return (
    <div className="team-tree-layout">
      <Card>
        <div className="section-head">
          <h3>{t('memberTree')}</h3>
          <div className="row gap wrap">
            {isSuper && <select value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); runSearch(e.target.value) }}>{ownerOptions.map((o) => <option key={o.id} value={o.id}>{ownerNameText(t, o.id, o.name)}</option>)}</select>}
            <SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch()} />
          </div>
        </div>
        <div className="member-tree-list">
          {roots.length ? roots.map((agent) => <MemberNode key={agent.id} agent={agent} />) : <Empty t={t} />}
        </div>
      </Card>
      <Card>
        <div className="section-head"><h3>{t('memberDetails')}</h3>{selectedAgent && <StatusBadge t={t} status={selectedAgent.status} />}</div>
        {selectedAgent ? (
          <>
            <div className="detail-grid">
              <span>{t('agentCode')}</span><strong>{selectedAgent.agentCode}</strong>
              <span>{t('name')}</span><strong>{selectedAgent.name}</strong>
              <span>{t('email')}</span><strong>{selectedAgent.email}</strong>
              <span>{t('phone')}</span><strong>{selectedAgent.phone || selectedAgent.profile?.phone || '-'}</strong>
              <span>{t('owner')}</span><strong>{ownerNameText(t, selectedAgent.ownerAdminId, selectedAgent.ownerName)}</strong>
              <span>{t('sponsor')}</span><strong>{selectedAgent.sponsor?.agentCode || '-'}</strong>
              <span>{t('balance')}</span><strong>{money(selectedAgent.balance)}</strong>
              <span>{t('annualFeeReminder')}</span><strong>{selectedAgent.annualFeeDaysLeft} {t('days')}</strong>
              <span>{t('createdAt')}</span><strong>{dateText(selectedAgent.createdAt)}</strong>
            </div>
            <div className="tree-note muted">{t('memberTreeNoStatsHint')}</div>
          </>
        ) : <Empty t={t} />}
      </Card>
    </div>
  )
}

function AdminUsers({ t, admin, admins, pagination, reload }) {
  const isSuper = admin?.role === 'SUPER_ADMIN'
  const defaultCreateRole = isSuper ? 'LEADER' : 'SUB_ADMIN'
  const roleOptions = isSuper ? ['LEADER', 'SUB_ADMIN', 'FULFILLMENT'] : ['SUB_ADMIN']
  const [search, setSearch] = useState('')
  const runSearch = (page = 1) => reload({ search, page })
  const [form, setForm] = useState({ code: '', password: '', name: '', role: defaultCreateRole, permissions: DEFAULT_LEADER_PERMISSIONS })
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
      setForm({ code: '', password: '', name: '', role: defaultCreateRole, permissions: DEFAULT_LEADER_PERMISSIONS })
      showSuccess(setNotice, t, 'saved')
      runSearch(1)
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
      runSearch(pageOf({ pagination }).page)
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
          <Field label={t('role')}><select key={`create-role-${roleOptions.join('-')}`} value={form.role} onChange={(e) => updateRole(e.target.value)}>{roleOptions.map((role) => <option key={role} value={role}>{roleText(t, role)}</option>)}</select></Field>
        </div>
        {['LEADER', 'SUB_ADMIN'].includes(form.role) && <PermissionChecklist t={t} value={form.permissions} onChange={(permissions) => setForm({ ...form, permissions })} />}
        <Button onClick={create}>{t('save')}</Button>
      </Card>
      <Card>
        <div className="section-head"><h3>{t('adminUsers')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
        <Table><thead><tr><th>{t('adminCode')}</th><th>{t('name')}</th><th>{t('role')}</th><th>{t('ownerScope')}</th><th>{t('downlineCount')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead><tbody>{admins.map((a) => {
          const actions = [
            { label: t('permissions'), variant: 'secondary', onClick: () => openPermissions(a), hidden: !['LEADER', 'SUB_ADMIN'].includes(a.role) },
            { label: t('changePassword'), variant: 'secondary', onClick: () => openPassword(a), hidden: a.role === 'SUPER_ADMIN' },
            { label: a.status === 'ACTIVE' ? t('hidden') : t('active'), onClick: () => setStatus(a.id, a.status === 'ACTIVE' ? 'HIDDEN' : 'ACTIVE'), hidden: a.role === 'SUPER_ADMIN' }
          ]
          return <tr key={a.id}><td>{a.code}</td><td>{a.name}</td><td>{roleText(t, a.role)}</td><td>{a.role === 'SUPER_ADMIN' ? t('hqOwner') : ownerNameText(t, a.scopeOwnerAdminId, a.scopeOwnerName || a.name)}</td><td>{a.downlineCount ?? 0}</td><td><StatusBadge t={t} status={a.status} /></td><td><ActionMenu t={t} actions={actions} /></td></tr>
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
  const [harvestRequests, setHarvestRequests] = useState([])
  const [harvestDetail, setHarvestDetail] = useState(null)
  const [harvestStatusForm, setHarvestStatusForm] = useState({ status: 'PENDING', adminRemark: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [shipModal, setShipModal] = useState(null)
  const [shipForm, setShipForm] = useState({ trackingNumber: '', courier: '', note: '' })

  async function load() {
    setError('')
    try {
      const [data, harvest] = await Promise.all([api('/api/fulfillment/orders', {}, 'admin'), api('/api/admin/harvest-requests', {}, 'admin')])
      setOrders(data.orders)
      setHarvestRequests(harvest.requests || [])
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



  async function openHarvestDetail(row) {
    try {
      const data = await api(`/api/admin/harvest-requests/${row.id}`, {}, 'admin')
      setHarvestDetail(data.request)
      setHarvestStatusForm({ status: data.request?.status || 'PENDING', adminRemark: data.request?.adminRemark || '' })
    } catch (err) { showError(setNotice, t, err) }
  }

  async function saveHarvestStatus() {
    if (!harvestDetail?.id) return
    try {
      await api(`/api/admin/harvest-requests/${harvestDetail.id}/status`, { method: 'PATCH', body: harvestStatusForm }, 'admin')
      setHarvestDetail(null)
      showSuccess(setNotice, t, 'saved')
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

      <Card>
        <h3>{t('harvestRequests')}</h3>
        <Table><thead><tr><th>{t('createdAt')}</th><th>{t('planter')}</th><th>{t('phone')}</th><th>{t('fruitType')}</th><th>{t('estimatedWeight')}</th><th>{t('location')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead><tbody>{harvestRequests.length ? harvestRequests.map((r) => {
          const map = mapsLink(r.latitude, r.longitude)
          return <tr key={r.id}><td>{dateText(r.createdAt)}</td><td>{r.planter?.name || '-'}</td><td>{r.phone || r.planter?.phone || '-'}</td><td>{r.fruitType || '-'}</td><td>{r.estimatedWeight} kg</td><td>{map ? <a href={map} target="_blank" rel="noreferrer">{t('openMap')}</a> : '-'}</td><td><StatusBadge t={t} status={r.status} /></td><td><ActionMenu t={t} actions={[{ label: t('view'), onClick: () => openHarvestDetail(r) }]} /></td></tr>
        }) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
      </Card>
      <CenterNotice open={Boolean(harvestDetail)} title={t('harvestRequestDetail')} type="info" onClose={() => setHarvestDetail(null)}>
        {harvestDetail && <div className="modal-form">
          <div className="detail-grid">
            <span>{t('planter')}</span><strong>{harvestDetail.planter?.name || '-'}</strong>
            <span>{t('phone')}</span><strong>{harvestDetail.phone || harvestDetail.planter?.phone || '-'}</strong>
            <span>{t('farmName')}</span><strong>{harvestDetail.planter?.farmName || '-'}</strong>
            <span>{t('fruitType')}</span><strong>{harvestDetail.fruitType || '-'}</strong>
            <span>{t('estimatedWeight')}</span><strong>{harvestDetail.estimatedWeight} kg</strong>
            <span>{t('location')}</span><strong>{harvestDetail.latitude}, {harvestDetail.longitude}</strong>
            <span>{t('notes')}</span><strong>{harvestDetail.notes || '-'}</strong>
          </div>
          <div className="row gap wrap">
            {mapsLink(harvestDetail.latitude, harvestDetail.longitude) && <a className="btn secondary" href={mapsLink(harvestDetail.latitude, harvestDetail.longitude)} target="_blank" rel="noreferrer">{t('openMap')}</a>}
            <a className="btn secondary" href={whatsappLink(harvestDetail.phone || harvestDetail.planter?.phone, `${t('harvestRequests')}: ${harvestDetail.fruitType}`)} target="_blank" rel="noreferrer">{t('whatsapp')}</a>
          </div>
          <HarvestPhotos t={t} photos={harvestDetail.photos || []} />
          <div className="form-grid small">
            <Field label={t('status')}><select value={harvestStatusForm.status} onChange={(e) => setHarvestStatusForm({ ...harvestStatusForm, status: e.target.value })}><option value="PENDING">{t('pending')}</option><option value="SCHEDULED">{t('scheduled')}</option><option value="COLLECTED">{t('collected')}</option><option value="REJECTED">{t('rejected')}</option></select></Field>
            <Field label={t('adminRemark')}><textarea value={harvestStatusForm.adminRemark} onChange={(e) => setHarvestStatusForm({ ...harvestStatusForm, adminRemark: e.target.value })} /></Field>
          </div>
          <div className="row gap"><Button onClick={saveHarvestStatus}>{t('save')}</Button><Button variant="secondary" onClick={() => setHarvestDetail(null)}>{t('cancel')}</Button></div>
        </div>}
      </CenterNotice>

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
        {isSuper && <StatCard label={t('pendingHarvestRequests')} value={s.pendingHarvestRequests || 0} />}
        <StatCard label={t('companyIncome')} value={money(s.totalCompanyIncome)} />
      </div>
      <Card>
        <h3>{t('commissionHistory')}</h3>
        <Table><tbody>{data.recentCommissions.length ? data.recentCommissions.map((r) => <tr key={r.id}><td>{generationText(t, r.generation)}</td><td>{sourceTypeText(t, r.sourceType)}</td><td>{money(r.amount)}</td><td><StatusBadge t={t} status={r.status} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
      </Card>
    </>
  )
}

function AdminAgents({ t, agents, pagination, ownerOptions = [], admin, reload }) {
  const isSuper = admin?.role === 'SUPER_ADMIN'
  const ownerCreateOptions = ownerOptions.filter((o) => o.id !== 'ALL')
  const defaultOwnerId = ownerCreateOptions[0]?.id || 'admin_super'
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ email: '', name: '', sponsorCode: '', ownerAdminId: defaultOwnerId })
  const [notice, setNotice] = useState(null)
  const [ownerFilter, setOwnerFilter] = useState('ALL')
  const [creditModal, setCreditModal] = useState(null)
  const [creditForm, setCreditForm] = useState({ amount: '', note: '' })
  const rows = agents
  const runSearch = (page = 1, nextOwner = ownerFilter) => reload({ search, page, ownerAdminId: isSuper ? nextOwner : undefined })

  async function createSalesAdviser() {
    try {
      await api('/api/admin/agents', { method: 'POST', body: form }, 'admin')
      setForm({ email: '', name: '', sponsorCode: '', ownerAdminId: defaultOwnerId })
      showSuccess(setNotice, t, 'saved')
      runSearch(1)
    } catch (err) { showError(setNotice, t, err) }
  }

  async function setStatus(id, status) {
    try {
      await api(`/api/admin/agents/${id}/status`, { method: 'PATCH', body: { status } }, 'admin')
      showSuccess(setNotice, t, 'saved')
      runSearch(pageOf({ pagination }).page)
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
      runSearch(pageOf({ pagination }).page)
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
          {isSuper && <Field label={t('ownerScope')}><select value={form.ownerAdminId} onChange={(e) => setForm({ ...form, ownerAdminId: e.target.value })}>{ownerCreateOptions.map((o) => <option key={o.id} value={o.id}>{ownerNameText(t, o.id, o.name)}</option>)}</select></Field>}
        </div>
        <Button onClick={createSalesAdviser}>{t('save')}</Button>
      </Card>
      <Card>
        <div className="section-head"><h3>{t('agents')}</h3><div className="row gap wrap">{isSuper && <select value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); runSearch(1, e.target.value) }}>{ownerOptions.map((o) => <option key={o.id} value={o.id}>{ownerNameText(t, o.id, o.name)}</option>)}</select>}<SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div></div>
        <Table>
          <thead><tr><th>{t('agentCode')}</th><th>{t('name')}</th><th>{t('email')}</th><th>{t('phone')}</th><th>{t('owner')}</th><th>{t('sponsor')}</th><th>{t('balance')}</th><th>{t('annualFeeReminder')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((a) => (
              <tr key={a.id}>
                <td>{a.agentCode}</td><td>{a.name}</td><td>{a.email}</td><td>{a.phone || a.profile?.phone || '-'}</td><td>{ownerNameText(t, a.ownerAdminId, a.ownerName)}</td><td>{a.sponsor?.agentCode || '-'}</td><td>{money(a.balance)}</td><td>{a.annualFeeDaysLeft} {t('days')}</td><td><StatusBadge t={t} status={a.status} /></td>
                <td><ActionMenu t={t} actions={[{ label: t('addRewardCredit'), onClick: () => openCreditModal(a) }, { label: t('active'), onClick: () => setStatus(a.id, 'ACTIVE') }, { label: t('frozen'), onClick: () => setStatus(a.id, 'FROZEN') }]} /></td>
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
  const ownerOptions = Array.isArray(rulesData.ownerOptions) && rulesData.ownerOptions.length ? rulesData.ownerOptions : [{ id: rulesData.ownerAdminId || 'admin_super', name: t('hqOwner') }]
  const [selectedOwnerId, setSelectedOwnerId] = useState(rulesData.ownerAdminId || 'admin_super')
  const [product, setProduct] = useState(rulesData.rules.product)
  const [annualFee, setAnnualFee] = useState(rulesData.rules.annualFee)
  const [annualFeeAmount, setAnnualFeeAmount] = useState(adminContact.annualFeeAmount ?? rulesData.annualFeeAmount ?? '')
  const [adminWhatsapp, setAdminWhatsapp] = useState(adminContact.whatsapp || '')
  const [whatsappText, setWhatsappText] = useState(adminContact.whatsappText || '')
  const [paymentInstructions, setPaymentInstructions] = useState(adminContact.paymentInstructions || '')
  const [paymentQrImage, setPaymentQrImage] = useState(adminContact.paymentQrImage || '')
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    const contact = rulesData.adminContact || {}
    setSelectedOwnerId(rulesData.ownerAdminId || 'admin_super')
    setProduct(rulesData.rules.product)
    setAnnualFee(rulesData.rules.annualFee)
    setAnnualFeeAmount(contact.annualFeeAmount ?? rulesData.annualFeeAmount ?? '')
    setAdminWhatsapp(contact.whatsapp || '')
    setWhatsappText(contact.whatsappText || '')
    setPaymentInstructions(contact.paymentInstructions || '')
    setPaymentQrImage(contact.paymentQrImage || '')
  }, [rulesData.ownerAdminId])

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
        body: { ownerAdminId: selectedOwnerId, product, annualFee, annualFeeAmount, adminWhatsapp, whatsappText, paymentInstructions, paymentQrImage }
      }, 'admin')
      showSuccess(setNotice, t, 'saved')
      reload({ ownerAdminId: selectedOwnerId })
    } catch (err) { showError(setNotice, t, err) }
  }


  const editor = (title, kind, list) => (
    <div>
      <h4>{title}</h4>
      <Table><thead><tr><th>{t('generation')}</th><th>{t('type')}</th><th>{t('value')}</th></tr></thead><tbody>{list.map((r, idx) => <tr key={r.generation}><td>{generationText(t, r.generation)}</td><td><select value={r.type} onChange={(e) => updateRule(kind, idx, { type: e.target.value })}><option value="percent">{t('percent')}</option><option value="amount">{t('fixedAmount')}</option></select></td><td><input type="number" value={r.value} onChange={(e) => updateRule(kind, idx, { value: e.target.value })} /></td></tr>)}</tbody></Table>
    </div>
  )

  return (
    <Card>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <div className="section-head"><h3>{t('commissionRules')}</h3><div className="row gap"><Button onClick={save}>{t('save')}</Button></div></div>
      <div className="notice">{t('adminContactSettingsHint')}</div>
      <div className="notice">{t('autoRenewalCronHint')}</div>
      <div className="form-grid small">
        {isSuper && <Field label={t('editAdminSettingsFor')}><select value={selectedOwnerId} onChange={(e) => { setSelectedOwnerId(e.target.value); reload({ ownerAdminId: e.target.value }) }}>{ownerOptions.map((o) => <option key={o.id} value={o.id}>{ownerNameText(t, o.id, o.name)}</option>)}</select></Field>}
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

function AdminWallet({ t, wallet, pagination, reload, isSuper = false }) {
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


function AdminPlanters({ t, planters = [], pagination, reload }) {
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState(null)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', password: '', farmName: '', farmAddress: '', status: 'ACTIVE' })
  const runSearch = (page = 1) => reload({ search, page })

  function resetForm() {
    setForm({ name: '', phone: '', password: '', farmName: '', farmAddress: '', status: 'ACTIVE' })
  }

  function openCreate() {
    resetForm()
    setModal({ mode: 'create', row: null })
  }

  function openEdit(row) {
    setForm({
      name: row.name || '',
      phone: row.phone || '',
      password: '',
      farmName: row.farmName || '',
      farmAddress: row.farmAddress || '',
      status: row.status || 'ACTIVE'
    })
    setModal({ mode: 'edit', row })
  }

  async function savePlanter() {
    try {
      if (modal?.mode === 'edit' && modal?.row?.id) {
        const body = { ...form }
        if (!body.password) delete body.password
        await api(`/api/admin/planters/${modal.row.id}`, { method: 'PATCH', body }, 'admin')
      } else {
        await api('/api/admin/planters', { method: 'POST', body: form }, 'admin')
      }
      setModal(null)
      resetForm()
      showSuccess(setNotice, t, 'saved')
      runSearch(pageOf({ pagination }).page)
    } catch (err) { showError(setNotice, t, err) }
  }

  async function setPlanterStatus(row, status) {
    try {
      await api(`/api/admin/planters/${row.id}`, { method: 'PATCH', body: { ...row, status } }, 'admin')
      showSuccess(setNotice, t, 'saved')
      runSearch(pageOf({ pagination }).page)
    } catch (err) { showError(setNotice, t, err) }
  }

  async function deletePlanter(row) {
    if (!window.confirm(t('confirmDeletePlanter'))) return
    try {
      await api(`/api/admin/planters/${row.id}`, { method: 'DELETE' }, 'admin')
      showSuccess(setNotice, t, 'deletedSuccess')
      runSearch(pageOf({ pagination }).page)
    } catch (err) { showError(setNotice, t, err) }
  }

  return (
    <>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <Card>
        <div className="section-head"><h3>{t('planterManagement')}</h3><div className="row gap wrap"><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /><Button onClick={openCreate}>{t('createPlanter')}</Button></div></div>
        <Table><thead><tr><th>{t('planterId')}</th><th>{t('name')}</th><th>{t('phone')}</th><th>{t('farmName')}</th><th>{t('farmAddress')}</th><th>{t('harvestRequests')}</th><th>{t('status')}</th><th>{t('createdAt')}</th><th>{t('action')}</th></tr></thead><tbody>{planters.length ? planters.map((p) => <tr key={p.id}><td>{p.id}</td><td>{p.name || '-'}</td><td>{p.phone || '-'}</td><td>{p.farmName || '-'}</td><td>{p.farmAddress || '-'}</td><td>{p.harvestRequestCount || 0}</td><td><StatusBadge t={t} status={p.status} /></td><td>{dateText(p.createdAt)}</td><td><ActionMenu t={t} actions={[{ label: t('edit'), onClick: () => openEdit(p) }, { label: p.status === 'ACTIVE' ? t('disable') : t('enable'), onClick: () => setPlanterStatus(p, p.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE') }, { label: t('delete'), variant: 'danger', onClick: () => deletePlanter(p) }]} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
        <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
      </Card>
      <CenterNotice open={Boolean(modal)} title={modal?.mode === 'edit' ? t('editPlanter') : t('createPlanter')} type="info" onClose={() => setModal(null)}>
        <div className="modal-form">
          <div className="form-grid">
            <Field label={t('name')}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={t('phone')}><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={modal?.mode === 'edit' ? t('newPasswordOptional') : t('password')}><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label={t('farmName')}><input value={form.farmName} onChange={(e) => setForm({ ...form, farmName: e.target.value })} /></Field>
            <Field label={t('farmAddress')}><input value={form.farmAddress} onChange={(e) => setForm({ ...form, farmAddress: e.target.value })} /></Field>
            <Field label={t('status')}><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="ACTIVE">{t('active')}</option><option value="DISABLED">{t('disabled')}</option></select></Field>
          </div>
          <p className="muted small-text">{modal?.mode === 'edit' ? t('planterPasswordEditHint') : t('planterPasswordCreateHint')}</p>
          <div className="row gap"><Button onClick={savePlanter}>{t('save')}</Button><Button variant="secondary" onClick={() => setModal(null)}>{t('cancel')}</Button></div>
        </div>
      </CenterNotice>
    </>
  )
}

function HarvestPhotos({ t, photos = [] }) {
  const list = Array.isArray(photos) ? photos : []
  if (!list.length) return <Empty t={t} />
  return <div className="photo-grid">{list.map((src, idx) => <a key={idx} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`${t('photo')} ${idx + 1}`} /></a>)}</div>
}

function AdminHarvestRequests({ t, requests = [], pagination, reload }) {
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState(null)
  const [detail, setDetail] = useState(null)
  const [statusForm, setStatusForm] = useState({ status: 'PENDING', adminRemark: '' })
  const runSearch = (page = 1) => reload({ search, page })

  async function openDetail(row) {
    try {
      const data = await api(`/api/admin/harvest-requests/${row.id}`, {}, 'admin')
      setDetail(data.request)
      setStatusForm({ status: data.request?.status || 'PENDING', adminRemark: data.request?.adminRemark || '' })
    } catch (err) { showError(setNotice, t, err) }
  }

  async function saveStatus() {
    if (!detail?.id) return
    try {
      await api(`/api/admin/harvest-requests/${detail.id}/status`, { method: 'PATCH', body: statusForm }, 'admin')
      showSuccess(setNotice, t, 'saved')
      const data = await api(`/api/admin/harvest-requests/${detail.id}`, {}, 'admin')
      setDetail(data.request)
      runSearch(pageOf({ pagination }).page)
    } catch (err) { showError(setNotice, t, err) }
  }

  return (
    <>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <Card>
        <div className="section-head"><h3>{t('harvestRequests')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => runSearch(1)} /></div>
        <Table><thead><tr><th>{t('createdAt')}</th><th>{t('planter')}</th><th>{t('phone')}</th><th>{t('fruitType')}</th><th>{t('estimatedWeight')}</th><th>{t('maturityStatus')}</th><th>{t('location')}</th><th>{t('status')}</th><th>{t('action')}</th></tr></thead><tbody>{requests.length ? requests.map((r) => {
          const map = mapsLink(r.latitude, r.longitude)
          return <tr key={r.id}><td>{dateText(r.createdAt)}</td><td>{r.planter?.name || '-'}</td><td>{r.phone || r.planter?.phone || '-'}</td><td>{r.fruitType || '-'}</td><td>{r.estimatedWeight} kg</td><td>{r.maturityStatus || '-'}</td><td>{map ? <a href={map} target="_blank" rel="noreferrer">{t('openMap')}</a> : '-'}</td><td><StatusBadge t={t} status={r.status} /></td><td><ActionMenu t={t} actions={[{ label: t('view'), onClick: () => openDetail(r) }]} /></td></tr>
        }) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
        <PaginationControls t={t} pagination={pagination} onPage={runSearch} />
      </Card>
      <CenterNotice open={Boolean(detail)} title={t('harvestRequestDetail')} type="info" onClose={() => setDetail(null)}>
        {detail && <div className="modal-form">
          <div className="detail-grid">
            <span>{t('planter')}</span><strong>{detail.planter?.name || '-'}</strong>
            <span>{t('farmName')}</span><strong>{detail.planter?.farmName || '-'}</strong>
            <span>{t('farmAddress')}</span><strong>{detail.planter?.farmAddress || '-'}</strong>
            <span>{t('phone')}</span><strong>{detail.phone || detail.planter?.phone || '-'}</strong>
            <span>{t('fruitType')}</span><strong>{detail.fruitType || '-'}</strong>
            <span>{t('estimatedWeight')}</span><strong>{detail.estimatedWeight} kg</strong>
            <span>{t('maturityStatus')}</span><strong>{detail.maturityStatus || '-'}</strong>
            <span>{t('location')}</span><strong>{detail.latitude}, {detail.longitude} {detail.locationAccuracy ? `±${Math.round(detail.locationAccuracy)}m` : ''}</strong>
            <span>{t('notes')}</span><strong>{detail.notes || '-'}</strong>
          </div>
          <div className="row gap wrap">
            {mapsLink(detail.latitude, detail.longitude) && <a className="btn secondary" href={mapsLink(detail.latitude, detail.longitude)} target="_blank" rel="noreferrer">{t('openMap')}</a>}
            <a className="btn secondary" href={whatsappLink(detail.phone || detail.planter?.phone, `${t('harvestRequests')}: ${detail.fruitType}`)} target="_blank" rel="noreferrer">{t('whatsapp')}</a>
          </div>
          <HarvestPhotos t={t} photos={detail.photos || []} />
          <div className="form-grid small">
            <Field label={t('status')}><select value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}><option value="PENDING">{t('pending')}</option><option value="SCHEDULED">{t('scheduled')}</option><option value="COLLECTED">{t('collected')}</option><option value="REJECTED">{t('rejected')}</option></select></Field>
            <Field label={t('adminRemark')}><textarea value={statusForm.adminRemark} onChange={(e) => setStatusForm({ ...statusForm, adminRemark: e.target.value })} /></Field>
          </div>
          <div className="row gap"><Button onClick={saveStatus}>{t('save')}</Button><Button variant="secondary" onClick={() => setDetail(null)}>{t('cancel')}</Button></div>
        </div>}
      </CenterNotice>
    </>
  )
}

function AdminReports({ t, summary, isSuper = false }) {
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


function PlanterAuth({ lang, setLang, t, onLogin }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ phone: '', password: '', name: '', farmName: '', farmAddress: '' })
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    try {
      const path = mode === 'register' ? '/api/auth/planter-register' : '/api/auth/planter-login'
      const data = await api(path, { method: 'POST', body: form })
      setToken('planter', data.token)
      onLogin(data.planter)
    } catch (err) { setError(readableError(t, err)) }
  }

  return (
    <Layout lang={lang} setLang={setLang} t={t} title={t('planterLogin')} right={<a className="btn secondary" href="/">{t('home')}</a>}>
      <Card className="narrow">
        <div className="tabs compact-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>{t('login')}</button><button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>{t('registerPlanter')}</button></div>
        <ErrorBox error={error} />
        {mode === 'register' && <Field label={t('name')}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>}
        <Field label={t('phone')}><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="60123456789" /></Field>
        <Field label={t('password')}><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        {mode === 'register' && <>
          <Field label={t('farmName')}><input value={form.farmName} onChange={(e) => setForm({ ...form, farmName: e.target.value })} /></Field>
          <Field label={t('farmAddress')}><textarea value={form.farmAddress} onChange={(e) => setForm({ ...form, farmAddress: e.target.value })} /></Field>
          <p className="muted small-text">{t('planterRegisterHint')}</p>
        </>}
        <Button onClick={submit}>{mode === 'register' ? t('register') : t('login')}</Button>
      </Card>
    </Layout>
  )
}

function PlanterApp({ lang, setLang, t }) {
  const [logged, setLogged] = useState(Boolean(localStorage.getItem('planter_token')))
  const [planter, setPlanter] = useState(null)
  const logout = () => { clearToken('planter'); setLogged(false); setPlanter(null) }
  useEffect(() => {
    if (!logged) return undefined
    let alive = true
    api('/api/planter/me', {}, 'planter')
      .then((data) => { if (alive) setPlanter(data.planter) })
      .catch(() => { if (alive) logout() })
    return () => { alive = false }
  }, [logged])
  if (!logged) return <PlanterAuth lang={lang} setLang={setLang} t={t} onLogin={(p) => { setPlanter(p); setLogged(true) }} />
  return <PlanterDashboard lang={lang} setLang={setLang} t={t} planter={planter} onLogout={logout} />
}

function PlanterDashboard({ lang, setLang, t, planter, onLogout }) {
  const [requests, setRequests] = useState([])
  const [pagination, setPagination] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)
  const [profile, setProfile] = useState({ name: '', farmName: '', farmAddress: '' })
  const [form, setForm] = useState({ fruitType: '', estimatedWeight: '', maturityStatus: '', notes: '', phone: '' })
  const [photos, setPhotos] = useState([])
  const [location, setLocation] = useState(null)

  useEffect(() => {
    if (!planter) return
    setProfile({ name: planter.name || '', farmName: planter.farmName || '', farmAddress: planter.farmAddress || '' })
    setForm((x) => ({ ...x, phone: x.phone || planter.phone || '' }))
  }, [planter?.id])

  async function load(page = 1) {
    setLoading(true)
    try {
      const data = await api(`/api/planter/harvest-requests${buildQuery({ search, page })}`, {}, 'planter')
      setRequests(data.requests || [])
      setPagination(data.pagination)
    } catch (err) { showError(setNotice, t, err) }
    finally { setLoading(false) }
  }

  useEffect(() => { load(1) }, [])

  async function pickPhotos(files) {
    const selected = Array.from(files || []).slice(0, 5 - photos.length)
    if (!selected.length) return
    try {
      const next = await Promise.all(selected.map((file) => compressImageFile(file)))
      setPhotos((x) => [...x, ...next].slice(0, 5))
    } catch (err) { setNotice({ title: t('operationFailed'), message: readableError(t, err), type: 'danger' }) }
  }

  async function detectLocation() {
    try {
      const loc = await getBrowserLocation()
      setLocation(loc)
      setNotice({ title: t('success'), message: t('locationCaptured'), type: 'success' })
      return loc
    } catch (err) {
      setNotice({ title: t('operationFailed'), message: t(err.message || 'LOCATION_PERMISSION_DENIED'), type: 'danger' })
      throw err
    }
  }

  async function submitHarvest() {
    try {
      const loc = location || await detectLocation()
      await api('/api/planter/harvest-requests', { method: 'POST', body: { ...form, ...loc, photos } }, 'planter')
      setForm({ fruitType: '', estimatedWeight: '', maturityStatus: '', notes: '', phone: planter?.phone || '' })
      setPhotos([])
      setLocation(null)
      showSuccess(setNotice, t, 'harvestSubmitted')
      load(1)
    } catch (err) {
      if (!String(err.message || '').startsWith('LOCATION_')) showError(setNotice, t, err)
    }
  }

  async function saveProfile() {
    try {
      await api('/api/planter/profile', { method: 'PATCH', body: profile }, 'planter')
      showSuccess(setNotice, t, 'saved')
    } catch (err) { showError(setNotice, t, err) }
  }

  const map = location ? mapsLink(location.latitude, location.longitude) : ''
  return (
    <Layout lang={lang} setLang={setLang} t={t} title={t('planterPortal')} subtitle={t('planterPortalSubtitle')} right={<><Button variant="secondary" onClick={() => load(1)}>{t('refresh')}</Button><Button variant="danger" onClick={onLogout}>{t('logout')}</Button></>}>
      <CenterNotice open={Boolean(notice)} title={notice?.title} message={notice?.message} type={notice?.type} onClose={() => setNotice(null)} />
      <div className="two-col">
        <Card>
          <h3>{t('newHarvestRequest')}</h3>
          <p className="muted">{t('harvestGpsHint')}</p>
          <div className="form-grid small">
            <Field label={t('fruitType')}><input value={form.fruitType} onChange={(e) => setForm({ ...form, fruitType: e.target.value })} placeholder={t('fruitTypePlaceholder')} /></Field>
            <Field label={t('estimatedWeight')}><input type="number" min="0" value={form.estimatedWeight} onChange={(e) => setForm({ ...form, estimatedWeight: e.target.value })} /></Field>
            <Field label={t('maturityStatus')}><input value={form.maturityStatus} onChange={(e) => setForm({ ...form, maturityStatus: e.target.value })} placeholder={t('maturityPlaceholder')} /></Field>
            <Field label={t('phone')}><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={t('notes')}><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <Field label={t('harvestPhotos')}><input type="file" accept="image/*" multiple onChange={(e) => pickPhotos(e.target.files)} /></Field>
          </div>
          <HarvestPhotos t={t} photos={photos} />
          {photos.length > 0 && <Button variant="secondary" onClick={() => setPhotos([])}>{t('removePhotos')}</Button>}
          <div className="location-card">
            <strong>{t('location')}</strong>
            {location ? <span>{Number(location.latitude).toFixed(6)}, {Number(location.longitude).toFixed(6)} · ±{Math.round(location.locationAccuracy || 0)}m</span> : <span className="muted">{t('locationNotCaptured')}</span>}
            <div className="row gap wrap"><Button variant="secondary" onClick={detectLocation}>{t('detectLocation')}</Button>{map && <a className="btn secondary" href={map} target="_blank" rel="noreferrer">{t('openMap')}</a>}</div>
          </div>
          <Button onClick={submitHarvest}>{t('submitHarvestRequest')}</Button>
        </Card>
        <Card>
          <h3>{t('planterProfile')}</h3>
          <div className="form-grid small">
            <Field label={t('name')}><input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
            <Field label={t('farmName')}><input value={profile.farmName} onChange={(e) => setProfile({ ...profile, farmName: e.target.value })} /></Field>
            <Field label={t('farmAddress')}><textarea value={profile.farmAddress} onChange={(e) => setProfile({ ...profile, farmAddress: e.target.value })} /></Field>
          </div>
          <Button onClick={saveProfile}>{t('save')}</Button>
        </Card>
      </div>
      <Card>
        <div className="section-head"><h3>{t('myHarvestRequests')}</h3><SearchBar t={t} value={search} onChange={setSearch} onSearch={() => load(1)} /></div>
        {loading ? <p className="muted">{t('loading')}...</p> : <Table><thead><tr><th>{t('createdAt')}</th><th>{t('fruitType')}</th><th>{t('estimatedWeight')}</th><th>{t('maturityStatus')}</th><th>{t('status')}</th><th>{t('adminRemark')}</th><th>{t('photos')}</th></tr></thead><tbody>{requests.length ? requests.map((r) => <tr key={r.id}><td>{dateText(r.createdAt)}</td><td>{r.fruitType}</td><td>{r.estimatedWeight} kg</td><td>{r.maturityStatus || '-'}</td><td><StatusBadge t={t} status={r.status} /></td><td>{r.adminRemark || '-'}</td><td><HarvestPhotos t={t} photos={r.photos || []} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>}
        <PaginationControls t={t} pagination={pagination} onPage={load} />
      </Card>
    </Layout>
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
  const tabs = ['products', 'dashboard', 'profile', 'orders', 'reward', 'withdrawals', 'team']
  const [tab, setTab] = useState('products')
  const [data, setData] = useState({})
  const dataRef = useRef({})
  const inflightRef = useRef({})
  const meInflightRef = useRef(null)
  const warmupStartedRef = useRef(false)
  const [loading, setLoading] = useState({})
  const [error, setError] = useState('')
  const [teamRefreshToken, setTeamRefreshToken] = useState(0)

  useEffect(() => { dataRef.current = data }, [data])

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
    if (dataRef.current.me && !force) return dataRef.current.me
    if (meInflightRef.current && !force) return meInflightRef.current
    const request = api(agentPathFor('me'), {}, 'agent')
      .then((me) => {
        setData((x) => {
          const next = { ...x, me }
          dataRef.current = next
          return next
        })
        return me
      })
      .finally(() => { meInflightRef.current = null })
    meInflightRef.current = request
    return request
  }

  function scheduleAgentWarmup(currentKey = tab) {
    if (warmupStartedRef.current) return
    warmupStartedRef.current = true

    const preloadPlan = [
      { key: 'dashboard', params: {} },
      { key: 'profile', params: {} },
      { key: 'orders', params: { limit: 20 } },
      { key: 'reward', params: {} },
      { key: 'withdrawals', params: { limit: 20 } },
      { key: 'team', params: {} }
    ].filter((item) => item.key !== currentKey && tabs.includes(item.key))

    runWhenIdle(async () => {
      await delay(1500)
      for (const item of preloadPlan) {
        if (!dataRef.current[item.key]) {
          await loadTab(item.key, item.params, false, { background: true }).catch(() => null)
        }
        await delay(800)
      }
    })
  }

  async function loadTab(key = tab, params = {}, force = false, options = {}) {
    const hasParams = Boolean(Object.keys(params || {}).length)
    const requestKey = `${key}:${buildQuery(params)}`
    if (dataRef.current[key] && !force && !hasParams) return dataRef.current[key]
    if (inflightRef.current[requestKey] && !force) return inflightRef.current[requestKey]

    if (!options.background) setError('')
    setLoading((x) => ({ ...x, [key]: true }))

    const request = (async () => {
      const needsMe = ['dashboard', 'profile', 'team', 'products', 'reward', 'withdrawals'].includes(key)
      const mePayload = needsMe ? await loadMe(force && ['dashboard', 'profile'].includes(key)) : dataRef.current.me
      const payload = key === 'dashboard' || key === 'profile'
        ? mePayload
        : await api(agentPathFor(key, params), {}, 'agent')

      setData((x) => {
        const next = key === 'dashboard' || key === 'profile'
          ? { ...x, me: payload, [key]: payload }
          : { ...x, [key]: payload }
        dataRef.current = next
        return next
      })
      if (!options.background) scheduleAgentWarmup(key)
      return payload
    })()
      .catch((err) => {
        if (!options.background) setError(err.message)
        if (err.message === 'UNAUTHORIZED') onLogout()
        throw err
      })
      .finally(() => {
        delete inflightRef.current[requestKey]
        setLoading((x) => ({ ...x, [key]: false }))
      })

    inflightRef.current[requestKey] = request
    return request
  }

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
  const whatsappMessage = buildAdminWhatsappMessage(adminContact.whatsappText, { amount: annualFeeAmount, agentCode: agent.agentCode, agentName: agent.name, fallbackTemplate: t('defaultAnnualFeeWhatsappText') })
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
        <Table><thead><tr><th>{t('sku')}</th><th>{t('productName')}</th><th>{t('description')}</th><th>{t('price')}</th></tr></thead><tbody>{products.length ? products.map((p) => <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.description}</td><td>{money(p.price)}</td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table>
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
        <Card><h3>{t('commissionHistory')}</h3><Table><tbody>{commissions.length ? commissions.map((c) => <tr key={c.id}><td>{generationText(t, c.generation)}</td><td>{sourceTypeText(t, c.sourceType)}</td><td>{money(c.amount)}</td><td><StatusBadge t={t} status={c.status} /></td></tr>) : <tr><td><Empty t={t} /></td></tr>}</tbody></Table></Card>
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
  if (route.startsWith('/planter')) return <PlanterApp lang={lang} setLang={setLang} t={t} />
  if (route.startsWith('/agent')) return <AgentApp lang={lang} setLang={setLang} t={t} />
  if (route.startsWith('/register')) return <Register lang={lang} setLang={setLang} t={t} />
  return <Landing lang={lang} setLang={setLang} t={t} />
}

createRoot(document.getElementById('root')).render(<App />)
