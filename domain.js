export const DEFAULT_REVIEW_AGENT = Object.freeze({
  provider: 'claude',
  model: 'claude-opus-4-8',
  effort: 'xhigh',
})

export const DEFAULT_REVIEW_AGENTS = Object.freeze({
  scout: DEFAULT_REVIEW_AGENT,
  verifier: DEFAULT_REVIEW_AGENT,
})

export const REVIEW_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])
const SAFE_REVIEW_MODEL_ID = /^claude-[A-Za-z0-9][A-Za-z0-9._:-]{0,72}$/

export function reviewEffortsForModel(model, models = []) {
  const id = String(model || '').trim()
  const metadata = Array.isArray(models) ? models.find(item => item?.id === id) : null
  const opus = metadata?.tier === 'opus' || /^claude-opus(?:-|$)/.test(id)
  return opus ? [...REVIEW_EFFORTS] : ['low', 'medium', 'high']
}

export const DEFAULT_AUTOMATION = Object.freeze({
  automaticPosting: false,
  paused: false,
  dailyLimit: 12,
  commentsPerPr: 5,
  reviewAgents: DEFAULT_REVIEW_AGENTS,
})

export const DEFAULT_SETTINGS = Object.freeze({
  selectedRepos: [],
  customGuidance: '',
  repoGuidance: {},
  automation: DEFAULT_AUTOMATION,
})

export function normalizeSettings(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const repos = Array.isArray(raw.selectedRepos)
    ? [...new Set(raw.selectedRepos.filter(validRepoName))].sort()
    : []
  const rawAutomation = raw.automation && typeof raw.automation === 'object'
    ? raw.automation
    : {}
  const rawAgents = rawAutomation.reviewAgents && typeof rawAutomation.reviewAgents === 'object'
    ? rawAutomation.reviewAgents
    : {}
  const boundedInteger = (candidate, fallback, minimum, maximum) => {
    const number = Number(candidate)
    return Number.isFinite(number)
      ? Math.max(minimum, Math.min(maximum, Math.round(number)))
      : fallback
  }
  const legacyReviewLimit = boundedInteger(rawAutomation.revisionsPerDay, 20, 1, 100)
  const legacyPostLimit = boundedInteger(rawAutomation.postsPerDay, 12, 1, 100)
  const dailyLimit = rawAutomation.dailyLimit === undefined
    ? Math.min(legacyReviewLimit, legacyPostLimit)
    : boundedInteger(rawAutomation.dailyLimit, DEFAULT_AUTOMATION.dailyLimit, 1, 100)
  const commentsPerPr = boundedInteger(
    rawAutomation.commentsPerPr ?? rawAutomation.roundsPerPr,
    DEFAULT_AUTOMATION.commentsPerPr, 1, 20,
  )
  const normalizeReviewAgent = role => {
    const candidate = rawAgents[role] && typeof rawAgents[role] === 'object'
      ? rawAgents[role]
      : {}
    const candidateModel = typeof candidate.model === 'string' ? candidate.model.trim() : ''
    if ((candidate.provider !== undefined && candidate.provider !== 'claude')
      || !SAFE_REVIEW_MODEL_ID.test(candidateModel)) return { ...DEFAULT_REVIEW_AGENT }
    const model = candidateModel
    const allowedEfforts = reviewEffortsForModel(model)
    const fallbackEffort = allowedEfforts.includes(DEFAULT_REVIEW_AGENT.effort)
      ? DEFAULT_REVIEW_AGENT.effort
      : 'high'
    const effort = allowedEfforts.includes(candidate.effort)
      ? candidate.effort
      : fallbackEffort
    return { provider: 'claude', model, effort }
  }
  return {
    selectedRepos: repos,
    customGuidance: typeof raw.customGuidance === 'string' ? raw.customGuidance : '',
    repoGuidance: raw.repoGuidance && typeof raw.repoGuidance === 'object'
      ? raw.repoGuidance
      : {},
    automation: {
      automaticPosting: rawAutomation.privateMode
        ? false
        : Boolean(rawAutomation.automaticPosting),
      paused: Boolean(rawAutomation.paused || rawAutomation.automaticReviewing === false),
      dailyLimit,
      commentsPerPr,
      reviewAgents: {
        scout: normalizeReviewAgent('scout'),
        verifier: normalizeReviewAgent('verifier'),
      },
    },
  }
}

