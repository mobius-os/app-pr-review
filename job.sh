#!/bin/bash
set -u
DATA_DIR="${DATA_DIR:-/data}"
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$DATA_DIR/cli-auth/claude}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "${APP_JOB_STATE_DIR:?}" "/data/cron-logs"
python3 "$SCRIPT_DIR/reviewer_runner.py" 2>>/data/cron-logs/pr-review.log
