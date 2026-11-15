import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("a2carsQuizShown", "true");
  });
});

test("optional external media is disabled until the visitor consents", async ({ page }) => {
  const rutubeRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("rutube.ru")) rutubeRequests.push(request.url());
  });

  await page.goto("/");

  await expect(page.locator("[data-privacy-banner]")).toBeVisible();
  const frames = page.locator("iframe[data-external-media]");
  await expect(frames).toHaveCount(3);
  await expect
    .poll(() => frames.evaluateAll((elements) => elements.map((frame) => frame.getAttribute("src"))))
    .toEqual([null, null, null]);
  expect(rutubeRequests).toEqual([]);
});

test("accept all loads external media and persists a versioned 12-month preference", async ({ page }) => {
  await page.route(/rutube\.ru/, (route) => route.abort());
  await page.goto("/");

  await page.locator("[data-privacy-accept-all]").click();

  await expect(page.locator("[data-privacy-banner]")).toBeHidden();
  const sources = await page
    .locator("iframe[data-external-media]")
    .evaluateAll((frames) => frames.map((frame) => frame.getAttribute("src")));
  expect(sources).toHaveLength(3);
  expect(sources.every((source) => source?.startsWith("https://rutube.ru/"))).toBe(true);

  const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem("ikautoPrivacyPreferences")));
  expect(preferences).toMatchObject({ version: 1, necessary: true, externalMedia: true });
  const expectedExpiry = new Date(preferences.updatedAt);
  expectedExpiry.setUTCFullYear(expectedExpiry.getUTCFullYear() + 1);
  expect(preferences.expiresAt).toBe(expectedExpiry.toISOString());

  await page.reload();
  await expect(page.locator("[data-privacy-banner]")).toBeHidden();
  await expect(page.locator('iframe[data-external-media][src^="https://rutube.ru/"]')).toHaveCount(3);
});

test("visitor can reject optional media and later revoke or grant consent in settings", async ({ page }) => {
  await page.route(/rutube\.ru/, (route) => route.abort());
  await page.goto("/");

  await page.locator("[data-privacy-reject-optional]").click();
  await expect(page.locator("[data-privacy-banner]")).toBeHidden();
  await expect(page.locator("iframe[data-external-media][src]")).toHaveCount(0);

  await page.locator("[data-privacy-open-settings]").first().click();
  const settings = page.locator("[data-privacy-settings]");
  const externalMedia = settings.locator("[data-privacy-external-media]");
  await expect(settings).toBeVisible();
  await expect(externalMedia).not.toBeChecked();

  await externalMedia.check();
  await settings.locator("[data-privacy-save]").click();
  await expect(page.locator('iframe[data-external-media][src^="https://rutube.ru/"]')).toHaveCount(3);

  await page.locator("[data-privacy-open-settings]").first().click();
  await externalMedia.uncheck();
  await settings.locator("[data-privacy-save]").click();
  await expect(page.locator("iframe[data-external-media][src]")).toHaveCount(0);

  const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem("ikautoPrivacyPreferences")));
  expect(preferences.externalMedia).toBe(false);
});

test("expired preferences are ignored and the banner is shown again", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "ikautoPrivacyPreferences",
      JSON.stringify({
        version: 1,
        necessary: true,
        externalMedia: true,
        updatedAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2025-01-01T00:00:00.000Z",
      }),
    );
  });
  await page.goto("/");

  await expect(page.locator("[data-privacy-banner]")).toBeVisible();
  await expect(page.locator("iframe[data-external-media][src]")).toHaveCount(0);
});

test("every lead form has an unchecked required personal-data consent", async ({ page }) => {
  await page.goto("/");
  const forms = page.locator(".lead-form");
  await expect(forms).toHaveCount(4);

  for (let index = 0; index < 4; index += 1) {
    const consent = forms.nth(index).locator("[data-personal-data-consent]");
    await expect(consent).toHaveCount(1);
    await expect(consent).not.toBeChecked();
    await expect(consent).toHaveAttribute("required", "");
  }
});

test("legal documents and footer are available", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator(".site-footer");
  await expect(footer).toContainText("ООО «А2авто»");
  await expect(footer.getByRole("link", { name: "Политика обработки персональных данных" })).toHaveAttribute(
    "href",
    "/privacy.html",
  );

  for (const document of [
    ["/privacy.html", "Политика в отношении обработки персональных данных"],
    ["/consent.html", "Согласие на обработку персональных данных"],
    ["/cookies.html", "Политика использования cookie и похожих технологий"],
    ["/terms.html", "Правовая информация и условия использования сайта"],
  ]) {
    const response = await page.goto(document[0]);
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { name: document[1] })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://ikauto.ru${document[0]}`);
  }
});

test("privacy UI and legal documents fit a 320px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await expect(page.locator("[data-privacy-banner]")).toBeVisible();

  for (const path of ["/", "/privacy.html", "/consent.html", "/cookies.html", "/terms.html"]) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(dimensions.page, `horizontal overflow on ${path}`).toBeLessThanOrEqual(dimensions.viewport);
  }
});
