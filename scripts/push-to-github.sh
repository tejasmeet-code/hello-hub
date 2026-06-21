#!/usr/bin/env bash
set -euo pipefail

TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:-${GIT_TOKEN:-}}"

if [ -z "${TOKEN}" ]; then
  echo "Error: GITHUB_PERSONAL_ACCESS_TOKEN (or GIT_TOKEN) secret is not set" >&2
  exit 1
fi

REPO="github.com/tejasmeet-code/hello-hub.git"
REMOTE_URL="https://${TOKEN}@${REPO}"

BRANCH=$(git --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

echo "Pushing branch '${BRANCH}' to GitHub..."
git push "$REMOTE_URL" "${BRANCH}:${BRANCH}" --force
echo "Done."
