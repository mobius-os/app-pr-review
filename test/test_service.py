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


def test_comment_policy_binds_safe_text_to_the_exact_head():
  head = "abcdef1234567890" + "0" * 24
  comment = "### Reviewer: all clear\n\nLooks good.\n\n_Reviewed revision `abcdef123456`._"
  assert service.validate_comment({"head_sha": head, "body": comment})["body"] == comment
  with pytest.raises(service.Rejected, match="active mention"):
    service.validate_comment({"head_sha": head, "body": comment.replace("Looks good.", "Thanks @owner")})


def test_manual_plan_is_bound_to_private_draft_guidance_and_selection(
  tmp_path, monkeypatch,
):
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
  (storage / "settings.json").write_text(json.dumps(settings))
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
  ledger = {"pulls": {f"{repository}#7": record}}
  (storage / "job-state" / "ledger.json").write_text(json.dumps(ledger))
  request = {
    "identity": identity,
    "repository": repository,
    "pr_number": 7,
    "head_sha": head,
    "base_sha": base,
    "guide_hash": guide_hash,
    "body": comment,
  }

  assert service.manual_plan(request)["identity"] == identity
  request["body"] = comment.replace("Clean.", "Changed.")
  with pytest.raises(service.Rejected, match="draft or guidance changed"):
    service.manual_plan(request)
