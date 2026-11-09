import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { given, story, then, when } from 'executable-stories-playwright';

const GUIDE = '/site-extension/guide/';

const STAFF = '/site-extension/staff/';

// The claim under test: a company makes the site `ac site` builds its own, and
// adds behaviour of its own, from one JSON file, a brand folder and a module of
// its code. Nothing from Astro is installed in this project.
test.describe('A white-labelled site', () => {
  test('carries the company’s name, logos and favicon', async ({ page, request }, testInfo) => {
    story.init(testInfo, { tags: ['brand'] });

    given('a brand folder with a logo for each theme and a PNG favicon');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(GUIDE);

    then('the title is the company’s and its light logo stands in for the name');
    await expect(page).toHaveTitle('Guide | Example Co Help');
    const logo = page.getByRole('img', { name: 'Example Co Help' }).filter({ visible: true });
    await expect(logo).toHaveAttribute('src', /\/logo\.[\w-]+\.svg$/);

    then('the favicon is the PNG, served from the site');
    const icon = page.locator('link[rel="shortcut icon"]');
    await expect(icon).toHaveAttribute('href', '/favicon.png');
    const favicon = await request.get('/favicon.png');
    expect(favicon.ok()).toBe(true);
    expect(favicon.headers()['content-type']).toContain('image/png');

    when('the reader prefers a dark theme');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();

    then('the dark logo shows instead');
    await expect(
      page.getByRole('img', { name: 'Example Co Help' }).filter({ visible: true }),
    ).toHaveAttribute('src', /\/logo-dark\.[\w-]+\.svg$/);
  });

  test('looks like the company: its font, colours and corners', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['brand', 'theme'] });

    given('theme.css that sets shadcn tokens and loads a font from the brand folder');
    await page.goto(GUIDE);

    then('the tokens take the company’s values over the defaults');

    const token = (name: string) =>
      page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n), name);

    expect(await token('--radius')).toMatch(/0?\.25rem/);
    expect(await token('--primary')).toMatch(/300\)?$/);

    then('the font is the company’s, loaded from its own file');

    const font = await page.evaluate(async () => {
      await document.fonts.ready;

      return {
        family: getComputedStyle(document.body).fontFamily,
        loaded: document.fonts.check('16px "Brand Sans"'),
      };
    });

    expect(font.family).toContain('Brand Sans');
    expect(font.loaded).toBe(true);
  });

  test('speaks in the company’s words, with its links and head tags', async ({
    page,
    request,
  }, testInfo) => {
    story.init(testInfo, { tags: ['brand', 'config'] });

    given('`strings`, `social` and `head` in autocatalog.site.json');
    await page.goto(GUIDE);

    then('the interface uses the company’s wording');
    await expect(page.getByText('In this article').first()).toBeAttached();

    then('the header links to the company’s GitHub');
    await expect(page.getByRole('link', { name: 'GitHub' }).first()).toHaveAttribute(
      'href',
      'https://github.com/example',
    );

    then('every page carries the head tags it asked for');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/apple-touch-icon.png',
    );

    then('files in brand/public are served as they are');
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /');
    expect((await request.get('/apple-touch-icon.png')).ok()).toBe(true);
  });
});

