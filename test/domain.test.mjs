import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'

if (!globalThis.crypto) globalThis.crypto = webcrypto

const {
  automationStateLabel, countOpenPullRequestsWithFindings, dailyEventCount,
  grantConfigurationMatchesSettings, grantMatchesSettings, guidanceConfigHash,
  inboxReviewGroup, normalizeSettings,
  reviewEffortsForModel, reviewerCommentPayload, reviewSendReadiness,
} = await import('../domain.js')

test('inbox groups reviews by actionable outcome and operational status', () => {
  assert.equal(inboxReviewGroup(null).id, 'awaiting')
  assert.equal(inboxReviewGroup({ status: 'complete', findings: [{ lifecycle: 'new' }] }).id, 'findings')
  assert.equal(inboxReviewGroup({ status: 'complete', findings: [{ lifecycle: 'addressed' }] }).id, 'clear')
  assert.equal(inboxReviewGroup({ status: 'skipped' }).id, 'skipped')
  assert.equal(inboxReviewGroup({ status: 'waiting_for_model' }).label, 'Queued for retry')
  assert.equal(inboxReviewGroup({ status: 'custom_hold' }).id, 'other')
  assert.equal(inboxReviewGroup(
    { status: 'complete', head_sha: 'a'.repeat(40), findings: [{ lifecycle: 'new' }] },
    { headRefOid: 'b'.repeat(40) },
  ).id, 'awaiting')
})

test('guidance grant hash matches canonical runner payload', async () => {
  const base = 'base guide'
  const settings = {
    customGuidance: 'custom',
    repoGuidance: { 'b/repo': 'second', 'a/repo': 'first' },
  }
  const canonical = JSON.stringify({
    base,
    custom: 'custom',
    repositories: { 'a/repo': 'first', 'b/repo': 'second' },
  })
  const expected = createHash('sha256').update(canonical).digest('hex')
  assert.equal(await guidanceConfigHash(base, settings), expected)
})

test('normalization reduces legacy automation controls to one safe model', () => {
  const value = normalizeSettings({
    selectedRepos: ['mobius-os/mobius', 'mobius-os/mobius', 'bad repo'],
    automation: {
      automaticReviewing: false, automaticPosting: true, privateMode: true,
      revisionsPerDay: 20, postsPerDay: 8, roundsPerPr: 3,
    },
  })
  assert.deepEqual(value.selectedRepos, ['mobius-os/mobius'])
  assert.equal(value.automation.dailyLimit, 8)
  assert.equal(value.automation.commentsPerPr, 3)
  assert.equal(value.automation.paused, true)
  assert.equal(value.automation.automaticPosting, false)
  assert.deepEqual(Object.keys(value.automation).sort(), [
    'automaticPosting', 'commentsPerPr', 'dailyLimit', 'paused', 'reviewAgents',
  ])
  assert.deepEqual(value.automation.reviewAgents, {
    scout: { provider: 'claude', model: 'claude-opus-4-8', effort: 'xhigh' },
    verifier: { provider: 'claude', model: 'claude-opus-4-8', effort: 'xhigh' },
  })
})

test('review agent choices are app-owned and normalized per pass', () => {
  const value = normalizeSettings({ automation: { reviewAgents: {
    scout: { provider: 'codex', model: 'claude-fable-5', effort: 'high' },
    verifier: { provider: 'claude', model: 'claude-opus-5', effort: 'max' },
  } } })
  assert.deepEqual(value.automation.reviewAgents, {
    scout: { provider: 'claude', model: 'claude-opus-4-8', effort: 'xhigh' },
    verifier: { provider: 'claude', model: 'claude-opus-5', effort: 'max' },
  })
})

test('review efforts respect Claude model capabilities', () => {
  assert.deepEqual(reviewEffortsForModel('claude-fable-5'), ['low', 'medium', 'high'])
  assert.deepEqual(reviewEffortsForModel('claude-opus-5'), ['low', 'medium', 'high', 'xhigh', 'max'])
  const value = normalizeSettings({ automation: { reviewAgents: {
    scout: { provider: 'claude', model: 'claude-fable-5', effort: 'max' },
  } } })
  assert.deepEqual(value.automation.reviewAgents.scout, {
    provider: 'claude', model: 'claude-fable-5', effort: 'high',
  })
})

test('open PR finding count intersects the inbox and counts each PR once', () => {
  const pulls = [
    { repository: 'MOBIUS-OS/MOBIUS', number: 1 },
    { repository: 'mobius-os/mobius', number: 1 },
    { repository: 'mobius-os/mobius', number: 2 },
    { repository: 'mobius-os/mobius', number: 4 },
  ]
  const ledger = { pulls: {
    'mobius-os/mobius#1': { findings: [
      { lifecycle: 'new' }, { lifecycle: 'persisting' },
    ] },
    'mobius-os/mobius#2': { findings: [{ lifecycle: 'addressed' }] },
    'mobius-os/mobius#3': { findings: [{ lifecycle: 'new' }] },
    'mobius-os/mobius#4': { status: 'waiting_for_model', findings: [{ lifecycle: 'persisting' }] },
  } }
  assert.equal(countOpenPullRequestsWithFindings(pulls, ledger), 2)
})

