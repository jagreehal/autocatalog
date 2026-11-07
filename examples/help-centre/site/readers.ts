// Who can be signed in. A real site reads its own session instead.
export type Feature = 'invoicing' | 'payments';

export interface Reader {
  id: string;
  name: string;
  /** What this account has, as a document's `access:` frontmatter names it. */
  access: Feature[];
}

export const readers: Reader[] = [
  { id: 'riverside', name: 'Riverside Studio', access: ['invoicing', 'payments'] },
  { id: 'lakeview', name: 'Lakeview Shop', access: ['invoicing'] },
];

export const findReader = (id: string | undefined) => readers.find((reader) => reader.id === id);

/** Questions the assistant offers this reader first. */
export function suggestionsFor(reader: Reader | undefined): string[] {
  if (!reader) return ['How do I get started?'];

  return [
    'How do I invite my team?',
    ...(reader.access.includes('invoicing') ? ['How do I send an invoice?'] : []),
    ...(reader.access.includes('payments') ? ['When do I get paid?'] : []),
  ];
}
