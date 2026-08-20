# Reviewer

Reviewer watches pull requests in repositories selected by the owner, runs a
two-pass quality-assurance review for each stable revision, tracks findings
across pushes, and can publish bounded comment-only reviews under an explicit
automation grant.

## V1 contract

- The repository picker is the entire watch scope; nothing is silently grouped
  or re-enabled.
- The platform upstream is derived from its Git remote (resolving a fork to its
  parent), while installed catalog apps are derived from their persisted
  manifest origins. These appear as provenance-labelled picker suggestions;
  newly detected repositories remain off until selected.
- Every stable head/base/guidance revision receives a scout pass and an
  independent verifier pass.
- Deterministic size/path/UI triage is included in both passes. Findings whose
  path and line are absent from the bounded patch are discarded.
- Pull-request text and patches are bounded hostile data. The model process has
  no tools and never receives the app or GitHub token.
- Review drafts remain private until a separate platform posting grant is
  active. The runner can only ask that guarded platform boundary to publish an
  exact review identity; it cannot write to GitHub directly.
- A private draft can instead be sent once from its Inbox card after a second
  inline confirmation. That one-off path revalidates the stored draft and live
  PR revision without creating or changing the standing automation grant.
- Automation exposes one pause control, one automatic-posting switch, one daily
  limit shared by reviewed revisions and automatic comments, and a per-PR
  comment limit. Stable draft pull requests are reviewed like other open pull
  requests.
- A provider-capacity failure backs off for an hour and remains visible instead
  of retrying every five minutes.
- Open PRs and accessible repositories are persisted as a five-minute
  background snapshot, so a transient browser connection failure never turns
  a known inbox into a false empty state.
- Workspace and per-repository guidance are editable. The immutable shipped
  guide remains visible, and every review stores its effective guide digest.

## Installation

The package requests Möbius's server-mediated GitHub read/connect capabilities
and a five-minute background schedule. Each installation uses that owner's
GitHub identity. The app never receives the underlying GitHub credential.

Automatic public comments require the companion platform posting-grant surface.
Enabling the app's automatic-posting setting stores a grant limited to the exact
selected repositories, guidance revision, daily posting ceiling, and rounds per
pull request. Without it Reviewer stays private by construction.

Posting identities are exactly-once within one Reviewer installation. Separate
self-hosted Möbius installations do not share a coordination lock, so two owners
reviewing the same revision at the same time can still publish independent
comments. This is an explicit beta limitation rather than a global guarantee.

The hostile-input model adapter currently requires a configured Claude CLI,
because it supports a genuine zero-tool invocation. A Codex-only installation
fails closed and shows a capacity/provider status rather than exposing a shell
to untrusted pull-request content.
