import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import { seedAuthedSession } from './fixtures/auth';
import { waitForAppDb } from './fixtures/db';
import { mockCalendarApis, mockDriveApis, mockGisToken } from './fixtures/mockGoogle';

/**
 * 001-cards-order-colors — user-defined card order in the header pill row.
 *
 * Numbered 12 because `11-offline-sync.spec.ts` already owns 11; tasks.md
 * calls this file `11-card-reorder.spec.ts`.
 *
 * Coverage:
 *   - Desktop (chromium): mouse drag moves a pill to a new slot, the row
 *     shows the new order, and it survives a reload (Dexie `position`).
 *   - Desktop (chromium): the keyboard path — Space to pick up, ArrowRight to
 *     move, Space to drop — reorders the row; Escape leaves it untouched.
 *   - Both projects: a plain tap still activates the card and reorders
 *     nothing (SC-005's tap half).
 *   - Mobile (mobile-iphone-13): the invariants that keep the row swipe-able
 *     while a hold starts a drag — the row is a horizontal scroller and an
 *     idle chip does NOT set `touch-action: none`. A synthetic finger swipe
 *     is not expressible in automation (the engine blocks the `Touch`
 *     constructor — see the same note in `08-drag-reschedule.spec.ts`), so
 *     the live-finger swipe lives in docs/SMOKE_TEST.md.
 *   - axe-core on the reordered header.
 *
 * dnd-kit needs a realistic pointer sequence: a single `dragTo()` never
 * crosses the MouseSensor's `distance: 8` activation constraint.
 */

const CARDS = [
  { id: 'card-order-a', name: 'Alpha', position: 0, color: '#DC2626' },
  { id: 'card-order-b', name: 'Bravo', position: 1024, color: '#16A34A' },
  { id: 'card-order-c', name: 'Cielo', position: 2048, color: '#2563EB' },
];

test.beforeEach(async ({ page }) => {
  await mockGisToken(page);
  await mockDriveApis(page, { existingFile: false });
  await mockCalendarApis(page);
  await page.goto('/login');
  await waitForAppDb(page);
  await seedAuthedSession(page, { onboardingSeen: true });
});

