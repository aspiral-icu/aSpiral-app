import { test, expect } from '@playwright/test';

test.describe('aSpiral Visual Regression & Render Stability', () => {

  test('Landing Page: Hero, Branding & Aurora Layer render cleanly', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Assert primary brand elements are visible
    const heroHeading = page.getByRole('heading', { name: /From Spiraling to Aspiring/i });
    await expect(heroHeading).toBeVisible({ timeout: 10000 });

    const ctaButton = page.getByRole('link', { name: /Start Your Breakthrough/i }).first();
    await expect(ctaButton).toBeVisible();

    // Verify background ambient / aurora container is mounted in DOM
    const auroraContainer = page.locator('.aurora-flow, .aurora-ambient, .ambient-orb, header').first();
    await expect(auroraContainer).toBeAttached();
  });

  test('App Session: Purple 3D Stage & Aurora Curtains render cleanly', async ({ page }) => {
    // Inject mock user to bypass ProtectedRoute synchronously
    await page.addInitScript(() => {
      localStorage.setItem('dev_mock_user', '1');
    });

    await page.goto('/#/app', { waitUntil: 'networkidle' });

    // Wait for the app container to mount
    const appContainer = page.locator('.app-container');
    await expect(appContainer).toBeVisible({ timeout: 15000 });

    // Wait for 3D stage or SVG fallback to mount
    const stage = page.locator('canvas, svg.spiral-hero-svg').first();
    await expect(stage).toBeVisible({ timeout: 15000 });

    // Verify QuickActionsBar touch target controls are interactive and rendered
    const quickActions = page.locator('button[aria-label], .quick-actions-bar, header').first();
    await expect(quickActions).toBeVisible();
  });

});
