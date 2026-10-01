import { expect, test } from 'runtime:test';
import { render } from '@opentf/web-test';
import Counter from './fixtures/Counter.jsx';
let disposed = 0;
test('setup preserves the native DOM and mounts a component', () => {
  const nativeDocument = document;
  const result = render(Counter, { onDispose: () => disposed++ });
  expect(result.getByRole('button').textContent).toBe('Count: 0');
  expect(document).toBe(nativeDocument);
});
test('setup removes mounted components and disposes them after the previous case', () => {
  expect(document.querySelector('[data-testid="counter"]')).toBeNull();
  expect(disposed).toBe(1);
});
