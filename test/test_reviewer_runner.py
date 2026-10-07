import json
import os
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import reviewer_runner as runner  # noqa: E402
REAL_DISCOVER_REPOSITORIES = runner.discover_mobius_repositories
REAL_SYNC_PUBLIC_COMMENT_STATUS = runner.sync_public_comment_status


@pytest.fixture(autouse=True)
def no_live_repository_derivation(monkeypatch):
  monkeypatch.setattr(runner, "discover_mobius_repositories", lambda: [])
  monkeypatch.setattr(runner, "sync_public_comment_status", lambda _pulls: False)


@pytest.mark.parametrize(("message", "status", "delay"), [
  ("Not logged in · Please run /login", "provider_setup_required", 5 * 60),
  ("No configured background provider has a zero-tool adapter", "provider_setup_required", 5 * 60),
  ("The scout review agent setting is invalid", "review_agent_setup_required", 5 * 60),
  ("You've hit your session limit", "waiting_for_capacity", 60 * 60),
  ("usage limit reached", "waiting_for_capacity", 60 * 60),
  ("invalid model JSON", "waiting_for_model", 15 * 60),
])
def test_model_failure_classifier(message, status, delay):
  assert runner.classify_model_failure(message) == (status, delay)


def test_legacy_login_failures_are_relabelled_without_losing_identity():
  ledger = {
    "last_status": "waiting_for_capacity",
    "model_retry_after_epoch": 9999999999,
    "pulls": {"mobius-os/mobius#42": {
      "identity": "a" * 64,
      "status": "waiting_for_capacity",
      "failed_at": "2026-08-19T13:50:12Z",
      "retry_after_epoch": 9999999999,
      "error": "Not logged in · Please run /login",
    }},
  }
  assert runner.normalize_legacy_model_waits(ledger) is True
  record = ledger["pulls"]["mobius-os/mobius#42"]
  assert record["identity"] == "a" * 64
  assert record["status"] == "provider_setup_required"
  assert "retry_after_epoch" not in record
  assert ledger["last_status"] == "provider_setup_required"
  assert "model_retry_after_epoch" not in ledger


def test_settings_pause_and_ceilings(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": True, "revisionsPerDay": 7},
  }))
  value = runner.load_settings()
  assert value["paused"] is True
  assert value["daily_ceiling"] == 7
  assert value["comments_per_pr"] == 5
  assert value["review_agents"] == {
    "scout": runner.DEFAULT_REVIEW_AGENT,
    "verifier": runner.DEFAULT_REVIEW_AGENT,
  }


def test_legacy_automation_controls_migrate_to_one_safe_model(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  (tmp_path / "settings.json").write_text(json.dumps({
    "automation": {
      "automaticReviewing": False, "automaticPosting": True,
      "privateMode": True, "includeDrafts": False,
      "revisionsPerDay": 50, "postsPerDay": 12, "roundsPerPr": 9,
    },
  }))
  value = runner.load_settings()
  assert value["paused"] is True
  assert value["automatic_posting"] is False
  assert value["daily_ceiling"] == 12
  assert value["comments_per_pr"] == 9
  assert "include_drafts" not in value


def test_partial_and_incompatible_agent_settings_normalize_like_the_ui(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  (tmp_path / "settings.json").write_text(json.dumps({
    "automation": {"reviewAgents": {
      "scout": {
        "provider": "claude", "model": "claude-fable-5", "effort": "max",
      },
    }},
  }))
  assert runner.load_settings()["review_agents"] == {
    "scout": {"provider": "claude", "model": "claude-fable-5", "effort": "high"},
    "verifier": runner.DEFAULT_REVIEW_AGENT,
  }


def test_collector_never_passes_github_credentials_to_model(monkeypatch):
  captured = {}
  monkeypatch.setattr(runner, "TOKEN", "super-secret-github-proxy-token")
  monkeypatch.setattr(runner, "resolve_model_choice", lambda *_args: {
    "provider": "claude", "model": None, "effort": None,
  })
  monkeypatch.setattr(runner, "_claude_result", lambda prompt, **kwargs: (
    captured.setdefault("prompts", []).append(prompt)
    or '{"summary":"clear","findings":[]}'
  ))
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 1, "head_sha": "a" * 40,
    "base_sha": "b" * 40, "diff": "+safe", "files": [],
  })
  runner.run_two_pass(bundle, "guide")
  assert len(captured["prompts"]) == 2
  assert all("super-secret" not in prompt for prompt in captured["prompts"])


def test_verifier_refetches_evidence_and_aborts_if_revision_moved(monkeypatch):
  monkeypatch.setattr(runner, "resolve_model_choice", lambda *_args: {
    "provider": "claude", "model": None, "effort": None,
  })
  calls = []
  monkeypatch.setattr(runner, "_claude_result", lambda *_args, **_kwargs: (
    calls.append("model") or '{"summary":"clear","findings":[]}'
  ))
  first = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 1,
    "head_sha": "a" * 40, "base_sha": "b" * 40,
  })
  moved = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 1,
    "head_sha": "c" * 40, "base_sha": "b" * 40,
  })
  with pytest.raises(runner.RevisionChanged):
    runner.run_two_pass(
      first, "guide", refresh_bundle=lambda: calls.append("refetch") or moved,
    )
  assert calls == ["model", "refetch"]


