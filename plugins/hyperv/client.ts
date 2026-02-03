import { runPowershell } from 'winrm-client';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lookup, reverse } from 'node:dns/promises';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { XMLBuilder, XMLParser } from 'fast-xml-parser';

import { buildKerberosPrincipalCandidates, buildKinitArgs } from './kerberos';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type TimeoutError = Error & { name: 'TimeoutError' };

function toBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
}

const HYPERV_DEBUG =
  toBooleanValue(process.env.ASSET_LEDGER_HYPERV_DEBUG) ?? toBooleanValue(process.env.ASSET_LEDGER_DEBUG) ?? false;

const WINRM_DEBUG_EXCERPT_LIMIT = 2000;

function excerpt(text: string, limit = WINRM_DEBUG_EXCERPT_LIMIT): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

type HttpHeaderSummary = {
  header_blocks: number;
  www_authenticate_schemes: string[];
  server?: string;
  content_type?: string;
  content_length?: number;
};

function parseHttpHeaderSummary(text: string): HttpHeaderSummary | null {
  const lines = text.split(/\r?\n/);
  const blocks: Array<Record<string, string[]>> = [];
  let current: Record<string, string[]> | null = null;

  for (const line of lines) {
    if (line.startsWith('HTTP/')) {
      if (current) blocks.push(current);
      current = {};
      continue;
    }
    if (!current) continue;

    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!name || !value) continue;

    if (!current[name]) current[name] = [];
    current[name].push(value);
  }

  if (current) blocks.push(current);
  if (blocks.length === 0) return null;

  const last = blocks[blocks.length - 1]!;
  const www = last['www-authenticate'] ?? [];
  const schemes = www
    .map((v) => v.trim().split(/\s+/)[0])
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  const www_authenticate_schemes = Array.from(new Set(schemes));

  const server = (last.server ?? []).map((v) => v.trim()).find((v) => v.length > 0);

  const contentType = (last['content-type'] ?? []).map((v) => v.trim()).find((v) => v.length > 0);
  const contentLengthText = (last['content-length'] ?? []).map((v) => v.trim()).find((v) => v.length > 0);
  const contentLength = contentLengthText ? Number(contentLengthText) : NaN;

  return {
    header_blocks: blocks.length,
    www_authenticate_schemes,
    ...(server ? { server } : {}),
    ...(contentType ? { content_type: contentType } : {}),
    ...(Number.isFinite(contentLength) ? { content_length: contentLength } : {}),
  };
}

function summarizeValue(value: unknown, maxKeys = 50): Record<string, unknown> {
  if (value === null) return { type: 'null' };

  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      ...(value.length > 0 ? { first: summarizeValue(value[0], maxKeys) } : {}),
    };
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return { type: 'string', length: value.length, excerpt: excerpt(value, 200) };
    return { type: typeof value };
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  return { type: 'object', key_count: keys.length, keys: keys.slice(0, maxKeys) };
}

