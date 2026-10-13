import { spawn, type ChildProcess } from "node:child_process";
import { delimiter } from "node:path";

const activeProcesses = new Set<ChildProcess>();

export function killAllActiveProcesses(): void {
  for (const child of activeProcesses) {
    try {
      child.kill(process.platform === "win32" ? undefined : "SIGKILL");
    } catch {
      // Ignore process cleanup errors
    }
  }
  activeProcesses.clear();
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  onProgress?: (percentage: number) => void
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const extraPath = home ? `${home}/bin${delimiter}${home}/.local/bin${delimiter}` : "";
    const env = {
      ...process.env,
      PATH: `${extraPath}${process.env.PATH || ""}`
    };

    const child = spawn(command, args, { windowsHide: true, shell: false, env });
    activeProcesses.add(child);

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill(process.platform === "win32" ? undefined : "SIGKILL");
      finish(new Error(`${command} timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeProcesses.delete(child);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (onProgress) {
        const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (match && match[1]) {
          onProgress(Math.min(100, Math.round(parseFloat(match[1]))));
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish();
      else {
        console.error(`[process error] ${command} exited with code ${code}:`, stderr || stdout);
        finish(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}
