import importlib.util
import hashlib
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("reviewer_service", ROOT / "service.py")
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)


def test_grant_policy_normalizes_repositories_and_enforces_ceilings():
  result = service.normalize_grant({
    "repositories": ["mobius-os/mobius", "mobius-os/mobius", "owner/app"],
    "guide_hash": "a" * 64,
    "max_rounds_per_pr": 5,
    "daily_post_ceiling": 12,
  })
  assert result["repositories"] == ["mobius-os/mobius", "owner/app"]
  with pytest.raises(service.Rejected, match="daily_post_ceiling"):
    service.normalize_grant({**result, "daily_post_ceiling": 101})


@pytest.mark.parametrize("guide_hash", ["a" * 40, "a" * 63, "a" * 65])
def test_grant_policy_requires_an_exact_sha256_guide_hash(guide_hash):
  with pytest.raises(service.Rejected, match="SHA-256"):
    service.normalize_grant({
      "repositories": ["mobius-os/mobius"],
      "guide_hash": guide_hash,
      "max_rounds_per_pr": 5,
      "daily_post_ceiling": 12,
    })


@pytest.mark.parametrize("head", ["abcdef1234567890" + "0" * 24, "a" * 64])
def test_comment_policy_binds_safe_text_to_the_exact_head(head):
  comment = f"### Reviewer: all clear\n\nLooks good.\n\n_Reviewed revision `{head[:12]}`._"
  assert service.validate_comment({"head_sha": head, "body": comment})["body"] == comment


@pytest.mark.parametrize("length", [39, 41, 63, 65])
def test_comment_policy_rejects_non_git_hash_lengths(length):
  head = "a" * length
  comment = f"### Reviewer: all clear\n\nClean.\n\n_Reviewed revision `{head[:12]}`._"
  with pytest.raises(service.Rejected, match="head SHA"):
    service.validate_comment({"head_sha": head, "body": comment})


@pytest.mark.parametrize("comment", [
  "arbitrary app comment\n\n_Reviewed revision `aaaaaaaaaaaa`._",
  "### Reviewer: QA second look\n\nPing @someone\n\n_Reviewed revision `aaaaaaaaaaaa`._",
  "### Reviewer: QA second look\n\n<img src=x>\n\n_Reviewed revision `aaaaaaaaaaaa`._",
  "### Reviewer: QA second look\n\n![pixel](https://evil.test)\n\n_Reviewed revision `aaaaaaaaaaaa`._",
  "### Reviewer: all clear\n\nClean.\n\n_Reviewed revision `bbbbbbbbbbbb`._",
])
def test_comment_policy_rejects_unbound_or_active_public_content(comment):
  with pytest.raises(service.Rejected):
    service.validate_comment({"head_sha": "a" * 40, "body": comment})


def _manual_case(tmp_path, monkeypatch):
  storage = tmp_path / "storage"
  (storage / "job-state").mkdir(parents=True)
  monkeypatch.setenv("APP_STORAGE_DIR", str(storage))
  monkeypatch.chdir(ROOT)
  repository = "mobius-os/mobius"
  guide = (ROOT / "reviewing.md").read_text().strip()
  settings = {
    "selectedRepos": [repository],
    "customGuidance": "Prefer the smallest durable correction.",
    "repoGuidance": {repository: "Protect owner data."},
  }
  settings_path = storage / "settings.json"
  settings_path.write_text(json.dumps(settings))
  effective = (
    guide + "\n\n---\n\n# Workspace guidance\n\n"
    + settings["customGuidance"]
    + "\n\n---\n\n# Repository guidance\n\n"
    + settings["repoGuidance"][repository]
  )
  guide_hash = hashlib.sha256(effective.encode()).hexdigest()
  head, base, bundle = "a" * 40, "b" * 40, "c" * 64
  identity = service._digest({
    "repository": repository,
    "number": 7,
    "head_sha": head,
    "base_sha": base,
    "guide_hash": guide_hash,
    "bundle_hash": bundle,
  })
  comment = "### Reviewer: all clear\n\nClean.\n\n_Reviewed revision `aaaaaaaaaaaa`._"
  record = {
    "identity": identity,
    "repository": repository,
    "number": 7,
    "head_sha": head,
    "base_sha": base,
    "guide_hash": guide_hash,
    "bundle_hash": bundle,
    "status": "complete",
    "private": True,
    "draft_comment": comment,
  }
  ledger_path = storage / "job-state" / "ledger.json"
  ledger_path.write_text(json.dumps({"pulls": {f"{repository}#7": record}}))
  request = {
    "identity": identity,
    "repository": repository,
    "pr_number": 7,
    "head_sha": head,
    "base_sha": base,
    "guide_hash": guide_hash,
    "body": comment,
  }
  return request, settings_path, ledger_path


def test_manual_plan_is_bound_to_private_draft_guidance_and_selection(
  tmp_path, monkeypatch,
):
  request, _settings, _ledger = _manual_case(tmp_path, monkeypatch)
  assert service.manual_plan(request)["identity"] == request["identity"]
  request["body"] = request["body"].replace("Clean.", "Changed.")
  with pytest.raises(service.Rejected, match="draft or guidance changed"):
    service.manual_plan(request)


@pytest.mark.parametrize(
  "mismatch", ["body", "guide", "identity", "selection", "source", "public"],
)
def test_manual_plan_rejects_every_stale_or_public_draft(
  tmp_path, monkeypatch, mismatch,
):
  request, settings_path, ledger_path = _manual_case(tmp_path, monkeypatch)
  if mismatch == "body":
    request["body"] = request["body"].replace("Clean.", "Changed.")
  elif mismatch == "guide":
    request["guide_hash"] = "d" * 64
  elif mismatch == "identity":
    request["identity"] = "e" * 64
  elif mismatch == "selection":
    settings = json.loads(settings_path.read_text())
    settings["selectedRepos"] = []
    settings_path.write_text(json.dumps(settings))
  elif mismatch == "source":
    monkeypatch.setattr(service, "_read_guide", lambda: "# Changed Reviewer guide")
  else:
    ledger = json.loads(ledger_path.read_text())
    ledger["pulls"]["mobius-os/mobius#7"]["private"] = False
    ledger_path.write_text(json.dumps(ledger))
  with pytest.raises(service.Rejected, match="draft|guidance|selected"):
    service.manual_plan(request)
