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
  // 1. Does the bug fix work? (60%)
  const bugfix = run('python3 -c "from calc import add; assert add(2,3) == 5"', workDir);

  // 2. Do all tests pass? (20%)
  const tests = run("python3 -m pytest test_calc.py -q --tb=no 2>&1", workDir);
  const passMatch = tests.out.match(/(\d+) passed/);
  const failMatch = tests.out.match(/(\d+) failed/);
  const passed = parseInt(passMatch?.[1] || "0");
  const failed = parseInt(failMatch?.[1] || "0");
  const total = passed + failed;
  const testScore = total > 0 ? (passed / total) * 100 : 0;

  // 3. Did it add new functions? (20%)
  const funcCount = run("grep -c '^def ' calc.py", workDir);
  const funcs = parseInt(funcCount.out.trim() || "1");
  const extendScore = Math.min((funcs - 1) / 3, 1) * 100; // 4+ functions = 100

  return [
    { name: "bugfix", score: bugfix.ok ? 100 : 0, weight: 0.6 },
    { name: "tests", score: testScore, weight: 0.2 },
    { name: "extend", score: extendScore, weight: 0.2 },
  ];
}
