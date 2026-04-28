#!/usr/bin/env bash
DIR="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")")" && pwd)"
exec node --experimental-strip-types --no-warnings "$DIR/src/cli/index.ts" "$@"
