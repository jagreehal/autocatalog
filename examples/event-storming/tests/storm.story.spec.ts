import { expect, test } from '@playwright/test';
import { given, story, then, when } from 'executable-stories-playwright';

const IMPORT = '/flows/event-storming/catalogue-import/';

test.describe('An EventStorming board from a flow', () => {
  test('lays the import out by stage, with each failure under the stage it comes from', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['storm'] });

    given('flows/catalogue-import.md, drafted from the import code and named by the team');
    await page.goto(IMPORT);

    then('the page opens on the board, a column per stage');
    const board = page.getByRole('grid', { name: 'Event storm' });
    await expect(board.getByRole('columnheader', { name: /Request import/ })).toBeVisible();
    await expect(board.getByRole('columnheader', { name: /Finish import/ })).toBeAttached();

    then('a failure sits on the failure track, with the hotspot a finding raised on it');
    const failures = board.getByRole('row', { name: /Failure track/ });
    await expect(failures.getByText('Import not found')).toBeVisible();
    await expect(
      failures.locator('[data-sticky="failure"]', { hasText: 'Hotspot' }).first(),
    ).toBeVisible();

    then('a failure nothing handles is a hotspot of its own, in the policy row');
    await expect(
      board.getByRole('row', { name: /Policy/ }).getByText(/No policy after “Import not found”/),
    ).toBeVisible();
  });

  test('shows the code behind each sticky on request, and leads from a sticky to its step', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['storm'] });

    given('a board whose steps link to the code that implements them');
    await page.goto(IMPORT);
    await expect(page.getByText('src/import.ts · loadImport')).toHaveCount(0);

    // The switch works once the board's island has hydrated, as a reader's would.
    await expect(
      page.locator('astro-island', { has: page.locator('[data-sticky]') }).first(),
    ).not.toHaveAttribute('ssr');

    when('the reader asks to see the code');
    await page.getByText('Show the code behind each sticky').click();

    then('each sticky names the file and what it contains');
    await expect(page.getByText('src/import.ts · loadImport')).toBeVisible();

    when('they open a sticky');
    await page.locator('[data-sticky="event"]', { hasText: 'Import loaded' }).first().click();

    then('the step it stands for is in view, in the list of steps');
    await expect(page).toHaveURL(/#step-load$/);
    await expect(page.locator('#step-load')).toBeInViewport();
  });

  test('zooms into a stage that runs once per product', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['storm', 'zoom'] });

    given('a stage that runs in a loop and names the flow inside it');
    await page.goto(IMPORT);

    when('the reader follows it');
    await page.getByRole('link', { name: 'Inside: Ingest a product' }).click();

    then('the inner flow opens on its own board');
    await expect(page).toHaveURL(/\/flows\/event-storming\/ingest-product\/$/);
    await expect(page.getByRole('grid', { name: 'Event storm' })).toBeVisible();
  });

  test('says how a run can end, what to decide, and what to test', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['storm'] });

    given('findings on the flow, and scenarios in its frontmatter');
    await page.goto(IMPORT);

    then('each ending says the status it leaves and who hears of it');
    const endings = page.getByRole('grid', { name: 'How it can end' });
    await expect(endings.getByRole('row', { name: /Import not found/ })).toContainText('Nothing');
    await expect(endings.getByRole('row', { name: /Catalogue import errored/ })).toContainText(
      'notify the user',
    );

    then('each hotspot links to the finding that raised it');
    await page
      .getByRole('list', { name: 'Hotspots' })
      .getByRole('link', { name: /Missing import or supplier vanishes silently/ })
      .click();
    await expect(page).toHaveURL(/\/findings\/missing-import-or-supplier\/$/);

    when('the reader goes back to the scenarios');
    await page.goBack();

    then('a case where today differs from what should happen says both');
    await expect(page.getByRole('grid', { name: 'Scenarios' })).toContainText(
      'Expected: Decided under the outside-region hotspot',
    );
  });
});

test.describe('Boards in a page of prose', () => {
  test('draws a flow’s board, a board sketched by hand, and a sticky in a sentence', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['storm', 'mdx'] });

    given('an MDX page with <Storm flow>, <Storm stages> and <Sticky>, none of them imported');
    await page.goto('/event-storming/storming/');

    then('the sentence carries the sticky inline');
    await expect(
      page.locator('p [data-sticky="event"]', { hasText: 'Import loaded' }),
    ).toBeVisible();

    then('the flow’s board and the hand-drawn one are both there');
    await expect(page.getByRole('grid', { name: 'Catalogue import' })).toBeVisible();
    await expect(
      page.getByRole('grid', { name: 'Catalogue export' }).getByText('Export too large'),
    ).toBeVisible();
  });
});

test.describe('The big picture', () => {
  test('lines every flow up as a lane of facts', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['storm', 'big-picture'] });

    given('two flows in the repository');
    await page.goto('/flows/');

    then('each is a lane, with its facts in order and what is open on it');
    const lanes = page.getByRole('list', { name: 'Big picture' });
    await expect(lanes.getByRole('link', { name: 'Catalogue import' })).toBeVisible();
    await expect(
      lanes.getByRole('list', { name: 'Catalogue import, in order' }).getByText('Import loaded'),
    ).toBeVisible();
    await expect(lanes.getByText(/hotspots/).first()).toBeVisible();
  });
});
