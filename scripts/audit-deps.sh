#!/usr/bin/env sh
set -eu
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# No advisory exceptions. Newly reported high/critical findings block deployment.
docker build --target audit --output=type=cacheonly --build-arg NPM_AUDIT_ALLOWLIST= "$repo"
