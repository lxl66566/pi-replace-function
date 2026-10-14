import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';

it('signal updates propagate', () => {
  createRoot(dispose => {
    const [count, setCount] = createSignal(0);

    setCount(1);
    expect(count()).toBe(1);

    setCount(previous => previous + 1);
    expect(count()).toBe(2);

    dispose();
  });
});
