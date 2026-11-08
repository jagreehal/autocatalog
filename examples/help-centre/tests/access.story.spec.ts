import { expect, test, type Browser } from '@playwright/test';
import { given, story, then, when } from 'executable-stories-playwright';

const GUIDES = {
  start: '/help-centre/getting-started/',
  invoices: '/help-centre/invoices/',
  send: '/help-centre/invoices/send-an-invoice/',
  paid: '/help-centre/payments/get-paid/',
};

/** A page signed in as one of the example's accounts, or signed out. */
async function readerPage(browser: Browser, reader?: string) {
  const page = await browser.newPage();

  if (reader) await page.goto(`${GUIDES.start}?reader=${reader}`);

  return page;
}

// The claim under test: one access module decides, per request, which guides
// each account may open, and every page, list and copy of a guide follows it.
test.describe('A help centre per account', () => {
  test('opens each guide to the accounts whose plan includes it', async ({ browser }, testInfo) => {
    story.init(testInfo, { tags: ['access'] });

    // Getting started, Invoices, Send an invoice, Get paid.
    const order = [GUIDES.start, GUIDES.invoices, GUIDES.send, GUIDES.paid];

    const expected = [
      ['', [200, 403, 403, 403]],
      ['lakeview', [200, 200, 200, 403]],
      ['riverside', [200, 200, 200, 200]],
    ] as const;

    for (const [reader, statuses] of expected) {
      given(reader ? `signed in as ${reader}` : 'nobody signed in');
      const page = await readerPage(browser, reader);

      for (const [i, guide] of order.entries()) {
        then(`${guide} answers ${statuses[i]}`);
        const response = await page.goto(guide);
        expect(response?.status(), `${reader || 'signed out'} ${guide}`).toBe(statuses[i]);
      }

      await page.close();
    }
  });

  test('names a guide a reader may not open, and offers to ask', async ({ browser }, testInfo) => {
    story.init(testInfo, { tags: ['access', 'teaser'] });

    given('Lakeview, whose plan has no payments');
    const page = await readerPage(browser, 'lakeview');

    when('they open the payments guide');
    const response = await page.goto(GUIDES.paid);

    then('it is a 403 with the guide’s title, kept from shared caches');
    expect(response?.status()).toBe(403);
    expect(response?.headers()['cache-control']).toBe('private');
    await expect(page.getByRole('heading', { level: 1, name: 'Get paid' })).toBeVisible();
    await expect(page.getByText('not available on your account')).toBeVisible();

    when('they ask about it');
    await page.getByRole('button', { name: 'Ask us about it' }).click();

    then('the assistant opens on a message to a person');
    await expect(page.getByText('Message a person')).toBeVisible();

    then('its Markdown twin says so in Markdown');
    const twin = await page.request.get('/help-centre/payments/get-paid.md');
    expect(twin.status()).toBe(403);
    expect(twin.headers()['content-type']).toContain('text/markdown');
    expect(await twin.text()).toMatch(/^# Get paid\n/);
    await page.close();
  });

  test('shows each account its own sidebar, home page and search', async ({
    browser,
  }, testInfo) => {
    story.init(testInfo, { tags: ['access', 'search'] });

    given('Lakeview, signed in');
    const lakeview = await readerPage(browser, 'lakeview');

    then('the sidebar has the invoicing guides and not the payments one');
    const nav = lakeview.getByRole('navigation').first();
    await expect(nav.getByRole('link', { name: 'Send an invoice' })).toBeAttached();
    await expect(nav.getByRole('link', { name: 'Get paid' })).toHaveCount(0);

    when('they open the home page');
    await lakeview.goto('/');

    then('it welcomes them, with their guides');
    await expect(
      lakeview.getByRole('heading', { name: 'Welcome back, Lakeview Shop' }),
    ).toBeVisible();
    await expect(lakeview.getByRole('link', { name: /Get paid/ })).toHaveCount(0);

    when('they search as a reader asks');
    await lakeview.goto('/search?q=how+do+I+get+paid');

    then('they find what their plan covers, and not the payments guide');
    await expect(lakeview.getByRole('link', { name: /Invoices/ }).first()).toBeVisible();
    await expect(lakeview.getByRole('link', { name: /^Get paid/ })).toHaveCount(0);

    given('Riverside, whose plan has payments');
    const riverside = await readerPage(browser, 'riverside');
    await riverside.goto('/search?q=how+do+I+get+paid');

    then('the payments guide comes first');
    await expect(riverside.getByRole('link').filter({ hasText: 'Get paid' }).first()).toBeVisible();

    await lakeview.close();
    await riverside.close();
  });

  test('opens the assistant the site composed', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['chat', 'composition'] });

    given('a panel the site builds from the assistant’s parts');
    await page.goto(GUIDES.start);

    when('the reader opens it');
    await page.getByRole('button', { name: 'Ask Acme' }).click();

    then('it has the site’s own words and its own way to search');
    const panel = page.getByRole('region', { name: 'Ask Acme' });
    await expect(panel.getByText('How can we help?')).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Or search the guides' })).toHaveAttribute(
      'href',
      '/search',
    );
  });

  test('gives agents only what the reader may open', async ({ browser }, testInfo) => {
    story.init(testInfo, { tags: ['access', 'agents'] });

    given('nobody signed in');
    const page = await browser.newPage();

    then('llms.txt lists the open guide only, and llms-full.txt carries only it');
    const index = await (await page.request.get('/llms.txt')).text();
    expect(index).toContain('Getting started');
    expect(index).not.toContain('Get paid');
    expect(await (await page.request.get('/llms-full.txt')).text()).not.toContain('Get paid');

    then('a twin reached by an encoded path stays closed');
    const encoded = await page.request.get('/help-centre/payments%2Fget-paid.md');
    expect(encoded.status()).not.toBe(200);
    expect(await encoded.text()).not.toContain('settle to your bank');
    await page.close();
  });
});
