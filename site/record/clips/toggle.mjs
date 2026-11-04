// Hero clip: the Dashboard in Personal, switch to Shared and back, then to
// Korea and back to Canada. Recorded on a phone.
export const account = 'tester3';
export const crf = '24'; // hero clip, budget 700 KB

const button = (page, name) => page.getByRole('button', { name, exact: true });
// Bottom tab bar on a phone (the sidebar buttons with the same names are hidden).
const tab = (page, name) => page.getByText(name, { exact: true }).filter({ visible: true }).last();
const settle = (page, text) =>
  page.getByText(text, { exact: true }).first().waitFor().then(() => page.waitForLoadState('networkidle'));

export async function setup(page) {
  await tab(page, 'Dashboard').click();
  await button(page, 'Personal').click();
  await button(page, 'Canada').click();
  await settle(page, 'TD Chequing');
  await page.waitForTimeout(800);
}

export async function play(page, ui) {
  await ui.pause(900);
  await ui.click(button(page, 'Shared'), { before: 200, after: 0 });
  await settle(page, 'Tangerine Joint Chequing');
  await ui.pause(1300);
  await ui.click(button(page, 'Personal'), { before: 200, after: 0 });
  await settle(page, 'TD Chequing');
  await ui.pause(900);
  await ui.click(button(page, 'Korea'), { before: 200, after: 0 });
  await settle(page, 'KB Chequing');
  await ui.pause(1300);
  await ui.click(button(page, 'Canada'), { before: 200, after: 0 });
  await settle(page, 'TD Chequing');
  await ui.pause(900);
}
