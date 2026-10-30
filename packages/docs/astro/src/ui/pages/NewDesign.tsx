/** @jsxImportSource react */
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '#ui/components/ui/button.tsx';
import { Field, FieldDescription, FieldError, FieldLabel } from '#ui/components/ui/field.tsx';
import { Input } from '#ui/components/ui/input.tsx';

export interface NewDesignProps {
  /** The repositories a design can start in, by name. */
  repositories: string[];
  /** Where a design is started. */
  startUrl: string;
}

const started = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), href: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

/**
 * Start a design under `ac site` dev: a title, and the repository it goes in.
 * It opens on the canvas, saved as an empty `designs/<id>.md` to fill in.
 */
export function NewDesign({ repositories, startUrl }: NewDesignProps) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const start = async (repository: string) => {
    setStarting(true);

    const response = await fetch(startUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository, title }),
    }).catch(() => undefined);

    const answer = started.safeParse(await response?.json().catch(() => undefined));

    if (answer.data?.ok) {
      window.location.assign(answer.data.href);

      return;
    }

    setError(answer.data?.error ?? 'The design could not be started.');
    setStarting(false);
  };

  return (
    <div className="not-content mb-8 flex max-w-xl flex-col gap-3">
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="new-design-title">New design</FieldLabel>
        <Input
          id="new-design-title"
          placeholder="Refunds v2"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-invalid={error ? true : undefined}
        />
        <FieldDescription>
          It opens on a canvas and saves as <code>designs/&lt;title&gt;.md</code> in the repository
          you pick.
        </FieldDescription>
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <div className="flex flex-wrap gap-2">
        {repositories.map((repository) => (
          <Button
            key={repository}
            variant={repositories.length === 1 ? 'default' : 'outline'}
            isDisabled={starting || !title.trim()}
            onPress={() => void start(repository)}
          >
            {repositories.length === 1 ? 'Start design' : `Start in ${repository}`}
          </Button>
        ))}
      </div>
    </div>
  );
}

export default NewDesign;
