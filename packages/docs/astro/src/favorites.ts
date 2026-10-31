/** Personal pins in the sidebar. Stored in localStorage; never on the server. */

import { z } from 'zod';

export const FAVORITES_KEY = 'autocatalog-favorites';

export interface Favorite {
  href: string;
  label: string;
  /** Catalog key when the page has one, else the path. */
  key: string;
}

const favoriteSchema = z.object({
  href: z.string().startsWith('/'),
  label: z.string().trim().min(1),
  key: z.string().trim().min(1),
});

export function readFavorites(raw: string | null): Favorite[] {
  if (!raw) return [];

  try {
    const list = z.array(z.unknown()).safeParse(JSON.parse(raw));

    if (!list.success) return [];

    return list.data.flatMap((entry) => {
      const favorite = favoriteSchema.safeParse(entry);

      return favorite.success ? [favorite.data] : [];
    });
  } catch {
    return [];
  }
}

export function writeFavorites(favorites: Favorite[]): string {
  return JSON.stringify(favorites);
}

export function isFavorite(favorites: Favorite[], key: string): boolean {
  return favorites.some((favorite) => favorite.key === key);
}

export function toggleFavorite(favorites: Favorite[], next: Favorite): Favorite[] {
  return isFavorite(favorites, next.key)
    ? favorites.filter((favorite) => favorite.key !== next.key)
    : [...favorites, next].slice(-20);
}
