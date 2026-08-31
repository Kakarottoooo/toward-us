import { expect, test } from "@playwright/test";

test("desktop gets a website and mobile gets the approved full-screen experience", async ({ browser }) => {
  const desktop = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: { width: 1440, height: 960 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto("/");

  await expect(desktopPage.getByTestId("desktop-home")).toBeVisible();
  await expect(desktopPage.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(desktopPage.getByTestId("phone-frame")).toHaveCSS("width", "1440px");
  await expect(desktopPage.locator(".phone-bezel")).toBeHidden();
  await expect(desktopPage.getByRole("heading", { name: "在争执之外，我们选择彼此。" })).toBeVisible();

  const mobile = await browser.newContext({ baseURL: "http://127.0.0.1:5173", viewport: { width: 393, height: 852 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto("/");

  await expect(mobilePage.getByTestId("desktop-home")).toBeHidden();
  await expect(mobilePage.getByTestId("home-screen")).toBeVisible();
  await expect(mobilePage.getByTestId("device-screen")).toHaveCSS("width", "393px");
  await expect(mobilePage.locator(".phone-bezel")).toBeHidden();
  await expect(mobilePage.getByTestId("start-button")).toBeVisible();

  await desktop.close();
  await mobile.close();
});
