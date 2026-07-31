import { expect, test } from '@playwright/test';

test('signs in and preserves a responsive dashboard shell', async ({ page }) => {
  await page.goto('/login?next=/dashboard');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('change-me');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('link', { name: /sales/i })).toBeVisible();
});
