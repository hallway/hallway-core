#!/bin/bash
set -euo pipefail

# Outer evolution loop: run → evolve → commit → rebuild → repeat

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAX_GENERATIONS="${MAX_GENERATIONS:-10}"
ITERATIONS_PER_GEN="${MAX_ITERATIONS:-3}"
SCORE_ITERS="${SCORE_ITERATIONS:-2}"
BUDGET="${HALLWAY_BUDGET:-2.00}"

echo "╔═══════════════════════════════════╗"
echo "║  hallway-core evolution loop      ║"
echo "╚═══════════════════════════════════╝"
echo "  generations: $MAX_GENERATIONS"
echo "  iterations/gen: $ITERATIONS_PER_GEN"
echo "  budget: \$$BUDGET"
echo ""

# Set up Docker network + Playwright screenshot sidecar
NETWORK="hallway-net"
docker network create "$NETWORK" 2>/dev/null || true

# Build and start screenshot sidecar (reused across generations)
docker build -q -t hallway-screenshot "$SCRIPT_DIR/screenshot" > /dev/null 2>&1
docker rm -f hallway-screenshot 2>/dev/null || true
docker run -d --name hallway-screenshot --network "$NETWORK" hallway-screenshot > /dev/null

# Wait for sidecar to be ready
for i in $(seq 1 15); do
  if docker logs hallway-screenshot 2>&1 | grep -q "listening"; then
    echo "  screenshot sidecar ready"
    break
  fi
  sleep 2
done

cleanup() {
  docker rm -f hallway-screenshot 2>/dev/null || true
  docker network rm "$NETWORK" 2>/dev/null || true
}
trap cleanup EXIT

for gen in $(seq 1 "$MAX_GENERATIONS"); do
  echo "══════ generation $gen/$MAX_GENERATIONS ══════"

  # Build image from current source (includes latest improve.ts)
  docker build -q -t hallway-core "$SCRIPT_DIR" > /dev/null 2>&1
  echo "  image built"

  # Run the kernel — let it evolve inside the container
  # Then copy the evolved improve.ts back out
  CONTAINER_ID=$(docker create \
    --entrypoint bun \
    --network "$NETWORK" \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY}" \
    -e SCREENSHOT_URL="http://hallway-screenshot:3000/screenshot" \
    -e MAX_ITERATIONS="$ITERATIONS_PER_GEN" \
    -e SCORE_ITERATIONS="$SCORE_ITERS" \
    -e HALLWAY_BUDGET="$BUDGET" \
    -e HALLWAY_FIXTURE="${HALLWAY_FIXTURE:-}" \
    -v "$SCRIPT_DIR/scoring:/scoring:ro" \
    -v "$SCRIPT_DIR/output:/output" \
    hallway-core run /scoring/score.ts /kernel)

  docker start -a "$CONTAINER_ID" 2>&1 | tee /tmp/hallway-gen-$gen.log || true

  # Extract final score and cost from output
  SCORE=$(grep "^[0-9]\+$" /tmp/hallway-gen-$gen.log | tail -1 || echo "?")
  COST=$(grep "\[cost\] Total:" /tmp/hallway-gen-$gen.log | grep -o '\$[0-9.]\+' | head -1 || echo "$?")

  # Copy evolved kernel back to host
  docker cp "$CONTAINER_ID:/kernel/improve.ts" "$SCRIPT_DIR/improve.ts.evolved" 2>/dev/null || true
  docker rm "$CONTAINER_ID" > /dev/null 2>&1

  # Check if it actually changed
  if [ -f "$SCRIPT_DIR/improve.ts.evolved" ] && ! diff -q "$SCRIPT_DIR/improve.ts" "$SCRIPT_DIR/improve.ts.evolved" > /dev/null 2>&1; then
    mv "$SCRIPT_DIR/improve.ts.evolved" "$SCRIPT_DIR/improve.ts"
    LINES=$(wc -l < "$SCRIPT_DIR/improve.ts" | tr -d ' ')
    echo "  kernel evolved: ${LINES} lines, score $SCORE, cost $COST"

    cd "$SCRIPT_DIR"
    git add improve.ts
    git commit -qm "gen $gen: score $SCORE"
    echo "  committed"
  else
    rm -f "$SCRIPT_DIR/improve.ts.evolved"
    echo "  no evolution this generation (score $SCORE, cost $COST)"
  fi

  echo ""
done

echo "══════ evolution complete ══════"
cd "$SCRIPT_DIR"
git log --oneline | head -20
