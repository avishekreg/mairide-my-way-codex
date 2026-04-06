import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "https://www.mairide.in";
const VIDEO_DIR = path.resolve("public/tutorials/videos");
const VIEWPORT = { width: 1365, height: 768 };

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function safeClick(page, candidates) {
  for (const selector of candidates) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.click({ timeout: 2500 });
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

async function fillVisibleInputs(page) {
  const fields = await page.locator("input:visible").all();
  for (const field of fields) {
    try {
      const type = (await field.getAttribute("type"))?.toLowerCase() || "text";
      const name = (await field.getAttribute("name"))?.toLowerCase() || "";
      const placeholder = (await field.getAttribute("placeholder"))?.toLowerCase() || "";
      const hint = `${name} ${placeholder}`;

      let value = "Demo Value";
      if (type === "email" || hint.includes("email")) value = "demo.user@mairide.in";
      else if (type === "tel" || hint.includes("phone") || hint.includes("mobile")) value = "9876543210";
      else if (type === "password" || hint.includes("password")) value = "Demo@1234";
      else if (hint.includes("name")) value = "Demo User";
      else if (hint.includes("from") || hint.includes("origin")) value = "Siliguri, West Bengal, India";
      else if (hint.includes("to") || hint.includes("destination")) value = "Kolkata, West Bengal, India";
      else if (hint.includes("fare") || hint.includes("price")) value = "2500";

      await field.fill(value, { timeout: 2000 });
      await page.waitForTimeout(200);
    } catch {
      // skip problematic field
    }
  }
}

async function recordScenario(browser, name, scenario) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
  });

  const page = await context.newPage();
  const video = page.video();

  try {
    await scenario(page);
  } finally {
    await context.close();
  }

  const source = await video.path();
  const target = path.join(VIDEO_DIR, `${name}.webm`);
  await fs.rm(target, { force: true });
  await fs.rename(source, target);
  return target;
}

async function recordLandingFlow(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(1000);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(1000);
}

async function recordTravelerSignupFlow(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);

  await safeClick(page, ["text=/traveler/i", "button:has-text('Traveler')", "[role='tab']:has-text('Traveler')"]);
  await page.waitForTimeout(600);
  await safeClick(page, ["text=/sign\\s*up/i", "button:has-text('Sign Up')", "[role='tab']:has-text('Sign Up')"]);
  await page.waitForTimeout(800);

  await fillVisibleInputs(page);
  await page.waitForTimeout(1000);

  await safeClick(page, ["button:has-text('Continue')", "button:has-text('Next')", "button:has-text('Sign Up')"]);
  await page.waitForTimeout(1800);
}

async function recordDriverSignupFlow(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);

  await safeClick(page, ["text=/driver/i", "button:has-text('Driver')", "[role='tab']:has-text('Driver')"]);
  await page.waitForTimeout(600);
  await safeClick(page, ["text=/sign\\s*up/i", "button:has-text('Sign Up')", "[role='tab']:has-text('Sign Up')"]);
  await page.waitForTimeout(800);

  await fillVisibleInputs(page);
  await page.waitForTimeout(1000);

  await safeClick(page, ["button:has-text('Continue')", "button:has-text('Next')", "button:has-text('Create')"]);
  await page.waitForTimeout(1800);
}

async function main() {
  await ensureDir(VIDEO_DIR);
  const browser = await chromium.launch({ headless: true });

  try {
    const outputs = [];
    outputs.push(await recordScenario(browser, "landing-overview", recordLandingFlow));
    outputs.push(await recordScenario(browser, "traveler-signup-demo", recordTravelerSignupFlow));
    outputs.push(await recordScenario(browser, "driver-signup-demo", recordDriverSignupFlow));
    console.log("Recorded tutorial videos:");
    outputs.forEach((file) => console.log(`- ${file}`));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Tutorial video generation failed:", error);
  process.exit(1);
});
