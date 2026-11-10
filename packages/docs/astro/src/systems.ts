import { isServiceCatalogResource, type ResourceGraph } from 'autocatalog-core';

/** A system or external system, named in a design or by the services in it. */
export interface SystemRow {
  id: string;
  name: string;
  href: string;
  external: boolean;
  summary?: string | undefined;
  /** The design that declares it, when one does. */
  design?: { href: string; title: string } | undefined;
  members: string[];
}

/** A service and the system it says it is part of, from the resource graph. */
interface ServiceSystemSource {
  name: string;
  system?: { id: string; name?: string | undefined } | undefined;
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
 * Systems and external systems from designs, and the systems services declare
 * they are part of. Events alone never invent one: a design or a service has
 * to name the box.
 */
export function buildSystems(
  designs: DesignSystemSource[],
  base: string,
  services: ServiceSystemSource[] = [],
): SystemRow[] {
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
        design: { href: designHref, title: design.title },
        members,
      });
    }
  }

  for (const service of services) {
    if (!service.system) continue;

    const existing = byId.get(service.system.id);

    if (existing) {
      existing.members = [...new Set([...existing.members, service.name])].sort();
      continue;
    }

    byId.set(service.system.id, {
      id: service.system.id,
      name: service.system.name ?? service.system.id,
      href: `${base}systems/${encodeURIComponent(service.system.id)}/`,
      external: false,
      members: [service.name],
    });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every system the catalog has: those designs name, and those its services say they are part of. */
export function catalogSystemRows(
  catalog: { designs: DesignSystemSource[]; graph: ResourceGraph },
  base: string,
): SystemRow[] {
  return buildSystems(
    catalog.designs,
    base,
    catalog.graph.resources
      .filter(isServiceCatalogResource)
      .map((resource) => ({ name: resource.ref.id, system: resource.attributes.system })),
  );
}

export function systemById(systems: SystemRow[], id: string): SystemRow | undefined {
  return systems.find((system) => system.id === id);
}