test('automation state prioritizes owner controls and then operational waits', () => {
  assert.equal(automationStateLabel({ paused: true }, { last_status: 'reviewing' }), 'Paused')
  assert.equal(automationStateLabel({ paused: false }, { last_status: 'provider_setup_required' }), 'Sign-in needed')
  assert.equal(automationStateLabel({}, { last_status: 'review_agent_setup_required' }), 'Check agents')
  assert.equal(automationStateLabel({}, { last_status: 'waiting_for_capacity' }), 'Usage wait')
  assert.equal(automationStateLabel({}, { last_status: 'ok' }), 'Running')
})

test('standing grant becomes stale when scope, guidance, or ceilings change', async () => {
  const settings = normalizeSettings({
    selectedRepos: ['b/repo', 'a/repo'], customGuidance: 'roadmap',
    automation: { commentsPerPr: 4, dailyLimit: 9 },
  })
  const grant = {
    enabled: true, repositories: ['a/repo', 'b/repo'],
    guide_hash: await guidanceConfigHash('base', settings),
    max_rounds_per_pr: 4, daily_post_ceiling: 9,
  }
  assert.equal(await grantMatchesSettings('base', settings, grant), true)
  assert.equal(await grantConfigurationMatchesSettings('base', settings, {
    ...grant, enabled: false,
  }), true)
  assert.equal(await grantMatchesSettings('base', {
    ...settings, customGuidance: 'new roadmap',
  }, grant), false)
  assert.equal(await grantMatchesSettings('base', {
    ...settings, automation: { ...settings.automation, dailyLimit: 10 },
  }, grant), false)
})

test('visible base guide is byte-identical to the scheduled runner guide', async () => {
  const markdown = (await readFile(new URL('../reviewing.md', import.meta.url), 'utf8')).trim()
  const source = await readFile(new URL('../review-guide.js', import.meta.url), 'utf8')
  const encoded = source.match(/export const BASE_REVIEW_GUIDE = (.+)\n$/)?.[1]
  assert.ok(encoded, 'review-guide.js must contain one generated JSON string')
  assert.equal(JSON.parse(encoded), markdown)
  const uiVersion = source.match(/REVIEW_GUIDE_VERSION = '([^']+)'/)?.[1]
  const runner = await readFile(new URL('../reviewer_runner.py', import.meta.url), 'utf8')
  const runnerVersion = runner.match(/REVIEW_GUIDE_VERSION = "([^"]+)"/)?.[1]
  assert.equal(uiVersion, runnerVersion)
})

test('daily review usage counts the UTC ceiling window only', () => {
  const ledger = { events: [
    { kind: 'review', at: '2026-08-18T00:01:00Z' },
    { kind: 'review_attempt', at: '2026-08-18T00:02:00Z' },
    { kind: 'review', at: '2026-08-17T23:59:00Z' },
    { kind: 'post', at: '2026-08-18T01:00:00Z' },
  ] }
  assert.equal(dailyEventCount(
    ledger, ['review', 'review_attempt'], new Date('2026-08-18T22:00:00Z'),
  ), 2)
})

test('manual comment payload stays bound to the persisted review', () => {
  const review = {
    identity: '1'.repeat(64), repository: 'mobius-os/app-memory', number: 54,
    head_sha: 'a'.repeat(40), base_sha: 'b'.repeat(40), guide_hash: 'c'.repeat(64),
    draft_comment: 'exact stored draft',
  }
  assert.deepEqual(reviewerCommentPayload(review), {
    identity: '1'.repeat(64), repository: 'mobius-os/app-memory', pr_number: 54,
    head_sha: 'a'.repeat(40), base_sha: 'b'.repeat(40), guide_hash: 'c'.repeat(64),
    body: 'exact stored draft',
  })
})

test('manual send is ready only for the current complete private revision', () => {
  const review = {
    status: 'complete', private: true, identity: '1'.repeat(64),
    repository: 'mobius-os/app-memory', number: 54,
    head_sha: 'a'.repeat(40), base_sha: 'b'.repeat(40), guide_hash: 'c'.repeat(64),
    draft_comment: 'exact stored draft',
  }
  const pr = { headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40) }
  assert.deepEqual(reviewSendReadiness(pr, review), { code: 'ready', ready: true })
  assert.equal(reviewSendReadiness({ ...pr, snapshotStale: true }, review).code, 'stale')
  assert.equal(reviewSendReadiness({ ...pr, headRefOid: 'd'.repeat(40) }, review).code, 'stale')
  assert.deepEqual(
    reviewSendReadiness(pr, review, { status: 'posted', url: 'https://github.test/review/1' }),
    { code: 'posted', ready: false, url: 'https://github.test/review/1' },
  )
  assert.equal(reviewSendReadiness(pr, review, { status: 'uncertain' }).code, 'uncertain')
})
