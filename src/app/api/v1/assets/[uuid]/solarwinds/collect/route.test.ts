import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/assets/[uuid]/solarwinds/collect/route';
import { requireAdmin } from '@/lib/auth/require-admin';
import { decryptJson } from '@/lib/crypto/aes-gcm';
import { prisma } from '@/lib/db/prisma';
import { compressRaw } from '@/lib/ingest/raw';
import { createSwisClient } from '@/lib/solarwinds/swis-client';

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/crypto/aes-gcm', () => ({ decryptJson: vi.fn() }));
vi.mock('@/lib/ingest/raw', () => ({ compressRaw: vi.fn() }));
vi.mock('@/lib/solarwinds/swis-client', () => ({ createSwisClient: vi.fn() }));
vi.mock('@/lib/db/prisma', () => {
  const asset = { findUnique: vi.fn() };
  const source = { findMany: vi.fn() };
  const assetSignalLink = { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() };
  const run = { create: vi.fn() };
  const signalRecord = { create: vi.fn() };
  const assetOperationalState = { upsert: vi.fn() };

  const tx = { run, assetSignalLink, signalRecord, assetOperationalState };

  return {
    prisma: {
      asset,
      source,
      assetSignalLink,
      run,
      signalRecord,
      assetOperationalState,
      $transaction: vi.fn(async (fn: unknown) => {
        if (typeof fn !== 'function') throw new Error('expected $transaction callback');
        return (fn as any)(tx);
      }),
    },
  };
});

function mockAdminAuth() {
  (requireAdmin as any).mockResolvedValue({
    ok: true,
    requestId: 'req_test',
    session: { user: { id: 'u1' } },
  } as any);
}

