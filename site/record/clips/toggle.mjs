// Hero clip: the Dashboard in Personal, switch to Shared and back, then to
// Korea and back to Canada.
export const account = 'tester3';
export const crf = '24'; // hero clip, budget 700 KB
// Rest the pointer in the empty margin so no row shows a hover state.
export const pointer = [1190, 250];

const button = (page, name) => page.getByRole('button', { name, exact: true });
const settle = (page, text) =>
  page.getByText(text, { exact: true }).first().waitFor().then(() => page.waitForLoadState('networkidle'));

export async function setup(page) {
  await button(page, 'Dashboard').click();
  await button(page, 'Personal').click();
  await button(page, 'Canada').click();
  await settle(page, 'TD Chequing');
  await page.waitForTimeout(800);
}

export async function play(page, ui) {
  await ui.pause(700);
  await ui.click(button(page, 'Shared'), { before: 400, after: 0 });
  await settle(page, 'Tangerine Joint Chequing');
  await ui.pause(900);
  await ui.click(button(page, 'Personal'), { before: 400, after: 0 });
  await settle(page, 'TD Chequing');
  await ui.pause(600);
  await ui.click(button(page, 'Korea'), { before: 400, after: 0 });
  await settle(page, 'KB Chequing');
  await ui.pause(900);
  await ui.click(button(page, 'Canada'), { before: 400, after: 0 });
  await settle(page, 'TD Chequing');
  await ui.pause(500);
  await ui.moveTo(...pointer);
  await ui.pause(400);
}
