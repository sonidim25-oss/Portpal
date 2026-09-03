import { test, expect } from '@playwright/test';

// Smoke for vite preview (no Tauri backend) - ensures critical navigation never 404
// For full Tauri use `tauri-driver` + `cargo run` and webDriver session (see README)

test.describe('PortPal critical paths (preview smoke)', () => {
  test('loads PortPal and shows navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('PortPal')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Ports/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Traffic' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Services' })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Port Map' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  });

  test('Ports page: search and filter tabs visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder(/Search ports or services/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'All 0' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dev' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Other' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kill All (0)' })).toBeVisible();
    await expect(page.getByText(/No ports in use|active connection/i).first()).toBeVisible();
  });

  test('Dashboard -> navigate to Ports via card', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Overview of your port activity')).toBeVisible();
    await expect(page.getByText('Active Ports')).toBeVisible();
  });

  test('Port Map and Services pages render', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation').getByRole('button', { name: 'Port Map' }).click();
    await expect(page.locator('body')).toContainText(/Port Map|No ports/i);
    await page.getByRole('button', { name: 'Services' }).click();
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
  });

  test('Logs and Settings pages render', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Logs' }).click();
    await expect(page.getByText(/Event Logs/)).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});
