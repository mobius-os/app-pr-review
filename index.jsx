import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BookOpenText, Check, ChevronDown, CirclePause, GitPullRequest,
  Inbox, LoaderCircle, Play, RefreshCw, Search, Send, Settings, ShieldCheck, SlidersHorizontal,
} from 'lucide-react'
import {
  fetchAllOpenPullRequests, fetchGitHubStatus, fetchRepositories,
  fetchProviderModels, fetchProviderStatuses, fetchReviewerComments, fetchReviewerGrant, grantReviewerPosting,
  runReviewerJob, sendReviewerComment, toggleReviewerGrant,
} from './api.js'
import {
  automationStateLabel, countOpenPullRequestsWithFindings,
  dailyEventCount, effectiveGuide, formatRelativeTime, grantConfigurationMatchesSettings,
  grantMatchesSettings, guidanceConfigHash, normalizeSettings,
  inboxReviewGroup, reviewEffortsForModel,
  reviewerCommentPayload, reviewSendReadiness, riskForPullRequest,
  sortPullRequests, validRepoName,
} from './domain.js'
import { BASE_REVIEW_GUIDE, REVIEW_GUIDE_VERSION } from './review-guide.js'
import {
  createSettingsWriter, loadDiscovery, loadReviewLedger, loadSettings,
  requestReviewRetry,
} from './storage.js'
import { CSS } from './theme.js'

const TABS = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'repos', label: 'Repositories', icon: GitPullRequest },
  { id: 'guidance', label: 'Guidance', icon: BookOpenText },
  { id: 'settings', label: 'Automation', icon: SlidersHorizontal },
]

function automationToneForState(state) {
  return state === 'Running' ? 'good' : state === 'Reviewing' ? 'active' : 'attention'
}

function Toggle({ value, onChange, label, disabled = false }) {
  return <button type="button" className={`rv-switch ${value ? 'on' : ''}`} aria-label={label} aria-pressed={value} disabled={disabled} onClick={() => onChange(!value)} />
}

function Empty({ icon: Icon = Inbox, title, copy, action }) {
  return <div className="rv-card rv-empty">
    <div className="rv-empty-icon"><Icon size={23} /></div>
    <h3>{title}</h3><p>{copy}</p>{action}
  </div>
}

function CommentSendAction({ pr, review, publicPost, onSend, sendState }) {
  const [confirming, setConfirming] = useState(false)
  const readiness = reviewSendReadiness(pr, review, publicPost)
  useEffect(() => { setConfirming(false) }, [review?.identity])
  if (readiness.code === 'posted') return null
  if (readiness.code === 'uncertain') return <div className="rv-send-result warning">
    <AlertTriangle size={16} /><span>GitHub did not confirm the outcome. Check the PR; Reviewer will not retry.</span>
  </div>
  if (readiness.code === 'stale') return <div className="rv-send-result warning">
    <RefreshCw size={16} /><span>The PR changed. Review the new revision before sending.</span>
  </div>
  if (!readiness.ready) return null
  if (sendState?.phase === 'sending') return <button className="rv-btn" disabled><LoaderCircle size={15} /> Sending comment…</button>
  if (confirming) return <div className="rv-send-confirm">
    <div><strong>Post publicly to {review.repository} #{review.number}?</strong><small>This sends the exact preview above for revision {review.head_sha.slice(0, 12)}. It cannot be undone.</small></div>
    <div className="rv-send-actions">
      <button className="rv-btn" onClick={() => setConfirming(false)}>Cancel</button>
      <button className="rv-btn primary" onClick={() => { setConfirming(false); onSend(review) }}><Send size={15} /> Send comment publicly</button>
    </div>
  </div>
  return <div className="rv-send-wrap">
    {sendState?.phase === 'error' && <p className="rv-error rv-send-error">{sendState.message}</p>}
    <button className="rv-btn" onClick={() => setConfirming(true)}><Send size={15} /> Send this comment</button>
  </div>
}

function RetryReviewAction({ review, onRetry, disabled }) {
  const [phase, setPhase] = useState('idle')
  useEffect(() => { setPhase('idle') }, [review?.identity, review?.failed_at])
  const request = async () => {
    setPhase('requesting')
    try {
      await onRetry(review)
      setPhase('queued')
    } catch {
      setPhase('error')
    }
  }
  const busy = phase === 'requesting' || phase === 'queued'
  const label = disabled
    ? `Resume automatic reviewing to retry ${review.repository} #${review.number}`
    : busy
    ? `Retry queued for ${review.repository} #${review.number}`
    : phase === 'error'
      ? `Retry failed for ${review.repository} #${review.number}; try again`
      : `Retry review for ${review.repository} #${review.number} now`
  return <button
    type="button" className={`rv-retry ${phase === 'error' ? 'error' : ''}`}
    aria-label={label} title={label} aria-busy={busy}
    aria-disabled={busy || disabled} disabled={busy}
    onClick={disabled ? undefined : request}
  >{busy ? <LoaderCircle className="rv-spin" size={14} /> : <RefreshCw size={14} />}</button>
}

