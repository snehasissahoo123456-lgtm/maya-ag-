import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";

export interface ValidationCommandResult {
  script: "lint" | "test" | "build";
  exitCode: number;
  durationMs: number;
  output: string;
}
export interface WorkspaceValidationResult {
  passed: true;
  commands: ValidationCommandResult[];
  sha256: string;
}

type SpawnFunction = (command: string, args: string[], options: SpawnOptions) => ChildProcessWithoutNullStreams;

async function runOne(
  script: ValidationCommandResult["script"],
  cwd: string,
  signal: AbortSignal,
  spawnProcess: SpawnFunction,
): Promise<ValidationCommandResult> {
  const startedAt = Date.now();
  return await new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    const append = (chunk: Buffer | string) => {
      output = (output + chunk.toString()).slice(-12_000);
    };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnProcess("bun", ["run", script], {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
        signal,
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("close", code => {
      if (settled) return;
      settled = true;
      const exitCode = typeof code === "number" ? code : -1;
      resolve({ script, exitCode, durationMs: Date.now() - startedAt, output });
    });
  });
}

export async function runWorkspaceValidation(
  cwd: string,
  signal: AbortSignal,
  spawnProcess: SpawnFunction = spawn as SpawnFunction,
): Promise<WorkspaceValidationResult> {
  const commands: ValidationCommandResult[] = [];
  for (const script of ["lint", "test", "build"] as const) {
    if (signal.aborted) throw new Error("Repository validation was cancelled.");
    const result = await runOne(script, cwd, signal, spawnProcess);
    commands.push(result);
    if (result.exitCode !== 0) {
      throw new Error(`Repository validation failed at 'bun run ${script}' (exit ${result.exitCode}).\n${result.output.slice(-2500)}`);
    }
  }
  const sha256 = createHash("sha256").update(JSON.stringify(commands)).digest("hex");
  return { passed: true, commands, sha256 };
}