test.describe('Sections in the header', () => {
  test('show where the reader is, and take them between sections', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['nav'] });

    given('`nav` with Docs (matching every document), Catalog and an outside Status page');
    await page.goto(GUIDE);
    const sections = page.getByRole('navigation', { name: 'Sections' }).filter({ visible: true });

    then('Docs is the current section on a document');
    await expect(sections.getByRole('link', { name: 'Docs' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(sections.getByRole('link', { name: 'Catalog' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    then('the outside link says it leaves the site');
    await expect(sections.getByRole('link', { name: /Status/ })).toHaveAttribute(
      'rel',
      'external noopener',
    );

    when('the reader opens Catalog');
    await sections.getByRole('link', { name: 'Catalog' }).click();

    then('the catalog opens and becomes the current section');
    await expect(page).toHaveURL(/\/catalog\/$/);
    await expect(
      page
        .getByRole('navigation', { name: 'Sections' })
        .filter({ visible: true })
        .getByRole('link', { name: 'Catalog' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('lead the menu on a phone @phone', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['nav', 'phone'] });

    given('a phone, where the header has no room for them');
    await page.goto(GUIDE);
    await expect(
      page.locator('[data-autocatalog-nav="header"]'),
      'the header keeps to title and menu',
    ).toBeHidden();

    when('the reader opens the menu');
    await page.getByRole('button', { name: 'Menu' }).click();

    then('the sections are at the top of it, the current one marked');
    const menu = page.locator('[data-autocatalog-nav="menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Docs' })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('The company’s own code', () => {
  test('decides who reads what, per request', async ({ page, browser }, testInfo) => {
    story.init(testInfo, { tags: ['extend', 'middleware'] });

    given('middleware that keeps staff pages to staff, and route middleware that hides them');
    const response = await page.goto(STAFF);

    then('a reader who is not staff is turned away');
    expect(response?.status()).toBe(403);

    when('they read the guide');
    await page.goto(GUIDE);

    then('the staff page is in neither the sidebar nor the page links');
    await expect(page.locator(`a[href="${STAFF.slice(0, -1)}"]`)).toHaveCount(0);

    when('a member of staff signs in');
    const staff = await browser.newPage();
    await staff.goto(`${STAFF}?staff`);

    then('they read it, and their sidebar has it');
    await expect(staff.getByText('The secret')).toBeVisible();
    await expect(
      staff.getByRole('navigation').getByRole('link', { name: 'Staff only' }).first(),
    ).toBeAttached();

    then('the sign-in holds as they move around');
    await staff.goto(STAFF);
    await expect(staff.getByText('The secret')).toBeVisible();
    await staff.close();
  });

  test('changes the page: a replaced footer, a rehype plugin, a field of its own', async ({
    page,
    request,
  }, testInfo) => {
    story.init(testInfo, { tags: ['extend'] });

    given('a footer override, a rehype plugin and an `access` field in the docs contract');
    const response = await request.get(GUIDE);

    then('the middleware ran on the response');
    expect(response.headers()['x-extended']).toBe('1');

    when('a reader opens the guide');
    await page.goto(GUIDE);

    then('the rehype plugin rewrote its text');
    await expect(page.getByText('Hello WORLD.')).toBeVisible();

    then('the footer is the company’s, and reads the document’s own field');
    await expect(page.getByText('Extended footer, access: everyone')).toBeVisible();
  });

  test('keeps the catalog prerendered while documents render per request', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['server'] });

    given('`"output": "server"`');

    then('the catalog was built once, as files');
    const dist = path.join(import.meta.dirname, '..', 'dist');
    expect(fs.existsSync(path.join(dist, 'client', 'catalog', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(dist, 'server.mjs'))).toBe(true);

    then('and documents were not: each is rendered for its reader');
    expect(fs.existsSync(path.join(dist, 'client', 'site-extension', 'guide', 'index.html'))).toBe(
      false,
    );
    await page.goto('/catalog/');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('offers agents no copy its own middleware would not see', async ({
    page,
    request,
  }, testInfo) => {
    story.init(testInfo, { tags: ['server', 'agents'] });

    given('a server site with neither `access` nor an audience');

    when('a reader opens a guide');
    await page.goto(GUIDE);

    then('the page offers no Markdown copy and names no twin');
    await expect(page.locator('[data-copy-markdown]')).toHaveCount(0);
    await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveCount(0);

    then('there is no twin, no llms-full.txt and no MCP endpoint to fetch');

    for (const address of ['/site-extension/guide.md', '/llms-full.txt']) {
      const response = await request.get(address);

      expect(response.headers()['content-type']).not.toContain('text/markdown');
      expect(response.headers()['content-type']).not.toContain('text/plain');
    }

    const mcp = await request.post('/mcp', {
      headers: { accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });

    expect(mcp.headers()['content-type']).not.toContain('application/json');
  });
});