function summarizeTopLevelArrayLengths(value: unknown, maxKeys = 50): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(obj).slice(0, maxKeys)) {
    if (Array.isArray(val)) out[key] = val.length;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function debugLog(message: string, data?: unknown, meta?: { runId?: string; host?: string }) {
  if (!HYPERV_DEBUG) return;
  try {
    const logsDir = join(process.cwd(), 'logs');
    mkdirSync(logsDir, { recursive: true });
    const logFile = join(logsDir, `hyperv-winrm-debug-${new Date().toISOString().slice(0, 10)}.log`);
    const payload = {
      ts: new Date().toISOString(),
      level: 'debug',
      component: 'hyperv.winrm',
      ...(meta?.runId ? { run_id: meta.runId } : {}),
      ...(meta?.host ? { host: meta.host } : {}),
      message,
      ...(data !== undefined ? { data } : {}),
    };
    appendFileSync(logFile, `${JSON.stringify(payload)}\n`);
  } catch {
    // ignore
  }
}

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

export type HypervAuthMethod = 'auto' | 'basic' | 'ntlm' | 'kerberos';

export type HypervWinrmOptions = {
  host: string;
  port: number;
  useHttps: boolean;
  rejectUnauthorized: boolean;
  timeoutMs: number;
  username: string;
  password: string;
  authMethod: HypervAuthMethod;
  domain?: string;
  rawUsername: string;
};

export type HypervWinrmMeta = { runId?: string };

/**
 * Run PowerShell via pywinrm (Python) with Kerberos message encryption.
 * This is required when WinRM server has AllowUnencrypted=false.
 */
async function runPowershellPywinrm(
  opts: HypervWinrmOptions,
  script: string,
  op: string,
  meta?: HypervWinrmMeta,
): Promise<string> {
  const runId = meta?.runId;
  const host = opts.host;
  const scriptPath = join(__dirname, 'winrm-kerberos.py');

  const input = JSON.stringify({
    host: opts.host,
    port: opts.port,
    use_https: opts.useHttps,
    username: opts.rawUsername,
    password: opts.password,
    script,
    transport: 'kerberos',
    server_cert_validation: opts.rejectUnauthorized ? 'validate' : 'ignore',
  });

  debugLog('winrm.pywinrm.start', { op, host, port: opts.port }, { runId, host });

  // Use uv run to execute with the correct Python environment that has pywinrm installed
  // Try common uv locations
  const uvPaths = [
    process.env.UV_PATH,
    join(process.env.HOME || '', '.local', 'bin', 'uv'),
    '/usr/local/bin/uv',
    'uv',
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  let res: SpawnCaptureResult | null = null;
  let lastUvError: string | null = null;
  for (const uvPath of uvPaths) {
    try {
      res = await spawnCapture(uvPath, ['run', '--with', 'pywinrm[kerberos]', 'python', scriptPath], input, {
        timeoutMs: opts.timeoutMs,
        env: { ...process.env }, // Pass all environment variables to uv
      });
      break;
    } catch (e) {
      lastUvError = e instanceof Error ? e.message : String(e);
      continue;
    }
  }

  if (!res) {
    throw new Error(
      `uv not found or failed to run. Last error: ${lastUvError}. Please install uv: curl -LsSf https://astral.sh/uv/install.sh | sh`,
    );
  }

  // Log Python debug output (stderr)
  if (res.stderr.trim().length > 0) {
    debugLog('winrm.pywinrm.debug', { op, python_stderr: res.stderr.trim() }, { runId, host });
  }

  if (res.exitCode !== 0 && res.stdout.trim().length === 0) {
    debugLog(
      'winrm.pywinrm.spawn_error',
      { op, exit_code: res.exitCode, stderr_excerpt: excerpt(res.stderr) },
      { runId, host },
    );
    throw new Error(`pywinrm failed to start: ${excerpt(res.stderr || 'unknown error')}`);
  }

  let result: { ok: boolean; stdout?: string; stderr?: string; error?: string };
  try {
    result = JSON.parse(res.stdout.trim());
  } catch {
    debugLog('winrm.pywinrm.parse_error', { op, stdout_excerpt: excerpt(res.stdout) }, { runId, host });
    throw new Error(`pywinrm returned invalid JSON: ${excerpt(res.stdout)}`);
  }

  if (!result.ok) {
    debugLog('winrm.pywinrm.error', { op, error: result.error }, { runId, host });
    throw new Error(result.error || 'pywinrm failed');
  }

  debugLog(
    'winrm.pywinrm.success',
    { op, stdout_length: result.stdout?.length ?? 0, stderr_length: result.stderr?.length ?? 0 },
    { runId, host },
  );

  return result.stdout || result.stderr || '';
}

export async function runPowershellWithTimeout(
  opts: HypervWinrmOptions,
  script: string,
  op = 'hyperv.winrm',
  meta?: HypervWinrmMeta,
): Promise<string> {
  const start = Date.now();
  const host = opts.host;

  try {
    let text: string;
    const wantKerberos =
      opts.authMethod === 'kerberos' ||
      (opts.authMethod === 'auto' && (opts.domain?.trim().length ?? 0) > 0) ||
      (opts.authMethod === 'auto' && (opts.rawUsername.includes('@') || opts.username.includes('@')));

    if (wantKerberos) {
      // Try pywinrm first (supports Kerberos message encryption for AllowUnencrypted=false)
      try {
        text = await withTimeout(runPowershellPywinrm(opts, script, op, meta), opts.timeoutMs);
      } catch (pywinrmErr) {
        const pywinrmErrMsg = pywinrmErr instanceof Error ? pywinrmErr.message : String(pywinrmErr);
        if (opts.authMethod === 'auto') {
          debugLog('winrm.pywinrm.fallback', { op, cause: pywinrmErrMsg }, { runId: meta?.runId, host });
        }

        // In explicit kerberos mode, do not downgrade to curl (curl path does not support message encryption
        // and can mask the real Kerberos failure reason).
        if (opts.authMethod === 'kerberos') throw pywinrmErr;

        // Fallback to curl-based Kerberos (works when AllowUnencrypted=true)
        try {
          text = await withTimeout(runPowershellKerberos(opts, script, op, meta), opts.timeoutMs);
        } catch (err) {
          if (opts.authMethod !== 'auto') throw err;
          debugLog(
            'winrm.auth.fallback',
            { op, from: 'kerberos', to: 'legacy', cause: err instanceof Error ? err.message : String(err) },
            { runId: meta?.runId, host },
          );
          // Legacy path: winrm-client auto-selects Basic vs NTLM based on username format.
          text = await withTimeout(
            runPowershell(
              script,
              host,
              opts.username,
              opts.password,
              opts.port,
              opts.useHttps,
              opts.rejectUnauthorized,
            ),
            opts.timeoutMs,
          );
        }
      }
    } else {
      // Legacy path: winrm-client auto-selects Basic vs NTLM based on username format.
      text = await withTimeout(
        runPowershell(script, host, opts.username, opts.password, opts.port, opts.useHttps, opts.rejectUnauthorized),
        opts.timeoutMs,
      );
    }

    debugLog(
      'winrm.call',
      {
        op,
        host,
        port: opts.port,
        use_https: opts.useHttps,
        tls_verify: opts.rejectUnauthorized,
        timeout_ms: opts.timeoutMs,
        auth_method: opts.authMethod,
        duration_ms: Date.now() - start,
        outcome: 'success',
        output_length: text.length,
      },
      { runId: meta?.runId, host },
    );

    return text;
  } catch (err) {
    debugLog(
      'winrm.call',
      {
        op,
        host,
        port: opts.port,
        use_https: opts.useHttps,
        tls_verify: opts.rejectUnauthorized,
        timeout_ms: opts.timeoutMs,
        auth_method: opts.authMethod,
        duration_ms: Date.now() - start,
        outcome: 'error',
        error:
          err instanceof Error ? { name: err.name, message: err.message } : { name: 'Error', message: String(err) },
      },
      { runId: meta?.runId, host },
    );
    throw err;
  }
}

export async function runPowershellJson<T>(
  opts: HypervWinrmOptions,
  script: string,
  op: string,
  meta?: HypervWinrmMeta,
): Promise<T> {
  const text = await runPowershellWithTimeout(opts, script, op, meta);
  try {
    const parsed = parseJson(text.trim(), op) as T;
    const topLevelArrayLengths = summarizeTopLevelArrayLengths(parsed);
    debugLog(
      'winrm.json.parsed',
      { op, shape: summarizeValue(parsed), ...(topLevelArrayLengths ? { array_lengths: topLevelArrayLengths } : {}) },
      { runId: meta?.runId, host: opts.host },
    );
    return parsed;
  } catch (err) {
    const bodyExcerpt =
      typeof err === 'object' && err && 'bodyText' in err ? (err as { bodyText?: string }).bodyText : undefined;
    debugLog(
      'winrm.json.parse_error',
      {
        op,
        cause: err instanceof Error ? err.message : String(err),
        ...(bodyExcerpt ? { body_excerpt: excerpt(bodyExcerpt) } : {}),
      },
      { runId: meta?.runId, host: opts.host },
    );
    throw err;
  }
}

function isIPv4(host: string): boolean {
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Pattern.test(host)) return false;
  const parts = host.split('.').map((part) => Number(part));
  return parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SpawnCaptureResult = { exitCode: number; stdout: string; stderr: string };

async function spawnCapture(
  command: string,
  args: string[],
  input: string | undefined,
  options?: { env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<SpawnCaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options?.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let finished = false;

    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      fn();
    };

    const timeoutMs = options?.timeoutMs;
    const timer =
      typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            finish(() => {
              try {
                child.kill('SIGKILL');
              } catch {
                // ignore
              }
              reject(new Error(`${command} timeout after ${timeoutMs}ms`));
            });
          }, timeoutMs)
        : null;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      finish(() => reject(err));
    });
    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf8');
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf8');
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      finish(() => resolve({ exitCode: code ?? 0, stdout, stderr }));
    });

    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

const winrmXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributesGroupName: '$',
  textNodeName: '_',
  parseTagValue: false,
});

const winrmXmlBuilder = new XMLBuilder({
  attributeNamePrefix: '@',
  textNodeName: '#',
  ignoreAttributes: false,
  format: true,
  suppressBooleanAttributes: false,
});

function extractValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, obj as unknown);
}

function extractText(obj: unknown): string {
  if (typeof obj === 'string') return obj;
  if (obj && typeof obj === 'object' && '_' in (obj as Record<string, unknown>)) return String((obj as any)._);
  return String(obj ?? '');
}

function extractAttribute(obj: unknown, attrName: string): string {
  if (!obj || typeof obj !== 'object') return '';
  if (!('$' in (obj as Record<string, unknown>))) return '';
  const attrs = (obj as any).$ as Record<string, unknown>;
  return String((attrs as any)[attrName] || (attrs as any)[`@_${attrName}`] || (attrs as any)[`@${attrName}`] || '');
}

function checkForSoapFault(response: unknown): void {
  const fault = extractValue(response, 's:Envelope.s:Body.s:Fault');
  if (!fault) return;
  const errorValue = extractValue(fault, 's:Code.s:Subcode.s:Value');
  throw new Error(String(errorValue || 'SOAP Fault occurred'));
}

