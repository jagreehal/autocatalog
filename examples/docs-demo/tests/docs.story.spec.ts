import { expect, test } from '@playwright/test';
import { given, story, then, when } from 'executable-stories-playwright';

// The claim under test: documentation stays in the repository that owns it, and
// readers still get one surface. Nothing in this project authors a document, a
// date or a backlink — the site is built from three repositories' docs/ roots.
//
// Starlight's own behaviour is tested by Starlight. What is covered here is the
// seam: that a document living in another repository still reaches Starlight's
// pages, navigation and search intact.
test.describe('The company documentation index', () => {
  test('one search covers every repository', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'search'] });

    given('documents from three repositories in one search index');
    await page.goto('/');

    when('a reader searches for a phrase written in one of them');
    await page.getByRole('button', { name: /search/i }).click();
    await page.getByPlaceholder(/search/i).fill('idempotency window');

    then('the document that contains it is offered, wherever it lives');
    await expect(
      page.getByRole('link', { name: /Replaying failed captures/ }).first(),
    ).toBeVisible();
  });

  test('a field the company added to its own contract reaches the page', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'contract'] });

    given('a `tier` field Acme added to contracts/docs-frontmatter.json');
    await page.goto('/payments-service/runbook');

    then('the site can show it, through this company’s own component');
    await expect(page.getByText('Someone may be paged while reading this.')).toBeVisible();

    when('a document the company tiered as standard is opened');
    await page.goto('/reporter/daily-reconciliation');

    then('it says nothing of the sort');
    await expect(page.getByText('Someone may be paged while reading this.')).toHaveCount(0);
  });

  test('the sidebar is what is on disk, not what someone configured', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'navigation'] });

    given('three enrolled repositories');
    await page.goto('/payments-service/runbook');

    then('each is a navigation group, titled from its own frontmatter');
    const nav = page.getByRole('navigation').first();
    await expect(nav.getByText('acme-handbook', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Replaying failed captures' })).toBeVisible();
  });

  test('documents from every repository land on one index', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'aggregate'] });

    given('three repositories that each committed their own docs/');
    await page.goto('/');

    then('the index reports what it aggregated');
    await expect(page.getByText('5 documents from 3 repositories')).toBeVisible();

    when('a repository section is read');
    then('its documents are listed under its own name');
    await expect(page.getByRole('heading', { name: 'payments-service' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Payments service runbook' }).first(),
    ).toBeVisible();
  });

  test('a declared cross-repository edge resolves, and appears at both ends', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'edges'] });

    given('a handbook policy declaring related: payments-service/runbook');
    await page.goto('/acme-handbook/incident-communications');

    then('the policy links to the runbook by its resolved title, not by path');
    const related = page.locator('[data-links="related"]');
    await expect(related.getByRole('link', { name: 'Payments service runbook' })).toBeVisible();

    when('the runbook is opened');
    await related.getByRole('link', { name: 'Payments service runbook' }).click();

    then('the same edge appears from the other end, derived and never authored');
    await expect(
      page.locator('[data-links="linked-from"]').getByRole('link', {
        name: 'Incident communications',
      }),
    ).toBeVisible();
  });

  test('a diagram committed beside the document is published with it', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'assets'] });

    given('a runbook referencing an image in the same docs/ folder');
    await page.goto('/payments-service/runbook');

    then('the image is served from this site, not from the author machine');
    const diagram = page.getByRole('img', { name: /capture path/i });
    await expect(diagram).toBeVisible();
    // Decoded at the committed capture-flow.png's own width, so it really loaded.
    await expect(diagram).toHaveJSProperty('naturalWidth', 2000);
  });

  test('every page has a raw markdown twin at the same path', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'agents'] });

    given('a rendered document page');
    await page.goto('/payments-service/ops/replay');

    when('the markdown twin is requested');
    await page.getByRole('link', { name: 'view as markdown' }).click();

    then('it serves the source, frontmatter intact');
    await expect(page.locator('body')).toContainText('title: Replaying failed captures');
    await expect(page.locator('body')).toContainText('owner: Payments');
  });

  test('llms.txt lists the whole index, generated not authored', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'agents'] });

    given('an index built from three repositories');
    when('/llms.txt is fetched');
    await page.goto('/llms.txt');

    then('every repository and document appears, pointing at markdown');
    const body = page.locator('body');
    await expect(body).toContainText('## acme-handbook');
    await expect(body).toContainText('## reporter');
    await expect(body).toContainText('/payments-service/runbook.md');
  });

  test('ownership is shown on the document, not looked up elsewhere', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'ownership'] });

    given('a document whose frontmatter names an owning team');
    await page.goto('/reporter/daily-reconciliation');

    then('the reader can see who to ask without leaving the page');
    await expect(page.getByText('Owned by Data Platform')).toBeVisible();
  });

  test('one graph connects repository-owned docs, events, and agents automatically', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'graph'] });

    given('a repository with conventional docs/, events/, and agents/ roots');
    await page.goto('/catalog.json');

    then('the public graph contains both resource kinds and their repository edges');

    // SAFETY: the shape is what this test asserts, not what it assumes: every field
    // read below is checked by the expectations that follow, and a graph without
    // them fails the test with a TypeError instead of passing.
    const graph = JSON.parse(await page.locator('body').innerText()) as {
      spec: string;
      resources: Array<{ ref: { kind: string; id: string } }>;
      relationships: Array<{ type: string }>;
    };

    expect(graph.spec).toBe('autocatalog/graph-v1');
    expect(graph.resources.map((resource) => resource.ref.kind)).toEqual(
      expect.arrayContaining(['agent', 'document', 'event', 'model', 'repository', 'service']),
    );
    expect(graph.relationships.map((relationship) => relationship.type)).toEqual(
      expect.arrayContaining(['defines', 'publishes', 'produces', 'usesModel']),
    );

    when('a document from that repository is opened');
    await page.goto('/payments-service/runbook');

    then('its automatically connected event is visible without authored linkage');
    const connections = page.getByRole('complementary', { name: 'Repository catalog' });
    await expect(connections).toContainText('payment.captured');
    await expect(connections).toContainText('Payment captured');
    await expect(connections).toContainText('Refund agent');
  });

  test('the knowledge graph is browsable as one catalog', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['catalog', 'graph'] });

    given('resources compiled from documentation, events, and agent manifests');
    await page.goto('/catalog');

    then('the shell exposes the graph as a searchable engineering index');
    await expect(page.getByRole('heading', { name: 'Knowledge graph' })).toBeVisible();
    await expect(page.getByText('autocatalog/graph-v1')).toBeVisible();
    // Scoped to the index: the sidebar links events too, and so does the map
    // above the index, which no filter of the index narrows.
    const index = page.locator('[data-catalog-explorer]');
    await expect(index.getByRole('link', { name: 'Refund agent' })).toBeVisible();
    await expect(index.getByRole('link', { name: 'Payment captured' })).toBeVisible();

    when('an engineer narrows the index to Agents');
    await page.getByRole('radio', { name: /^agent 1$/i }).click();

    then('the Agent remains with its evidence and model connection');
    await expect(page.getByText('1 resource', { exact: true })).toBeVisible();
    const agent = page.locator('[data-resource][data-kind="agent"]');
    await expect(agent.getByRole('link', { name: 'Refund agent' })).toBeVisible();
    await expect(index.getByRole('link', { name: 'Payment captured' })).toBeHidden();
    const connections = agent.getByRole('button', { name: /connections?$/ });
    await connections.click();
    await expect(connections).toHaveAttribute('aria-expanded', 'true');
    await agent.getByRole('link', { name: 'Fast model' }).click();

    then('following a connection restores and focuses its target resource');
    const model = page.locator('[data-resource][data-kind="model"]');
    await expect(model).toBeVisible();
    await expect(page).toHaveURL(/#resource-model%3Afast-model$/);
  });

  test('an event, the services around it, and the fields they share', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['events', 'services', 'fields'] });

    given('payments-service publishes its events/ beside its docs/');
    await page.goto('/events/payments-service/payments/payment.captured/');

    then('the event page says where its contract was found and who produces it');
    await expect(page.getByRole('heading', { level: 1, name: 'Payment captured' })).toBeVisible();
    await expect(page.getByText(/Read from/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Schema' })).toBeVisible();
    const producedBy = page.getByText(/^Produced by/);
    await expect(producedBy.getByRole('link', { name: 'PaymentService' })).toBeVisible();

    when('a reader follows the producing service');
    await producedBy.getByRole('link', { name: 'PaymentService' }).click();

    then('its page lists what it produces, which nobody wrote by hand');
    await expect(page.getByRole('heading', { level: 1, name: 'PaymentService' })).toBeVisible();
    // The flow strip links the event too, so the list itself is what is checked.
    await expect(
      page.locator('#produces').getByRole('link', { name: 'Payment captured' }),
    ).toBeVisible();

    when('the reader filters the field index by that service');
    await page.goto('/fields/');
    await page.getByPlaceholder('Filter by field, event or service').fill('paymentId');

    then('only the fields that match stay on screen');
    await expect(page.locator('tr[data-search]:visible')).toHaveCount(1);
  });

  test('an agent finds the markdown and the contract without guessing', async ({
    page,
    request,
  }, testInfo) => {
    story.init(testInfo, { tags: ['agents'] });

    given('a document page');
    await page.goto('/payments-service/runbook');

    then('its head names the markdown twin');

    const twin = await page
      .locator('link[rel="alternate"][type="text/markdown"]')
      .getAttribute('href');

    expect(twin).toBe('/payments-service/runbook.md');

    when('the agent fetches the twin and the event contract');
    const markdown = await (await request.get(twin!)).text();

    const schema = await (
      await request.get('/events/payments-service/payments/payment.captured/schema.json')
    ).json();

    then('the twin carries its URL and the contract is JSON Schema');
    expect(markdown).toMatch(/^url: https:\/\/docs\.acme\.example\/payments-service\/runbook\/$/m);
    expect(schema.type).toBe('object');
  });
});