def test_model_process_environment_excludes_github_authority(monkeypatch, tmp_path):
  captured = {}
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path)
  monkeypatch.setenv("APP_TOKEN", "collector-secret")
  monkeypatch.setenv("GH_TOKEN", "github-secret")
  monkeypatch.setenv("CLAUDE_CONFIG_DIR", "/safe/provider-auth")
  monkeypatch.setattr(runner.subprocess, "run", lambda *args, **kwargs: (
    captured.update({"args": args, **kwargs}) or type("Result", (), {
      "returncode": 0, "stdout": '{"summary":"ok","findings":[]}', "stderr": "",
    })()
  ))
  runner._claude_result("review this")
  assert captured["env"]["CLAUDE_CONFIG_DIR"] == "/safe/provider-auth"
  assert "APP_TOKEN" not in captured["env"]
  assert "GH_TOKEN" not in captured["env"]
  command = captured["args"][0]
  assert command[command.index("--tools") + 1] == ""
  assert command[command.index("--mcp-config") + 1] == '{"mcpServers":{}}'
  assert command[command.index("--max-turns") + 1] == "10"
  assert "--strict-mcp-config" in command
  # CLI-side structured output must stay off: its harness intermittently drops
  # an empty findings array and kills every clean review pass.
  assert "--json-schema" not in command


def test_codex_review_agent_configuration_fails_closed():
  try:
    runner.resolve_model_choice({
      "provider": "codex", "model": "gpt-5.6-terra", "effort": "xhigh",
    }, "scout")
  except RuntimeError as exc:
    assert "no-tools" in str(exc)
  else:
    raise AssertionError("unsafe provider configuration was accepted")


def test_app_owned_review_agent_uses_explicit_override_without_fallback(monkeypatch):
  captured = {}
  class FakeModule:
    @staticmethod
    def resolve_background_agents(data_dir, override):
      captured.update({"data_dir": data_dir, "override": override})
      return {"primary": override["primary"], "fallback": None}

  monkeypatch.setitem(sys.modules, "app.background_agents", FakeModule)
  requested = {
    "provider": "claude", "model": "claude-opus-5", "effort": "max",
  }
  assert runner.resolve_model_choice(requested, "verifier") == requested
  assert captured == {
    "data_dir": "/data",
    "override": {"primary": requested, "fallback": None},
  }


@pytest.mark.parametrize("choice", [
  {"provider": "claude", "model": "--tools", "effort": "xhigh"},
  {"provider": "claude", "model": "claude-opus-5", "effort": "ultracode"},
  {"provider": "claude", "model": "", "effort": "high"},
])
def test_invalid_review_agent_choice_fails_before_model_execution(choice):
  with pytest.raises(RuntimeError, match="review agent setting"):
    runner.resolve_model_choice(choice, "scout")


def test_scout_and_verifier_use_their_own_saved_choices(monkeypatch):
  choices = {
    "scout": {"provider": "claude", "model": "claude-fable-5", "effort": "high"},
    "verifier": {"provider": "claude", "model": "claude-opus-5", "effort": "max"},
  }
  monkeypatch.setattr(runner, "resolve_model_choice", lambda raw, _role: dict(raw))
  calls = []
  monkeypatch.setattr(runner, "_claude_result", lambda _prompt, **kwargs: (
    calls.append(kwargs) or '{"summary":"clear","findings":[]}'
  ))
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 1,
    "head_sha": "a" * 40, "base_sha": "b" * 40,
  })
  result = runner.run_two_pass(bundle, "guide", review_agents=choices)
  assert calls == [
    {"model": "claude-fable-5", "effort": "high"},
    {"model": "claude-opus-5", "effort": "max"},
  ]
  assert result["review_agents"] == choices


def test_github_collection_paginates_without_silently_dropping_rows(monkeypatch):
  calls = []
  def github(path):
    calls.append(path)
    if path.endswith("page=1"):
      return [{"id": index} for index in range(100)]
    return [{"id": 100}]
  monkeypatch.setattr(runner, "_github", github)
  rows = runner._github_pages("repos/a/b/pulls?state=open", max_rows=160)
  assert len(rows) == 101
  assert calls == [
    "repos/a/b/pulls?state=open&per_page=100&page=1",
    "repos/a/b/pulls?state=open&per_page=100&page=2",
  ]


def test_repository_derivation_uses_platform_and_installed_manifest_origins(monkeypatch):
  monkeypatch.setattr(runner, "platform_repository", lambda: "mobius-os/mobius")
  monkeypatch.setattr(runner, "resolve_parent_repository", lambda repo: repo)
  monkeypatch.setattr(runner, "_json_request", lambda *_args: [
    {"name": "Memory", "manifest_url": "https://raw.githubusercontent.com/mobius-os/app-memory/main/mobius.json"},
    {"name": "Local", "manifest_url": None},
  ])
  rows = REAL_DISCOVER_REPOSITORIES()
  assert rows == [
    {"nameWithOwner": "mobius-os/app-memory", "provenance": "Installed app manifest", "provenanceDetail": "Memory"},
    {"nameWithOwner": "mobius-os/mobius", "provenance": "Platform upstream", "provenanceDetail": "Derived from the platform Git remote"},
  ]


