export const events = [
  {
    id: 'kyc.submitted',
    version: '1.0.0',
    name: 'KYC Submitted',
    summary: 'Fires when a KYC submission is received',
    domain: 'kyc',
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { applicantId: { type: 'string' } },
    },
    examples: [{ name: 'default', data: { applicantId: 'app_1' } }],
  },
];
