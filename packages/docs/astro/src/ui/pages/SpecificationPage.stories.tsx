/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SpecificationPage } from './SpecificationPage';

const meta = {
  title: 'Pages/SpecificationPage',
  component: SpecificationPage,
  parameters: { layout: 'fullscreen' },
  args: {
    format: 'WSDL',
    language: 'html',
    repository: 'shipping',
    file: 'contracts/carrier.wsdl',
    downloadHref: '/specs/shipping/carrier/carrier.wsdl',
    services: [{ name: 'shipping-service', href: '/services/shipping-service/' }],
    source: `<definitions name="Carrier" xmlns="http://schemas.xmlsoap.org/wsdl/">
  <message name="BookCollection">
    <part name="parcelId" type="xsd:string"/>
  </message>
</definitions>`,
  },
} satisfies Meta<typeof SpecificationPage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Unattached: Story = { args: { services: [] } };