@pytest.mark.parametrize(("message", "expected_status", "expected_delay"), [
  ("usage limit", "waiting_for_capacity", runner.MODEL_BACKOFF_SECONDS),
  ("Not logged in · Please run /login", "provider_setup_required", runner.PROVIDER_SETUP_RETRY_SECONDS),
  ("The verifier review agent setting is invalid", "review_agent_setup_required", runner.PROVIDER_SETUP_RETRY_SECONDS),
  ("temporary malformed response", "waiting_for_model", runner.MODEL_RETRY_SECONDS),
])
def test_model_failure_is_durable_and_classified(
  tmp_path, monkeypatch, message, expected_status, expected_delay,
):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [{
    "number": 1, "draft": False, "updated_at": "2026-01-01T00:00:00Z",
  }])
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 1,
    "head_sha": "a" * 40, "base_sha": "b" * 40,
  })
  monkeypatch.setattr(runner, "collect_bundle", lambda *_: (bundle, "full"))
  monkeypatch.setattr(
    runner, "run_two_pass", lambda *_, **__: (
      (_ for _ in ()).throw(runner.ReviewModelUnavailable(message))
    ),
  )
  before = runner.time.time()
  assert runner.run() == 0
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  record = ledger["pulls"]["mobius-os/mobius#1"]
  assert record["status"] == expected_status
  assert before + expected_delay <= record["retry_after_epoch"] <= runner.time.time() + expected_delay
  assert ledger["last_status"] == expected_status
  if expected_status == "waiting_for_model":
    # One transient model failure backs off only its own revision; the run
    # keeps moving instead of standing the whole provider down.
    assert "model_retry_after_epoch" not in ledger
  else:
    assert ledger["model_retry_after_epoch"] == record["retry_after_epoch"]
    assert ledger["model_retry_status"] == expected_status
  assert [event["kind"] for event in ledger["events"]] == ["review_attempt"]


def test_provider_choice_failure_is_a_model_failure(monkeypatch):
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 1,
    "head_sha": "a" * 40, "base_sha": "b" * 40,
  })
  monkeypatch.setattr(runner, "resolve_model_choice", lambda *_args: (
    (_ for _ in ()).throw(RuntimeError("No configured background provider"))
  ))
  with pytest.raises(runner.ReviewModelUnavailable, match="No configured"):
    runner.run_two_pass(bundle, "guide")


def test_prune_drops_only_provably_closed_pull_records():
  ledger = {
    "pulls": {
      "mobius-os/mobius#1": {"identity": "a" * 64, "status": "complete"},
      "mobius-os/mobius#2": {"identity": "b" * 64, "status": "waiting_for_model"},
      "mobius-os/app-memory#3": {"identity": "c" * 64, "status": "provider_setup_required"},
      "mobius-os/app-store#4": {"identity": "d" * 64, "status": "waiting_for_capacity"},
    },
    "model_retry_after_epoch": 9999999999,
    "model_retry_status": "waiting_for_model",
    "model_retry_identity": "b" * 64,
  }
  assert runner.prune_closed_pull_records(
    ledger,
    # app-memory's listing failed this run; app-store is not selected.
    listed_repositories={"mobius-os/mobius"},
    candidate_keys={"mobius-os/mobius#1"},
  ) is True
  assert set(ledger["pulls"]) == {
    "mobius-os/mobius#1", "mobius-os/app-memory#3", "mobius-os/app-store#4",
  }
  # The provider backoff outlives its pruned owner and expires on its own.
  assert ledger["model_retry_after_epoch"] == 9999999999


def test_run_prunes_closed_pull_records_with_listing_proof(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius", "mobius-os/app-memory"],
    "automation": {"paused": False},
  }))
  runner.LEDGER_PATH.parent.mkdir(parents=True)
  runner.LEDGER_PATH.write_text(json.dumps({
    "schema": 1, "events": [], "pulls": {
      "mobius-os/mobius#1": {"identity": "a" * 64, "status": "complete"},
      "mobius-os/mobius#2": {"identity": "b" * 64, "status": "waiting_for_model"},
      "mobius-os/app-memory#3": {"identity": "c" * 64, "status": "provider_setup_required"},
      "other/repo#4": {"identity": "d" * 64, "status": "complete"},
    },
  }))
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: [])
  def pulls(repo):
    if repo == "mobius-os/app-memory":
      raise RuntimeError("GitHub unavailable")
    # Recently updated, so the debounce skips it without any model work.
    return [{"number": 1, "draft": False, "updated_at": runner.utc_now()}]
  monkeypatch.setattr(runner, "list_open_prs", pulls)

  assert runner.run() == 0
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  # #2 is provably closed (its repo listed cleanly, it was absent) — pruned.
  # #3's repo failed to list and #4's repo is unselected — both kept.
  assert set(ledger["pulls"]) == {
    "mobius-os/mobius#1", "mobius-os/app-memory#3", "other/repo#4",
  }


