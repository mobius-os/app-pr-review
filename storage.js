import { DEFAULT_SETTINGS, normalizeSettings } from './domain.js'

const SETTINGS_KEY = 'settings.json'

function store() {
  return window.mobius?.storage || null
}

export async function loadSettings() {
  const api = store()
  if (!api) return normalizeSettings(DEFAULT_SETTINGS)
  let lastError = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const value = await api.get(SETTINGS_KEY)
      if (value !== null && value !== undefined) return normalizeSettings(value)
      // A frame swap can briefly answer null before its storage host catches
      // up. Confirm absence instead of turning one transient null into a
      // destructive defaults write.
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 150))
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 150))
    }
  }
  if (lastError) throw lastError
  return normalizeSettings(DEFAULT_SETTINGS)
}

export async function saveSettings(value) {
  const next = normalizeSettings(value)
  const api = store()
  if (!api) throw new Error('Reviewer storage is unavailable.')
  await api.set(SETTINGS_KEY, next)
  return next
}

export function createSettingsWriter(write = saveSettings) {
  let queue = Promise.resolve()
  let latestRevision = 0
  return value => {
    const revision = ++latestRevision
    queue = queue.catch(() => undefined).then(() => write(value))
    return queue.then(
      saved => ({ saved, current: revision === latestRevision }),
      error => { throw Object.assign(error, { current: revision === latestRevision }) },
    )
  }
}

export async function loadReviewLedger() {
  const api = store()
  if (!api) return { schema: 1, pulls: {}, events: [] }
  try {
    const value = await api.get('job-state/ledger.json')
    return value && typeof value === 'object'
      ? value
      : { schema: 1, pulls: {}, events: [] }
  } catch {
    return { schema: 1, pulls: {}, events: [] }
  }
}

export async function loadDiscovery() {
  const api = store()
  if (!api) return null
  try {
    const value = await api.get('discovery.json')
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

export function reviewRetryKey(review) {
  const identity = String(review?.identity || '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(identity)) {
    throw new Error('This review no longer has a valid retry identity.')
  }
  return `job-state/retry-requests/${identity}.json`
}

export async function requestReviewRetry(review) {
  const api = store()
  if (!api) throw new Error('Reviewer storage is unavailable.')
  const key = reviewRetryKey(review)
  await api.set(key, {
    schema: 1,
    identity: String(review.identity).toLowerCase(),
    repository: String(review.repository || ''),
    number: Number(review.number),
    head_sha: String(review.head_sha || '').toLowerCase(),
    failed_at: String(review.failed_at || ''),
    requested_at: new Date().toISOString(),
  })
  return key
}
