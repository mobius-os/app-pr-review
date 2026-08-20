import { splitRepo } from './domain.js'

function headers(token, json = false) {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function readJson(response, fallback) {
  let body = null
  try { body = await response.json() } catch { body = null }
  if (!response.ok) {
    const detail = body?.detail
    const error = new Error(
      typeof detail === 'string' ? detail : detail?.message || fallback,
    )
    error.status = response.status
    error.detail = detail
    throw error
  }
  return body
}

export async function fetchGitHubStatus(token) {
  const response = await fetch('/api/github/status', { headers: headers(token) })
  return readJson(response, 'Could not read the GitHub connection.')
}

export async function fetchProviderModels(token) {
  const response = await fetch('/api/auth/providers/models', { headers: headers(token) })
  return readJson(response, 'Could not read the available review models.')
}

export async function fetchProviderStatuses(token) {
  const response = await fetch('/api/auth/providers/status', { headers: headers(token) })
  return readJson(response, 'Could not read the review-model connection status.')
}

export async function graphql(token, query, variables = {}) {
  const response = await fetch('/api/github/graphql', {
    method: 'POST',
    headers: headers(token, true),
    body: JSON.stringify({ query, variables }),
  })
  const body = await readJson(response, 'GitHub request failed.')
  if (Array.isArray(body?.errors) && body.errors.length) {
    throw new Error(body.errors[0]?.message || 'GitHub returned an error.')
  }
  return body?.data || {}
}

const REPOSITORIES_QUERY = `
  query ReviewerRepositories {
    viewer {
      login
      repositories(
        first: 100
        affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        nodes {
          nameWithOwner
          name
          url
          isPrivate
          pushedAt
          viewerPermission
          owner { login }
        }
      }
    }
  }
`

export async function fetchRepositories(token) {
  const data = await graphql(token, REPOSITORIES_QUERY)
  return {
    login: data?.viewer?.login || '',
    repositories: Array.isArray(data?.viewer?.repositories?.nodes)
      ? data.viewer.repositories.nodes.filter(Boolean)
      : [],
  }
}

const OPEN_PULLS_QUERY = `
  query ReviewerOpenPullRequests($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      nameWithOwner
      pullRequests(
        first: 100
        states: OPEN
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        nodes {
          id
          number
          title
          url
          isDraft
          createdAt
          updatedAt
          headRefOid
          baseRefOid
          additions
          deletions
          changedFiles
          reviewDecision
          mergeable
          author { login avatarUrl }
        }
      }
    }
  }
`

export async function fetchOpenPullRequests(token, fullName) {
  const parts = splitRepo(fullName)
  if (!parts) return []
  const data = await graphql(token, OPEN_PULLS_QUERY, parts)
  const nodes = data?.repository?.pullRequests?.nodes
  return (Array.isArray(nodes) ? nodes : []).filter(Boolean).map(pr => ({
    ...pr,
    repository: data?.repository?.nameWithOwner || fullName,
  }))
}

export async function fetchAllOpenPullRequests(token, repositories) {
  const settled = await Promise.allSettled(
    repositories.map(repo => fetchOpenPullRequests(token, repo)),
  )
  const rows = []
  const errors = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') rows.push(...result.value)
    else errors.push(`${repositories[index]}: ${result.reason?.message || 'failed'}`)
  })
  return { rows, errors }
}

export async function fetchReviewerGrant(token, appId) {
  const response = await fetch(`/api/github/reviewer/${appId}/grant`, {
    headers: headers(token),
  })
  return readJson(response, 'Could not read the automatic-posting grant.')
}

export async function grantReviewerPosting(token, appId, value) {
  const response = await fetch(`/api/github/reviewer/${appId}/grant`, {
    method: 'POST', headers: headers(token, true), body: JSON.stringify(value),
  })
  return readJson(response, 'Could not grant automatic posting.')
}

export async function toggleReviewerGrant(token, appId, enabled) {
  const response = await fetch(`/api/github/reviewer/${appId}/grant/toggle`, {
    method: 'POST', headers: headers(token, true), body: JSON.stringify({ enabled }),
  })
  return readJson(response, 'Could not change automatic posting.')
}

export async function fetchReviewerComments(token, appId) {
  const response = await fetch(`/api/github/reviewer/${appId}/comments`, {
    headers: headers(token),
  })
  return readJson(response, 'Could not read Reviewer comment status.')
}

export async function sendReviewerComment(token, appId, payload) {
  const response = await fetch(`/api/github/reviewer/${appId}/comment/manual`, {
    method: 'POST', headers: headers(token, true), body: JSON.stringify(payload),
  })
  return readJson(response, 'Could not send this Reviewer comment.')
}

export async function runReviewerJob(token, appId) {
  const response = await fetch(`/api/apps/${appId}/run-job`, {
    method: 'POST', headers: headers(token),
  })
  return readJson(response, 'The retry is queued, but Reviewer could not start immediately.')
}
