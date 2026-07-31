import { expect, test } from '@playwright/test';

test('signs in and preserves a responsive dashboard shell', async ({ page }) => {
  await page.goto('/login?next=/dashboard');
  await page.getByLabel('Username').fill('e2e-admin');
  await page.getByLabel('Password').fill('e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('link', { name: /sales/i })).toBeVisible();
  for (const path of ['/dashboard/sales', '/dashboard/inventory', '/dashboard/flights', '/dashboard/schedules', '/dashboard/concession', '/dashboard/connections']) {
    await page.goto(path);
    await expect(page.locator('#dashboard-content')).toBeVisible();
  }
});
