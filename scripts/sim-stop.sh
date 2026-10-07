#!/usr/bin/env bash
# Stops every local simulation: the fake drivers and the simulator phone drives. Safe to run any time.
pkill -f "ops/src/cli.ts sim live" 2>/dev/null || true
pkill -f "rdv-ops.mjs sim" 2>/dev/null || true
pkill -f "scripts/sim-drive.sh" 2>/dev/null || true
pkill -f "scripts/sim-phone.mjs" 2>/dev/null || true
sleep 1
left=$(pgrep -f "cli.ts sim live|rdv-ops.mjs sim|sim-drive.sh|sim-phone.mjs" | wc -l | tr -d ' ')
echo "simulations still running: $left"
