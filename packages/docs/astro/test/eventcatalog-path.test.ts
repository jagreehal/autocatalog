import { expect, it } from 'vitest';
import { architectureHref, eventCatalogPath } from '../src/eventcatalog-path';

it('opens a page inside the hosted EventCatalog', () => {
  expect(eventCatalogPath('eventcatalog/visualiser/events/payment.completed/1.0.0/')).toBe(
    'eventcatalog/visualiser/events/payment.completed/1.0.0/',
  );
});

it('opens any page EventCatalog can build, a SemVer with build metadata included', () => {
  for (const valid of [
    'eventcatalog/visualiser/events/payment.completed/1.0.0+build.7/',
    'eventcatalog/visualiser/services/Ledger%20Service/1.0.0/',
    'eventcatalog/docs/events/order@v2/1.0.0/',
  ]) {
    expect(eventCatalogPath(valid)).toBe(valid);
  }
});

it('never lets ?at= name anything outside EventCatalog', () => {
  for (const hostile of [
    null,
    '',
    'https://evil.example/',
    '//evil.example/',
    'javascript:alert(1)',
    'eventcatalog/../catalog.json',
    'eventcatalog/./x',
    'eventcatalog\\..\\x',
    'eventcatalog/x?y=1',
    'eventcatalog/x#y',
    'eventcatalog/%2e%2e/catalog.json',
    'eventcatalog/%2E/x',
    'eventcatalog/bad%zz',
    'eventcatalog/a b',
    'docs/',
  ]) {
    expect(eventCatalogPath(hostile)).toBeNull();
  }
});

it('links to the Architecture page at a diagram, under the base', () => {
  expect(architectureHref('/docs/', 'eventcatalog/visualiser/graph/')).toBe(
    '/docs/architecture/?at=eventcatalog%2Fvisualiser%2Fgraph%2F',
  );
});
