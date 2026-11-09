import { given, story, then, when } from 'executable-stories-playwright';
import { SITES } from '../playwright.config';
import { expect, test } from './fixtures';

story.feature({
  title: 'Browse a catalog',
  narrative: `
    A company's catalog, built from its repositories: what it holds, its
    services, one service up close, and a document beside them.
  `,
  tags: ['media', 'readme'],
});

test('Browse a catalog', async ({ page, frame }, testInfo) => {
  story.init({ page }, testInfo);

  given('the catalog opens on what it holds and how it connects');
  await page.goto(`${SITES.docs}/`);
  await expect(page.getByRole('list', { name: 'What the catalog holds' })).toBeVisible();
  await page.getByRole('heading', { name: 'Architecture' }).scrollIntoViewIfNeeded();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await frame('The home page: what the catalog holds, and its architecture', { still: 'home' });

  when('the reader opens the services');
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Catalog' })
    .click();
  await page
    .locator('.sidebar-content')
    .getByRole('link', { name: 'Services', exact: true })
    .click();
  await expect(page.getByRole('grid', { name: 'Services' })).toBeVisible();
  await frame('Every service, its owner, what it serves, receives and sends', {
    still: 'services',
  });

  when('they open one');
  await page
    .getByRole('grid', { name: 'Services' })
    .getByRole('link', { name: 'LedgerService' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'LedgerService' })).toBeVisible();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await frame('A service: where it was read from, and the services around it', {
    still: 'service',
  });

  then('a document sits one click away, in the Docs section');
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Docs' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await frame('A document from a repository, with its owner and its place in the catalog', {
    still: 'document',
  });
});