function mockSolarWindsSource() {
  (prisma.source.findMany as any).mockResolvedValue([
    {
      id: 'src_sw_1',
      sourceType: 'solarwinds',
      role: 'signal',
      enabled: true,
      deletedAt: null,
      createdAt: new Date('2026-02-06T00:00:00.000Z'),
      scheduleGroupId: null,
      config: { endpoint: 'https://swis.example.com' },
      credential: { payloadCiphertext: 'ciphertext_test' },
    },
  ]);

  (decryptJson as any).mockReturnValue({ username: 'user@example.com', password: 'password' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/assets/:uuid/solarwinds/collect', () => {
  it('returns no_source when no solarwinds signal source configured', async () => {
    mockAdminAuth();

    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      status: 'in_service',
      assetType: 'host',
      machineNameOverride: null,
      ipOverrideText: null,
      collectedHostname: 'host01.example.com',
      collectedVmCaption: null,
      collectedIpText: '192.0.2.10',
    } as any);

    (prisma.source.findMany as any).mockResolvedValue([]);

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000/solarwinds/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toBe('req_test');
    const body = (await res.json()) as any;
    expect(body.data).toEqual({ status: 'no_source' });
  });

  it('returns no_match when nodeId is provided but not found', async () => {
    mockAdminAuth();
    mockSolarWindsSource();

    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      status: 'in_service',
      assetType: 'host',
      machineNameOverride: null,
      ipOverrideText: null,
      collectedHostname: 'host01.example.com',
      collectedVmCaption: null,
      collectedIpText: '192.0.2.10',
    } as any);

    const query = vi.fn().mockResolvedValue({ results: [], raw: {} });
    (createSwisClient as any).mockReturnValue({ query });

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000/solarwinds/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: '123' }),
    });
    const res = await POST(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('no_match');
  });

  it('returns ambiguous candidates when multiple nodes tie on score', async () => {
    mockAdminAuth();
    mockSolarWindsSource();

    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      status: 'in_service',
      assetType: 'host',
      machineNameOverride: 'host01.example.com',
      ipOverrideText: '192.0.2.10',
      collectedHostname: null,
      collectedVmCaption: null,
      collectedIpText: null,
    } as any);

    (prisma.assetSignalLink.findFirst as any).mockResolvedValue(null);

    const query = vi.fn().mockResolvedValue({
      results: [
        {
          NodeID: 1001,
          Caption: 'host01.example.com',
          SysName: 'host01',
          DNS: 'host01.example.com',
          IPAddress: '192.0.2.10',
          MachineType: 'Windows Server',
          Status: 1,
          StatusDescription: 'Up',
          UnManaged: false,
          LastSync: '2026-02-06T00:00:00.000Z',
        },
        {
          NodeID: 1002,
          Caption: 'host01b.example.com',
          SysName: 'host01',
          DNS: 'host01b.example.com',
          IPAddress: '192.0.2.10',
          MachineType: 'Windows Server',
          Status: 1,
          StatusDescription: 'Up',
          UnManaged: false,
          LastSync: '2026-02-06T00:00:00.000Z',
        },
      ],
      raw: {},
    });
    (createSwisClient as any).mockReturnValue({ query });

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000/solarwinds/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('ambiguous');
    expect(body.data.candidates).toHaveLength(2);
    expect(body.data.candidates[0]).toMatchObject({
      nodeId: '1001',
      ipAddress: '192.0.2.10',
      machineType: 'Windows Server',
    });
    expect(body.data.candidates[0].matchScore).toBeTypeOf('number');
    expect(body.data.candidates[0].matchReasons).toEqual(expect.arrayContaining(['ip']));
  });

  it('returns ok and writes signal records for a chosen nodeId', async () => {
    mockAdminAuth();
    mockSolarWindsSource();

    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      status: 'in_service',
      assetType: 'host',
      machineNameOverride: null,
      ipOverrideText: null,
      collectedHostname: 'host01.example.com',
      collectedVmCaption: null,
      collectedIpText: '192.0.2.10',
    } as any);

    const query = vi.fn().mockResolvedValue({
      results: [
        {
          NodeID: 1001,
          Caption: 'host01.example.com',
          SysName: 'host01.example.com',
          DNS: 'host01.example.com',
          IPAddress: '192.0.2.10',
          MachineType: 'Linux',
          Status: 1,
          StatusDescription: 'Up',
          UnManaged: false,
          LastSync: '2026-02-06T00:00:00.000Z',
        },
      ],
      raw: {},
    });
    (createSwisClient as any).mockReturnValue({ query });

    (prisma.assetSignalLink.findUnique as any).mockResolvedValue(null);
    (prisma.run.create as any).mockResolvedValue({ id: 'run_1' });
    (prisma.assetSignalLink.upsert as any).mockResolvedValue({ id: 'link_1' });
    (prisma.signalRecord.create as any).mockResolvedValue({ id: 'sig_1' });
    (prisma.assetOperationalState.upsert as any).mockResolvedValue({
      assetUuid: '550e8400-e29b-41d4-a716-446655440000',
    });

    (compressRaw as any).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      compression: 'zstd',
      sizeBytes: 3,
      hash: 'hash_test',
      mimeType: 'application/json',
      inlineExcerpt: '{"NodeID":1001}',
    });

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000/solarwinds/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: '1001' }),
    });
    const res = await POST(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('ok');
    expect(body.data.runId).toBe('run_1');
    expect(body.data.linkId).toBe('link_1');
    expect(body.data.fields).toEqual({
      machineName: 'host01.example.com',
      ipText: '192.0.2.10',
      osText: 'Linux',
    });
  });

  it('returns 409 when node already manually bound to another asset', async () => {
    mockAdminAuth();
    mockSolarWindsSource();

    (prisma.asset.findUnique as any).mockResolvedValue({
      uuid: '550e8400-e29b-41d4-a716-446655440000',
      status: 'in_service',
      assetType: 'host',
      machineNameOverride: null,
      ipOverrideText: null,
      collectedHostname: 'host01.example.com',
      collectedVmCaption: null,
      collectedIpText: '192.0.2.10',
    } as any);

    const query = vi.fn().mockResolvedValue({
      results: [
        {
          NodeID: 1001,
          Caption: 'host01.example.com',
          SysName: 'host01.example.com',
          DNS: 'host01.example.com',
          IPAddress: '192.0.2.10',
          MachineType: 'Linux',
          Status: 1,
          StatusDescription: 'Up',
          UnManaged: false,
          LastSync: '2026-02-06T00:00:00.000Z',
        },
      ],
      raw: {},
    });
    (createSwisClient as any).mockReturnValue({ query });

    (prisma.assetSignalLink.findUnique as any).mockResolvedValue({
      id: 'link_existing',
      assetUuid: '550e8400-e29b-41d4-a716-446655440099',
      matchType: 'manual',
    } as any);

    const req = new Request('http://localhost/api/v1/assets/550e8400-e29b-41d4-a716-446655440000/solarwinds/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: '1001' }),
    });
    const res = await POST(req, { params: Promise.resolve({ uuid: '550e8400-e29b-41d4-a716-446655440000' }) });

    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIG_RESOURCE_CONFLICT');
  });
});
