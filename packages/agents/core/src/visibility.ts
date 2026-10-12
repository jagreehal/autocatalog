export type Audience = 'human' | 'agent';

const FOR_AGENT_RE = /<!--\s*for:agent\s*-->([\s\S]*?)<!--\s*\/for:agent\s*-->/g;

const FOR_HUMAN_RE = /<!--\s*for:human\s*-->([\s\S]*?)<!--\s*\/for:human\s*-->/g;

const PROMPT_RE = /<!--\s*prompt\s*-->([\s\S]*?)<!--\s*\/prompt\s*-->/g;

const reset = (re: RegExp) => {
  re.lastIndex = 0;

  return re;
};

export const filterForAudience = (body: string, audience: Audience): string => {
  if (audience === 'human') {
    return body.replace(reset(FOR_AGENT_RE), '').replace(reset(FOR_HUMAN_RE), '$1');
  }

  return body.replace(reset(FOR_HUMAN_RE), '').replace(reset(FOR_AGENT_RE), '$1');
};

const extractAll = (body: string, re: RegExp): string[] => {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  reset(re);

  while ((m = re.exec(body)) !== null) {
    if (m[1]) matches.push(m[1].trim());
  }

  return matches;
};

export const extractForAudience = (body: string, audience: Audience): string => {
  const re = audience === 'agent' ? FOR_AGENT_RE : FOR_HUMAN_RE;

  return extractAll(body, re).join('\n\n');
};

export const extractPrompts = (body: string): string[] => extractAll(body, PROMPT_RE);
