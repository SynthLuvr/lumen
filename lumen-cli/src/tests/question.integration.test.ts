import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");

const QUESTIONS = [
  "I've been feeling fatigued lately and my iron came back low on my last blood test. What should I be looking at?",
  "I want to improve my sleep quality. I track with Oura and my deep sleep is consistently low.",
  "I'm training for a Hyrox in 12 weeks. What should I be taking for recovery?",
];

const runQuestion = (
  question: string,
): Promise<{ code: number; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [
        "--import",
        join(PROJECT_ROOT, "node_modules", "tsx", "dist", "loader.mjs"),
        "src/cli.ts",
        "question",
        question,
      ],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (d) => chunks.push(d as Buffer));
    child.stderr.on("data", (d) => errChunks.push(d as Buffer));

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(chunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
      });
    });
  });

describe.sequential("lumen question — real OpenAI integration", {
  timeout: 120_000,
}, () => {
  for (const [index, question] of QUESTIONS.entries()) {
    it(`answers question ${index + 1} without errors`, async () => {
      const { code, stdout, stderr } = await runQuestion(question);

      // Output the response for visibility
      console.log(`\n══════ Question ${index + 1} ══════`);
      console.log(`Q: ${question}\n`);
      console.log(`A: ${stdout.trim() || "(no output)"}`);
      console.log(`\n${"─".repeat(60)}`);
      if (stderr.trim()) console.log(`[stderr] ${stderr.trim()}`);

      // The only assertion: no errors
      expect(code).toBe(0);
    });
  }
});
