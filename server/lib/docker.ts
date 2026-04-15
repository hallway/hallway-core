/**
 * Container lifecycle management.
 *
 * Each organism runs in its own container on the hallway network.
 * The container gets a copy of its kernel (improve.ts variant)
 * and talks to the hallway server for everything.
 */

import { spawnSync } from "child_process";

const NETWORK = "hallway-net";
const IMAGE = "hallway-organism";
// On macOS, containers reach the host via host.docker.internal
const HOST_URL = process.env.HALLWAY_HOST_URL || "http://host.docker.internal:4000";

function exec(cmd: string): { ok: boolean; out: string } {
  const r = spawnSync("bash", ["-c", cmd], { encoding: "utf-8", timeout: 30_000 });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

/** Ensure the Docker network exists. */
export function ensureNetwork() {
  exec(`docker network create ${NETWORK} 2>/dev/null`);
}

/** Build the organism container image. */
export function buildImage(dockerfilePath: string) {
  const r = exec(`docker build -q -t ${IMAGE} ${dockerfilePath}`);
  if (!r.ok) throw new Error("failed to build organism image: " + r.out.slice(0, 200));
}

/** Spawn a new organism container. Returns container ID. */
export function spawnContainer(
  organismId: string,
  token: string,
  kernelPath: string,
  _serverUrl?: string,
): string {
  const serverUrl = HOST_URL;
  // The organism container runs its kernel, which talks to hallway via HALLWAY_URL
  // Kernel is mounted read-write so the organism can self-improve
  const r = exec([
    "docker create",
    `--name org-${organismId}`,
    `--network ${NETWORK}`,
    `-e HALLWAY_URL=${serverUrl}`,
    `-e HALLWAY_TOKEN=${token}`,
    `-e ORGANISM_ID=${organismId}`,
    `-v ${kernelPath}:/kernel/improve.ts`,
    IMAGE,
  ].join(" "));

  if (!r.ok) throw new Error("failed to create container: " + r.out.slice(0, 200));
  const containerId = r.out.trim();

  exec(`docker start ${containerId}`);
  return containerId;
}

/** Kill and remove a container. */
export function killContainer(organismId: string) {
  exec(`docker rm -f org-${organismId} 2>/dev/null`);
}

/** Check if a container is still running. */
export function isRunning(organismId: string): boolean {
  const r = exec(`docker inspect -f '{{.State.Running}}' org-${organismId} 2>/dev/null`);
  return r.ok && r.out.trim() === "true";
}

/** Get all running organism container IDs. */
export function listRunning(): string[] {
  const r = exec(`docker ps --filter "network=${NETWORK}" --filter "name=org-" --format "{{.Names}}" 2>/dev/null`);
  if (!r.ok) return [];
  return r.out.trim().split("\n").filter(Boolean).map(name => name.replace("org-", ""));
}

/** Start the screenshot sidecar if not running. */
export function ensureScreenshotSidecar(screenshotDir: string) {
  const running = exec(`docker inspect -f '{{.State.Running}}' hallway-screenshot 2>/dev/null`);
  if (running.ok && running.out.trim() === "true") return;

  exec("docker rm -f hallway-screenshot 2>/dev/null");
  exec([
    "docker run -d",
    "--name hallway-screenshot",
    `--network ${NETWORK}`,
    "hallway-screenshot",
  ].join(" "));
}