function PullRequestCard({ pr, review, groupId, publicPost, onSendReview, onRetryReview, retryDisabled, sendState }) {
  const risk = riskForPullRequest(pr)
  const hasCurrentResult = review?.status === 'complete' && (groupId === 'findings' || groupId === 'clear')
  const isSent = hasCurrentResult && (publicPost?.status === 'posted'
    || review?.post_status === 'posted'
    || sendState?.phase === 'sent')
  return <article className="rv-card rv-pr">
    <div className="rv-avatar">{pr.author?.avatarUrl && <img src={pr.author.avatarUrl} alt="" onError={event => { event.currentTarget.style.display = 'none' }} />}</div>
    <div className="rv-pr-main">
      <div className="rv-pr-heading">
        <a className="rv-pr-title" href={pr.url} target="_blank" rel="noreferrer">{pr.title}</a>
        <span className={`rv-risk ${risk}`}>{risk}</span>
        {isSent && <span className="rv-card-sent"><Check size={12} /> Sent</span>}
        {groupId === 'retry' && review?.identity && onRetryReview && <RetryReviewAction review={review} onRetry={onRetryReview} disabled={retryDisabled} />}
      </div>
      <div className="rv-meta">
        <span>{pr.repository} #{pr.number}</span>
        <span>{pr.author?.login || 'Unknown author'}</span>
        <span>{formatRelativeTime(pr.updatedAt)}</span>
        {Number.isFinite(pr.changedFiles) && <span>{pr.changedFiles} files</span>}
        {Number.isFinite(pr.additions) && Number.isFinite(pr.deletions) && <span className="rv-diff"><span className="rv-additions">+{pr.additions}</span><span className="rv-deletions">−{pr.deletions}</span></span>}
        {pr.isDraft && <span>Draft</span>}
        {pr.snapshotStale && <span>Last known · refresh pending</span>}
      </div>
      {hasCurrentResult && <details className="rv-review-detail">
        <summary>Review comment</summary>
        {review.draft_comment && <div className="rv-comment-preview"><pre>{review.draft_comment}</pre></div>}
        {review.draft_comment && <CommentSendAction pr={pr} review={review} publicPost={publicPost} onSend={onSendReview} sendState={sendState} />}
      </details>}
    </div>
  </article>
}

const INBOX_GROUPS = [
  { id: 'awaiting', label: 'Awaiting review', tone: 'pending' },
  { id: 'findings', label: 'Verified findings', tone: 'findings' },
  { id: 'clear', label: 'All clear', tone: 'clear' },
  { id: 'skipped', label: 'Skipped', tone: 'muted' },
  { id: 'reviewing', label: 'Reviewing', tone: 'active' },
  { id: 'retry', label: 'Queued for retry', tone: 'attention' },
  { id: 'capacity', label: 'Waiting for model usage', tone: 'attention' },
  { id: 'sign-in', label: 'Waiting for model sign-in', tone: 'attention' },
  { id: 'agents', label: 'Check review agents', tone: 'attention' },
  { id: 'evidence', label: 'Refreshing PR evidence', tone: 'active' },
  { id: 'other', label: 'Other', tone: 'muted' },
]

function ReviewGroup({ group, children }) {
  return <details className={`rv-inbox-group ${group.tone}`}>
    <summary>
      <span className="rv-group-label"><span className="rv-group-dot" aria-hidden="true" />{group.label}</span>
      <span className="rv-group-count" aria-label={`${group.items.length} pull request${group.items.length === 1 ? '' : 's'}`}>{group.items.length}</span>
      <ChevronDown className="rv-group-chevron" size={17} aria-hidden="true" />
    </summary>
    <div className="rv-group-list">{children}</div>
  </details>
}

function InboxView({ settings, pulls, ledger, loading, errors, onChooseRepos, publicPosts, onSendReview, onRetryReview, sendStates }) {
  const visiblePulls = useMemo(
    () => pulls.filter(pr => settings.selectedRepos.includes(pr.repository)),
    [pulls, settings.selectedRepos],
  )
  const reviews = ledger?.pulls || {}
  const reviewGroups = useMemo(() => {
    const groups = new Map(INBOX_GROUPS.map(group => [group.id, { ...group, items: [] }]))
    for (const pr of visiblePulls) {
      const review = reviews[`${pr.repository.toLowerCase()}#${pr.number}`]
      const status = inboxReviewGroup(review, pr)
      const group = groups.get(status.id) || groups.get('other')
      group.items.push({ pr, review })
    }
    return [...groups.values()].filter(group => group.items.length > 0)
  }, [visiblePulls, reviews])
  const findingPulls = countOpenPullRequestsWithFindings(visiblePulls, ledger)
  const automationState = automationStateLabel(settings.automation, ledger)
  const automationTone = automationToneForState(automationState)
  return <div className="rv-inbox-layout">
      <section className="rv-card rv-hero">
        <div className="rv-eyebrow">Continuous QA</div>
        <h2>{visiblePulls.length ? `${visiblePulls.length} open pull request${visiblePulls.length === 1 ? '' : 's'}` : 'A quieter way to review everything'}</h2>
        <p>Reviewer watches the repositories you choose, runs two evidence-focused passes on every stable revision, and follows findings until the contribution is clear.</p>
        <div className="rv-metrics">
          <div className="rv-metric"><strong>{settings.selectedRepos.length}</strong><span>watched repos</span></div>
          <div className="rv-metric"><strong>{findingPulls}</strong><span>open PRs with findings</span></div>
          <div className="rv-metric"><strong className={`rv-metric-state ${automationTone}`}>{automationState}</strong><span>automation</span></div>
        </div>
      </section>
      {errors.length > 0 && <section className="rv-card rv-alert"><AlertTriangle size={19} /><div><strong>Some repositories could not refresh</strong><p className="rv-copy">{errors.join(' · ')}</p></div></section>}
      {loading ? <Empty icon={LoaderCircle} title="Refreshing pull requests" copy="Reading the current open work from your selected repositories." />
        : settings.selectedRepos.length === 0
          ? <Empty icon={GitPullRequest} title="Choose repositories to watch" copy="Nothing is enabled automatically. Pick the exact repositories Reviewer should own." action={<button className="rv-btn primary" onClick={onChooseRepos}>Choose repositories</button>} />
          : visiblePulls.length === 0
            ? <Empty icon={Check} title="The inbox is clear" copy="There are no open pull requests in the selected repositories right now." />
            : <div className="rv-inbox-groups">{reviewGroups.map(group => <ReviewGroup key={group.id} group={group}>
              {group.items.map(({ pr, review }) => <PullRequestCard key={`${pr.repository}:${pr.id}`} pr={pr} review={review} groupId={group.id} publicPost={review?.identity ? publicPosts[review.identity] : null} onSendReview={onSendReview} onRetryReview={onRetryReview} retryDisabled={settings.automation.paused} sendState={review?.identity ? sendStates[review.identity] : null} />)}
            </ReviewGroup>)}</div>}
  </div>
}

