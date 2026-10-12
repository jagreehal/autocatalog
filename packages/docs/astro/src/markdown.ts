/**
 * The rendered body without its opening `<h1>` when that heading only repeats
 * the page title. Anything else — a different first heading, a heading after
 * some text — is the author's and stays.
 */
export function dropRepeatedTitle(html: string, title: string): string {
  const match = /^\s*<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/.exec(html);

  if (!match || normalise(textOf(match[1] ?? '')) !== normalise(title)) return html;

  return html.slice(match[0].length);
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}
