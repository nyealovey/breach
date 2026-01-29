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

    // Create credential (API). Secrets never get returned by API.
    const credentialName = `e2e_cred_${Date.now()}`;
    const credentialRes = await page.request.post('/api/v1/credentials', {
      data: {
        name: credentialName,
        type: 'vcenter',
        payload: {
          username: vcenterUsername || 'dummy',
          password: vcenterPassword || 'dummy',
        },
      },
    });
    expect(credentialRes.ok()).toBe(true);
    const credentialBody = (await credentialRes.json()) as any;
    const credentialId = credentialBody.data.credentialId as string;

    // Create source (API)
    const sourceName = `e2e_source_${Date.now()}`;
    const sourceRes = await page.request.post('/api/v1/sources', {
      data: {
        name: sourceName,
        sourceType: 'vcenter',
        enabled: true,
        scheduleGroupId: groupId,
        config: { endpoint: vcenterEndpoint || 'https://example.invalid' },
        credentialId,
      },
    });
    expect(sourceRes.ok()).toBe(true);
    const sourceBody = (await sourceRes.json()) as any;
    const sourceId = sourceBody.data.sourceId as string;

    // Create another enabled source without credential to cover skip_missing_credential.
    const sourceNameNoCred = `e2e_source_nocred_${Date.now()}`;
    const sourceResNoCred = await page.request.post('/api/v1/sources', {
      data: {
        name: sourceNameNoCred,
        sourceType: 'vcenter',
        enabled: true,
        scheduleGroupId: groupId,
        config: { endpoint: vcenterEndpoint || 'https://example.invalid' },
        credentialId: null,
      },
    });
    expect(sourceResNoCred.ok()).toBe(true);

    // Trigger collect runs via Schedule Group UI button.
    await page.goto('/schedule-groups');
    const row = page.locator('tr', { hasText: groupName });
    await expect(row).toBeVisible();

    const [manualRunRes] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes(`/api/v1/schedule-groups/${groupId}/runs`) && res.request().method() === 'POST',
      ),
      row.getByRole('button', { name: '运行' }).click(),
    ]);
    expect(manualRunRes.ok()).toBe(true);
    const manualRunBody = (await manualRunRes.json()) as any;
    expect(manualRunBody.data.queued).toBe(1);
    expect(manualRunBody.data.skipped_missing_credential).toBe(1);

    // Find the queued collect run id for the source, then browse runs UI.
    const runListRes = await page.request.get(
      `/api/v1/runs?sourceId=${encodeURIComponent(sourceId)}&mode=collect&triggerType=manual&pageSize=1`,
    );
    expect(runListRes.ok()).toBe(true);
    const runListBody = (await runListRes.json()) as any;
    const collectRunId = runListBody.data?.[0]?.runId as string | undefined;
    expect(collectRunId).toBeTruthy();
    const runId = collectRunId as string;

    // Browse runs UI
    await page.goto(`/runs/${runId}`);
    await expect(page.getByText('Run 详情')).toBeVisible();

    // Optionally wait for completion to make assets available.
    await waitForRunToFinish({
      runId,
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

    // Credentials list should be reachable.
    await page.goto('/credentials');
    await expect(page.getByText('凭据')).toBeVisible();
  });
});
