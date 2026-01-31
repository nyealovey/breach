import { runPowershell } from 'winrm-client';

type TimeoutError = Error & { name: 'TimeoutError' };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const err = new Error(`timeout after ${timeoutMs}ms`) as TimeoutError;
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(timeout);
        resolve(v);
      },
      (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    );
  });
}

function parseJson(text: string, op: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const e = new Error(`${op} returned invalid json: ${err instanceof Error ? err.message : String(err)}`);
    (e as { bodyText?: string }).bodyText = text.slice(0, 2000);
    throw e;
  }
}

export type HypervWinrmOptions = {
  host: string;
  port: number;
  useHttps: boolean;
  rejectUnauthorized: boolean;
  timeoutMs: number;
  username: string;
  password: string;
};

export async function runPowershellWithTimeout(opts: HypervWinrmOptions, script: string): Promise<string> {
  // winrm-client handles Basic vs NTLM based on username format.
  return withTimeout(
    runPowershell(script, opts.host, opts.username, opts.password, opts.port, opts.useHttps, opts.rejectUnauthorized),
    opts.timeoutMs,
  );
}

export async function runPowershellJson<T>(opts: HypervWinrmOptions, script: string, op: string): Promise<T> {
  const text = await runPowershellWithTimeout(opts, script);
  return parseJson(text.trim(), op) as T;
}
