#!/bin/bash
set -euo pipefail

# Build and run hallway-core with scoring mounted read-only
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building hallway-core..."
docker build -t hallway-core "$SCRIPT_DIR"

echo "Running hallway-core (self-improving)..."
docker run --rm \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY}" \
  -e MAX_ITERATIONS="${MAX_ITERATIONS:-20}" \
  -v "$SCRIPT_DIR/scoring:/scoring:ro" \
  hallway-core
