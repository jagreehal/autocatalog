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

    given('repositories, and packages inside a monorepo, that each committed their own docs/');
    await page.goto('/');

    then('the index reports what it aggregated');
    await expect(page.getByText('9 documents from 6 repositories')).toBeVisible();

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
      expect.arrayContaining(['defines', 'publishes', 'produces', 'usesModel', 'repliesTo']),
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
    // Clicked again until the index has hydrated and listens.
    await expect(async () => {
      await page.getByRole('radio', { name: /^agent 1$/i }).click();
      await expect(page.getByText('1 resource', { exact: true })).toBeVisible({ timeout: 500 });
    }).toPass();

    then('the Agent remains with its evidence and model connection');
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
    then('only the fields that match stay on screen');
    // Typed again until the table has hydrated and listens.
    const filter = page.getByPlaceholder('Filter by field, event or service');
    await expect(async () => {
      await filter.fill('');
      await filter.fill('paymentId');
      await expect(page.locator('tr[data-search]:visible')).toHaveCount(1, { timeout: 500 });
    }).toPass();
  });

  test('a monorepo publishes each package as if it were its own repository', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['monorepo', 'events', 'docs'] });

    given('acme-platform keeps orders and shipping under services/, each with its own docs/');
    await page.goto('/acme-platform/workspace/');

    when("a reader follows the workspace page to the orders package's runbook");
    await page.locator('main').getByRole('link', { name: 'Orders runbook' }).first().click();

    then('it is published under the package name, not the path it sits at');
    await expect(page).toHaveURL(/\/orders\/runbook\/?$/);

    when('the reader opens the event the runbook is about');
    await page.goto('/events/orders/orders/order.placed/');

    then("the consumer another package declared is on it, and the monorepo's owner");
    const participants = page.getByText(/Consumed by/);
    await expect(participants.getByRole('link', { name: 'ShippingService' })).toBeVisible();
    await expect(participants.getByRole('link', { name: 'acme/orders' })).toBeVisible();

    then(
      'the runtime card says what happened to its deliveries, and where it puts those it gives up on',
    );
    await expect(page.locator('#runtime')).toContainText(
      '4 deliveries: 3 failed, 2 retried, 1 dead-lettered. Dead letters go to shipping-dlq after 5 attempts.',
    );
  });

  test('a specification the catalog has no model for is published as written', async ({
    page,
    request,
  }, testInfo) => {
    story.init(testInfo, { tags: ['specifications'] });

    given('payments-service commits a WSDL under contracts/, its sidecar naming PaymentService');
    await page.goto('/services/PaymentService/');

    when('a reader opens it from the service it belongs to');
    await page.getByRole('link', { name: /Card gateway/ }).click();

    then('the page shows the source, and the file downloads under its own name');
    await expect(page).toHaveURL(/\/specs\/payments-service\/card-gateway\/?$/);
    await expect(page.getByLabel('contracts/card-gateway.wsdl')).toContainText(
      '<portType name="CardGatewayPort">',
    );

    const wsdl = await request.get('/specs/payments-service/card-gateway/card-gateway.wsdl');

    expect(wsdl.ok()).toBe(true);
    expect(await wsdl.text()).toContain('<definitions name="CardGateway"');
  });

  test('a business process crosses repositories, and opens in lanes by domain', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['flows', 'monorepo'] });

    given(
      'acme-platform declares Order to dispatch under flows/, naming payments-service resources',
    );
    await page.goto('/flows/');
    await page.getByRole('link', { name: 'Order to dispatch' }).click();

    then('every step is listed in order, each linked to its page in the catalog');
    const steps = page.locator('#steps');
    await expect(steps.getByRole('link', { name: /^4\. Payment captured/ })).toHaveAttribute(
      'href',
      '/events/payments-service/payments/payment.captured/',
    );
    await expect(steps).toContainText('Then Payment captured (Card accepted)');

    then('a step names the one that undoes it if a later step fails');
    await expect(steps).toContainText('If a later step fails, Refund the payment undoes it.');

    then("the map opens in lanes by domain, as the flow's frontmatter says");
    const map = page.getByRole('region', { name: 'Flow' });
    await expect(map.getByText('payments', { exact: true })).toBeVisible();
    await expect(map.getByText('orders', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/group=domain&groupStyle=lanes/);

    then('the saga that runs it shows how its runs went, step by step');
    await expect(page.locator('#runtime')).toContainText(
      'Ran 4 times: 3 completed, 1 compensated.',
    );
    await expect(steps).toContainText('Ran 4 times: 1 failed.');
    await expect(page.locator('#runtime')).toContainText(
      'It also ran NotifyCustomer, which no step here names.',
    );

    when('the reader walks through the flow from the start');
    // Ten steps, beside the lanes they sit in.
    await expect(map.locator('.react-flow__node:not(.react-flow__node-swimlane)')).toHaveCount(10);
    // Pressed again until the walkthrough has hydrated and listens.
    await expect(async () => {
      await map.getByTitle('Start walking through the flow').click();
      await expect(map.getByTitle('Stop (Esc)')).toBeVisible({ timeout: 500 });
    }).toPass();
    await map.getByTitle('Next (→)').first().click();

    then('each step is called by its title, not its id');
    await expect(map.getByRole('heading', { name: 'Take payment' })).toBeVisible();
    await map.getByTitle('Stop (Esc)').click();

    when('the reader opens the event');
    await page.goto('/events/payments-service/payments/payment.captured/');

    then('it lists the flow it is a step in');
    await expect(
      page.locator('#flows').getByRole('link', { name: /Order to dispatch/ }),
    ).toBeVisible();
  });

  test('an MDX document draws from the catalog without importing anything', async ({
    page,
  }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'mdx'] });

    given('docs/overview.mdx using <Owner>, <Term>, <Map> and <Schema>');
    await page.goto('/payments-service/overview');

    then('the term links to its definition in the glossary');
    await expect(page.getByRole('link', { name: 'Capture', exact: true })).toHaveAttribute(
      'href',
      '/glossary/#payments-capture',
    );

    then('the map and the schema come from the catalog');
    await expect(page.locator('.react-flow').first()).toBeVisible();
    await expect(page.getByText('paymentId').first()).toBeVisible();

    when('the reader follows the term');
    await page.getByRole('link', { name: 'Capture', exact: true }).click();

    then('the glossary defines it, under its domain');
    await expect(page.locator('#payments-capture')).toContainText(
      'Taking money a card issuer has already authorised.',
    );
  });

  test('an entity says which events carry its identifier', async ({ page }, testInfo) => {
    story.init(testInfo, { tags: ['docs', 'entities'] });

    given('entities/payment.md, with its properties read from a JSON Schema');
    await page.goto('/entities/payments-service/payment/');

    then('its properties are the schema’s');
    await expect(page.locator('#properties')).toContainText('In the currency');

    then('the events whose schema has paymentId are listed');
    await expect(
      page.locator('#events').getByRole('link', { name: 'Payment captured' }),
    ).toBeVisible();

    when('the owning team is opened');
    await page.goto('/owners/payments/');

    then('the directory’s profile is on its page');
    await expect(page.locator('#profile')).toContainText('Grace Hopper (Engineering manager)');
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
