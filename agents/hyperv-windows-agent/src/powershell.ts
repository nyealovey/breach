import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

export class PowerShellExecError extends Error {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, input: { exitCode: number | null; stdout: string; stderr: string }) {
    super(message);
    this.name = 'PowerShellExecError';
    this.exitCode = input.exitCode;
    this.stdout = input.stdout;
    this.stderr = input.stderr;
  }
}

export class PowerShellParseError extends Error {
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, input: { stdout: string; stderr: string }) {
    super(message);
    this.name = 'PowerShellParseError';
    this.stdout = input.stdout;
    this.stderr = input.stderr;
  }
}

function excerpt(text: string, limit = 2000): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

export async function runPowerShellJsonFile(args: {
  powershellExe?: string;
  scriptPath: string;
  scriptArgs?: string[];
  timeoutMs: number;
}): Promise<unknown> {
  const powershellExe = args.powershellExe ?? 'powershell.exe';
  const scriptArgs = args.scriptArgs ?? [];
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn(
      powershellExe,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', args.scriptPath, ...scriptArgs],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    ) as ChildProcessByStdio<null, Readable, Readable>;
  } catch (err) {
    // In Bun, spawn can throw synchronously (e.g. missing executable). Convert it into a
    // typed error so the HTTP handler can return a stable error response instead of crashing.
    throw new PowerShellExecError('powershell spawn failed', {
      exitCode: null,
      stdout: '',
      stderr: excerpt(err instanceof Error ? err.message : String(err)),
    });
  }

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (buf) => {
    stdout += buf.toString('utf8');
  });
  child.stderr.on('data', (buf) => {
    stderr += buf.toString('utf8');
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    // Best-effort kill; Windows will terminate the process.
    timedOut = true;
    child.kill('SIGKILL');
  }, args.timeoutMs);

  const exit = await new Promise<{ exitCode: number | null; spawnError?: unknown }>((resolve) => {
    let done = false;
    const finish = (value: { exitCode: number | null; spawnError?: unknown }) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    child.on('error', (err) => finish({ exitCode: null, spawnError: err }));
    child.on('close', (code) => finish({ exitCode: code ?? null }));
  });

  clearTimeout(timeout);

  if (exit.spawnError) {
    throw new PowerShellExecError('powershell failed to start', {
      exitCode: null,
      stdout: excerpt(stdout),
      stderr: excerpt(exit.spawnError instanceof Error ? exit.spawnError.message : String(exit.spawnError)),
    });
  }

  const exitCode = exit.exitCode;
  if (timedOut) {
    throw new PowerShellExecError('powershell timed out', {
      exitCode: exitCode ?? -1,
      stdout: excerpt(stdout),
      stderr: excerpt(stderr),
    });
  }

  if (exitCode !== 0) {
    throw new PowerShellExecError('powershell exited non-zero', {
      exitCode,
      stdout: excerpt(stdout),
      stderr: excerpt(stderr),
    });
  }

  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new PowerShellParseError('powershell output is not valid json', {
      stdout: excerpt(stdout),
      stderr: excerpt(stderr),
    });
  }
}
