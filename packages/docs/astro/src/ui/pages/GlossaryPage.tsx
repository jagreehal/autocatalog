/** @jsxImportSource react */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#ui/components/ui/card.tsx';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#ui/components/ui/empty.tsx';
import { Icon } from '../components/Icon';

export interface GlossaryPageProps {
  domains: Array<{
    domain: string;
    /** The domain's page, when events name it. */
    href?: string | undefined;
    repository: string;
    file: string;
    terms: Array<{
      /** The term's id on this page: link to `/glossary/#<anchor>`. */
      anchor: string;
      name: string;
      summary?: string | undefined;
      description?: string | undefined;
    }>;
  }>;
}

/** Each domain's ubiquitous language: what its words mean, where they are defined. */
export function GlossaryPage({ domains }: GlossaryPageProps) {
  if (domains.length === 0) {
    return (
      <div className="not-content">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon name="glossary" />
            </EmptyMedia>
            <EmptyTitle>No glossary yet</EmptyTitle>
            <EmptyDescription>
              Define a domain&apos;s terms in <code>glossary/&lt;domain&gt;.md</code>, as a{' '}
              <code>dictionary:</code> list in the frontmatter, and they appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      {domains.map((glossary) => (
        <Card key={glossary.domain} id={glossary.domain}>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              {glossary.href ? (
                <a
                  href={glossary.href}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  {glossary.domain}
                </a>
              ) : (
                glossary.domain
              )}
            </CardTitle>
            <CardDescription>
              Defined in <code>{glossary.file}</code> in the {glossary.repository} repository.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="m-0 grid gap-4">
              {glossary.terms.map((term) => (
                <div key={term.anchor} id={term.anchor} className="scroll-mt-24">
                  <dt className="font-medium">
                    <a
                      href={`#${term.anchor}`}
                      className="text-foreground no-underline hover:underline"
                    >
                      {term.name}
                    </a>
                  </dt>
                  {term.summary && <dd className="m-0 mt-1">{term.summary}</dd>}
                  {term.description && (
                    <dd className="m-0 mt-1 text-muted-foreground">{term.description}</dd>
                  )}
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default GlossaryPage;