def test_single_model_flake_does_not_starve_other_reviews(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [
    {"number": 1, "draft": False, "updated_at": "2026-01-01T00:00:00Z"},
    {"number": 2, "draft": False, "updated_at": "2026-01-02T00:00:00Z"},
  ])
  def collect(repo, pr, _previous=None):
    return runner.ReviewBundle.build({
      "repository": repo, "number": pr["number"],
      "head_sha": ("a" if pr["number"] == 2 else "c") * 40, "base_sha": "b" * 40,
    }), "full"
  monkeypatch.setattr(runner, "collect_bundle", collect)
  def two_pass(bundle, *_args, **_kwargs):
    if bundle.number == 2:
      raise runner.ReviewModelUnavailable("temporary malformed response")
    return {"verified": {"summary": "clear", "findings": []}}
  monkeypatch.setattr(runner, "run_two_pass", two_pass)

  assert runner.run() == 0
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  # The newer PR flaked and queued for retry; the older one still completed.
  assert ledger["pulls"]["mobius-os/mobius#2"]["status"] == "waiting_for_model"
  assert ledger["pulls"]["mobius-os/mobius#1"]["status"] == "complete"
  assert "model_retry_after_epoch" not in ledger
  assert ledger["last_status"] == "waiting_for_model"
  assert [event["kind"] for event in ledger["events"]] == ["review_attempt", "review"]


def test_repeated_model_failures_stand_the_runner_down(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [
    {"number": 1, "draft": False, "updated_at": "2026-01-01T00:00:00Z"},
    {"number": 2, "draft": False, "updated_at": "2026-01-02T00:00:00Z"},
    {"number": 3, "draft": False, "updated_at": "2026-01-03T00:00:00Z"},
  ])
  def collect(repo, pr, _previous=None):
    return runner.ReviewBundle.build({
      "repository": repo, "number": pr["number"],
      "head_sha": (chr(ord("a") + pr["number"])) * 40, "base_sha": "b" * 40,
    }), "full"
  monkeypatch.setattr(runner, "collect_bundle", collect)
  attempts = []
  def two_pass(bundle, *_args, **_kwargs):
    attempts.append(bundle.number)
    raise runner.ReviewModelUnavailable("temporary malformed response")
  monkeypatch.setattr(runner, "run_two_pass", two_pass)

  assert runner.run() == 0
  # The second consecutive failure reads as provider-wide: stand down, and
  # never even attempt the third candidate.
  assert attempts == [3, 2]
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  assert ledger["model_retry_status"] == "waiting_for_model"
  assert float(ledger["model_retry_after_epoch"]) > runner.time.time()
  assert ledger["last_status"] == "waiting_for_model"
  assert "mobius-os/mobius#1" not in ledger["pulls"]


def test_capacity_failure_after_a_flake_stands_down_immediately(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [
    {"number": 1, "draft": False, "updated_at": "2026-01-01T00:00:00Z"},
    {"number": 2, "draft": False, "updated_at": "2026-01-02T00:00:00Z"},
    {"number": 3, "draft": False, "updated_at": "2026-01-03T00:00:00Z"},
  ])
  def collect(repo, pr, _previous=None):
    return runner.ReviewBundle.build({
      "repository": repo, "number": pr["number"],
      "head_sha": (chr(ord("a") + pr["number"])) * 40, "base_sha": "b" * 40,
    }), "full"
  monkeypatch.setattr(runner, "collect_bundle", collect)
  attempts = []
  def two_pass(bundle, *_args, **_kwargs):
    attempts.append(bundle.number)
    if bundle.number == 3:
      raise runner.ReviewModelUnavailable("temporary malformed response")
    raise runner.ReviewModelUnavailable("usage limit reached")
  monkeypatch.setattr(runner, "run_two_pass", two_pass)

  assert runner.run() == 0
  # A provider-wide condition never spends the second flake slot: the capacity
  # failure right after a flake arms the hour-long stand-down at once.
  assert attempts == [3, 2]
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  assert ledger["model_retry_status"] == "waiting_for_capacity"
  assert ledger["last_status"] == "waiting_for_capacity"
  assert ledger["pulls"]["mobius-os/mobius#2"]["status"] == "waiting_for_capacity"
  assert "mobius-os/mobius#1" not in ledger["pulls"]


def test_global_model_backoff_keeps_discovery_fresh_without_trying_another_pr(
  tmp_path, monkeypatch,
):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  runner.LEDGER_PATH.parent.mkdir(parents=True)
  runner.LEDGER_PATH.write_text(json.dumps({
    "schema": 1, "pulls": {}, "events": [],
    "model_retry_after_epoch": runner.time.time() + 600,
    "model_retry_status": "waiting_for_model",
  }))
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: [])
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [{
    "number": 2, "title": "Still discovered", "updated_at": "2026-01-01T00:00:00Z",
  }])
  monkeypatch.setattr(runner, "collect_bundle", lambda *_args: (
    (_ for _ in ()).throw(AssertionError("global backoff collected a model bundle"))
  ))

  assert runner.run() == 0
  discovery = json.loads((tmp_path / "discovery.json").read_text())
  assert discovery["pulls"][0]["number"] == 2
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  assert ledger["last_status"] == "waiting_for_model"