function RepositoriesView({ repositories, detectedRepos, settings, onSettings, loading }) {
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState('')
  const selected = new Set(settings.selectedRepos)
  const listRef = useRef(null)
  const preservedScrollTop = useRef(0)
  const merged = useMemo(() => {
    const detected = new Map(detectedRepos.map(repo => [repo.nameWithOwner.toLowerCase(), repo]))
    const byName = new Map(repositories.map(repo => [repo.nameWithOwner, {
      ...repo, ...(detected.get(repo.nameWithOwner.toLowerCase()) || {}),
    }]))
    detectedRepos.forEach(repo => {
      if (![...byName.keys()].some(name => name.toLowerCase() === repo.nameWithOwner.toLowerCase())) byName.set(repo.nameWithOwner, repo)
    })
    settings.selectedRepos.forEach(name => {
      if (!byName.has(name)) byName.set(name, { nameWithOwner: name, viewerPermission: 'CUSTOM' })
    })
    return [...byName.values()].filter(repo => repo.nameWithOwner.toLowerCase().includes(query.toLowerCase()))
  }, [repositories, detectedRepos, settings.selectedRepos, query])
  const groups = useMemo(() => {
    const alphabetically = (a, b) => a.nameWithOwner.localeCompare(
      b.nameWithOwner, undefined, { sensitivity: 'base' },
    )
    return {
      selected: merged.filter(repo => selected.has(repo.nameWithOwner)).sort(alphabetically),
      available: merged.filter(repo => !selected.has(repo.nameWithOwner)).sort(alphabetically),
    }
  }, [merged, settings.selectedRepos])
  const rows = [
    ...groups.selected.map(repo => ({ type: 'repository', repo })),
    ...(groups.selected.length > 0 && groups.available.length > 0
      ? [{ type: 'divider', key: 'repository-divider' }]
      : []),
    ...groups.available.map(repo => ({ type: 'repository', repo })),
  ]
  useLayoutEffect(() => {
    if (!listRef.current) return
    const maximum = Math.max(0, listRef.current.scrollHeight - listRef.current.clientHeight)
    listRef.current.scrollTop = Math.min(preservedScrollTop.current, maximum)
  }, [groups])
  const toggle = name => {
    if (listRef.current) preservedScrollTop.current = listRef.current.scrollTop
    onSettings({
      ...settings,
      selectedRepos: selected.has(name)
        ? settings.selectedRepos.filter(item => item !== name)
        : [...settings.selectedRepos, name],
    })
  }
  const addManual = () => {
    const name = manual.trim()
    if (!validRepoName(name) || selected.has(name)) return
    onSettings({ ...settings, selectedRepos: [...settings.selectedRepos, name] })
    setManual('')
  }
  return <div className="rv-grid">
    <section className="rv-card">
      <div className="rv-section-head"><div><div className="rv-eyebrow">Authoritative scope</div><h3>{settings.selectedRepos.length} repositories selected</h3></div>{loading && <LoaderCircle size={18} />}</div>
      <p className="rv-copy" style={{marginBottom:12}}>Suggestions come from GitHub, but only your checked list is watched. Newly discovered repositories stay off.</p>
      <div className="rv-search"><Search size={17} /><input className="rv-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search accessible repositories" /></div>
      <div className="rv-repo-list" style={{marginTop:10}} ref={listRef} onScroll={event => { preservedScrollTop.current = event.currentTarget.scrollTop }}>
        {rows.map(item => item.type === 'divider'
          ? <div className="rv-repo-divider" role="separator" key={item.key}><span>Other repositories</span></div>
          : <div className="rv-repo" key={item.repo.nameWithOwner}>
            <div className="rv-repo-main"><div className="rv-repo-name">{item.repo.nameWithOwner}</div><div className="rv-repo-note">{item.repo.viewerPermission || 'Permission unknown'}{item.repo.isPrivate ? ' · Private' : ''}{item.repo.provenance ? ` · ${item.repo.provenance}${item.repo.provenanceDetail ? ` (${item.repo.provenanceDetail})` : ''}` : ' · Custom or accessible repository'}</div></div>
            <Toggle value={selected.has(item.repo.nameWithOwner)} onChange={() => toggle(item.repo.nameWithOwner)} label={`${selected.has(item.repo.nameWithOwner) ? 'Stop watching' : 'Watch'} ${item.repo.nameWithOwner}`} />
          </div>)}
        {!loading && merged.length === 0 && <p className="rv-copy">No repositories match this search.</p>}
      </div>
    </section>
    <aside className="rv-stack">
      <section className="rv-card">
        <div className="rv-section-head"><h3>Add repository</h3></div>
        <p className="rv-copy" style={{marginBottom:10}}>Paste an exact repository if it is not in the accessible list.</p>
        <div className="rv-inline"><input className="rv-input" value={manual} onChange={event => setManual(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addManual() }} placeholder="owner/repository" /><button className="rv-btn" disabled={!validRepoName(manual) || selected.has(manual.trim())} onClick={addManual}>Add</button></div>
      </section>
      <section className="rv-card">
        <div className="rv-section-head"><h3>Scope rule</h3><ShieldCheck size={17} /></div>
        <p className="rv-copy">Reviewer never infers a “core” group and never resurrects a repository you disabled.</p>
      </section>
    </aside>
  </div>
}

