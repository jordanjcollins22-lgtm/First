#!/usr/bin/env bash
# legal-guard.sh <base-sha> <head-sha>
# Fails if any commit in the range changes legal/*.md (except README.md) or
# HASHES.lock without: (a) a `LEGAL:` subject prefix, (b) HASHES.lock in the
# same commit, (c) an author email listed in legal/APPROVERS.
# The single commit that first introduces HASHES.lock is exempt (seed).
set -euo pipefail
base="${1:-}"; head="${2:-HEAD}"

if [ -z "$base" ] || [[ "$base" =~ ^0+$ ]] || ! git cat-file -e "$base" 2>/dev/null; then
  # New branch or unknown base: check only the head commit.
  commits=$(git rev-list --no-merges -n 1 "$head")
else
  commits=$(git rev-list --no-merges "$base".."$head")
fi

fail=0
for c in $commits; do
  changed=$(git diff-tree --no-commit-id --name-only -r "$c" -- legal/ | grep -E '^legal/([^/]+\.md|HASHES\.lock)$' | grep -v '^legal/README.md$' || true)
  [ -z "$changed" ] && continue

  parent=$(git rev-parse "$c^" 2>/dev/null || true)
  if [ -z "$parent" ] || ! git cat-file -e "$parent:legal/HASHES.lock" 2>/dev/null; then
    echo "· $c seeds legal/ (exempt)"
    continue
  fi

  subject=$(git log -1 --format=%s "$c")
  email=$(git log -1 --format=%ae "$c")
  short=${c:0:10}

  if [[ "$subject" != LEGAL:* ]]; then
    echo "✖ $short changes legal text but subject lacks the LEGAL: prefix: \"$subject\""; fail=1
  fi
  if ! echo "$changed" | grep -qx 'legal/HASHES.lock'; then
    echo "✖ $short changes legal text without updating legal/HASHES.lock"; fail=1
  fi
  if ! git show "$c:legal/APPROVERS" | grep -v '^#' | grep -qx "$email"; then
    echo "✖ $short author <$email> is not in legal/APPROVERS"; fail=1
  fi
  # The lock committed in this commit must match the files committed in this commit.
  tmp=$(mktemp -d)
  git archive "$c" legal scripts | tar -x -C "$tmp"
  if ! (cd "$tmp" && node scripts/legal-hash.mjs --check >/dev/null); then
    echo "✖ $short HASHES.lock does not match the legal files in that commit"; fail=1
  fi
  rm -rf "$tmp"
  [ $fail -eq 0 ] && echo "✔ $short LEGAL change OK ($email)"
done

if [ $fail -ne 0 ]; then
  echo
  echo "Legal text may only change via the LEGAL: flow. See legal/README.md."
  exit 1
fi
echo "Legal guard passed."
