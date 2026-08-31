import { expect, test } from "@playwright/test";

test("desktop gets a website and mobile gets the approved full-screen experience", async ({ browser, baseURL }) => {
  const desktop = await browser.newContext({ baseURL, viewport: { width: 1440, height: 960 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto("/");

  await expect(desktopPage.getByTestId("desktop-home")).toBeVisible();
  await expect(desktopPage.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(desktopPage.getByTestId("phone-frame")).toHaveCSS("width", "1440px");
  await expect(desktopPage.locator(".phone-bezel")).toBeHidden();
  await expect(desktopPage.getByRole("heading", { name: "在争执之外，我们选择彼此。" })).toBeVisible();

  await desktopPage.goto("/demo");
  const desktopSharedChoice = desktopPage.getByRole("button", { name: "共用一台手机 一起使用，简单快捷" });
  const desktopRemoteChoice = desktopPage.getByRole("button", { name: "各用一台手机 扫码加入，更私密" });
  await expect(desktopSharedChoice).toHaveCSS("cursor", "pointer");
  await expect(desktopRemoteChoice).toHaveCSS("cursor", "pointer");
  const desktopName = desktopPage.getByLabel("你的称呼");
  await expect(desktopName).toHaveCSS("cursor", "text");
  await expect(desktopName).toHaveAttribute("placeholder", "输入你的称呼");
  await expect(desktopName).toHaveCSS("border-top-style", "solid");
  await expect(desktopName).toHaveCSS("background-color", "rgba(251, 247, 239, 0.92)");
  await desktopName.fill("小彼");
  await expect(desktopName).toHaveValue("小彼");

  const mobile = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto("/");

  await expect(mobilePage.getByTestId("desktop-home")).toBeHidden();
  await expect(mobilePage.getByTestId("home-screen")).toBeVisible();
  await expect(mobilePage.getByTestId("device-screen")).toHaveCSS("width", "393px");
  await expect(mobilePage.locator(".phone-bezel")).toBeHidden();
  await expect(mobilePage.getByTestId("start-button")).toBeVisible();

  await mobilePage.goto("/demo");
  await expect(mobilePage.getByRole("button", { name: "共用一台手机 一起使用，简单快捷" })).toHaveCSS("cursor", "none");
  const mobileName = mobilePage.getByLabel("你的称呼");
  await expect(mobileName).toHaveCSS("cursor", "none");
  await expect(mobileName).toHaveAttribute("placeholder", "输入你的称呼");
  await expect(mobileName).toHaveCSS("border-top-style", "none");
  await mobileName.fill("小彼");
  await expect(mobileName).toHaveValue("小彼");

  await desktop.close();
  await mobile.close();
});
