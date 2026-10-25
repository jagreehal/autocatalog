/** @jsxImportSource react */
import { Fragment } from 'react';
import { Code } from '../components/Code';

export interface SpecificationPageProps {
  format: string;
  /** A microlighter grammar for the source, or `text`. */
  language: string;
  repository: string;
  /** Where the repository keeps it. */
  file: string;
  source: string;
  /** The file itself, under its own name. */
  downloadHref: string;
  services: Array<{ name: string; href: string }>;
}

const link =
  'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';

/** A specification as its repository wrote it: the source, and where it came from. */
export function SpecificationPage({
  format,
  language,
  repository,
  file,
  source,
  downloadHref,
  services,
}: SpecificationPageProps) {
  return (
    <div className="not-content flex flex-col gap-6" data-wide>
      <p className="m-0 max-w-prose">
        {format}, read from{' '}
        <a className={link} href={downloadHref} download>
          <code>{file}</code>
        </a>{' '}
        in the {repository} repository.
        {services.length > 0 && (
          <>
            {' '}
            Belongs to{' '}
            {services.map((service, i) => (
              <Fragment key={service.name}>
                {i > 0 && (i === services.length - 1 ? ' and ' : ', ')}
                <a className={link} href={service.href} data-kind="service">
                  {service.name}
                </a>
              </Fragment>
            ))}
            .
          </>
        )}
      </p>
      <Code code={source} language={language} label={file} />
    </div>
  );
}

export default SpecificationPage;
