// Recorded videos have no mouse pointer, so draw one in the page and move it
// slowly with eased steps. Also hides the Next.js dev badge and scrollbars.
const OVERLAY = () => {
  const css = `
    nextjs-portal { display: none !important; }
    html { scrollbar-width: none; }
    #rec-cursor { position: fixed; left: 0; top: 0; width: 22px; height: 22px;
      z-index: 2147483647; pointer-events: none; transform: translate(-100px, -100px); }
    #rec-cursor svg { filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.35)); }
    .rec-ripple { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px;
      border-radius: 50%; background: rgba(59,130,246,.35); z-index: 2147483646;
      pointer-events: none; animation: rec-ripple .45s ease-out forwards; }
    @keyframes rec-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }`;
  const mount = () => {
    if (document.getElementById('rec-cursor')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'rec-cursor';
    cursor.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 8.5-6.6 1.5L8.6 18.6z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    const at = JSON.parse(sessionStorage.getItem('rec-cursor') ?? 'null');
    if (at) cursor.style.transform = `translate(${at.x - 3}px, ${at.y - 2}px)`;
    window.addEventListener('mousemove', (e) => {
      cursor.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`;
      sessionStorage.setItem('rec-cursor', JSON.stringify({ x: e.clientX, y: e.clientY }));
    }, true);
    window.addEventListener('mousedown', (e) => {
      const ripple = document.createElement('div');
      ripple.className = 'rec-ripple';
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 500);
    }, true);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
};

export const installOverlay = (context) => context.addInitScript(OVERLAY);

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function ui(page) {
  const pos = { x: 1000, y: 560 };
  const api = {
    pause: (ms = 500) => page.waitForTimeout(ms),
    // Glide to a point at a calm, distance-based speed.
    async moveTo(x, y) {
      const dist = Math.hypot(x - pos.x, y - pos.y);
      const steps = Math.max(12, Math.round(dist / 14));
      const from = { ...pos };
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        await page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
        await page.waitForTimeout(16);
      }
      Object.assign(pos, { x, y });
    },
    async hover(locator) {
      const box = await locator.boundingBox();
      if (!box) throw new Error(`not visible: ${locator}`);
      await api.moveTo(box.x + box.width / 2, box.y + box.height / 2);
    },
    async click(locator, { before = 350, after = 500 } = {}) {
      await api.hover(locator);
      await api.pause(before);
      await page.mouse.down();
      await page.waitForTimeout(70);
      await page.mouse.up();
      await api.pause(after);
    },
    // Put the pointer somewhere without animating (before the clip starts).
    async place(x, y) {
      await page.mouse.move(x, y);
      Object.assign(pos, { x, y });
    },
  };
  return api;
}
