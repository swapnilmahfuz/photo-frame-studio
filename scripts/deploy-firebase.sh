#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/configure-firebase.mjs "$@"
firebase deploy --project kuetconvocationphotoframe27 --only hosting,firestore:rules,database
