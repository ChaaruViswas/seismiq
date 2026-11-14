import { expect, type Page, test } from '@playwright/test';

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
});
test.afterEach(() => {
  expect(errors, 'no console errors').toEqual([]);
});

async function open(page: Page, route: string, heading: string) {
  await page.goto(`/#/${route}`);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 30_000 });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('overview loads the demo and shows the engine scorecard', async ({ page }) => {
  await open(page, '', 'Overview');
  await expect(page.getByText('Demo data').first()).toBeVisible();
  await expect(page.getByRole('img', { name: /Failed and retried tests per run/ })).toBeVisible();
  await expect(page.getByText('Culprit commit ranked first')).toBeVisible();
  await noHorizontalScroll(page);
});

const pages: [string, string][] = [
  ['changes', 'Change impact'],
  ['tests', 'Tests'],
  ['flaky', 'Flaky tests'],
  ['failures', 'Failures'],
  ['pipeline', 'Pipeline'],
  ['model', 'Model card'],
  ['import', 'Import data'],
  ['about', 'How it works'],
];
for (const [route, heading] of pages) {
  test(`${heading} page renders without errors or overflow`, async ({ page }) => {
    await open(page, route, heading);
    await noHorizontalScroll(page);
  });
}

test('a pasted diff is analysed into a test plan', async ({ page }) => {
  await open(page, 'changes', 'Change impact');
  await page.getByRole('tab', { name: 'Analyse a diff' }).click();
  await page.getByLabel('Diff or list of changed paths').fill('src/core/logger.ts\nREADME.md');
  await page.getByRole('button', { name: 'Analyse change' }).click();
  await expect(page.getByText('2 changed files')).toBeVisible();
  await expect(page.getByText('Recommended test order')).toBeVisible();
  await expect(page.getByText('Source file')).toBeVisible();
  await expect(page.getByText('Documentation')).toBeVisible();
});

test('a lockfile change forces the full suite', async ({ page }) => {
  await open(page, 'changes', 'Change impact');
  await page.getByRole('tab', { name: 'Analyse a diff' }).click();
  await page.getByLabel('Diff or list of changed paths').fill('package-lock.json');
  await page.getByRole('button', { name: 'Analyse change' }).click();
  await expect(page.getByText('Forces a full run')).toBeVisible();
  await expect(page.getByText('of the suite').first()).toContainText('100%');
});

test('test filters and the detail drawer work', async ({ page }) => {
  await open(page, 'tests', 'Tests');
  await page.getByLabel('State').selectOption('flaky');
  const firstRow = page.locator('tbody tr').first();
  await expect(firstRow).toContainText('Flaky');
  await firstRow.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Flakiness', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('the quarantine simulator reacts to the threshold', async ({ page }) => {
  await open(page, 'flaky', 'Flaky tests');
  const slider = page.getByLabel('Minimum flake score to quarantine');
  await slider.fill('0');
  const many = await page.getByText(/→ \d+ tests?/).textContent();
  await slider.fill('90');
  const few = await page.getByText(/→ \d+ tests?/).textContent();
  expect(Number(many?.match(/\d+/)?.[0])).toBeGreaterThan(Number(few?.match(/\d+/)?.[0]));
});

test('command palette finds pages and tests', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcut is a desktop feature');
  await open(page, '', 'Overview');
  await page.keyboard.press('Control+k');
  const input = page.getByLabel('Search tests, runs, commits and pages');
  await input.fill('model');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Model card' })).toBeVisible();
});

test('importing JUnit reports replaces the demo and survives a reload', async ({ page }) => {
  await open(page, 'import', 'Import data');
  const report = (i: number, fail: boolean) => ({
    name: `run-${i}.xml`,
    mimeType: 'application/xml',
    buffer: Buffer.from(
      `<testsuite name="cart" timestamp="2026-11-0${i}T10:00:00Z"><testcase classname="cart" name="adds" time="0.1"/>` +
        `<testcase classname="cart" name="totals" time="0.2">${fail ? '<failure message="expected 1 to equal 2"/>' : ''}</testcase></testsuite>`,
    ),
  });
  await page.getByLabel('Project name').fill('Shop API');
  await page.locator('input[type=file]').setInputFiles([report(1, false), report(2, true), report(3, false)]);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Shop API')).toBeVisible();
  await expect(page.getByText('Imported', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Shop API')).toBeVisible({ timeout: 30_000 });
  await open(page, 'import', 'Import data');
  await page.getByRole('button', { name: 'Back to the demo' }).click();
  await expect(page.getByText('Demo data').first()).toBeVisible({ timeout: 30_000 });
});

test('the theme toggle switches and persists', async ({ page }) => {
  await open(page, '', 'Overview');
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
  const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(after);
});
