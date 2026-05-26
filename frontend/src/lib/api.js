export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001'

export function getToken(kind) {
  return localStorage.getItem(`${kind}_token`)
}

export function setToken(kind, token) {
  if (token) localStorage.setItem(`${kind}_token`, token)
}

export function clearToken(kind) {
  localStorage.removeItem(`${kind}_token`)
}

export async function api(path, options = {}, kind = null) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const token = kind ? getToken(kind) : null
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || 'API_ERROR')
    err.data = data
    throw err
  }
  return data
}

export function money(value) {
  return `RM ${Number(value || 0).toFixed(2)}`
}

export function dateText(value) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}


export async function downloadFile(path, filename, kind = null) {
  const headers = {}
  const token = kind ? getToken(kind) : null
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, { headers })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'DOWNLOAD_FAILED')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
