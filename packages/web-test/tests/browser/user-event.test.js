import { expect, test } from 'runtime:test';
import { render, userEvent } from '@opentf/web-test';
import Counter from '../fixtures/Counter.jsx';

test('userEvent setup clicks a compiled component in the browser', async () => {
  const user = userEvent.setup();
  const { getByRole } = render(Counter, { initial: 2 });
  const button = getByRole('button', { name: 'Count: 2' });
  await user.click(button);
  expect(button.textContent).toBe('Count: 3');
});

test('userEvent types, clears, selects, toggles and moves keyboard focus', async () => {
  const user = userEvent.setup();
  const { getByLabelText, getByRole } = render(() => {
    const form = document.createElement('form');
    form.innerHTML = '<label>Name<input /></label><label>Country<select><option value="IN">India</option><option value="NL">Netherlands</option></select></label><label><input type="checkbox" />Subscribe</label>';
    return form;
  });
  const input = getByLabelText('Name');
  await user.type(input, 'Ada');
  expect(input.value).toBe('Ada');
  await user.clear(input);
  expect(input.value).toBe('');
  await user.selectOptions(getByLabelText('Country'), 'NL');
  expect(getByLabelText('Country').value).toBe('NL');
  await user.click(getByRole('checkbox'));
  expect(getByRole('checkbox').checked).toBe(true);
  input.focus();
  await user.tab();
  expect(document.activeElement).toBe(getByLabelText('Country'));
});
