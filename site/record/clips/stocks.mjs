// Stock tab with both countries, on a phone: start on the combined view,
// filter to the Korea brokerage and show its holdings, then the Canada one,
// then show everything again.
export const account = 'tester3';
export const crf = '25'; // budget 450 KB

const button = (page, name) => page.getByRole('button', { name, exact: true });
// Bottom tab bar on a phone (the sidebar buttons with the same names are hidden).
const tab = (page, name) => page.getByText(name, { exact: true }).filter({ visible: true }).last();
// The account card that shows `name`, and its funnel (filter) button.
const card = (page, name) =>
  page.getByText(name, { exact: true }).first().locator('xpath=ancestor::*[.//button[@title="Filter"]][1]');
const filter = (page, name) => card(page, name).locator('button[title="Filter"]');

const scrollTo = (page, y) => page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y);
// The holdings list, scrolled up to just under the top bar.
const holdingsY = (page) => page.getByText('Holdings', { exact: true }).first()
  .evaluate((el) => el.getBoundingClientRect().top + window.scrollY - 330);

export async function setup(page) {
  await tab(page, 'Stock').click();
  await button(page, 'Personal').click();
  await button(page, 'All').first().click();
  // Live prices load after the page opens; wait for both countries' holdings.
  await page.getByText('SK hynix', { exact: true }).waitFor();
  await page.getByText('Royal Bank of Canada', { exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
}

export async function play(page, ui) {
  await ui.pause(1000);

  // Korea: filter, then scroll down to its holdings.
  await ui.click(filter(page, '[Kiwoom] Kiwoom Securities'), { before: 200, after: 0 });
  await page.getByText('Royal Bank of Canada', { exact: true }).waitFor({ state: 'detached' });
  await ui.pause(700);
  await scrollTo(page, await holdingsY(page));
  await ui.pause(1500);
  await scrollTo(page, 0);
  await ui.pause(600);

  // Canada: swipe the account cards over, filter, and show its holdings.
  await card(page, '[Wealthsimple] Wealthsimple TFSA')
    .evaluate((el) => el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));
  await ui.pause(600);
  await ui.click(filter(page, '[Wealthsimple] Wealthsimple TFSA'), { before: 150, after: 0 });
  await page.getByText('SK hynix', { exact: true }).waitFor({ state: 'detached' });
  await ui.pause(700);
  await scrollTo(page, await holdingsY(page));
  await ui.pause(1500);
  await scrollTo(page, 0);
  await ui.pause(600);

  // Back to everything.
  await ui.click(page.getByRole('button', { name: /^Show all/ }), { before: 150, after: 0 });
  await page.getByText('SK hynix', { exact: true }).waitFor();
  // Swipe the account cards back to the start ("All accounts").
  await card(page, '[Kiwoom] Kiwoom Securities').evaluate((el) => {
    let row = el.parentElement;
    while (row && row.scrollWidth <= row.clientWidth + 4) row = row.parentElement;
    row?.scrollTo({ left: 0, behavior: 'smooth' });
  });
  await ui.pause(1300);
}