function GuidanceView({ settings, onSettings, saveState }) {
  const [repository, setRepository] = useState(settings.selectedRepos[0] || '')
  useEffect(() => {
    if (repository && settings.selectedRepos.includes(repository)) return
    setRepository(settings.selectedRepos[0] || '')
  }, [repository, settings.selectedRepos])
  const repositoryGuidance = String(settings.repoGuidance?.[repository] || '')
  const setRepositoryGuidance = value => onSettings({
    ...settings,
    repoGuidance: { ...settings.repoGuidance, [repository]: value },
  })
  const guide = effectiveGuide(BASE_REVIEW_GUIDE, settings.customGuidance, repositoryGuidance)
  return <div className="rv-grid">
    <div className="rv-stack">
      <section className="rv-card">
        <div className="rv-section-head"><div><div className="rv-eyebrow">Owner-controlled layer</div><h3>Your workspace guidance</h3></div><span className={`rv-save ${saveState === 'error' ? 'rv-error' : ''}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Could not save' : ''}</span></div>
        <p className="rv-copy" style={{marginBottom:11}}>Add roadmap priorities, architectural preferences, or review exclusions shared by every selected repository. App updates cannot overwrite this layer.</p>
        <textarea className="rv-textarea" value={settings.customGuidance} onChange={event => onSettings({ ...settings, customGuidance: event.target.value })} placeholder="Example: Prefer changes that simplify the shared app runtime. Flag new compatibility shims unless the PR includes a concrete removal plan." />
      </section>
      <section className="rv-card">
        <div className="rv-section-head"><div><div className="rv-eyebrow">Repository layer</div><h3>Repository-specific guidance</h3></div></div>
        {settings.selectedRepos.length ? <>
          <select className="rv-input" value={repository} onChange={event => setRepository(event.target.value)}>{settings.selectedRepos.map(name => <option key={name} value={name}>{name}</option>)}</select>
          <p className="rv-copy" style={{margin:'11px 0'}}>Use this for a repository’s role, near-term direction, or deliberate exceptions. It is added after the workspace guidance.</p>
          <textarea className="rv-textarea" value={repositoryGuidance} onChange={event => setRepositoryGuidance(event.target.value)} placeholder={`Optional guidance for ${repository}`} />
        </> : <p className="rv-copy">Choose at least one repository before adding a repository-specific layer.</p>}
      </section>
    </div>
    <aside className="rv-stack">
      <section className="rv-card">
        <div className="rv-section-head"><h3>Effective guide · v{REVIEW_GUIDE_VERSION}</h3><BookOpenText size={17} /></div>
        <div className="rv-card rv-guide-preview">{guide}</div>
      </section>
    </aside>
  </div>
}

function NumberSetting({ value, min, max, onChange, label }) {
  return <input aria-label={label} className="rv-input rv-number" type="number" min={min} max={max} value={value} onChange={event => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} />
}

function ReviewAgentSetting({ role, description, value, models, onChange }) {
  const available = Array.isArray(models) ? models : []
  const savedAvailable = available.some(model => model.id === value.model)
  const efforts = reviewEffortsForModel(value.model, available)
  const effortLabels = {
    low: 'Low effort', medium: 'Medium effort', high: 'High effort',
    xhigh: 'Extra-high effort', max: 'Maximum effort',
  }
  return <div className="rv-agent-setting">
    <div className="rv-agent-copy"><div className="rv-agent-title"><strong>{role}</strong><span>Claude · no tools</span></div><small>{description}</small></div>
    <div className="rv-agent-controls">
      <label><span>Model</span><select className="rv-input" aria-label={`${role} model`} value={value.model} onChange={event => {
        const model = event.target.value
        const nextEfforts = reviewEffortsForModel(model, available)
        onChange({ model, effort: nextEfforts.includes(value.effort) ? value.effort : 'high' })
      }}>
        {!savedAvailable && <option value={value.model}>{value.model} · saved</option>}
        {available.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select></label>
      <label><span>Effort</span><select className="rv-input" aria-label={`${role} effort`} value={value.effort} onChange={event => onChange({ effort: event.target.value })}>
        {efforts.map(effort => <option key={effort} value={effort}>{effortLabels[effort]}</option>)}
      </select></label>
    </div>
  </div>
}

function AutomationView({ settings, onSettings, grant, grantStatus, grantMatches, grantState, onPosting, ledger, providerModels, providerStatuses, providerModelsState, providerStatusState }) {
  const setAutomation = patch => onSettings({ ...settings, automation: { ...settings.automation, ...patch } })
  const a = settings.automation
  const setReviewAgent = (role, patch) => setAutomation({
    reviewAgents: {
      ...a.reviewAgents,
      [role]: { ...a.reviewAgents[role], ...patch, provider: 'claude' },
    },
  })
  const reviewsToday = dailyEventCount(ledger, ['review', 'review_attempt'])
  const postsToday = dailyEventCount(ledger, 'post')
  const automationState = automationStateLabel(a, ledger)
  const automationTone = automationToneForState(automationState)
  const automationCopy = {
    Paused: 'The inbox still refreshes, but reviews and automatic comments are stopped.',
    Reviewing: 'Reviewer is working through the next stable revision now.',
    'Sign-in needed': 'Reviews are queued until Claude sign-in is available.',
    'Check agents': 'Reviews are queued until the Scout or Verifier setting is corrected.',
    'Usage wait': 'Reviews are queued while model usage is temporarily limited.',
    'Retry queued': 'A model pass failed; the exact revision remains queued for retry.',
    Refreshing: 'The pull request changed during review; Reviewer is refreshing its evidence.',
    'Daily limit': 'Today’s review-work ceiling has been reached; queued work resumes tomorrow.',
  }[automationState] || 'Reviewer watches your selected repositories and handles stable revisions in the background.'
  const claudeStatus = providerStatusState === 'error'
    ? 'Claude status unavailable'
    : providerStatusState !== 'loaded'
      ? 'Checking Claude'
      : providerStatuses?.claude?.configured ? 'Claude configured' : 'Claude sign-in needed'
  const claudeTone = providerStatusState === 'loaded' && providerStatuses?.claude?.configured
    ? 'good'
    : providerStatusState === 'error' ? 'attention' : ''
  const postingStateKnown = grantStatus === 'loaded'
  const postingSwitchValue = postingStateKnown
    ? Boolean(a.automaticPosting && grant?.enabled && grantMatches)
    : false
  const postingCopy = grantStatus === 'loading'
    ? 'Checking automatic posting…'
    : grantStatus === 'error'
      ? 'Automatic posting could not be confirmed. Reviews continue privately.'
      : postingSwitchValue
        ? `On · completed reviews are posted automatically, up to ${a.dailyLimit} per day and ${a.commentsPerPr} per PR.`
        : grant?.enabled || a.automaticPosting
          ? 'Settings changed. Turn this on to approve the current repositories and limits.'
          : 'Off · reviews still run and remain available in the Inbox.'
  const showClaudeStatus = providerStatusState === 'error'
    || (providerStatusState === 'loaded' && !providerStatuses?.claude?.configured)
  return <div className="rv-automation-layout">
    <section className="rv-card">
      <div className="rv-automation-statusbar" aria-live="polite">
        <div className="rv-automation-status-copy">
          <div className="rv-automation-status-title"><span className={`rv-dot ${automationTone}`} /><span>Status:</span><strong>{automationState}</strong></div>
          <p>{automationCopy}</p>
        </div>
        <button className={`rv-btn rv-compact ${a.paused ? 'primary' : ''}`} onClick={() => setAutomation({ paused: !a.paused })}>{a.paused ? <Play size={15} /> : <CirclePause size={15} />}{a.paused ? 'Resume' : 'Pause'}</button>
      </div>

      <div className="rv-setting-group">
        <div className="rv-setting-group-head"><h2>General settings</h2><p>Reviewer handles every stable PR revision unless you pause it above.</p></div>
        <div className="rv-setting rv-setting-tall"><div><strong>Post reviews automatically</strong><small>{postingCopy}</small></div><Toggle value={postingSwitchValue} disabled={!postingStateKnown || grantState === 'saving'} onChange={onPosting} label="Post reviews automatically" /></div>
        <div className="rv-setting"><div><strong>Daily automation limit</strong><small>{reviewsToday} review runs · {postsToday} posted today. This one limit caps both.</small></div><NumberSetting label="Daily automation limit" value={a.dailyLimit} min={1} max={100} onChange={value => setAutomation({ dailyLimit: value })} /></div>
        <div className="rv-setting"><div><strong>Comments per PR</strong><small>Maximum automatic comments across revisions of one pull request.</small></div><NumberSetting label="Comments per PR" value={a.commentsPerPr} min={1} max={20} onChange={value => setAutomation({ commentsPerPr: value })} /></div>
        {(grantState === 'saving' || grantState === 'error' || grantState === 'owner_required') && <div className={`rv-inline-state ${grantState !== 'saving' ? 'error' : ''}`} aria-live="polite">{
          grantState === 'saving'
            ? 'Updating automatic posting…'
            : grantState === 'owner_required'
              ? 'Ask Möbius in chat to approve this automatic-posting change. The previous state is unchanged.'
              : 'Automatic posting could not be updated; the previous state is unchanged.'
        }</div>}
      </div>

      <div className="rv-setting-group">
        <div className="rv-setting-group-head rv-agent-group-head"><div><h2>Agent settings</h2><p>A Scout finds concrete issues; an independent Verifier rejects unsupported findings. These choices apply only to Reviewer.</p></div>{showClaudeStatus && <span className="rv-status"><span className={`rv-dot ${claudeTone}`} />{claudeStatus}</span>}</div>
        <div className="rv-agent-list">
          <ReviewAgentSetting role="Scout agent" description="Finds concrete issues and sweeps every review dimension." value={a.reviewAgents.scout} models={providerModels?.claude} onChange={patch => setReviewAgent('scout', patch)} />
          <ReviewAgentSetting role="Verifier agent" description="Refetches the evidence and tries to reject unsupported findings." value={a.reviewAgents.verifier} models={providerModels?.claude} onChange={patch => setReviewAgent('verifier', patch)} />
        </div>
        {providerModelsState === 'error' && <p className="rv-agent-note">The model list is unavailable; your saved choices are retained.</p>}
      </div>
    </section>
  </div>
}

export default function App({ appId, token }) {
  const [tab, setTab] = useState('inbox')
  const [settings, setSettings] = useState(normalizeSettings(null))
  const [status, setStatus] = useState(null)
  const [repositories, setRepositories] = useState([])
  const [detectedRepos, setDetectedRepos] = useState([])
  const [pulls, setPulls] = useState([])
  const [discoveryErrors, setDiscoveryErrors] = useState([])
  const [snapshotRefreshedAt, setSnapshotRefreshedAt] = useState('')
  const [ledger, setLedger] = useState({ schema: 1, pulls: {}, events: [] })
  const [grant, setGrant] = useState(null)
  const [grantStatus, setGrantStatus] = useState('loading')
  const [providerModels, setProviderModels] = useState({})
  const [providerStatuses, setProviderStatuses] = useState(null)
  const [providerModelsState, setProviderModelsState] = useState('idle')
  const [providerStatusState, setProviderStatusState] = useState('idle')
  const [publicPosts, setPublicPosts] = useState({})
  const [sendStates, setSendStates] = useState({})
  const [grantMatches, setGrantMatches] = useState(false)
  const [grantState, setGrantState] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [saveState, setSaveState] = useState('')
  const [loaded, setLoaded] = useState(false)
  const settingsWriter = useRef(null)
  const settingsRef = useRef(settings)
  const pullRefreshRevision = useRef(0)
  const postingRequestRef = useRef(false)
  settingsRef.current = settings
  if (!settingsWriter.current) settingsWriter.current = createSettingsWriter()

  useEffect(() => {
    let active = true
    loadSettings().then(value => {
      if (!active) return
      setSettings(value)
      setLoaded(true)
    }).catch(() => {
      if (active) setMessage('Reviewer could not safely read its settings. Nothing was overwritten.')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const storage = window.mobius?.storage
    if (typeof storage?.subscribe !== 'function') return undefined
    const stopLedger = storage.subscribe('job-state/ledger.json', value => {
      if (value && typeof value === 'object') setLedger(value)
    })
    const stopDiscovery = storage.subscribe('discovery.json', value => {
      if (!value || typeof value !== 'object') return
      setRepositories(Array.isArray(value.repositories) ? value.repositories : [])
      setDetectedRepos(Array.isArray(value.detectedRepos) ? value.detectedRepos : [])
      setPulls(sortPullRequests(Array.isArray(value.pulls) ? value.pulls : []))
      setDiscoveryErrors(Array.isArray(value.errors) ? value.errors : [])
      setSnapshotRefreshedAt(String(value.refreshedAt || ''))
    })
    return () => { stopLedger?.(); stopDiscovery?.() }
  }, [])

  const refreshSelectedPulls = useCallback(async selectedRepos => {
    const revision = ++pullRefreshRevision.current
    if (!selectedRepos.length) {
      setPulls([])
      return
    }
    const open = await fetchAllOpenPullRequests(token, selectedRepos)
    if (revision !== pullRefreshRevision.current) return
    setPulls(sortPullRequests(open.rows))
    if (open.errors.length) setMessage(open.errors.join(' · '))
  }, [token])

  const updateSettings = useCallback(next => {
    const previousRepos = settingsRef.current.selectedRepos
    const repositoriesChanged = previousRepos.length !== next.selectedRepos.length
      || previousRepos.some((name, index) => name !== next.selectedRepos[index])
    settingsRef.current = next
    setSettings(next)
    setSaveState('saving')
    settingsWriter.current(next)
      .then(result => { if (result.current) setSaveState('saved') })
      .catch(error => { if (error.current) setSaveState('error') })
    if (repositoriesChanged) {
      refreshSelectedPulls(next.selectedRepos).catch(error => {
        setMessage(error?.message || 'The pull request list could not refresh.')
      })
    }
  }, [refreshSelectedPulls])

  const refreshProviderMetadata = useCallback(async () => {
    setProviderModelsState('loading')
    setProviderStatusState('loading')
    const [modelsResult, statusesResult] = await Promise.allSettled([
      fetchProviderModels(token), fetchProviderStatuses(token),
    ])
    if (modelsResult.status === 'fulfilled') {
      setProviderModels(modelsResult.value || {})
      setProviderModelsState('loaded')
    } else setProviderModelsState('error')
    if (statusesResult.status === 'fulfilled') {
      setProviderStatuses(statusesResult.value || {})
      setProviderStatusState('loaded')
    } else setProviderStatusState('error')
  }, [token])

  const refresh = useCallback(async () => {
    setLoading(true); setMessage(''); setGrantStatus('loading')
    void refreshProviderMetadata()
    const [snapshot, savedLedger] = await Promise.all([loadDiscovery(), loadReviewLedger()])
    setLedger(savedLedger)
    if (snapshot) {
      setRepositories(Array.isArray(snapshot.repositories) ? snapshot.repositories : [])
      setDetectedRepos(Array.isArray(snapshot.detectedRepos) ? snapshot.detectedRepos : [])
      setPulls(sortPullRequests(Array.isArray(snapshot.pulls) ? snapshot.pulls : []))
      setDiscoveryErrors(Array.isArray(snapshot.errors) ? snapshot.errors : [])
      setSnapshotRefreshedAt(String(snapshot.refreshedAt || ''))
    }
    try {
      const [grantResult, commentsResult] = await Promise.allSettled([
        fetchReviewerGrant(token, appId), fetchReviewerComments(token, appId),
      ])
      if (grantResult.status === 'fulfilled') {
        setGrant(grantResult.value?.grant || null)
        setGrantStatus('loaded')
      } else setGrantStatus('error')
      if (commentsResult.status === 'fulfilled') {
        setPublicPosts(Object.fromEntries(
          (commentsResult.value?.comments || []).map(item => [item.identity, item]),
        ))
      }
      const github = await fetchGitHubStatus(token)
      setStatus(github)
      if (!github?.connected) return
      const available = await fetchRepositories(token)
      setRepositories(available.repositories)
      await refreshSelectedPulls(settingsRef.current.selectedRepos)
    } catch (error) {
      if (snapshot) {
        setStatus({ connected: true, snapshot: true })
        setMessage('Live GitHub refresh is unavailable; showing the latest background snapshot.')
      } else setMessage(error.message || 'Reviewer could not refresh.')
    } finally { setLoading(false) }
  }, [appId, refreshProviderMetadata, refreshSelectedPulls, token])

  const changePosting = useCallback(async enabled => {
    if (grantStatus !== 'loaded' || postingRequestRef.current) return
    postingRequestRef.current = true
    const approvalSettings = settingsRef.current
    const approvalGrant = grant
    const saveLocalIntent = () => {
      const current = settingsRef.current
      updateSettings({
        ...current,
        automation: {
          ...current.automation,
          automaticPosting: enabled,
        },
      })
    }
    setGrantState('saving')
    try {
      if (enabled) {
        if (!approvalSettings.selectedRepos.length) throw new Error('Choose repositories first.')
        const currentApprovalMatches = await grantConfigurationMatchesSettings(
          BASE_REVIEW_GUIDE, approvalSettings, approvalGrant,
        )
        const result = currentApprovalMatches
          ? await toggleReviewerGrant(token, appId, true)
          : await grantReviewerPosting(token, appId, {
            repositories: approvalSettings.selectedRepos,
            guide_hash: await guidanceConfigHash(BASE_REVIEW_GUIDE, approvalSettings),
            max_rounds_per_pr: Number(approvalSettings.automation.commentsPerPr),
            daily_post_ceiling: Number(approvalSettings.automation.dailyLimit),
          })
        setGrant(result.grant)
        setGrantStatus('loaded')
      } else if (approvalGrant) {
        const result = await toggleReviewerGrant(token, appId, false)
        setGrant(result.grant)
        setGrantStatus('loaded')
      }
      saveLocalIntent()
      setGrantState('saved')
    } catch (error) {
      try {
        const result = await fetchReviewerGrant(token, appId)
        const authoritative = result?.grant || null
        setGrant(authoritative)
        setGrantStatus('loaded')
        const confirmed = enabled
          ? Boolean(authoritative?.enabled) && await grantMatchesSettings(
            BASE_REVIEW_GUIDE, approvalSettings, authoritative,
          )
          : !authoritative?.enabled
        if (confirmed) {
          saveLocalIntent()
          setGrantState('saved')
        } else setGrantState(error?.status === 403 ? 'owner_required' : 'error')
      } catch {
        setGrantStatus('error')
        setGrantState(error?.status === 403 ? 'owner_required' : 'error')
      }
    } finally {
      postingRequestRef.current = false
    }
  }, [appId, grant, grantStatus, token, updateSettings])

  useEffect(() => {
    let active = true
    if (!grant?.enabled) { setGrantMatches(false); return () => { active = false } }
    grantMatchesSettings(BASE_REVIEW_GUIDE, settings, grant).then(matches => {
      if (!active) return
      setGrantMatches(matches)
    }).catch(() => { if (active) setGrantMatches(false) })
    return () => { active = false }
  }, [grant, settings])

  useEffect(() => { if (loaded) refresh() }, [loaded, refresh])

  const sendReview = useCallback(async review => {
    const identity = String(review?.identity || '')
    if (!identity) return
    setSendStates(current => ({ ...current, [identity]: { phase: 'sending' } }))
    try {
      const result = await sendReviewerComment(
        token, appId, reviewerCommentPayload(review),
      )
      const posted = {
        identity, status: 'posted', url: result?.url || '',
        repository: review.repository, pr_number: review.number,
      }
      setPublicPosts(current => ({ ...current, [identity]: posted }))
      setSendStates(current => ({ ...current, [identity]: { phase: 'sent' } }))
      window.mobius?.signal?.('reviewer_comment_sent', {
        repository: review.repository, number: review.number,
      })
    } catch (error) {
      let authoritative = null
      try {
        const result = await fetchReviewerComments(token, appId)
        const rows = Array.isArray(result?.comments) ? result.comments : []
        setPublicPosts(Object.fromEntries(rows.map(item => [item.identity, item])))
        authoritative = rows.find(item => item.identity === identity) || null
      } catch { /* The original bounded error remains the useful state. */ }
      if (authoritative?.status === 'posted') {
        setSendStates(current => ({ ...current, [identity]: { phase: 'sent' } }))
      } else if (['posting', 'uncertain', 'superseded'].includes(authoritative?.status)) {
        setSendStates(current => ({ ...current, [identity]: { phase: authoritative.status } }))
      } else {
        const message = error?.status === 403
          ? 'Ask Möbius in chat to send this exact review comment.'
          : error?.status === 409
            ? 'The PR or stored review changed. Refresh before sending.'
            : error?.message || 'The comment was not sent.'
        setSendStates(current => ({ ...current, [identity]: { phase: 'error', message } }))
      }
    }
  }, [appId, token])

  const retryReview = useCallback(async review => {
    await requestReviewRetry(review)
    try {
      await runReviewerJob(token, appId)
    } catch {
      // The durable one-shot request remains queued for the five-minute job.
    }
  }, [appId, token])

  const active = TABS.find(item => item.id === tab) || TABS[0]
  return <div className="rv-root"><style>{CSS}</style><main className="rv-shell">
    <header className="rv-header">
      <div className="rv-brand"><div className="rv-mark"><ShieldCheck size={22} /></div><div><div className="rv-title">Reviewer</div><div className="rv-subtitle">Constructive QA for every pull request revision</div></div></div>
      <div className="rv-actions"><span className="rv-pill"><span className={`rv-dot ${status?.connected ? 'good' : ''}`} />{status?.connected ? status.snapshot ? `GitHub · snapshot ${formatRelativeTime(snapshotRefreshedAt)}` : `GitHub · ${status.login || 'connected'}` : status ? 'GitHub not connected' : 'GitHub check unavailable'}</span><button className="rv-icon-btn" aria-label="Refresh Reviewer" onClick={refresh} disabled={loading}><RefreshCw size={18} /></button></div>
    </header>
    <nav className="rv-tabs" aria-label="Reviewer sections">{TABS.map(item => { const Icon = item.icon; return <button key={item.id} className={`rv-tab ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}><span className="rv-inline"><Icon size={16} />{item.label}</span></button> })}</nav>
    {message && <section className="rv-card rv-alert" style={{marginBottom:16}}><AlertTriangle size={19} /><div><strong>Refresh needs attention</strong><p className="rv-copy">{message}</p></div></section>}
    {status && !status.connected && !loading
      ? <Empty icon={GitPullRequest} title="Connect GitHub to begin" copy="Reviewer uses your existing Möbius GitHub connection and never exposes its credential to the app." />
      : active.id === 'inbox' ? <InboxView settings={settings} pulls={pulls} ledger={ledger} loading={loading} errors={discoveryErrors.map(item => `${item.repository}: ${item.message}`)} onChooseRepos={() => setTab('repos')} publicPosts={publicPosts} onSendReview={sendReview} onRetryReview={retryReview} sendStates={sendStates} />
        : active.id === 'repos' ? <RepositoriesView repositories={repositories} detectedRepos={detectedRepos} settings={settings} onSettings={updateSettings} loading={loading} />
          : active.id === 'guidance' ? <GuidanceView settings={settings} onSettings={updateSettings} saveState={saveState} />
            : <AutomationView settings={settings} onSettings={updateSettings} grant={grant} grantStatus={grantStatus} grantMatches={grantMatches} grantState={grantState} onPosting={changePosting} ledger={ledger} providerModels={providerModels} providerStatuses={providerStatuses} providerModelsState={providerModelsState} providerStatusState={providerStatusState} />}
  </main></div>
}
