import { expect, test } from 'runtime:test';
import { cleanup, render, userEvent } from '../index.js';
import Counter from './fixtures/Counter.jsx';
test('renders a compiled component with initial props and drives a click', async () => {
  const { getByRole } = render(Counter, { initial: 2 });
  const button = getByRole('button', { name: 'Count: 2' });
  await userEvent.click(button);
  expect(button.textContent).toBe('Count: 3');
});

test('unmount disposes component lifecycle once', async () => {
  let disposed = 0;
  const { container, unmount } = render(Counter, { onDispose: () => disposed++ });
  unmount(); unmount(); cleanup();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(container.isConnected).toBe(false);
  expect(disposed).toBe(1);
});

test('mounts factory pages with props and runs their mount and cleanup lifecycle', async () => {
  const { default: Page } = await import('./fixtures/page.jsx');
  let started = 0, disposed = 0;
  const { getByRole, unmount } = render(Page, { name: 'Ada', onStart: () => started++, onDispose: () => disposed++ });
  expect(getByRole('heading').textContent).toBe('Hello Ada');
  expect(started).toBe(1);
  unmount(); cleanup();
  expect(disposed).toBe(1);
});

test('invalid component input leaves no container behind', () => {
  const before = document.body.childElementCount;
  expect(() => render({})).toThrow('invalid component');
  expect(document.body.childElementCount).toBe(before);
});

