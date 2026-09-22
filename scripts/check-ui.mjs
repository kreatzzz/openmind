import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

// Serve built assets through interception: no server, personal vault, or model.
const assets = path.resolve("dist");
const output = path.resolve("test-results/browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.OPENMIND_TEST_BROWSER_CHANNEL || undefined,
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== "http://openmind.test") return route.abort();
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(assets, relative);
  if (!file.startsWith(assets + path.sep)) return route.abort();
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
  };
  try {
    await route.fulfill({ body: await readFile(file), contentType: types[path.extname(file)] || "application/octet-stream" });
  } catch {
    await route.fulfill({ status: 404, body: "Not found" });
  }
});

async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  if (await settings.isVisible()) {
    await expect.poll(() => settings.getByRole("button", { name: "Done", exact: true }).evaluate((button) => {
      const dialog = button.closest("dialog").getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      return bounds.top >= dialog.top && bounds.bottom <= dialog.bottom && bounds.bottom <= innerHeight && bounds.right <= dialog.right;
    })).toBe(true);
  }
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}

async function expectBackground(locator, color) {
  await expect.poll(() => locator.evaluate((element) => {
    for (let current = element; current; current = current.parentElement) {
      const background = getComputedStyle(current).backgroundColor;
      if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") return background;
    }
    return "transparent";
  })).toBe(color);
}

async function expectProviderChoicesToFit(dialog) {
  const choices = dialog.locator(".provider-choices > button");
  await expect(choices).toHaveCount(2);
  await expect.poll(() => choices.evaluateAll((buttons) => buttons.every((button) => {
    const bounds = button.getBoundingClientRect();
    const icon = button.querySelector("svg")?.getBoundingClientRect();
    const title = button.querySelector("strong")?.getBoundingClientRect();
    const detail = button.querySelector("small")?.getBoundingClientRect();
    if (!icon || !title || !detail) return false;
    return icon.right < title.left &&
      title.top < detail.top &&
      title.right <= bounds.right + 1 &&
      detail.right <= bounds.right + 1 &&
      detail.bottom <= bounds.bottom + 1;
  }))).toBe(true);
}

async function navigate(name) {
  const mobile = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await mobile.isVisible()) {
    await mobile.click();
    await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
  } else {
    await page.getByRole("complementary", { name: "Workspace navigation" }).getByRole("button", { name, exact: true }).click();
  }
}

try {
  await page.goto("http://openmind.test/");
  await expect(page.getByRole("heading", { name: "Welcome to Openmind." })).toBeVisible();
  await capture("onboarding-light");
  await page.getByRole("button", { name: "Explore the workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening)\.$/ })).toBeVisible();
  await capture("overview-light");

  await navigate("Your notes");
  await page.getByRole("button", { name: "Edit note", exact: true }).first().click();
  await page.getByRole("textbox", { name: "Edit note", exact: true }).fill("A synthetic note used only for browser verification.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByText("A synthetic note used only for browser verification.")).toBeVisible();

  await navigate("Remembered context");
  await page.getByRole("searchbox", { name: "Search remembered context" }).fill("synthetic-unmatched-search");
  await expect(page.getByRole("heading", { name: "No matches" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search remembered context" }).fill("");
  await page.getByRole("button", { name: "Forget", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Forget context from this message?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();

  await navigate("Settings");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Dark", exact: true }).click();
  await expectBackground(page.locator(".workspace"), "rgb(0, 0, 0)");
  await expectBackground(page.locator(".desktop-rail"), "rgb(0, 0, 0)");
  await expectBackground(settings, "rgb(0, 0, 0)");
  await settings.getByRole("button", { name: "Blue", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Blue", exact: true })).toHaveAttribute("aria-pressed", "true");
  await capture("settings-dark");
  await settings.getByRole("button", { name: "Model connection", exact: true }).click();
  await expectProviderChoicesToFit(settings);
  await capture("settings-model-connection-dark");
  await page.keyboard.press("Escape");
  await expect(settings).not.toBeVisible();
  await expect(page.getByRole("complementary").getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await capture("memory-dark");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await capture(`memory-${width}`);
    await navigate("Settings");
    await expectProviderChoicesToFit(settings);
    await capture(`settings-${width}`);
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await navigate("Settings");
  await settings.getByRole("button", { name: "Appearance", exact: true }).click();
  await settings.getByRole("button", { name: "System", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".workspace")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".workspace")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");
  // Browser zoom reduces the CSS viewport; CSS `zoom` does not reproduce it.
  await page.setViewportSize({ width: 640, height: 450 });
  await capture("memory-200-percent-layout");
  await navigate("Settings");
  await capture("settings-200-percent-layout");
  expect(errors).toEqual([]);
  console.log("Browser checks passed: onboarding, notebook edit, memory search/forget confirmation, theme colors, focus return, narrow layouts, and a 200%-zoom-equivalent viewport. Actual native zoom, accessibility, and model behavior are separate checks.");
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
