#!/bin/bash
# Serve fixture outputs locally for preview.
# Open http://localhost:3000 to see available games.
# Refresh after each generation to see progress.

PORT="${1:-3000}"
DIR="$(cd "$(dirname "$0")" && pwd)/output"

if ! command -v bunx &> /dev/null; then
  echo "Need bun installed. Run: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

echo "Serving $DIR on http://localhost:$PORT"
echo "Open http://localhost:$PORT/{fixture}/index.html"
echo ""
cd "$DIR" && bunx serve -l "$PORT" .
