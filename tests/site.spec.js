import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const updatedAt = new Date();
    const expiresAt = new Date(updatedAt);
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
    localStorage.setItem(
      "ikautoPrivacyPreferences",
      JSON.stringify({
        version: 1,
        necessary: true,
        externalMedia: false,
        updatedAt: updatedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      }),
    );
  });
  if (!testInfo.title.includes("quiz")) {
    await page.addInitScript(() => sessionStorage.setItem("a2carsQuizShown", "true"));
  }
  await page.goto("/");
});

test("renders every main section and the original contacts", async ({ page }) => {
  await expect(page).toHaveTitle("Автомобили под заказ");
  await expect(page.getByRole("heading", { name: "Примеры автомобилей и расчётов" })).toBeVisible();
  await expect(page.locator(".car-card")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "О проекте" })).toBeAttached();
  await expect(page.locator(".reviews iframe")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "+79043294986" })).toHaveAttribute("href", "tel:+79043294986");
});

test("opens and closes the consultation form", async ({ page }) => {
  await page.getByRole("button", { name: "Консультация по автомобилю" }).click();
  const modal = page.locator("#order-modal");
  await expect(modal).toHaveClass(/is-open/);
  await expect(page.getByRole("heading", { name: "Заявка на консультацию" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).not.toHaveClass(/is-open/);
});

test("mobile drawer contains navigation and contact links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Открыть меню" }).click();
  const drawer = page.locator("#mobile-drawer");
  await expect(drawer).toHaveClass(/is-open/);
  await expect(drawer.getByRole("link", { name: "Отзывы клиентов" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Telegram" })).toHaveAttribute("href", "https://t.me/A2carspro");
  await expect(drawer.locator("[data-max-contact]")).toHaveAttribute("href", "https://max.ru/");
  await drawer.getByRole("button", { name: "Закрыть меню" }).click();
  await expect(drawer).not.toHaveClass(/is-open/);
});

test("MAX and Telegram contacts are available in every contact area", async ({ page }) => {
  const maxLinks = page.locator("[data-max-contact]");
  await expect(maxLinks).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(maxLinks.nth(index)).toHaveAttribute("href", "https://max.ru/");
  }

  await expect(page.locator('a[href="https://t.me/A2carspro"]')).toHaveCount(4);
});

test("quiz advances through all three steps", async ({ page }) => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const quiz = page.locator("#quiz-modal");
  await expect(quiz).toHaveClass(/is-open/);
  await expect(page.getByRole("heading", { name: "Из какой страны предпочитаете автомобиль" })).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByRole("heading", { name: "Какой бюджет на автомобиль планируете?" })).toBeVisible();
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByRole("heading", { name: "Ваши контакты для связи" })).toBeVisible();
});

test("lead form requires consent and sends the application to the mail endpoint", async ({ page }) => {
  let leadPayload;
  await page.route("**/api/lead.php", async (route) => {
    leadPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  const form = page.locator(".hero-form");
  await form.getByPlaceholder("Имя").fill("Иван");
  await form.getByPlaceholder("Телефон").fill("+79040000000");
  const consent = form.locator("[data-personal-data-consent]");
  await expect(consent).not.toBeChecked();
  await form.getByRole("button", { name: "Хочу расчёт стоимости" }).click();
  expect(await consent.evaluate((input) => input.validity.valid)).toBe(false);

  await consent.check();
  await form.getByRole("button", { name: "Хочу расчёт стоимости" }).click();
  await expect(form.getByRole("status")).toContainText("Спасибо! Заявка принята");
  expect(leadPayload).toMatchObject({
    form: "Тест-драйв",
    name: "Иван",
    phone: "+79040000000",
    personalDataConsent: true,
    consentVersion: "2",
    website: "",
  });
  expect(leadPayload.consentAt).toBeTruthy();
  expect(leadPayload.page).toContain("127.0.0.1:4173");
});

test("lead form reports a mail endpoint failure truthfully", async ({ page }) => {
  await page.route("**/api/lead.php", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }),
  );

  const form = page.locator(".hero-form");
  await form.getByPlaceholder("Имя").fill("Иван");
  await form.getByPlaceholder("Телефон").fill("+79040000000");
  await form.locator("[data-personal-data-consent]").check();
  await form.getByRole("button", { name: "Хочу расчёт стоимости" }).click();
  await expect(form.getByRole("status")).toContainText("+7 904 329-49-86");
});

test("mobile layouts have no horizontal overflow", async ({ page }) => {
  for (const width of [390, 375, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");

    await expect(page.locator(".mobile-menu-button")).toBeVisible();
    await expect(page.locator(".hero-form")).toBeVisible();
    await expect(page.locator(".car-card")).toHaveCount(4);
    await expect(page.locator(".reviews iframe")).toHaveCount(3);

    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(layout.page, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(layout.viewport);
  }
});

test("mobile consultation and chat controls work at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");

  await page.locator(".consultation-cta button").click();
  await expect(page.locator("#order-modal")).toHaveClass(/is-open/);
  await expect(page.locator("#order-modal .order-panel")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator(".chat-widget__toggle").click();
  await expect(page.locator(".chat-widget")).toHaveClass(/is-open/);
  await expect(page.locator(".chat-link--telegram")).toBeVisible();
  await expect(page.locator(".chat-link--max")).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(layout.page).toBeLessThanOrEqual(layout.viewport);
});

test("mobile quiz fits a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.reload();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  const quiz = page.locator("#quiz-modal");
  await expect(quiz).toHaveClass(/is-open/);
  await expect(page.locator(".quiz-options")).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(layout.page).toBeLessThanOrEqual(layout.viewport);
});