def test_manual_retry_command_is_bound_to_exact_failed_attempt(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  identity = "a" * 64
  record = {
    "identity": identity, "repository": "mobius-os/mobius", "number": 818,
    "head_sha": "b" * 40, "status": "waiting_for_model",
    "failed_at": "2026-08-19T20:11:14Z", "retry_after_epoch": 9999999999,
  }
  ledger = {"pulls": {"mobius-os/mobius#818": record}}
  directory = runner._retry_request_dir()
  directory.mkdir(parents=True)
  path = directory / f"{identity}.json"
  path.write_text(json.dumps({
    "schema": 1, "identity": identity, "repository": "mobius-os/mobius",
    "number": 818, "head_sha": "b" * 40,
    "failed_at": "2026-08-19T20:11:14Z",
  }))
  requests = runner.load_manual_retry_requests(ledger)
  assert list(requests) == ["mobius-os/mobius#818"]
  assert requests["mobius-os/mobius#818"]["path"] == path

  path.write_text(json.dumps({
    **requests["mobius-os/mobius#818"]["value"],
    "failed_at": "2026-08-19T20:12:00Z",
  }))
  assert runner.load_manual_retry_requests(ledger) == {}
  assert not path.exists()


def test_manual_retry_bypasses_its_gate_without_clearing_another_global_wait(
  tmp_path, monkeypatch,
):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  pull = {
    "number": 818, "draft": False, "updated_at": "2026-01-01T00:00:00Z",
  }
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 818,
    "head_sha": "b" * 40, "base_sha": "c" * 40,
  })
  identity = runner.review_identity(bundle, "guide").key
  other_identity = "d" * 64
  failed_at = "2026-08-19T20:11:14Z"
  future = runner.time.time() + 3600
  runner.LEDGER_PATH.parent.mkdir(parents=True)
  runner.LEDGER_PATH.write_text(json.dumps({
    "schema": 1,
    "pulls": {
      "mobius-os/mobius#818": {
        "identity": identity, "repository": "mobius-os/mobius", "number": 818,
        "head_sha": bundle.head_sha, "status": "waiting_for_model",
        "failed_at": failed_at, "retry_after_epoch": future,
      },
      "mobius-os/mobius#999": {
        "identity": other_identity, "repository": "mobius-os/mobius", "number": 999,
        "head_sha": "e" * 40, "status": "waiting_for_model",
        "failed_at": "2026-08-19T20:10:00Z", "retry_after_epoch": future,
      },
    },
    "events": [], "last_status": "waiting_for_model",
    "model_retry_after_epoch": future, "model_retry_status": "waiting_for_model",
    "model_retry_identity": other_identity,
  }))
  request_dir = runner._retry_request_dir()
  request_dir.mkdir()
  request_path = request_dir / f"{identity}.json"
  request_path.write_text(json.dumps({
    "schema": 1, "identity": identity, "repository": "mobius-os/mobius",
    "number": 818, "head_sha": bundle.head_sha, "failed_at": failed_at,
  }))
  calls = []
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: [])
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [pull])
  monkeypatch.setattr(runner, "collect_bundle", lambda *_args: (bundle, "full"))
  monkeypatch.setattr(runner, "run_two_pass", lambda *_args, **_kwargs: (
    calls.append("review") or {
      "scout": {"summary": "clear", "findings": []},
      "verified": {"summary": "clear", "findings": []},
    }
  ))

  assert runner.run() == 0
  assert calls == ["review"]
  assert not request_path.exists()
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  assert ledger["pulls"]["mobius-os/mobius#818"]["status"] == "complete"
  assert ledger["model_retry_identity"] == other_identity
  assert ledger["model_retry_after_epoch"] == future
  assert ledger["last_status"] == "waiting_for_model"


def test_discovery_failure_preserves_manual_retry_request(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  identity = "a" * 64
  failed_at = "2026-08-19T20:11:14Z"
  runner.LEDGER_PATH.parent.mkdir(parents=True)
  runner.LEDGER_PATH.write_text(json.dumps({
    "schema": 1, "events": [], "pulls": {"mobius-os/mobius#818": {
      "identity": identity, "repository": "mobius-os/mobius", "number": 818,
      "head_sha": "b" * 40, "status": "waiting_for_model",
      "failed_at": failed_at, "retry_after_epoch": runner.time.time() + 600,
    }},
  }))
  request_dir = runner._retry_request_dir()
  request_dir.mkdir()
  request_path = request_dir / f"{identity}.json"
  request_path.write_text(json.dumps({
    "schema": 1, "identity": identity, "repository": "mobius-os/mobius",
    "number": 818, "head_sha": "b" * 40, "failed_at": failed_at,
  }))
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: [])
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: (
    (_ for _ in ()).throw(RuntimeError("GitHub unavailable"))
  ))

  assert runner.run() == 0
  assert request_path.exists()


def test_manual_retry_revision_change_releases_pending_button(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  pull = {"number": 818, "draft": False, "updated_at": "2026-01-01T00:00:00Z"}
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 818,
    "head_sha": "b" * 40, "base_sha": "c" * 40,
  })
  identity = runner.review_identity(bundle, "guide").key
  failed_at = "2026-08-19T20:11:14Z"
  runner.LEDGER_PATH.parent.mkdir(parents=True)
  runner.LEDGER_PATH.write_text(json.dumps({
    "schema": 1, "events": [], "pulls": {"mobius-os/mobius#818": {
      "identity": identity, "repository": "mobius-os/mobius", "number": 818,
      "head_sha": bundle.head_sha, "status": "waiting_for_model",
      "failed_at": failed_at, "retry_after_epoch": runner.time.time() + 600,
    }},
  }))
  request_dir = runner._retry_request_dir()
  request_dir.mkdir()
  request_path = request_dir / f"{identity}.json"
  request_path.write_text(json.dumps({
    "schema": 1, "identity": identity, "repository": "mobius-os/mobius",
    "number": 818, "head_sha": bundle.head_sha, "failed_at": failed_at,
  }))
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: [])
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [pull])
  monkeypatch.setattr(runner, "collect_bundle", lambda *_args: (bundle, "full"))
  monkeypatch.setattr(runner, "run_two_pass", lambda *_args, **_kwargs: (
    (_ for _ in ()).throw(runner.RevisionChanged("moved"))
  ))

  assert runner.run() == 0
  assert not request_path.exists()
  record = json.loads(runner.LEDGER_PATH.read_text())["pulls"]["mobius-os/mobius#818"]
  assert record["status"] == "waiting_for_evidence"
  assert record["failed_at"] != failed_at