async function seedCards(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (cards) => {
    const dbInner = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('hourtrack');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = dbInner.transaction(['cards'], 'readwrite');
      const now = new Date().toISOString();
      for (const card of cards) {
        tx.objectStore('cards').put({
          ...card,
          defaultDurationMin: 480,
          defaultStartMinutes: 540,
          rateType: 'hourly',
          hourlyRate: 50,
          fixedTotal: null,
          monthlyTotal: null,
          defaultNote: null,
          isArchived: false,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    dbInner.close();
  }, CARDS);
  await page.reload();
}

/** The rendered pill order, read from the chips' `title` attributes. */
async function readRowOrder(page: Page): Promise<string[]> {
  const row = page.getByTestId('cards-header');
  await expect(row.getByRole('button', { name: 'Alpha' })).toBeVisible({ timeout: 10_000 });
  return row
    .locator('button[title]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? ''));
}

/** Persisted order, straight out of Dexie — `(position, id)` ascending. */
async function readPersistedOrder(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const dbInner = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('hourtrack');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<Array<{ id: string; name: string; position: number }>>(
      (resolve, reject) => {
        const tx = dbInner.transaction(['cards'], 'readonly');
        const req = tx.objectStore('cards').getAll();
        req.onsuccess = () =>
          resolve(req.result as Array<{ id: string; name: string; position: number }>);
        req.onerror = () => reject(req.error);
      },
    );
    dbInner.close();
    return rows
      .sort((a, b) => (a.position !== b.position ? a.position - b.position : a.id < b.id ? -1 : 1))
      .map((r) => r.name);
  });
}

/**
 * Step-wise mouse drag past dnd-kit's `distance: 8`.
 *
 * The travel distance is NOT "to the target's centre" — that is the trap this
 * helper exists to document. The moment the dragged chip leaves its slot, the
 * chips between it and the target slide back by one chip width to close the
 * gap, and dnd-kit's collision detection runs against those SHIFTED rects. A
 * pointer that stops at the target's original centre is by then hovering the
 * chip BEFORE it, so the drop lands one slot short. Overshooting by the
 * dragged chip's own width (plus the row's 8px gap) puts the pointer over the
 * target's new position.
 */
async function dragChip(page: Page, fromName: string, toName: string): Promise<void> {
  const row = page.getByTestId('cards-header');
  const from = row.getByRole('button', { name: fromName });
  const to = row.getByRole('button', { name: toName });
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error('chip has no box');

  const ROW_GAP = 8;
  const fx = fromBox.x + fromBox.width / 2;
  const fy = fromBox.y + fromBox.height / 2;
  const movingRight = toBox.x > fromBox.x;
  const overshoot = (fromBox.width + ROW_GAP) * (movingRight ? 1 : -1);
  const tx = toBox.x + toBox.width / 2 + overshoot;
  const ty = toBox.y + toBox.height / 2;

  await page.mouse.move(fx, fy);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(fx + ((tx - fx) * i) / steps, fy + ((ty - fy) * i) / steps);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(50);
  await page.mouse.up();
}

test.describe('001 — desktop mouse reorder', () => {
  test('dragging a pill to a new slot reorders the row and survives a reload', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'mouse-drag reorder runs under the chromium project only',
    );
    await seedCards(page);
    expect(await readRowOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);

    await dragChip(page, 'Alpha', 'Cielo');

    await expect
      .poll(() => readRowOrder(page), { timeout: 5_000 })
      .toEqual(['Bravo', 'Cielo', 'Alpha']);
    await expect
      .poll(() => readPersistedOrder(page), { timeout: 5_000 })
      .toEqual(['Bravo', 'Cielo', 'Alpha']);

    await page.reload();
    await expect
      .poll(() => readRowOrder(page), { timeout: 10_000 })
      .toEqual(['Bravo', 'Cielo', 'Alpha']);
  });

  test('the keyboard path picks up, moves and drops a pill', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'keyboard reorder runs under the chromium project only',
    );
    await seedCards(page);
    const first = page.getByTestId('cards-header').getByRole('button', { name: 'Alpha' });
    await first.focus();

    // Each keystroke needs a beat: dnd-kit sets up the keyboard drag on the
    // pick-up, and an arrow pressed inside the same frame is swallowed.
    await page.keyboard.press('Space'); // pick up
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowRight'); // move one slot right
    await page.waitForTimeout(150);
    await page.keyboard.press('Space'); // drop

    await expect
      .poll(() => readRowOrder(page), { timeout: 5_000 })
      .toEqual(['Bravo', 'Alpha', 'Cielo']);
  });

  test('Escape cancels a keyboard move and writes nothing', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'keyboard cancel runs under the chromium project only',
    );
    await seedCards(page);
    const first = page.getByTestId('cards-header').getByRole('button', { name: 'Alpha' });
    await first.focus();

    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');

    await page.waitForTimeout(300);
    expect(await readRowOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);
    expect(await readPersistedOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);
  });

  /**
   * The sequence the guard against a post-drag click has to survive:
   * reorder a card, THEN use it. dnd-kit suppresses the click that ends a
   * drag itself (a capture-phase listener on `document`, removed 50ms after
   * the sensor detaches), so a guard that only disarms by consuming a click
   * never disarms at all and eats the next real tap.
   */
  test('a click right after a drag still activates the card', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'mouse-drag reorder runs under the chromium project only',
    );
    await seedCards(page);
    // Same drag as the reorder test above — `dragChip` overshoots by design,
    // so Alpha lands at the end of the row.
    await dragChip(page, 'Alpha', 'Cielo');
    await expect
      .poll(() => readRowOrder(page), { timeout: 5_000 })
      .toEqual(['Bravo', 'Cielo', 'Alpha']);

    const alpha = page.getByTestId('cards-header').getByRole('button', { name: 'Alpha' });
    await alpha.click();
    await expect(alpha).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * Keyboard activation must survive the KeyboardSensor. dnd-kit's default
   * start codes are Space AND Enter, and its activator calls
   * `preventDefault()` — which on a real `<button>` also cancels the
   * synthetic click, so a chip whose `aria-pressed` can be toggled by mouse
   * became unreachable by keyboard (WCAG 2.1.1). Enter stays activation;
   * Space is the drag.
   */
  test('Enter activates the focused card instead of lifting it', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'keyboard activation runs under the chromium project only',
    );
    await seedCards(page);
    const bravo = page.getByTestId('cards-header').getByRole('button', { name: 'Bravo' });
    await bravo.focus();

    await page.keyboard.press('Enter');

    await expect(bravo).toHaveAttribute('aria-pressed', 'true');
    // ...and it must not have moved anything.
    expect(await readRowOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);
    expect(await readPersistedOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);
  });

  test('a plain click still activates the card and reorders nothing', async ({ page }) => {
    await seedCards(page);
    const bravo = page.getByTestId('cards-header').getByRole('button', { name: 'Bravo' });

    await bravo.click();

    await expect(bravo).toHaveAttribute('aria-pressed', 'true');
    expect(await readRowOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);
    expect(await readPersistedOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);
  });
});

