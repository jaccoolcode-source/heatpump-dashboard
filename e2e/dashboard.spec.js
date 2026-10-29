'use strict';

const { test, expect } = require('@playwright/test');

// These tests run against the live deployment with real readings, so they check
// structure and rendering rather than exact values. They never trigger a real
// controller read: /api/refresh is always mocked.

// ── API ───────────────────────────────────────────────────────────────────────
test.describe('API', () => {
  test('GET /api/data returns readings', async ({ request }) => {
    const res = await request.get('/api/data');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('readings');
    for (const [key, r] of Object.entries(body.readings)) {
      expect(key).toMatch(/^\d{4}-\d{2}$/);
      expect(r).toHaveProperty('consumed');
    }
  });

  test('GET /api/status returns JSON', async ({ request }) => {
    const res = await request.get('/api/status');
    expect(res.status()).toBe(200);
    expect(typeof await res.json()).toBe('object');
  });

  test('static assets are served', async ({ request }) => {
    for (const asset of ['/app.js', '/style.css']) {
      expect((await request.get(asset)).status(), asset).toBe(200);
    }
  });
});

// ── Page ──────────────────────────────────────────────────────────────────────
test.describe('Dashboard page', () => {
  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
    page.on('requestfailed', req => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));
    page.on('response', res => { if (res.status() >= 400) errors.push(`HTTP ${res.status()}: ${res.url()}`); });

    await page.route('**/api/refresh', route => route.abort());   // safety net, overridden where needed
    await page.goto('/');
    await expect(page.locator('#historyBody tr')).toHaveCount(12);
  });

  test.afterEach(() => {
    expect(errors, 'no errors while using the page').toEqual([]);
  });

  test('loads with title and header', async ({ page }) => {
    await expect(page).toHaveTitle('Heat Pump Dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Heat Pump Dashboard');
    await expect(page.locator('#lastUpdated')).not.toHaveText('Loading...');
    await expect(page.locator('#lastUpdated')).not.toContainText('Error loading data');
  });

  test('Chart.js loads (CDN + SRI hash) and both charts render', async ({ page }) => {
    expect(await page.evaluate(() => typeof window.Chart)).toBe('function');
    for (const id of ['consumptionChart', 'temperatureChart']) {
      const info = await page.evaluate(canvasId => {
        const chart = window.Chart.getChart(canvasId);
        return chart && { datasets: chart.data.datasets.length, width: chart.width, height: chart.height };
      }, id);
      expect(info, `${id} is a Chart.js chart`).toBeTruthy();
      expect(info.datasets, `${id} has year datasets`).toBeGreaterThan(0);
      expect(info.width).toBeGreaterThan(0);
      expect(info.height).toBeGreaterThan(0);
    }
  });

  test('KPI cards show values', async ({ page, request }) => {
    const { readings } = await (await request.get('/api/data')).json();
    const hasConsumption = Object.values(readings).some(r => r?.consumed?.total > 0);
    test.skip(!hasConsumption, 'no consumption data deployed');

    await expect(page.locator('#kpiTotal')).toHaveText(/^\d+$/);
    await expect(page.locator('#kpiPeak')).toHaveText(/^\d+$/);
  });

  test('year toggles match chart datasets', async ({ page }) => {
    const datasets = await page.evaluate(() => window.Chart.getChart('consumptionChart').data.datasets.length);
    await expect(page.locator('#consumptionToggles input[type=checkbox]')).toHaveCount(datasets);
    await expect(page.locator('#tempToggles input[type=checkbox]')).toHaveCount(datasets);
  });

  test('toggling a year hides its dataset', async ({ page }) => {
    // The checkbox itself is hidden; users click the year badge (its label)
    const index   = await page.locator('#consumptionToggles input[type=checkbox]')
      .evaluateAll(els => els.findIndex(e => e.checked));
    const toggle  = page.locator('#consumptionToggles label.toggle').nth(index);
    const visible = () => page.evaluate(i => window.Chart.getChart('consumptionChart').isDatasetVisible(i), index);

    expect(await visible()).toBe(true);
    await toggle.click();
    expect(await visible()).toBe(false);
  });

  test('year tabs switch the history table', async ({ page }) => {
    const tabs = page.locator('#yearTabs .year-tab');
    expect(await tabs.count()).toBeGreaterThan(0);
    await expect(page.locator('#yearTabs .year-tab.active')).toHaveCount(1);

    const last = tabs.last();
    await last.click();
    await expect(last).toHaveClass(/active/);
    await expect(page.locator('#historyBody tr')).toHaveCount(12);
    await expect(page.locator('#historyBody tr').first().locator('td').first()).toHaveText('January');
  });

  test('all-time totals are filled in', async ({ page }) => {
    for (const id of ['totConsumed', 'totHeatConsumed', 'totDhwConsumed']) {
      await expect(page.locator(`#${id}`)).not.toBeEmpty();
    }
  });

  test('"Refresh now" shows the collector error (mocked)', async ({ page }) => {
    await page.unroute('**/api/refresh');
    await page.route('**/api/refresh', route => route.fulfill({
      status: 200,   // a real 503 would be logged as a console error by the browser
      contentType: 'application/json',
      body: JSON.stringify({ started: false, reason: 'Collector is not running' }),
    }));

    const button = page.locator('#refreshBtn');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.locator('#lastUpdated')).toHaveText('⚠️ Collector is not running');
    await expect(button).toBeEnabled();
  });

  test('copy stats puts a summary on the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: /Copy stats/ }).click();
    await expect(page.locator('#toast')).toContainText('Copied to clipboard');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('kWh');
  });

  test('no horizontal scroll', async ({ page }) => {
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
