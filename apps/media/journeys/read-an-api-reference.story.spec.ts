import { given, story, then } from 'executable-stories-playwright';
import { SITES } from '../playwright.config';
import { expect, test } from './fixtures';

story.feature({
  title: 'Read an API reference',
  narrative: "An API's Scalar reference, framed beside the site's own navigation and theme.",
  tags: ['media'],
});

test('Read an API reference', async ({ page, frame }, testInfo) => {
  story.init({ page }, testInfo);

  given("an API's reference, beside the site's navigation");
  await page.goto(`${SITES.api}/apis/public-api/openapi/`);
  const reference = page.frameLocator('iframe[title$="reference"]');
  await expect(reference.locator('h1').first()).toBeVisible({ timeout: 30_000 });
  await frame('The reference in a frame, with its own sidebar and search', {
    still: 'api-reference',
  });

  then('its operations are a click away');
  await reference.locator('a[href^="#tag/"]').first().click();
  await frame('An operation, its place kept in the address');
});