test.describe('001 — mobile row gestures', () => {
  test('a tap activates the card without starting a drag', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-iphone-13',
      'tap-vs-drag is a touch behaviour — mobile project only',
    );
    await seedCards(page);
    const bravo = page.getByTestId('cards-header').getByRole('button', { name: 'Bravo' });

    await bravo.tap();

    await expect(bravo).toHaveAttribute('aria-pressed', 'true');
    expect(await readRowOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);
    // Read Dexie too: a hold that fired anyway would leave a new rank behind
    // even when the rendered row happens to look unchanged.
    expect(await readPersistedOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);
  });

  test('the row stays a horizontal scroller and an idle chip never blocks touch', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'mobile-iphone-13',
      'scroll-preservation invariant checked under the mobile-iphone-13 project',
    );
    await seedCards(page);
    await readRowOrder(page);

    // The mechanism that lets a swipe scroll while a hold starts a drag is
    // the TouchSensor's 220ms delay — NOT `touch-action: none`, which is what
    // would kill the scroll. Assert the chip does not set it while idle.
    const chip = page.getByTestId('cards-header').getByRole('button', { name: 'Alpha' });
    expect(await chip.evaluate((el) => getComputedStyle(el).touchAction)).not.toBe('none');

    // And the row itself is still the scroll container.
    const scroller = page.getByTestId('cards-header').locator('div.overflow-x-auto').first();
    expect(await scroller.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');

    // The two assertions above are the load-bearing ones. What follows only
    // shows the element is a real scroll box: assigning `scrollLeft` is not a
    // gesture, so it would succeed even with `touch-action: none` on the row.
    // The live-finger swipe is in docs/SMOKE_TEST.md §12 — the engines
    // Playwright drives block synthetic `Touch` construction.
    await scroller.evaluate((el) => {
      el.style.maxWidth = '120px';
      el.scrollLeft = 60;
    });
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    expect(await readRowOrder(page)).toEqual(['Alpha', 'Bravo', 'Cielo']);
  });
});

test.describe('001 — a11y of the reordered header', () => {
  test('no critical or serious axe violations after a reorder', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'axe scan runs once, under the chromium project',
    );
    await seedCards(page);
    await dragChip(page, 'Alpha', 'Cielo');
    await expect
      .poll(() => readRowOrder(page), { timeout: 5_000 })
      .toEqual(['Bravo', 'Cielo', 'Alpha']);

    const results = await new AxeBuilder({ page })
      .include('[data-testid="cards-header"]')
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (blocking.length > 0) {
      await testInfo.attach('axe-violations', {
        body: JSON.stringify(blocking, null, 2),
        contentType: 'application/json',
      });
    }
    expect(blocking).toEqual([]);
  });
});