def test_completed_identity_never_creates_a_duplicate_draft(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  pull = {"number": 1, "draft": False, "updated_at": "2026-01-01T00:00:00Z"}
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [pull])
  item = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 1,
    "head_sha": "a" * 40, "base_sha": "b" * 40,
  })
  identity = runner.review_identity(item, "guide")
  runner.LEDGER_PATH.parent.mkdir(parents=True)
  runner.LEDGER_PATH.write_text(json.dumps({
    "schema": 1, "pulls": {
      "mobius-os/mobius#1": {
        "identity": identity.key, "status": "complete",
        "head_sha": item.head_sha, "findings": [],
      },
    }, "events": [{"kind": "review", "identity": identity.key}],
  }))
  monkeypatch.setattr(runner, "collect_bundle", lambda *_args: (item, "full"))
  monkeypatch.setattr(runner, "run_two_pass", lambda *_args, **_kwargs: (
    (_ for _ in ()).throw(AssertionError("duplicate model pass ran"))
  ))

  assert runner.run() == 0
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  assert len(ledger["pulls"]) == 1
  assert len([event for event in ledger["events"] if event["kind"] == "review"]) == 1


def test_legacy_skipped_placeholder_reenters_the_normal_review_queue(
  tmp_path, monkeypatch,
):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False},
  }))
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [{
    "number": 42, "draft": False, "updated_at": "2026-01-01T00:00:00Z",
  }])
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 42,
    "head_sha": "b" * 40, "base_sha": "c" * 40,
  })
  runner.LEDGER_PATH.parent.mkdir(parents=True)
  runner.LEDGER_PATH.write_text(json.dumps({
    "schema": 1, "pulls": {"mobius-os/mobius#42": {
      "repository": "mobius-os/mobius", "number": 42, "status": "skipped",
      "head_sha": "a" * 40,
    }}, "events": [],
  }))
  calls = []
  monkeypatch.setattr(runner, "collect_bundle", lambda *_args: (bundle, "full"))
  monkeypatch.setattr(runner, "run_two_pass", lambda *_args, **_kwargs: (
    calls.append("review") or {
      "scout": {"summary": "clear", "findings": []},
      "verified": {"summary": "clear", "findings": []},
    }
  ))

  assert runner.run() == 0
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  assert calls == ["review"]
  assert ledger["pulls"]["mobius-os/mobius#42"]["status"] == "complete"
  assert ledger["last_status"] == "ok"


def test_exact_skipped_revision_stays_skipped(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"], "automation": {"paused": False},
  }))
  pull = {"number": 42, "updated_at": "2026-01-01T00:00:00Z"}
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 42,
    "head_sha": "b" * 40, "base_sha": "c" * 40,
  })
  identity = runner.review_identity(bundle, "guide").key
  runner.LEDGER_PATH.parent.mkdir(parents=True)
  runner.LEDGER_PATH.write_text(json.dumps({
    "schema": 1, "events": [], "pulls": {"mobius-os/mobius#42": {
      "identity": identity, "repository": "mobius-os/mobius", "number": 42,
      "head_sha": bundle.head_sha, "status": "skipped",
    }},
  }))
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [pull])
  monkeypatch.setattr(runner, "collect_bundle", lambda *_args: (bundle, "full"))
  monkeypatch.setattr(runner, "run_two_pass", lambda *_args, **_kwargs: (
    (_ for _ in ()).throw(AssertionError("skipped revision was reviewed"))
  ))

  assert runner.run() == 0
  ledger = json.loads(runner.LEDGER_PATH.read_text())
  assert ledger["pulls"]["mobius-os/mobius#42"]["status"] == "skipped"


def test_guidance_config_hash_is_stable_across_repo_key_order(tmp_path, monkeypatch):
  guide = tmp_path / "reviewing.md"
  guide.write_text("base guide\n")
  monkeypatch.setattr(runner, "GUIDE_PATH", guide)
  one = {
    "custom_guidance": "custom", "repo_guidance": {"b/repo": "b", "a/repo": "a"},
  }
  two = {
    "custom_guidance": "custom", "repo_guidance": {"a/repo": "a", "b/repo": "b"},
  }
  assert runner.guidance_config_hash(one) == runner.guidance_config_hash(two)


