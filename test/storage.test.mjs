import test from 'node:test'
import assert from 'node:assert/strict'

const {
  createSettingsWriter, loadDiscovery, loadSettings,
  requestReviewRetry, reviewRetryKey,
} = await import('../storage.js')

test('transient storage null retries instead of becoming defaults', async () => {
  let reads = 0
  globalThis.window = {
    mobius: { storage: { get: async () => {
      reads += 1
      if (reads === 1) return null
      return { selectedRepos: ['mobius-os/mobius'], automation: { paused: true } }
    } } },
  }
  const value = await loadSettings()
  assert.equal(reads, 2)
  assert.deepEqual(value.selectedRepos, ['mobius-os/mobius'])
  assert.equal(value.automation.paused, true)
})

test('persistent read error is surfaced and never flattened to defaults', async () => {
  globalThis.window = {
    mobius: { storage: { get: async () => { throw new Error('host unavailable') } } },
  }
  await assert.rejects(loadSettings(), /host unavailable/)
})

test('background discovery snapshot remains readable when live GitHub is unavailable', async () => {
  const snapshot = { schema: 1, pulls: [{ repository: 'mobius-os/mobius', number: 42 }] }
  globalThis.window = {
    mobius: { storage: { get: async key => key === 'discovery.json' ? snapshot : null } },
  }
  assert.deepEqual(await loadDiscovery(), snapshot)
})

test('rapid settings edits serialize so an older write cannot finish last', async () => {
  const started = []
  const finished = []
  const writer = createSettingsWriter(async value => {
    started.push(value)
    await new Promise(resolve => setTimeout(resolve, value === 'old' ? 20 : 1))
    finished.push(value)
    return value
  })
  const old = writer('old')
  const newest = writer('newest')
  const [oldResult, newestResult] = await Promise.all([old, newest])
  assert.deepEqual(started, ['old', 'newest'])
  assert.deepEqual(finished, ['old', 'newest'])
  assert.equal(oldResult.current, false)
  assert.equal(newestResult.current, true)
})

test('manual retry is a durable one-shot command bound to the failed review', async () => {
  const writes = []
  globalThis.window = {
    mobius: { storage: { set: async (key, value) => { writes.push({ key, value }) } } },
  }
  const review = {
    identity: 'a'.repeat(64), repository: 'mobius-os/mobius', number: 818,
    head_sha: 'b'.repeat(40), failed_at: '2026-08-19T20:11:14Z',
  }
  assert.equal(
    reviewRetryKey(review),
    `job-state/retry-requests/${'a'.repeat(64)}.json`,
  )
  await requestReviewRetry(review)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].value.identity, review.identity)
  assert.equal(writes[0].value.head_sha, review.head_sha)
  assert.equal(writes[0].value.failed_at, review.failed_at)
  assert.equal(writes[0].value.number, 818)
  assert.match(writes[0].value.requested_at, /^2026-/)
})

test('manual retry refuses an unbound storage path', () => {
  assert.throws(() => reviewRetryKey({ identity: '../ledger' }), /valid retry identity/)
})
