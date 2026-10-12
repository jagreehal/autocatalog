/** @jsxImportSource react */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Item, ItemContent, ItemMedia, ItemTitle } from '#ui/components/ui/item.tsx';
import { icons, type IconName } from '../../icons';
import { Icon } from './Icon';

const meta = {
  title: 'Components/Icon',
  component: Icon,
  args: { name: 'event' },
} satisfies Meta<typeof Icon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// SAFETY: the keys of `icons` are exactly IconName, which is derived from it.
const names = Object.keys(icons) as IconName[];

/** Every icon by the name it is drawn under, in the one treatment rows give it. */
export const AllIcons: Story = {
  render: () => (
    <ul className="not-content m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-5">
      {names.map((name) => (
        <li key={name}>
          <Item size="xs" variant="outline">
            <ItemMedia variant="icon">
              <Icon name={name} className="text-muted-foreground" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                <code className="font-mono font-normal">{name}</code>
              </ItemTitle>
            </ItemContent>
          </Item>
        </li>
      ))}
    </ul>
  ),
};
