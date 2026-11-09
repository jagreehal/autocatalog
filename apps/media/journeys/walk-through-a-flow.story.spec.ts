import { given, story, then, when } from 'executable-stories-playwright';
import { SITES } from '../playwright.config';
import { expect, test } from './fixtures';

story.feature({
  title: 'Walk through a flow',
  narrative: 'A business process drawn from its steps, walked one hop at a time.',
  tags: ['media'],
});

test('Walk through a flow', async ({ page, frame }, testInfo) => {
  story.init({ page }, testInfo);

  given('a flow, drawn from the steps its repository declares');
  await page.goto(`${SITES.docs}/flows/payments-service/capturing-a-payment/`);
  const map = page.getByRole('region', { name: 'Flow' });
  await map.scrollIntoViewIfNeeded();
  await expect(map.locator('.react-flow__node').first()).toBeVisible();
  await frame('The flow, every step and branch', { still: 'flow' });

  when('the reader walks through it');
  await map.getByRole('button', { name: 'Walk through' }).click();
  await expect(map.getByTitle('Stop (Esc)')).toBeVisible();
  await frame('The first step, and where it can go next');

  then('each hop is a step of its own');
  await map.getByTitle('Next (→)').first().click();
  await frame('The next step along the chosen branch');
});
