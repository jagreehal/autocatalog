import { expect, type Page, test } from '@playwright/test';
import { given, story, then, when } from 'executable-stories-playwright';

const REFERENCE = '/apis/public-api/openapi/';

// The reference is a page of its own in a frame: these reach into it.
const scalar = (page: Page) => page.frameLocator('iframe[title="Payments API reference"]');

// Scalar's sidebar links each section by its address.
const section = (page: Page, tag: string) => scalar(page).locator(`a[href="#tag/${tag}"]`);

// Scalar loads from its CDN, which a cold start can take a while to reach.
const LOADED = { timeout: 20_000 };

const frameHash = (page: Page) =>
  page.locator('iframe[title="Payments API reference"]').evaluate((frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return '';

    return frame.contentWindow?.location.hash ?? '';
  });

test.describe('The API reference in a frame', () => {
  test('keeps the site’s navigation beside Scalar’s own, and scrolls only the reference', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['api', 'frame'] });

    given('a site whose API reference is framed, the default');
    await page.goto(REFERENCE);

    then('the site’s sidebar is there, with the reference current');
    await expect(
      page.locator('#starlight__sidebar').getByRole('link', { name: 'API reference' }),
    ).toHaveAttribute('aria-current', 'page');

    then('Scalar has the rest, with its own navigation and search');
    await expect(scalar(page).locator('h1', { hasText: 'Payments API' })).toBeVisible(LOADED);
    await expect(section(page, 'balances')).toBeVisible();

    then('the page around the frame does not scroll as well');
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(1);
  });

  test('puts the reader’s place in the address, and opens there from a link', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['api', 'frame', 'links'] });

    given('the reference');
    await page.goto(REFERENCE);

    when('the reader opens a section in Scalar');
    await section(page, 'payments').click(LOADED);

    then('the page’s address says where they are');
    await expect(page).toHaveURL(/#tag\/payments$/);

    when('someone opens that address');
    const shared = page.url();

    await page.goto('about:blank');
    await page.goto(shared);

    then('the frame opens at the same place');
    await expect.poll(() => frameHash(page)).toBe('#tag/payments');
  });

  test('follows the site’s theme, and keeps the reader where they were', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['api', 'frame', 'theme'] });

    given('the reference open at a section, in the light theme');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`${REFERENCE}#tag/balances`);
    await expect(scalar(page).locator('body')).toHaveClass(/light-mode/, LOADED);

    when('the reader switches the site to dark');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();

    then('the reference turns dark too, at the same section');
    await expect(scalar(page).locator('body')).toHaveClass(/dark-mode/);
    expect(await frameHash(page)).toBe('#tag/balances');
  });

  test('on a laptop, never covers the reference, and collapsing the sidebar gives Scalar its own', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['api', 'frame', 'layout'] });

    given('a laptop-sized window, where the frame is too narrow for Scalar’s sidebar');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(REFERENCE);
    await expect(scalar(page).locator('h1', { hasText: 'Payments API' })).toBeVisible(LOADED);
    await expect(section(page, 'balances')).toBeHidden();

    then('the sidebar’s toggle sits beside the frame, not over it');

    const toggle = page.getByRole('button', { name: 'Collapse sidebar' });
    const frame = page.locator('iframe[title="Payments API reference"]');

    expect((await toggle.boundingBox())!.x + (await toggle.boundingBox())!.width).toBeLessThan(
      (await frame.boundingBox())!.x,
    );

    when('the reader collapses the site’s sidebar');
    await expect(page.locator('[data-sidebar-toggle][data-ready]').first()).toBeAttached();
    await toggle.click();

    then('Scalar has room for its own sidebar');
    await expect(section(page, 'balances')).toBeVisible();
  });
});

test.describe('A site for readers outside', () => {
  test('opens on its guides and APIs, with no map of the company’s systems', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['public', 'audience'] });

    given('the home page of a site for developers outside the company');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    then('it has no architecture map and no count of what the catalog holds');
    await expect(page.getByRole('heading', { name: 'Architecture' })).toHaveCount(0);
    await expect(page.locator('[data-graph]')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'What the catalog holds' })).toHaveCount(0);
  });
});
