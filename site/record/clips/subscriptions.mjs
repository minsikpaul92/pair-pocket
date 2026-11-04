// Fixed expenses: add Spotify with a promo price ($4.99 for three months,
// then $11.99) and a promo end reminder, then see it in Due this month.
// Recorded on a phone.
export const account = 'tester3';
export const crf = '26';
// A whole form is a lot of steps; play it faster so the clip stays short.
export const speed = 1.25;

const button = (page, name) => page.getByRole('button', { name, exact: true });
// Bottom tab bar on a phone (the sidebar buttons with the same names are hidden).
const tab = (page, name) => page.getByText(name, { exact: true }).filter({ visible: true }).last();
const dialog = (page) => page.getByRole('dialog');

// Scroll the dialog's scrolling area smoothly to the bottom.
const scrollDialog = (page) =>
  dialog(page).getByPlaceholder('e.g. Netflix, iPhone installment, rent').evaluate((el) => {
    let box = el.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) {
      box = box.parentElement;
    }
    box?.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  });

async function type(page, ui, locator, text) {
  await ui.click(locator, { before: 250, after: 150 });
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text, { delay: 45 });
}

export async function setup(page) {
  await tab(page, 'Fixed expenses').click();
  await button(page, 'Personal').click();
  await button(page, 'All').first().click();
  await page.getByText('Fido phone plan', { exact: true }).first().waitFor();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
}

export async function play(page, ui) {
  await ui.pause(700);
  await ui.click(page.locator('main').getByRole('button', { name: 'Add', exact: true }).first(), { before: 200, after: 350 });
  const d = dialog(page);
  await type(page, ui, d.getByPlaceholder('e.g. Netflix, iPhone installment, rent'), 'Spotify');
  // Paid on the 20th, so it lands in Due this month.
  await type(page, ui, d.locator('input[type="number"]'), '20');
  await ui.pause(200);

  await scrollDialog(page);
  await ui.pause(600);
  await type(page, ui, d.getByText('Amount', { exact: true }).locator('xpath=following::input[1]'), '11.99');
  await ui.click(d.getByRole('button', { name: /Promo \(optional\)/ }), { before: 200, after: 250 });
  await scrollDialog(page);
  await ui.pause(500);
  await type(page, ui, d.getByText('Promo amount', { exact: true }).locator('xpath=following::input[1]'), '4.99');

  // Promo ends three months later.
  await ui.click(d.getByText('Promo end date (optional)', { exact: true })
    .locator('xpath=following::button[1]'), { before: 200, after: 200 });
  const next = page.getByRole('button', { name: 'Next month', exact: true }).last();
  for (let i = 0; i < 3; i++) await ui.click(next, { before: 80, after: 120 });
  const calendar = next.locator('xpath=ancestor::div[.//button[normalize-space()="20"]][1]');
  await ui.click(calendar.getByRole('button', { name: '20', exact: true }).first(), { before: 150, after: 250 });

  await ui.click(d.getByText('Email reminder 1 week before promo ends', { exact: true }), { before: 200, after: 450 });
  await ui.click(d.getByRole('button', { name: 'Add', exact: true }), { before: 250, after: 0 });
  await d.waitFor({ state: 'detached' });
  await page.getByText('Spotify', { exact: true }).first().waitFor();
  await page.waitForLoadState('networkidle');
  await ui.pause(1300); // Due this month and the monthly total now include Spotify
  // Then the new row, with its account, next payment and promo end date.
  await page.getByText('Spotify', { exact: true }).last()
    .evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await ui.pause(1600);
}
