/** @jsxImportSource react */
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '#ui/components/ui/item.tsx';
import { kindIcon } from '../../icons';
import { Icon } from '../components/Icon';
import { SectionHeading } from '../components/SectionHeading';
import { IconTile } from '../components/IconTile';

export interface OwnedResource {
  kind: string;
  title: string;
  href: string;
  namespace?: string | undefined;
  summary?: string | undefined;
}

/** What `teams/<id>.md` or `users/<id>.md` says of an owner. */
export interface OwnerProfile {
  kind: 'team' | 'user';
  summary?: string | undefined;
  role?: string | undefined;
  avatarUrl?: string | undefined;
  email?: string | undefined;
  slack?: string | undefined;
  teams?: string | undefined;
  members: Array<{ name: string; role?: string | undefined }>;
  /** The teams a person is a member of, by name. */
  memberOf: string[];
}

export interface OwnerPageProps {
  /** A contact URL or `mailto:` link, when the metadata says how to reach the team. */
  contact?: string | undefined;
  profile?: OwnerProfile | undefined;
  /** Everything the owner owns, by kind. */
  sections: Array<{ kind: string; heading: string; resources: OwnedResource[] }>;
}

const linkClass = 'text-foreground underline underline-offset-4 hover:text-primary';

function Profile({ profile }: { profile: OwnerProfile }) {
  const reach = [
    ...(profile.email ? [{ label: profile.email, href: `mailto:${profile.email}` }] : []),
    ...(profile.slack ? [{ label: 'Slack', href: profile.slack }] : []),
    ...(profile.teams ? [{ label: 'Microsoft Teams', href: profile.teams }] : []),
  ];

  return (
    <section id="profile" className="flex flex-col gap-3" aria-label="Profile">
      <div className="flex items-center gap-4">
        {profile.avatarUrl && (
          <img src={profile.avatarUrl} alt="" className="size-12 rounded-full" />
        )}
        <div className="flex flex-col gap-1">
          {profile.role && <p className="m-0 font-medium">{profile.role}</p>}
          {profile.summary && <p className="m-0 max-w-prose">{profile.summary}</p>}
          {reach.length > 0 && (
            <p className="m-0 text-sm">
              {reach.map((link, index) => (
                <span key={link.href}>
                  {index > 0 && ' · '}
                  <a href={link.href} className={linkClass}>
                    {link.label}
                  </a>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
      {profile.members.length > 0 && (
        <p className="m-0 text-sm">
          Members:{' '}
          {profile.members
            .map((member) => (member.role ? `${member.name} (${member.role})` : member.name))
            .join(', ')}
        </p>
      )}
      {profile.memberOf.length > 0 && (
        <p className="m-0 text-sm">Member of {profile.memberOf.join(', ')}</p>
      )}
    </section>
  );
}

export function OwnerPage({ contact, profile, sections }: OwnerPageProps) {
  return (
    <div className="not-content flex flex-col gap-10" data-wide>
      {profile && <Profile profile={profile} />}
      <p className="m-0 max-w-prose text-sm text-muted-foreground">
        Gathered from the owner each resource declares. Change a resource&apos;s owner and it moves.
        {contact && (
          <>
            {' '}
            Reach the team at{' '}
            <a
              href={contact}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              {contact.replace(/^mailto:/, '')}
            </a>
            .
          </>
        )}
      </p>
      {sections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="owners" />
            </EmptyMedia>
            <EmptyTitle>Owns nothing yet</EmptyTitle>
            <EmptyDescription>
              Name this team as the <code>owner</code> in a document&apos;s or event&apos;s
              frontmatter, and what it owns gathers here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid items-start gap-x-6 gap-y-10 md:grid-cols-2">
          {sections.map((section) => (
            <section
              id={section.kind}
              key={section.kind}
              className="flex flex-col gap-4"
              aria-labelledby={`${section.kind}-heading`}
            >
              <SectionHeading
                id={`${section.kind}-heading`}
                count={String(section.resources.length)}
              >
                {section.heading}
              </SectionHeading>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {section.resources.map((resource) => (
                  <li
                    key={`${resource.kind}|${resource.namespace ?? ''}|${resource.href}`}
                    data-kind={resource.kind}
                  >
                    <Item variant="outline" size="sm" href={resource.href}>
                      <ItemMedia>
                        <IconTile name={kindIcon(resource.kind)} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{resource.title}</ItemTitle>
                        {resource.summary && <ItemDescription>{resource.summary}</ItemDescription>}
                      </ItemContent>
                      <ItemActions>
                        {resource.namespace && (
                          <code className="font-mono text-xs text-muted-foreground">
                            {resource.namespace}
                          </code>
                        )}
                        <Icon
                          name="external"
                          className="size-4 text-muted-foreground group-hover/item:text-foreground"
                        />
                      </ItemActions>
                    </Item>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default OwnerPage;