export function validRepoName(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value || '').trim())
}

export function splitRepo(value) {
  const [owner, name] = String(value || '').split('/')
  return validRepoName(value) ? { owner, name } : null
}

export function formatRelativeTime(value, now = Date.now()) {
  const stamp = new Date(value).getTime()
  if (!Number.isFinite(stamp)) return 'recently'
  const seconds = Math.max(0, Math.round((now - stamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function riskForPullRequest(pr) {
  const additions = Number(pr?.additions || 0)
  const deletions = Number(pr?.deletions || 0)
  const files = Number(pr?.changedFiles || 0)
  const magnitude = additions + deletions
  if (magnitude >= 1000 || files >= 35) return 'high'
  if (magnitude >= 300 || files >= 12) return 'medium'
  return 'focused'
}

export function sortPullRequests(rows) {
  return [...rows].sort((a, b) => (
    new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  ))
}

export function dailyEventCount(ledger, kind, now = new Date()) {
  const day = now.toISOString().slice(0, 10)
  const kinds = new Set(Array.isArray(kind) ? kind : [kind])
  return (ledger?.events || []).filter(event => (
    kinds.has(event?.kind) && String(event?.at || '').slice(0, 10) === day
  )).length
}

export function activeVerifiedFindings(review) {
  return Array.isArray(review?.findings)
    ? review.findings.filter(item => item && item.lifecycle !== 'addressed')
    : []
}

const INBOX_REVIEW_STATUS_GROUPS = Object.freeze({
  reviewing: { id: 'reviewing', label: 'Reviewing', tone: 'active' },
  waiting_for_model: { id: 'retry', label: 'Queued for retry', tone: 'attention' },
  waiting_for_capacity: { id: 'capacity', label: 'Waiting for model usage', tone: 'attention' },
  provider_setup_required: { id: 'sign-in', label: 'Waiting for model sign-in', tone: 'attention' },
  review_agent_setup_required: { id: 'agents', label: 'Check review agents', tone: 'attention' },
  waiting_for_evidence: { id: 'evidence', label: 'Refreshing PR evidence', tone: 'active' },
})

export function inboxReviewGroup(review, pullRequest = null) {
  const currentHead = String(pullRequest?.headRefOid || '').toLowerCase()
  const currentBase = String(pullRequest?.baseRefOid || '').toLowerCase()
  const reviewedHead = String(review?.head_sha || '').toLowerCase()
  const reviewedBase = String(review?.base_sha || '').toLowerCase()
  if (
    (currentHead && currentHead !== reviewedHead)
    || (currentBase && reviewedBase && currentBase !== reviewedBase)
  ) return { id: 'awaiting', label: 'Awaiting review', tone: 'pending' }
  const status = String(review?.status || '')
  if (!status || status === 'pending') return { id: 'awaiting', label: 'Awaiting review', tone: 'pending' }
  if (status === 'complete') return activeVerifiedFindings(review).length > 0
    ? { id: 'findings', label: 'Verified findings', tone: 'findings' }
    : { id: 'clear', label: 'All clear', tone: 'clear' }
  if (status === 'skipped') return { id: 'skipped', label: 'Skipped', tone: 'muted' }
  if (INBOX_REVIEW_STATUS_GROUPS[status]) return INBOX_REVIEW_STATUS_GROUPS[status]
  return { id: 'other', label: 'Other', tone: 'muted' }
}

export function countOpenPullRequestsWithFindings(openPulls, ledger) {
  const reviews = ledger?.pulls && typeof ledger.pulls === 'object' ? ledger.pulls : {}
  const counted = new Set()
  for (const pull of Array.isArray(openPulls) ? openPulls : []) {
    const repository = String(pull?.repository || '').toLowerCase()
    const number = Number(pull?.number || 0)
    if (!repository || number < 1) continue
    const key = `${repository}#${number}`
    if (!counted.has(key) && activeVerifiedFindings(reviews[key]).length > 0) counted.add(key)
  }
  return counted.size
}

export function automationStateLabel(automation, ledger) {
  if (automation?.paused) return 'Paused'
  return {
    provider_setup_required: 'Sign-in needed',
    review_agent_setup_required: 'Check agents',
    waiting_for_capacity: 'Usage wait',
    waiting_for_model: 'Retry queued',
    waiting_for_evidence: 'Refreshing',
    daily_ceiling: 'Daily limit',
    reviewing: 'Reviewing',
  }[ledger?.last_status] || 'Running'
}

export function reviewerCommentPayload(review) {
  return {
    identity: String(review?.identity || ''),
    repository: String(review?.repository || ''),
    pr_number: Number(review?.number || 0),
    head_sha: String(review?.head_sha || ''),
    base_sha: String(review?.base_sha || ''),
    guide_hash: String(review?.guide_hash || ''),
    body: String(review?.draft_comment || ''),
  }
}

export function reviewSendReadiness(pr, review, publicPost = null) {
  const status = String(publicPost?.status || review?.post_status || '')
  if (status === 'posted' || review?.private === false) {
    return { code: 'posted', ready: false, url: publicPost?.url || review?.post_url || '' }
  }
  if (status === 'uncertain' || status === 'posting') {
    return { code: 'uncertain', ready: false }
  }
  if (status === 'superseded') return { code: 'stale', ready: false }
  const payload = reviewerCommentPayload(review)
  if (
    review?.status !== 'complete' || !review?.private || !payload.body
    || !/^[0-9a-f]{64}$/.test(payload.identity)
    || !/^[0-9a-f]{40,64}$/.test(payload.head_sha)
    || !/^[0-9a-f]{40,64}$/.test(payload.base_sha)
    || !/^[0-9a-f]{64}$/.test(payload.guide_hash)
    || !validRepoName(payload.repository) || payload.pr_number < 1
  ) return { code: 'unavailable', ready: false }
  if (
    pr?.snapshotStale
    || String(pr?.headRefOid || '').toLowerCase() !== payload.head_sha.toLowerCase()
    || String(pr?.baseRefOid || '').toLowerCase() !== payload.base_sha.toLowerCase()
  ) return { code: 'stale', ready: false }
  return { code: 'ready', ready: true }
}

export function effectiveGuide(baseGuide, customGuidance, repoGuidance = '') {
  return [
    baseGuide.trim(),
    customGuidance.trim() ? `# Workspace guidance\n\n${customGuidance.trim()}` : '',
    repoGuidance.trim() ? `# Repository guidance\n\n${repoGuidance.trim()}` : '',
  ].filter(Boolean).join('\n\n---\n\n')
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]))
}

export async function guidanceConfigHash(baseGuide, settings) {
  const payload = JSON.stringify(stableObject({
    base: baseGuide.trim(),
    custom: String(settings?.customGuidance || '').trim(),
    repositories: settings?.repoGuidance || {},
  }))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0')).join('')
}

export async function grantConfigurationMatchesSettings(baseGuide, settings, grant) {
  if (!grant) return false
  const hash = await guidanceConfigHash(baseGuide, settings)
  const selected = [...(settings?.selectedRepos || [])].sort().join('\n')
  const granted = [...(grant.repositories || [])].sort().join('\n')
  return hash === grant.guide_hash && selected === granted
    && Number(settings?.automation?.commentsPerPr) === Number(grant.max_rounds_per_pr)
    && Number(settings?.automation?.dailyLimit) === Number(grant.daily_post_ceiling)
}

export async function grantMatchesSettings(baseGuide, settings, grant) {
  return Boolean(grant?.enabled)
    && grantConfigurationMatchesSettings(baseGuide, settings, grant)
}
