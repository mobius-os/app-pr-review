from pathlib import Path
import py_compile


ROOT = Path(__file__).resolve().parents[1]


def test_scheduled_python_entrypoints_compile(tmp_path):
  for name in ("review_engine.py", "reviewer_runner.py"):
    py_compile.compile(
      str(ROOT / name),
      cfile=str(tmp_path / f"{name}.pyc"),
      doraise=True,
    )


def test_scheduled_job_supplies_connected_claude_config_to_cron():
  source = (ROOT / "job.sh").read_text()
  assert 'DATA_DIR="${DATA_DIR:-/data}"' in source
  assert 'export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$DATA_DIR/cli-auth/claude}"' in source
