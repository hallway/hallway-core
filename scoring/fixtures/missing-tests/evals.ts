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
  // Run the test suite
  const testResult = run("bash test.sh 2>&1", workDir);
  const passMatch = testResult.out.match(/(\d+) passed/);
  const failMatch = testResult.out.match(/(\d+) failed/);
  const passed = parseInt(passMatch?.[1] || "0");
  const failed = parseInt(failMatch?.[1] || "0");
  const total = passed + failed;

  // 1. Did it add any tests at all? (40%)
  const hasTests = total > 0 ? 100 : 0;

  // 2. Do the tests pass? (30%)
  const passRate = total > 0 ? (passed / total) * 100 : 0;

  // 3. Coverage — are all 5 functions tested? (30%)
  // Count how many function names appear in test.sh
  const testFile = run("cat test.sh", workDir);
  const funcs = ["reverse", "word_count", "to_upper", "is_palindrome", "repeat_string"];
  const tested = funcs.filter(f => testFile.out.includes(f)).length;
  const coverageScore = (tested / funcs.length) * 100;

  return [
    { name: "has_tests", score: hasTests, weight: 0.4 },
    { name: "pass_rate", score: passRate, weight: 0.3 },
    { name: "coverage", score: coverageScore, weight: 0.3 },
  ];
}
