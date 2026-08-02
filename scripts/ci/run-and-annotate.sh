#!/usr/bin/env bash
#
# Runs a command and, if it fails, republishes the tail of its output as a
# GitHub Actions error annotation.
#
# WHY THIS EXISTS
# ---------------
# Downloading an Actions run log requires admin rights on the repository. A
# contributor — or a maintainer without the GitHub CLI authenticated — sees
# only "Process completed with exit code 101" and has to guess at the cause.
# Annotations, unlike logs, are public on a public repository, so putting the
# compiler's own words there makes a red build diagnosable by anyone who can
# see the repository at all.
#
# Usage:  scripts/ci/run-and-annotate.sh "cargo check" cargo check --all-targets
#
set -uo pipefail

title="$1"
shift

log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}

if [ "$status" -ne 0 ]; then
  # Annotation messages are single-line: % must be escaped first (so the
  # escapes below are not themselves mangled), then newlines encoded.
  message="$(tail -40 "$log" \
    | sed 's/%/%25/g; s/\r/%0D/g' \
    | awk '{ printf "%s%%0A", $0 }')"
  echo "::error title=${title} failed::${message}"
fi

exit "$status"
