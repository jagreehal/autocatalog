/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { catalogNav, navLinks, portalNav } from '../../nav';
import { SectionRail } from './SectionRail';

const meta = {
  title: 'Overrides/SectionRail',
  component: SectionRail,
  decorators: [
    (Story) => {
      // The site widens the rail to its labels on a page with a sidebar (theme.css).
      document.documentElement.dataset.hasSidebar = '';

      return (
        <div className="not-content">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof SectionRail>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A catalog that names no sections, on a service page. */
export const Catalog: Story = {
  args: {
    links: navLinks(
      catalogNav(['handbook/intro'], ['catalog', 'services', 'owners']),
      '/services/orders-api/',
    ),
  },
};

/** A portal for readers outside, on its API reference. */
export const Portal: Story = {
  args: {
    links: navLinks(portalNav(['guides/start'], ['apis/shop/openapi/']), '/apis/shop/openapi/'),
  },
};

/** A site's own sections, one outside the site and one icon the catalog lacks. */
export const OwnSections: Story = {
  args: {
    links: navLinks(
      [
        { label: 'Guides', href: '/guides/', icon: 'book' },
        { label: 'Runbooks', href: '/runbooks/', icon: 'runbook' },
        { label: 'Status', href: 'https://status.example.com', icon: 'external' },
        { label: 'Other', href: '/other/', icon: 'not-an-icon' },
      ],
      '/guides/setup/',
    ),
  },
};

/** No sections: nothing renders, and the sidebar takes the rail's room. */
export const None: Story = {
  args: { links: [] },
};

/** Worst case: long and translated labels, and one long word that cannot break. */
export const WorstCase: Story = {
  args: {
    links: navLinks(
      [
        { label: 'Platform engineering handbook', href: '/handbook/', icon: 'book' },
        { label: 'Документация', href: '/docs/', icon: 'doc' },
        { label: 'Zahlungsverkehrsrichtlinien', href: '/zahlung/', icon: 'runbook' },
        { label: 'API reference', href: '/apis/', icon: 'api' },
        { label: 'Status', href: 'https://status.example.com', icon: 'external' },
      ],
      '/zahlung/x/',
    ),
  },
};
