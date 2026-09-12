#!/usr/bin/env python3
"""Reviewer-owned draft, guidance, and comment policy."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path


REPO = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
SHA = re.compile(r"^[0-9a-f]{40,64}$")
RAW_MENTION = re.compile(r"@[A-Za-z0-9_-]")
RAW_HTML = re.compile(r"<\s*/?\s*[A-Za-z][^>]*>")
MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\(")
LEDGER_MAX_BYTES = 4 * 1024 * 1024
SETTINGS_MAX_BYTES = 256 * 1024
GUIDE_MAX_BYTES = 256 * 1024


class Rejected(ValueError):
  def __init__(self, status: int, message: str):
    super().__init__(message)
    self.status = status


def _read_json(path: Path, limit: int) -> dict:
  try:
    with path.open("rb") as handle:
      raw = handle.read(limit + 1)
    if len(raw) > limit:
      raise ValueError("oversized")
    value = json.loads(raw)
  except (OSError, UnicodeDecodeError, ValueError) as exc:
    raise Rejected(409, "The stored Reviewer draft is unavailable; refresh it before sending.") from exc
  if not isinstance(value, dict):
    raise Rejected(409, "The stored Reviewer draft is unavailable; refresh it before sending.")
  return value


def _read_guide() -> str:
  try:
    with Path("reviewing.md").open("rb") as handle:
      raw = handle.read(GUIDE_MAX_BYTES + 1)
    if len(raw) > GUIDE_MAX_BYTES:
      raise ValueError("oversized")
    return raw.decode("utf-8").strip()
  except (OSError, UnicodeDecodeError, ValueError) as exc:
    raise Rejected(409, "Reviewer guidance is unavailable; refresh the review before sending.") from exc


def _digest(value: object) -> str:
  raw = json.dumps(
    value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
  ).encode("utf-8")
  return hashlib.sha256(raw).hexdigest()


def normalize_grant(body: dict) -> dict:
  repositories = body.get("repositories")
  if not isinstance(repositories, list):
    raise Rejected(422, "repositories must be a list")
  repos = sorted({str(value).strip() for value in repositories})
  if not repos or len(repos) > 100 or any(REPO.fullmatch(repo) is None for repo in repos):
    raise Rejected(422, "repositories must contain 1-100 owner/name values")
  guide_hash = str(body.get("guide_hash") or "").lower()
  if SHA.fullmatch(guide_hash) is None:
    raise Rejected(422, "guide_hash must be a SHA-256 digest")
  max_rounds = body.get("max_rounds_per_pr")
  daily_ceiling = body.get("daily_post_ceiling")
  if isinstance(max_rounds, bool) or not isinstance(max_rounds, int) or not 1 <= max_rounds <= 20:
    raise Rejected(422, "max_rounds_per_pr must be between 1 and 20")
  if isinstance(daily_ceiling, bool) or not isinstance(daily_ceiling, int) or not 1 <= daily_ceiling <= 100:
    raise Rejected(422, "daily_post_ceiling must be between 1 and 100")
  return {
    "repositories": repos,
    "guide_hash": guide_hash,
    "max_rounds_per_pr": max_rounds,
    "daily_post_ceiling": daily_ceiling,
  }


def validate_comment(body: dict) -> dict:
  head_sha = str(body.get("head_sha") or "").lower()
  comment = str(body.get("body") or "").strip()
  if SHA.fullmatch(head_sha) is None:
    raise Rejected(422, "Reviewer comment head SHA is invalid.")
  if not comment or len(comment) > 30_000:
    raise Rejected(422, "Reviewer comment must contain 1-30000 characters.")
  if not (
    comment.startswith("### Reviewer: QA second look\n")
    or comment.startswith("### Reviewer: all clear\n")
  ):
    raise Rejected(422, "Reviewer comment has an invalid heading.")
  if not comment.endswith(f"_Reviewed revision `{head_sha[:12]}`._"):
    raise Rejected(409, "Reviewer comment is not bound to the claimed revision.")
  if RAW_MENTION.search(comment) or RAW_HTML.search(comment) or MARKDOWN_IMAGE.search(comment):
    raise Rejected(422, "Reviewer comment contains active mention or remote markup.")
  return {"body": comment, "head_sha": head_sha}


def manual_plan(body: dict) -> dict:
  storage = Path(os.environ["APP_STORAGE_DIR"])
  ledger = _read_json(storage / "job-state" / "ledger.json", LEDGER_MAX_BYTES)
  settings = _read_json(storage / "settings.json", SETTINGS_MAX_BYTES)
  pulls = ledger.get("pulls")
  if not isinstance(pulls, dict) or len(pulls) > 500:
    raise Rejected(409, "The stored Reviewer draft is unavailable; refresh it before sending.")

  repository = str(body.get("repository") or "").strip()
  number = body.get("pr_number")
  record = pulls.get(f"{repository}#{number}")
  if not isinstance(record, dict):
    matches = [
      value for value in pulls.values()
      if isinstance(value, dict)
      and str(value.get("repository") or "").casefold() == repository.casefold()
      and value.get("number") == number
    ]
    record = matches[0] if len(matches) == 1 else None
  if not isinstance(record, dict):
    raise Rejected(409, "This exact private Reviewer draft no longer exists.")

  selected = settings.get("selectedRepos")
  if (
    not isinstance(selected, list)
    or repository.casefold() not in {
      str(value).strip().casefold() for value in selected if isinstance(value, str)
    }
  ):
    raise Rejected(409, "This repository is no longer selected in Reviewer.")

  custom = settings.get("customGuidance")
  repo_guidance = settings.get("repoGuidance")
  if not isinstance(custom, str) or not isinstance(repo_guidance, dict):
    raise Rejected(409, "Reviewer guidance changed; refresh the review before sending.")
  repo_extra = repo_guidance.get(repository)
  if repo_extra is None:
    for key, value in repo_guidance.items():
      if str(key).casefold() == repository.casefold():
        repo_extra = value
        break
  if repo_extra is not None and not isinstance(repo_extra, str):
    raise Rejected(409, "Reviewer guidance changed; refresh the review before sending.")
  guide_parts = [_read_guide()]
  if custom.strip():
    guide_parts.append("# Workspace guidance\n\n" + custom.strip())
  if str(repo_extra or "").strip():
    guide_parts.append("# Repository guidance\n\n" + str(repo_extra).strip())
  guide_hash = hashlib.sha256("\n\n---\n\n".join(guide_parts).encode()).hexdigest()
  identity = _digest({
    "repository": repository.lower(),
    "number": number,
    "head_sha": str(body.get("head_sha") or "").lower(),
    "base_sha": str(body.get("base_sha") or "").lower(),
    "guide_hash": guide_hash,
    "bundle_hash": str(record.get("bundle_hash") or "").lower(),
  })
  exact = (
    record.get("status") == "complete"
    and record.get("private") is True
    and str(record.get("identity") or "").lower() == str(body.get("identity") or "").lower()
    and identity == str(body.get("identity") or "").lower()
    and str(record.get("repository") or "").casefold() == repository.casefold()
    and record.get("number") == number
    and str(record.get("head_sha") or "").lower() == str(body.get("head_sha") or "").lower()
    and str(record.get("base_sha") or "").lower() == str(body.get("base_sha") or "").lower()
    and str(record.get("guide_hash") or "").lower() == guide_hash
    and str(record.get("draft_comment") or "") == str(body.get("body") or "")
    and str(body.get("guide_hash") or "").lower() == guide_hash
  )
  if not exact:
    raise Rejected(409, "The draft or guidance changed; refresh the review before sending.")
  comment = validate_comment({
    "body": str(record["draft_comment"]),
    "head_sha": str(record["head_sha"]).lower(),
  })["body"]
  return {
    "identity": identity,
    "repository": str(record["repository"]),
    "pr_number": int(record["number"]),
    "head_sha": str(record["head_sha"]).lower(),
    "base_sha": str(record["base_sha"]).lower(),
    "guide_hash": guide_hash,
    "body": comment,
  }


def handle(request: dict) -> dict:
  if request.get("schema") != 1:
    raise Rejected(400, "unsupported request schema")
  body = request.get("body")
  if not isinstance(body, dict):
    raise Rejected(400, "Reviewer policy requires an object body.")
  routes = {
    "reviewer/normalize-grant": normalize_grant,
    "reviewer/validate-comment": validate_comment,
    "reviewer/manual-plan": manual_plan,
  }
  policy = routes.get(request.get("path"))
  if policy is None:
    raise Rejected(404, "unknown Reviewer policy")
  return {"status": 200, "body": policy(body)}


if __name__ == "__main__":
  try:
    response = handle(json.load(sys.stdin))
  except Rejected as exc:
    response = {"status": exc.status, "body": {"detail": str(exc)}}
  except Exception as exc:
    print(f"Reviewer service failed: {exc}", file=sys.stderr)
    raise SystemExit(1)
  print(json.dumps(response, separators=(",", ":")))
