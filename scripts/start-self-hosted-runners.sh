#!/usr/bin/env bash
set -euo pipefail

# Start all GitHub Actions self-hosted runners that are already configured for this repo.
# This is intended for the local Mac runner pool used by GitHub Actions workflows.
#
# Usage:
#   ./scripts/start-self-hosted-runners.sh
#
# Expected runner folders:
#   ~/actions-runner-1
#   ~/actions-runner-2
#   ~/actions-runner-3
#   ~/actions-runner-4

runner_ids=(1 2 3 4)

for runner_id in "${runner_ids[@]}"; do
  runner_dir="$HOME/actions-runner-$runner_id"

  if [[ ! -d "$runner_dir" ]]; then
    echo "[WARN] Runner directory not found: $runner_dir"
    continue
  fi

  if [[ ! -x "$runner_dir/svc.sh" ]]; then
    echo "[WARN] svc.sh not found for runner $runner_id in $runner_dir"
    continue
  fi

  echo "===== Starting runner $runner_id ====="
  (cd "$runner_dir" && ./svc.sh install || true)
  (cd "$runner_dir" && ./svc.sh start || true)
  (cd "$runner_dir" && ./svc.sh status || true)
  echo
 done