function extractShellId(response: unknown): string {
  checkForSoapFault(response);
  const selectorValue = extractValue(
    response,
    's:Envelope.s:Body.x:ResourceCreated.a:ReferenceParameters.w:SelectorSet.w:Selector',
  );
  if (selectorValue) return extractText(selectorValue);
  const shellId = extractValue(response, 's:Envelope.s:Body.rsp:Shell.rsp:ShellId');
  if (shellId) return extractText(shellId);
  throw new Error('unable to extract shellId from winrm response');
}

function extractCommandId(response: unknown): string {
  checkForSoapFault(response);
  const commandId = extractValue(response, 's:Envelope.s:Body.rsp:CommandResponse.rsp:CommandId');
  if (commandId) return extractText(commandId);
  throw new Error('unable to extract commandId from winrm response');
}

type StreamData = { name: string; content: string; end: boolean };

function extractStreams(response: unknown): StreamData[] {
  checkForSoapFault(response);
  const streams = extractValue(response, 's:Envelope.s:Body.rsp:ReceiveResponse.rsp:Stream');
  if (!streams) return [];
  const streamArray = Array.isArray(streams) ? streams : [streams];
  return streamArray.map((stream) => ({
    name: extractAttribute(stream, 'Name') || '',
    content: extractText(stream) || '',
    end: extractAttribute(stream, 'End') === 'true',
  }));
}

function buildSoapHeader(toUrl: string, action: string, shellId?: string) {
  const header: Record<string, unknown> = {
    '@xmlns:s': 'http://www.w3.org/2003/05/soap-envelope',
    '@xmlns:wsa': 'http://schemas.xmlsoap.org/ws/2004/08/addressing',
    '@xmlns:wsman': 'http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd',
    '@xmlns:p': 'http://schemas.microsoft.com/wbem/wsman/1/wsman.xsd',
    '@xmlns:rsp': 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell',
    's:Header': {
      // WinRM expects WS-Addressing headers to be understood.
      'wsa:To': { '@s:mustUnderstand': 'true', '#': toUrl },
      'wsman:ResourceURI': {
        '@s:mustUnderstand': 'true',
        '#': 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd',
      },
      'wsa:ReplyTo': {
        'wsa:Address': {
          '@s:mustUnderstand': 'true',
          '#': 'http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous',
        },
      },
      'wsman:MaxEnvelopeSize': {
        '@s:mustUnderstand': 'true',
        '#': '153600',
      },
      'wsa:MessageID': `uuid:${randomUUID()}`,
      'wsman:Locale': {
        '@s:mustUnderstand': 'false',
        '@xml:lang': 'en-US',
      },
      // Some WSMan servers expect DataLocale in addition to Locale.
      'p:DataLocale': {
        '@s:mustUnderstand': 'false',
        '@xml:lang': 'en-US',
      },
      'wsman:OperationTimeout': 'PT60S',
      'wsa:Action': {
        '@s:mustUnderstand': 'true',
        '#': action,
      },
    },
  };

  if (shellId) {
    (header['s:Header'] as any)['wsman:SelectorSet'] = [
      {
        'wsman:Selector': [{ '@Name': 'ShellId', '#': shellId }],
      },
    ];
  }

  return header;
}

