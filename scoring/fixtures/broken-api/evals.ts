import { spawnSync } from "bun";

export interface EvalResult {
  name: string;
  score: number;
  weight: number;
}

function run(cmd: string, cwd: string, timeoutMs = 30_000): { ok: boolean; out: string } {
  const result = spawnSync(["bash", "-c", cmd], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  return {
    ok: result.exitCode === 0,
    out: (result.stdout?.toString() || "") + (result.stderr?.toString() || ""),
  };
}

export function evaluate(workDir: string): EvalResult[] {
  // Install deps
  run("bun install 2>&1", workDir, 60_000);

  // 1. Does it start without crashing? (20%)
  const startTest = run(
    "timeout 5 bun -e \"const app = require('./server'); const s = app.listen(3002); setTimeout(() => { s.close(); process.exit(0); }, 2000)\" 2>&1",
    workDir,
  );

  // 2. Run the test suite, count pass/fail (80%)
  const testResult = run("bun test.js 2>&1", workDir, 15_000);
  const passMatch = testResult.out.match(/(\d+) passed/);
  const failMatch = testResult.out.match(/(\d+) failed/);
  const passed = parseInt(passMatch?.[1] || "0");
  const failed = parseInt(failMatch?.[1] || "0");
  const total = passed + failed;
  const testScore = total > 0 ? (passed / total) * 100 : 0;

  return [
    { name: "starts", score: startTest.ok ? 100 : 0, weight: 0.2 },
    { name: "tests", score: testScore, weight: 0.8 },
  ];
}
