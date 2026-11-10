import { type ChangeEvent, useLayoutEffect, useRef, useState } from 'react';

/**
 * A text field's value that keeps what the reader typed before the page's
 * script arrived. The server renders the field empty; a reader who starts
 * typing at once types into that plain input, and the component starts from
 * what is already there.
 */
export function useFieldValue(initial = '') {
  const ref = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(initial);

  useLayoutEffect(() => {
    const typed = ref.current?.value;

    if (typed && typed !== initial) setValue(typed);
  }, [initial]);

  return {
    value,
    setValue,
    /** Spread onto the input: its ref, value and change handler. */
    field: {
      ref,
      value,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
    },
  };
}
