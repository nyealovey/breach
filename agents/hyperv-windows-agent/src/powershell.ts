import { spawn } from 'node:child_process';

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
  scriptPath: string;
  scriptArgs?: string[];
  timeoutMs: number;
}): Promise<unknown> {
  const scriptArgs = args.scriptArgs ?? [];
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', args.scriptPath, ...scriptArgs],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (buf) => {
    stdout += buf.toString('utf8');
  });
  child.stderr.on('data', (buf) => {
    stderr += buf.toString('utf8');
  });

  const timeout = setTimeout(() => {
    // Best-effort kill; Windows will terminate the process.
    child.kill('SIGKILL');
  }, args.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code ?? null));
  });

  clearTimeout(timeout);

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
