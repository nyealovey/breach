import { expect, test } from '@playwright/test';

test('unauthenticated users are redirected to /login', async ({ page }) => {
  await page.context().clearCookies();

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
});
