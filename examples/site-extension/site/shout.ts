// Upper-cases "world" in every document, to show a rehype plugin ran.
type Node = { type: string; value?: string; children?: Node[] };

export function shout() {
  const walk = (node: Node): void => {
    if (node.type === 'text' && node.value) node.value = node.value.replace('world', 'WORLD');
    node.children?.forEach(walk);
  };

  return walk;
}