def test_newest_revision_wins_global_queue(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  monkeypatch.setattr(runner, "MAX_REVISIONS_PER_RUN", 1)
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["old/repo", "new/repo"],
    "automation": {"paused": False},
  }))
  def pulls(repo):
    return [{
      "number": 1, "draft": False,
      "updated_at": "2026-08-18T10:00:00Z" if repo == "old/repo" else "2026-08-18T20:00:00Z",
    }]
  monkeypatch.setattr(runner, "list_open_prs", pulls)
  reviewed = []
  def collect(repo, pr, _previous=None):
    reviewed.append(repo)
    return runner.ReviewBundle.build({
      "repository": repo, "number": pr["number"],
      "head_sha": ("a" if repo == "new/repo" else "c") * 40,
      "base_sha": "b" * 40,
    }), "full"
  monkeypatch.setattr(runner, "collect_bundle", collect)
  monkeypatch.setattr(runner, "run_two_pass", lambda *_, **__: {
    "verified": {"summary": "clear", "findings": []},
  })
  assert runner.run() == 0
  assert reviewed == ["new/repo"]


def test_paused_runner_still_refreshes_discovery(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": True},
  }))
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: [{
    "nameWithOwner": "mobius-os/mobius", "viewerPermission": "WRITE",
  }])
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [{
    "id": 7, "number": 42, "title": "Improve Reviewer", "draft": False,
    "html_url": "https://github.com/mobius-os/mobius/pull/42",
    "updated_at": "2026-08-18T20:00:00Z", "user": {"login": "author"},
    "head": {"sha": "a" * 40}, "base": {"sha": "b" * 40},
  }])
  monkeypatch.setattr(runner, "run_two_pass", lambda *_args, **_kwargs: (
    (_ for _ in ()).throw(AssertionError("paused review ran model work"))
  ))

  assert runner.run() == 0
  discovery = json.loads((tmp_path / "discovery.json").read_text())
  assert discovery["pulls"][0]["repository"] == "mobius-os/mobius"
  assert discovery["pulls"][0]["author"]["login"] == "author"
  assert discovery["repositories"][0]["viewerPermission"] == "WRITE"
  assert discovery["errors"] == []
  ledger = json.loads((tmp_path / "job-state" / "ledger.json").read_text())
  assert ledger["last_status"] == "paused"


def test_posting_includes_every_completed_result_when_automation_allows_it():
  settings = {
    "automatic_posting": True, "paused": False,
    "selected_repos": ["mobius-os/mobius"],
    "custom_guidance": "", "repo_guidance": {},
    "daily_ceiling": 50, "comments_per_pr": 10,
  }
  grant = {
    "enabled": True, "repositories": ["mobius-os/mobius"],
    "guide_hash": runner.guidance_config_hash(settings),
    "daily_post_ceiling": 50, "max_rounds_per_pr": 10,
  }
  assert runner.should_post_review(settings, grant) is True
  assert runner.should_post_review({**settings, "automatic_posting": False}, grant) is False
  assert runner.should_post_review({**settings, "paused": True}, grant) is False
  assert runner.should_post_review(settings, {**grant, "daily_post_ceiling": 12}) is False


def test_held_completed_review_retries_when_daily_capacity_returns(monkeypatch):
  settings = {
    "automatic_posting": True, "paused": False,
    "selected_repos": ["mobius-os/mobius"],
    "custom_guidance": "", "repo_guidance": {},
    "daily_ceiling": 50, "comments_per_pr": 10,
  }
  grant = {
    "enabled": True, "repositories": ["mobius-os/mobius"],
    "guide_hash": runner.guidance_config_hash(settings),
    "daily_post_ceiling": 50, "max_rounds_per_pr": 10,
    "daily_window": None, "daily_posts_used": 0,
  }
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 42,
    "head_sha": "a" * 40, "base_sha": "b" * 40,
  })
  record = {
    "identity": "c" * 64, "private": True, "post_status": "held",
    "draft_comment": runner.render_review([], head_sha=bundle.head_sha),
  }
  monkeypatch.setattr(runner, "post_review_comment", lambda **_kwargs: {
    "url": "https://github.test/review/42",
  })
  assert runner.try_post_completed_review(settings, bundle, record, grant) is True
  assert record["private"] is False
  assert record["post_status"] == "posted"


def test_platform_post_audit_reconciles_manual_comment_into_runner_ledger(monkeypatch):
  identity = "1" * 64
  pulls = {"mobius-os/mobius#42": {
    "identity": identity, "private": True, "findings": [{"lifecycle": "new"}],
  }}
  monkeypatch.setattr(runner, "STORAGE_DIR", Path("/tmp/12"))
  monkeypatch.setattr(runner, "_json_request", lambda *_args: {"comments": [{
    "identity": identity, "status": "posted", "url": "https://github.test/review/1",
  }]})
  assert REAL_SYNC_PUBLIC_COMMENT_STATUS(pulls) is True
  assert pulls["mobius-os/mobius#42"]["post_status"] == "posted"
  assert pulls["mobius-os/mobius#42"]["private"] is False
  assert pulls["mobius-os/mobius#42"]["post_url"] == "https://github.test/review/1"


def test_one_inaccessible_repository_does_not_block_other_discovery(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["gone/repo", "good/repo"],
    "automation": {"paused": True},
  }))
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: [])
  def pulls(repository):
    if repository == "gone/repo":
      raise RuntimeError("not found")
    return [{"number": 9, "title": "Available", "updated_at": "2026-01-01T00:00:00Z"}]
  monkeypatch.setattr(runner, "list_open_prs", pulls)

  assert runner.run() == 0
  discovery = json.loads((tmp_path / "discovery.json").read_text())
  assert [row["repository"] for row in discovery["pulls"]] == ["good/repo"]
  assert discovery["errors"] == [{"repository": "gone/repo", "message": "not found"}]


