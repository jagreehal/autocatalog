import { given, story, then } from 'executable-stories-playwright';
import { SITES } from '../playwright.config';
import { expect, test } from './fixtures';

story.feature({
  title: 'Read an EventStorming board',
  narrative:
    'A flow drawn as an EventStorming board: the stages, who and what take part, and the hotspots.',
  tags: ['media'],
});

test('Read an EventStorming board', async ({ page, frame }, testInfo) => {
  story.init({ page }, testInfo);

  given('a flow with its stages, commands, policies and failures');
  await page.goto(`${SITES.storm}/flows/event-storming/catalogue-import/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Catalogue import' })).toBeVisible();

  then('it reads as a board, a column per stage');
  await page.getByText('Event storm', { exact: true }).scrollIntoViewIfNeeded();
  await frame('The board: a column per stage, a sticky per actor, command, event and policy', {
    still: 'event-storm',
  });
});