function buildCreateShellRequest(toUrl: string): string {
  const res = buildSoapHeader(toUrl, 'http://schemas.xmlsoap.org/ws/2004/09/transfer/Create');
  (res['s:Header'] as any)['wsman:OptionSet'] = [
    {
      'wsman:Option': [
        { '@Name': 'WINRS_NOPROFILE', '#': 'FALSE' },
        // Use UTF-8 for predictable JSON parsing and non-ASCII output.
        { '@Name': 'WINRS_CODEPAGE', '#': '65001' },
      ],
    },
  ];
  (res as any)['s:Body'] = {
    'rsp:Shell': [{ 'rsp:InputStreams': 'stdin', 'rsp:OutputStreams': 'stderr stdout' }],
  };
  return winrmXmlBuilder.build({ 's:Envelope': res });
}

function buildDeleteShellRequest(toUrl: string, shellId: string): string {
  const res = buildSoapHeader(toUrl, 'http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete', shellId);
  (res as any)['s:Body'] = {};
  return winrmXmlBuilder.build({ 's:Envelope': res });
}

function buildRunCommandRequest(toUrl: string, shellId: string, command: string): string {
  const res = buildSoapHeader(toUrl, 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command', shellId);
  (res['s:Header'] as any)['wsman:OptionSet'] = [
    {
      'wsman:Option': [
        { '@Name': 'WINRS_CONSOLEMODE_STDIN', '#': 'TRUE' },
        { '@Name': 'WINRS_SKIP_CMD_SHELL', '#': 'FALSE' },
      ],
    },
  ];
  (res as any)['s:Body'] = { 'rsp:CommandLine': { 'rsp:Command': command } };
  return winrmXmlBuilder.build({ 's:Envelope': res });
}

function buildReceiveOutputRequest(toUrl: string, shellId: string, commandId: string): string {
  const res = buildSoapHeader(toUrl, 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive', shellId);
  (res as any)['s:Body'] = {
    'rsp:Receive': {
      'rsp:DesiredStream': { '@CommandId': commandId, '#': 'stdout stderr' },
    },
  };
  return winrmXmlBuilder.build({ 's:Envelope': res });
}

function generatePowershellCommand(script: string): string {
  return [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-NoLogo',
    '-ExecutionPolicy',
    'Bypass',
    '-InputFormat',
    'Text',
    '-Command',
    '"& {',
    script,
    '}"',
  ].join(' ');
}

async function resolveKerberosHost(host: string): Promise<{ resolvedHost: string; realm: string | null }> {
  if (isIPv4(host)) {
    try {
      const names = await reverse(host);
      const picked = (names ?? []).map((n) => n.replace(/\.$/, '')).find((n) => n.includes('.')) ?? null;
      if (picked) {
        const domain = picked.split('.').slice(1).join('.');
        return { resolvedHost: picked, realm: domain ? domain.toUpperCase() : null };
      }
    } catch {
      // ignore
    }
    return { resolvedHost: host, realm: null };
  }

  const normalized = host.replace(/\.$/, '');
  if (normalized.includes('.')) {
    const domain = normalized.split('.').slice(1).join('.');
    return { resolvedHost: normalized, realm: domain ? domain.toUpperCase() : null };
  }

  // Short hostname: best-effort resolve -> reverse to FQDN.
  try {
    const resolved = await lookup(normalized);
    const names = await reverse(resolved.address);
    const picked = (names ?? []).map((n) => n.replace(/\.$/, '')).find((n) => n.includes('.')) ?? null;
    if (picked) {
      const domain = picked.split('.').slice(1).join('.');
      return { resolvedHost: picked, realm: domain ? domain.toUpperCase() : null };
    }
  } catch {
    // ignore
  }

  return { resolvedHost: normalized, realm: null };
}

async function curlSoap(
  input: {
    url: string;
    bodyXml: string;
    timeoutMs: number;
    tlsVerify: boolean;
    env: NodeJS.ProcessEnv;
    serviceName?: string;
    headerFilePath?: string;
  },
  meta?: { runId?: string; host?: string; op?: string },
): Promise<{ status: number; bodyText: string; headers: HttpHeaderSummary | null }> {
  const maxTimeSeconds = Math.max(1, Math.ceil(input.timeoutMs / 1000));
  const args = [
    '--silent',
    '--show-error',
    '--negotiate',
    ...(input.serviceName ? ['--service-name', input.serviceName] : []),
    ...(input.headerFilePath ? ['--dump-header', input.headerFilePath] : []),
    '--user',
    ':',
    '--request',
    'POST',
    '--header',
    'Content-Type: application/soap+xml;charset=UTF-8',
    '--header',
    'User-Agent: Asset-Ledger HyperV Collector',
    '--data-binary',
    '@-',
    '--max-time',
    String(maxTimeSeconds),
    '--write-out',
    '\\n__HTTP_STATUS__:%{http_code}\\n',
    input.url,
  ];
  if (!input.tlsVerify) args.unshift('--insecure');

  const start = Date.now();
  const res = await spawnCapture('curl', args, input.bodyXml, { env: input.env, timeoutMs: input.timeoutMs });
  const durationMs = Date.now() - start;
  const marker = '\n__HTTP_STATUS__:';
  const idx = res.stdout.lastIndexOf(marker);
  if (idx < 0) {
    debugLog(
      'winrm.curl.unexpected_output',
      {
        ...(meta?.op ? { op: meta.op } : {}),
        url: input.url,
        duration_ms: durationMs,
        exit_code: res.exitCode,
        stdout_excerpt: excerpt(res.stdout),
        stderr_excerpt: excerpt(res.stderr),
      },
      { runId: meta?.runId, host: meta?.host },
    );
    throw new Error(`curl returned unexpected output (exit=${res.exitCode})`);
  }

  const bodyText = res.stdout.slice(0, idx);
  const statusText = res.stdout.slice(idx + marker.length).trim();
  const status = Number(statusText);
  if (!Number.isFinite(status)) {
    throw new Error(`curl returned invalid http status: ${statusText}`);
  }
  if (res.exitCode !== 0) {
    throw new Error(`curl failed (exit=${res.exitCode}): ${excerpt(res.stderr || res.stdout)}`);
  }

  let headers: HttpHeaderSummary | null = null;
  if (input.headerFilePath) {
    try {
      headers = parseHttpHeaderSummary(readFileSync(input.headerFilePath, 'utf8'));
    } catch {
      headers = null;
    }
  }

  debugLog(
    'winrm.curl',
    {
      ...(meta?.op ? { op: meta.op } : {}),
      url: input.url,
      ...(input.serviceName ? { service_name: input.serviceName } : {}),
      duration_ms: durationMs,
      outcome: status >= 200 && status < 300 ? 'success' : 'http_error',
      status,
      body_length: bodyText.length,
      ...(headers ? { headers } : {}),
      ...(res.stderr.trim().length > 0 ? { stderr_excerpt: excerpt(res.stderr) } : {}),
    },
    { runId: meta?.runId, host: meta?.host },
  );

  return { status, bodyText, headers };
}

async function curlSoapWithServiceNameFallback(
  input: {
    url: string;
    bodyXml: string;
    timeoutMs: number;
    tlsVerify: boolean;
    env: NodeJS.ProcessEnv;
    headerFilePath?: string;
  },
  meta?: { runId?: string; host?: string; op?: string },
): Promise<{ status: number; bodyText: string; headers: HttpHeaderSummary | null; serviceNameUsed?: string }> {
  // Different Windows environments can register different SPNs for WinRM:
  // - WSMAN/<host> is common for WinRM
  // - HTTP/<host> is curl's default for SPNEGO over HTTP
  // - HOST/<host> can exist broadly for machine accounts
  //
  // When the service principal does not match, servers tend to reply 401.
  const candidates: Array<string | undefined> = ['WSMAN', undefined, 'HOST'];

  let last: { status: number; bodyText: string; headers: HttpHeaderSummary | null; serviceNameUsed?: string } | null =
    null;
  for (const serviceName of candidates) {
    const res = await curlSoap({ ...input, serviceName }, meta);
    last = { ...res, serviceNameUsed: serviceName };

    // If auth succeeds we are done. If it's not an auth error, don't guess further.
    if (res.status >= 200 && res.status < 300) return last;
    if (res.status !== 401) return last;
  }

  return last ?? { status: 0, bodyText: '', headers: null, serviceNameUsed: undefined };
}

async function runPowershellKerberos(
  opts: HypervWinrmOptions,
  script: string,
  op: string,
  meta?: HypervWinrmMeta,
): Promise<string> {
  // Kerberos requires "Negotiate" and a valid ticket. We use kinit + curl --negotiate to avoid native deps.
  const runId = meta?.runId;

  const resolved = await resolveKerberosHost(opts.host);
  const resolvedHost = resolved.resolvedHost;

  const principalCandidates = buildKerberosPrincipalCandidates({
    rawUsername: opts.rawUsername,
    domain: opts.domain,
    realmFromHost: resolved.realm,
  });

  if (principalCandidates.length === 0) {
    throw new Error(
      'kerberos requires a resolvable hostname/FQDN (or username as UPN). Please use FQDN endpoint or set username to user@domain.',
    );
  }

  const tmp = mkdtempSync(join(tmpdir(), 'asset-ledger-hyperv-krb-'));
  const ccachePath = join(tmp, 'ccache');
  const passwordFilePath = join(tmp, 'password');
  const headerFilePath = join(tmp, 'curl-headers.txt');
  const env: NodeJS.ProcessEnv = { ...process.env, KRB5CCNAME: `FILE:${ccachePath}` };
  const useEnterprise = opts.rawUsername.includes('@');

  // Useful for debugging: confirm we are actually hitting the intended machine (A/AAAA results).
  let resolvedAddresses: string[] | null = null;
  if (HYPERV_DEBUG) {
    try {
      const addrs = await lookup(resolvedHost, { all: true });
      resolvedAddresses = addrs.map((a) => a.address).filter((a): a is string => typeof a === 'string' && a.length > 0);
    } catch {
      resolvedAddresses = null;
    }
  }

  // Avoid interactive password prompts: write to a temp file with restrictive perms.
  writeFileSync(passwordFilePath, `${opts.password}\n`, { mode: 0o600 });

  debugLog(
    'winrm.kerberos.kinit.start',
    {
      op,
      resolved_host: resolvedHost,
      ...(resolvedAddresses ? { resolved_addresses: resolvedAddresses } : {}),
      realm_from_host: resolved.realm,
      principal_candidates: principalCandidates,
      enterprise: useEnterprise,
    },
    { runId, host: opts.host },
  );

  try {
    let principalUsed: string | null = null;
    let lastKinitError: SpawnCaptureResult | null = null;

    for (const principal of principalCandidates) {
      const kinitArgs = buildKinitArgs({ principal, passwordFilePath, enterprise: useEnterprise });
      const kinitRes = await spawnCapture('kinit', kinitArgs, undefined, { env, timeoutMs: opts.timeoutMs });
      if (kinitRes.exitCode === 0) {
        principalUsed = principal;
        lastKinitError = null;
        break;
      }
      lastKinitError = kinitRes;
      debugLog(
        'winrm.kerberos.kinit.try_failed',
        { op, principal, exit_code: kinitRes.exitCode, stderr_excerpt: excerpt(kinitRes.stderr) },
        { runId, host: opts.host },
      );
    }

    if (!principalUsed) {
      debugLog(
        'winrm.kerberos.kinit.failed',
        {
          op,
          exit_code: lastKinitError?.exitCode ?? -1,
          stderr_excerpt: lastKinitError ? excerpt(lastKinitError.stderr) : undefined,
          stdout_excerpt: lastKinitError ? excerpt(lastKinitError.stdout) : undefined,
        },
        { runId, host: opts.host },
      );
      throw new Error('kerberos kinit failed');
    }

    debugLog('winrm.kerberos.kinit.ok', { op, principal: principalUsed }, { runId, host: opts.host });

    const scheme = opts.useHttps ? 'https' : 'http';
    const toUrl = `${scheme}://${resolvedHost}:${opts.port}/wsman`;

    // 1) Create shell
    const shellCreate = await curlSoapWithServiceNameFallback(
      {
        url: toUrl,
        bodyXml: buildCreateShellRequest(toUrl),
        timeoutMs: opts.timeoutMs,
        tlsVerify: opts.rejectUnauthorized,
        env,
        headerFilePath,
      },
      { runId, host: opts.host, op: `${op}.CreateShell` },
    );
    const serviceNameUsed = shellCreate.serviceNameUsed;
    if (shellCreate.status < 200 || shellCreate.status >= 300) {
      debugLog(
        'winrm.kerberos.http_error',
        {
          op: `${op}.CreateShell`,
          status: shellCreate.status,
          ...(serviceNameUsed ? { service_name: serviceNameUsed } : {}),
          ...(shellCreate.headers ? { headers: shellCreate.headers } : {}),
          body_excerpt: excerpt(shellCreate.bodyText),
        },
        { runId, host: opts.host },
      );
      const err = new Error(`CreateShell failed with status ${shellCreate.status}`);
      (err as any).winrm_http = {
        op: `${op}.CreateShell`,
        url: toUrl,
        status: shellCreate.status,
        ...(serviceNameUsed ? { service_name: serviceNameUsed } : {}),
        ...(shellCreate.headers ? { headers: shellCreate.headers } : {}),
      };
      throw err;
    }
    const shellObj = winrmXmlParser.parse(shellCreate.bodyText) as unknown;
    const shellId = extractShellId(shellObj);

    // 2) Execute powershell command
    const commandText = generatePowershellCommand(script);
    const cmdRes = await curlSoap(
      {
        url: toUrl,
        bodyXml: buildRunCommandRequest(toUrl, shellId, commandText),
        timeoutMs: opts.timeoutMs,
        tlsVerify: opts.rejectUnauthorized,
        env,
        headerFilePath,
        ...(serviceNameUsed ? { serviceName: serviceNameUsed } : {}),
      },
      { runId, host: opts.host, op: `${op}.Command` },
    );
    if (cmdRes.status < 200 || cmdRes.status >= 300) {
      debugLog(
        'winrm.kerberos.http_error',
        {
          op: `${op}.Command`,
          status: cmdRes.status,
          ...(serviceNameUsed ? { service_name: serviceNameUsed } : {}),
          ...(cmdRes.headers ? { headers: cmdRes.headers } : {}),
          body_excerpt: excerpt(cmdRes.bodyText),
        },
        { runId, host: opts.host },
      );
      const err = new Error(`Command failed with status ${cmdRes.status}`);
      (err as any).winrm_http = {
        op: `${op}.Command`,
        url: toUrl,
        status: cmdRes.status,
        ...(serviceNameUsed ? { service_name: serviceNameUsed } : {}),
        ...(cmdRes.headers ? { headers: cmdRes.headers } : {}),
      };
      throw err;
    }
    const cmdObj = winrmXmlParser.parse(cmdRes.bodyText) as unknown;
    const commandId = extractCommandId(cmdObj);

    // 3) Receive output (poll a few times for safety)
    let stdout = '';
    let stderr = '';
    let stdoutEnd = false;
    let stderrEnd = false;
    for (let i = 0; i < 50; i++) {
      const rxRes = await curlSoap(
        {
          url: toUrl,
          bodyXml: buildReceiveOutputRequest(toUrl, shellId, commandId),
          timeoutMs: opts.timeoutMs,
          tlsVerify: opts.rejectUnauthorized,
          env,
          headerFilePath,
          ...(serviceNameUsed ? { serviceName: serviceNameUsed } : {}),
        },
        { runId, host: opts.host, op: `${op}.Receive` },
      );
      if (rxRes.status < 200 || rxRes.status >= 300) {
        debugLog(
          'winrm.kerberos.http_error',
          {
            op: `${op}.Receive`,
            status: rxRes.status,
            ...(serviceNameUsed ? { service_name: serviceNameUsed } : {}),
            ...(rxRes.headers ? { headers: rxRes.headers } : {}),
            body_excerpt: excerpt(rxRes.bodyText),
          },
          { runId, host: opts.host },
        );
        const err = new Error(`Receive failed with status ${rxRes.status}`);
        (err as any).winrm_http = {
          op: `${op}.Receive`,
          url: toUrl,
          status: rxRes.status,
          ...(serviceNameUsed ? { service_name: serviceNameUsed } : {}),
          ...(rxRes.headers ? { headers: rxRes.headers } : {}),
        };
        throw err;
      }
      const rxObj = winrmXmlParser.parse(rxRes.bodyText) as unknown;
      const streams = extractStreams(rxObj);
      for (const stream of streams) {
        if (stream.name === 'stdout') {
          if (stream.end) stdoutEnd = true;
          else if (stream.content) stdout += Buffer.from(stream.content.trim(), 'base64').toString('utf8');
        }
        if (stream.name === 'stderr') {
          if (stream.end) stderrEnd = true;
          else if (stream.content) stderr += Buffer.from(stream.content.trim(), 'base64').toString('utf8');
        }
      }
      if (stdoutEnd && stderrEnd) break;
      await sleep(200);
    }

    // 4) Delete shell (best-effort)
    await curlSoap(
      {
        url: toUrl,
        bodyXml: buildDeleteShellRequest(toUrl, shellId),
        timeoutMs: opts.timeoutMs,
        tlsVerify: opts.rejectUnauthorized,
        env,
        headerFilePath,
        ...(serviceNameUsed ? { serviceName: serviceNameUsed } : {}),
      },
      { runId, host: opts.host, op: `${op}.DeleteShell` },
    ).catch(() => null);

    if (stdout.trim().length > 0) return stdout.trim();
    return stderr.trim();
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
