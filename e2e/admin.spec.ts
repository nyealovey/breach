import { expect, test } from '@playwright/test';

const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? '';

async function waitForRunToFinish(args: {
  get: (path: string) => Promise<{ status: number; json: () => Promise<any> }>;
  runId: string;
  timeoutMs?: number;
}) {
  const timeoutMs = args.timeoutMs ?? 20_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await args.get(`/api/v1/runs/${args.runId}`);
    if (res.status === 200) {
      const body = await res.json();
      const status = body?.data?.status as string | undefined;
      if (status && status !== 'Queued' && status !== 'Running') return status;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return null;
}

test.describe('admin happy path (vCenter MVP)', () => {
  test.skip(!adminPassword, 'E2E_ADMIN_PASSWORD is required to run this test');

  test('login -> configure -> trigger -> browse', async ({ page }) => {
    const vcenterEndpoint = process.env.E2E_VCENTER_ENDPOINT ?? '';
    const vcenterUsername = process.env.E2E_VCENTER_USERNAME ?? '';
    const vcenterPassword = process.env.E2E_VCENTER_PASSWORD ?? '';

    await page.goto('/login');
    await page.getByLabel('密码').fill(adminPassword);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL('/');

    // Create schedule group (API)
    const groupName = `e2e_group_${Date.now()}`;
    const groupRes = await page.request.post('/api/v1/schedule-groups', {
      data: { name: groupName, timezone: 'Asia/Shanghai', runAtHhmm: '02:00', enabled: true },
    });
    expect(groupRes.ok()).toBe(true);
    const groupBody = (await groupRes.json()) as any;
    const groupId = groupBody.data.groupId as string;

    // Create source (API)
    const sourceName = `e2e_source_${Date.now()}`;
    const sourceRes = await page.request.post('/api/v1/sources', {
      data: {
        name: sourceName,
        sourceType: 'vcenter',
        enabled: true,
        scheduleGroupId: groupId,
        config: { endpoint: vcenterEndpoint || 'https://example.invalid' },
      },
    });
    expect(sourceRes.ok()).toBe(true);
    const sourceBody = (await sourceRes.json()) as any;
    const sourceId = sourceBody.data.sourceId as string;

    // Update credential (API) - optional if not provided.
    if (vcenterUsername && vcenterPassword) {
      const credRes = await page.request.put(`/api/v1/sources/${sourceId}/credential`, {
        data: { username: vcenterUsername, password: vcenterPassword },
      });
      expect(credRes.ok()).toBe(true);
    }

    // Trigger runs (API). Worker may or may not be running; tolerate pending.
    const healthRes = await page.request.post(`/api/v1/sources/${sourceId}/runs`, { data: { mode: 'healthcheck' } });
    expect(healthRes.ok()).toBe(true);
    const healthBody = (await healthRes.json()) as any;
    const healthRunId = healthBody.data.runId as string;

    const collectRes = await page.request.post(`/api/v1/sources/${sourceId}/runs`, { data: { mode: 'collect' } });
    expect(collectRes.ok()).toBe(true);
    const collectBody = (await collectRes.json()) as any;
    const collectRunId = collectBody.data.runId as string;

    // Browse runs UI
    await page.goto(`/runs/${collectRunId}`);
    await expect(page.getByText('Run 详情')).toBeVisible();

    // Optionally wait for completion to make assets available.
    await waitForRunToFinish({
      runId: collectRunId,
      get: async (path) => {
        const res = await page.request.get(path);
        return { status: res.status(), json: () => res.json() };
      },
    });

    // Browse assets list UI (may be empty if collect didn't ingest)
    await page.goto('/assets');
    await expect(page.getByText('资产')).toBeVisible();

    // If we have at least one asset, open its detail page.
    const assetsRes = await page.request.get('/api/v1/assets?pageSize=1');
    if (assetsRes.ok()) {
      const assetsBody = (await assetsRes.json()) as any;
      const first = (assetsBody.data?.[0] ?? null) as { assetUuid?: string } | null;
      if (first?.assetUuid) {
        await page.goto(`/assets/${first.assetUuid}`);
        await expect(page.getByText('基本信息')).toBeVisible();
      }
    }

    // Healthcheck run detail should still be reachable.
    await page.goto(`/runs/${healthRunId}`);
    await expect(page.getByText('Run 详情')).toBeVisible();
  });
});
