import { describe, expect, it } from 'vitest';
import {
  isFavorite,
  readFavorites,
  toggleFavorite,
  writeFavorites,
  type Favorite,
} from '../src/favorites';

const pin: Favorite = {
  href: '/events/payments-service/payments/payment.completed/',
  label: 'payment.completed',
  key: 'event:payments/payment.completed',
};

describe('favorites', () => {
  it('round-trips through localStorage JSON', () => {
    expect(readFavorites(writeFavorites([pin]))).toEqual([pin]);
    expect(readFavorites('not-json')).toEqual([]);
    expect(readFavorites('[{"href":"https://evil"}]')).toEqual([]);
  });

  it('pins and unpins by catalog key', () => {
    expect(isFavorite([], pin.key)).toBe(false);
    const on = toggleFavorite([], pin);
    expect(isFavorite(on, pin.key)).toBe(true);
    expect(toggleFavorite(on, pin)).toEqual([]);
  });
});
