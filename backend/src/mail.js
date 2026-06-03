import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { query, uid } from './db.js'

const PEPPER = process.env.OTP_PEPPER || process.env.JWT_SECRET || 'change-me'

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function makeTac() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export function hashTac(email, tac) {
  return crypto.createHash('sha256').update(`${normalizeEmail(email)}:${tac}:${PEPPER}`).digest('hex')
}

export async function createOtp(email, purpose = 'LOGIN_REGISTER') {
  const clean = normalizeEmail(email)
  if (!clean || !clean.includes('@')) throw new Error('INVALID_EMAIL')

  const recent = await query(
    `SELECT created_at FROM otp_codes WHERE email=$1 AND created_at > NOW() - INTERVAL '600 seconds' ORDER BY created_at DESC LIMIT 1`,
    [clean]
  )
  if (recent.rowCount) throw new Error('TAC_TOO_FREQUENT')

  const tac = makeTac()
  const expiresMinutes = Number(process.env.OTP_EXPIRES_MINUTES || 10)
  await query(
    `INSERT INTO otp_codes (id, email, tac_hash, purpose, expires_at)
     VALUES ($1,$2,$3,$4,NOW() + ($5 || ' minutes')::interval)`,
    [uid('otp'), clean, hashTac(clean, tac), purpose, String(expiresMinutes)]
  )
  await sendTacEmail(clean, tac, expiresMinutes)
  return { email: clean, devTac: process.env.NODE_ENV === 'production' ? undefined : tac }
}

export async function verifyOtp(email, tac, purpose = 'LOGIN_REGISTER') {
  const clean = normalizeEmail(email)
  const code = String(tac || '').trim()
  if (!clean || !code) throw new Error('INVALID_TAC')
  const res = await query(
    `SELECT * FROM otp_codes
     WHERE email=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [clean, purpose]
  )
  const row = res.rows[0]
  if (!row) throw new Error('TAC_EXPIRED_OR_NOT_FOUND')
  if (Number(row.attempt_count || 0) >= 5) throw new Error('TAC_TOO_MANY_ATTEMPTS')

  const ok = row.tac_hash === hashTac(clean, code)
  if (!ok) {
    await query('UPDATE otp_codes SET attempt_count = attempt_count + 1 WHERE id=$1', [row.id])
    throw new Error('INVALID_TAC')
  }
  await query('UPDATE otp_codes SET used_at=NOW() WHERE id=$1', [row.id])
  return true
}

async function sendTacEmail(email, tac, expiresMinutes) {
  if (!process.env.SMTP_HOST && !process.env.RESEND_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('SMTP_HOST/RESEND_API_KEY missing. TAC email not sent.')
    } else {
      console.log(`DEV TAC for ${email}: ${tac}`)
    }
    return
  }

  if (process.env.RESEND_API_KEY) {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'no-reply@example.com',
        to: [email],
        subject: 'Your TAC Code',
        html: `<p>Your TAC code is <strong>${tac}</strong>.</p><p>It expires in ${expiresMinutes} minutes.</p>`
      })
    })
    if (!resp.ok) throw new Error('EMAIL_SEND_FAILED')
    return
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  })
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Your TAC Code',
    html: `<p>Your TAC code is <strong>${tac}</strong>.</p><p>It expires in ${expiresMinutes} minutes.</p>`
  })
}