def test_failed_repository_retains_last_known_open_prs_as_stale(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["flaky/repo"],
    "automation": {"paused": True},
  }))
  (tmp_path / "discovery.json").write_text(json.dumps({
    "pulls": [{
      "repository": "flaky/repo", "number": 4, "title": "Last known PR",
    }],
    "repositories": [], "detectedRepos": [],
  }))
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: [])
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: (
    (_ for _ in ()).throw(RuntimeError("temporary outage"))
  ))

  assert runner.run() == 0
  discovery = json.loads((tmp_path / "discovery.json").read_text())
  assert discovery["pulls"] == [{
    "repository": "flaky/repo", "number": 4, "title": "Last known PR",
    "snapshotStale": True,
  }]


def _settled_fixture(tmp_path, monkeypatch, *, automatic_posting=False):
  monkeypatch.setattr(runner, "TOKEN", "app-token")
  monkeypatch.setattr(runner, "STATE_DIR", tmp_path / "job-state")
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  monkeypatch.setattr(runner, "LEDGER_PATH", tmp_path / "job-state" / "ledger.json")
  monkeypatch.setattr(runner, "GUIDE_PATH", tmp_path / "reviewing.md")
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: [])
  monkeypatch.setattr(runner, "load_posting_grant", lambda: None)
  (tmp_path / "reviewing.md").write_text("guide")
  (tmp_path / "settings.json").write_text(json.dumps({
    "selectedRepos": ["mobius-os/mobius"],
    "automation": {"paused": False, "automaticPosting": automatic_posting},
  }))
  bundle = runner.ReviewBundle.build({
    "repository": "mobius-os/mobius", "number": 5,
    "head_sha": "a" * 40, "base_sha": "b" * 40,
  })
  identity = runner.review_identity(bundle, "guide")
  runner.LEDGER_PATH.parent.mkdir(parents=True)
  runner.LEDGER_PATH.write_text(json.dumps({"schema": 1, "events": [], "pulls": {
    "mobius-os/mobius#5": {
      "identity": identity.key, "status": "complete", "private": True,
      "head_sha": bundle.head_sha, "base_sha": bundle.base_sha,
      "guide_hash": identity.guide_hash, "findings": [], "draft_comment": "x",
    },
  }}))
  listing = {
    "number": 5, "updated_at": "2026-01-01T00:00:00Z",
    "head": {"sha": "a" * 40}, "base": {"sha": "b" * 40},
  }
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [dict(listing)])
  fetches = []
  monkeypatch.setattr(runner, "collect_bundle", lambda *_args: (
    fetches.append("bundle") or (bundle, "full")
  ))
  monkeypatch.setattr(runner, "run_two_pass", lambda *_args, **_kwargs: (
    (_ for _ in ()).throw(AssertionError("settled revision was reviewed again"))
  ))
  return listing, fetches


def test_unchanged_listing_skips_pull_detail_and_files_fetch(tmp_path, monkeypatch):
  _listing, fetches = _settled_fixture(tmp_path, monkeypatch)

  assert runner.run() == 0  # first run confirms the identity from a full fetch
  assert runner.run() == 0  # second run settles it from the listing alone
  assert fetches == ["bundle"]
  record = json.loads(runner.LEDGER_PATH.read_text())["pulls"]["mobius-os/mobius#5"]
  assert record["listed_updated_at"] == "2026-01-01T00:00:00Z"


def test_listing_with_new_updated_at_refetches_the_bundle(tmp_path, monkeypatch):
  listing, fetches = _settled_fixture(tmp_path, monkeypatch)
  assert runner.run() == 0
  listing["updated_at"] = "2026-01-02T00:00:00Z"
  monkeypatch.setattr(runner, "list_open_prs", lambda _repo: [dict(listing)])

  assert runner.run() == 0
  assert fetches == ["bundle", "bundle"]


def test_completed_review_awaiting_automatic_post_is_never_settled_from_listing(
  tmp_path, monkeypatch,
):
  _listing, fetches = _settled_fixture(tmp_path, monkeypatch, automatic_posting=True)

  assert runner.run() == 0
  assert runner.run() == 0
  assert fetches == ["bundle", "bundle"]


def test_discovery_reuses_the_repository_list_within_its_max_age(tmp_path, monkeypatch):
  monkeypatch.setattr(runner, "STORAGE_DIR", tmp_path)
  calls = []
  monkeypatch.setattr(runner, "list_accessible_repositories", lambda: (
    calls.append("list") or [{"nameWithOwner": "mobius-os/mobius"}]
  ))
  settings = {"selected_repos": ["mobius-os/mobius"]}

  runner.save_discovery(settings, [], [])
  runner.save_discovery(settings, [], [])
  assert calls == ["list"]
  discovery = json.loads((tmp_path / "discovery.json").read_text())
  assert discovery["repositories"] == [{"nameWithOwner": "mobius-os/mobius"}]

  discovery["repositoriesListedEpoch"] -= runner.REPOSITORY_LIST_MAX_AGE_SECONDS + 1
  (tmp_path / "discovery.json").write_text(json.dumps(discovery))
  runner.save_discovery(settings, [], [])
  assert calls == ["list", "list"]
