/** A system or external system named in a design. */
export interface SystemRow {
  id: string;
  name: string;
  href: string;
  external: boolean;
  summary?: string | undefined;
  /** Design that declares it. */
  designHref: string;
  designTitle: string;
  members: string[];
}

interface DesignSystemSource {
  repository: string;
  id: string;
  title: string;
  resources: Array<{
    id: string;
    type: string;
    name?: string | undefined;
    summary?: string | undefined;
    parent?: string | undefined;
  }>;
}

/**
 * Systems and external systems from designs. Observed runtime systems are not
 * inventable from events alone; designs are where teams name the boxes.
 */
export function buildSystems(designs: DesignSystemSource[], base: string): SystemRow[] {
  const byId = new Map<string, SystemRow>();

  for (const design of designs) {
    const designHref = `${base}designs/${design.repository}/${design.id}/`;

    for (const resource of design.resources) {
      if (resource.type !== 'system' && resource.type !== 'external-system') continue;

      const members = design.resources
        .filter((other) => other.parent === resource.id)
        .map((other) => other.name ?? other.id)
        .sort();

      const existing = byId.get(resource.id);

      if (existing) {
        existing.members = [...new Set([...existing.members, ...members])].sort();
        continue;
      }

      byId.set(resource.id, {
        id: resource.id,
        name: resource.name ?? resource.id,
        href: `${base}systems/${encodeURIComponent(resource.id)}/`,
        external: resource.type === 'external-system',
        summary: resource.summary,
        designHref,
        designTitle: design.title,
        members,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function systemById(systems: SystemRow[], id: string): SystemRow | undefined {
  return systems.find((system) => system.id === id);
}
