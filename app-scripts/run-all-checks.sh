#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TERMINAL_VALIDATE="$PROJECT_ROOT/terminal-script/validate-terminal-app-outputs.sh"
TERMINAL_TESTS="$PROJECT_ROOT/terminal-script/test-topology-country-tool.sh"
APP_VALIDATE="$SCRIPT_DIR/validate_topolograph.sh"

echo "=== Run All Checks ==="
echo ""

if [[ ! -x "$TERMINAL_VALIDATE" ]]; then
  echo "ERROR: missing executable $TERMINAL_VALIDATE"
  exit 1
fi
if [[ ! -x "$TERMINAL_TESTS" ]]; then
  echo "ERROR: missing executable $TERMINAL_TESTS"
  exit 1
fi
if [[ ! -x "$APP_VALIDATE" ]]; then
  echo "ERROR: missing executable $APP_VALIDATE"
  exit 1
fi

echo "1) Terminal app output validation"
"$TERMINAL_VALIDATE"
echo ""

echo "2) Terminal app regression tests"
"$TERMINAL_TESTS"
echo ""

echo "3) Main Topolograph validation"
"$APP_VALIDATE"
echo ""

echo "=== ALL CHECKS PASSED ==="
