// Stock tab with both countries: start on the combined view, filter to the
// Korea brokerage, then the Canada one, then show everything again.
export const account = 'tester3';
export const crf = '20'; // budget 450 KB; the clip is mostly still, so spend it on sharpness
// Rest the pointer in the empty right margin so no card shows a hover state.
export const pointer = [1190, 300];

const button = (page, name) => page.getByRole('button', { name, exact: true });
// The funnel button on the account card that shows `name`.
const filter = (page, name) =>
  page.getByText(name, { exact: true }).first()
    .locator('xpath=ancestor::*[.//button[@title="Filter"]][1]')
    .locator('button[title="Filter"]');

export async function setup(page) {
  await button(page, 'Stock').click();
  await button(page, 'Personal').click();
  await button(page, 'All').first().click();
  // Live prices load after the page opens; wait for both countries' holdings.
  await page.getByText('SK hynix', { exact: true }).waitFor();
  await page.getByText('Royal Bank of Canada', { exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  // Scroll so the account cards (and their "Show all" button) sit just under
  // the sticky top bar, with the total and the holdings below them.
  const top = await page.getByText('Performance by account', { exact: true })
    .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top - 100));
  await page.waitForTimeout(500);
}

export async function play(page, ui) {
  await ui.pause(1100);
  await ui.click(filter(page, '[Kiwoom] Kiwoom Securities'), { before: 400, after: 0 });
  await page.getByText('Royal Bank of Canada', { exact: true }).waitFor({ state: 'detached' });
  await ui.pause(1600);
  await ui.click(filter(page, '[Wealthsimple] Wealthsimple TFSA'), { before: 400, after: 0 });
  await page.getByText('SK hynix', { exact: true }).waitFor({ state: 'detached' });
  await ui.pause(1600);
  await ui.click(page.getByRole('button', { name: /^Show all/ }), { before: 400, after: 0 });
  await page.getByText('SK hynix', { exact: true }).waitFor();
  await ui.pause(700);
  await ui.moveTo(...pointer);
  await ui.pause(600);
}
