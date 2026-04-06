import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = "https://www.mairide.in";
const VIDEO_DIR = path.resolve("public/tutorials/videos");
const VIEWPORT = { width: 1365, height: 768 };

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function pause(ms = 1200) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeClick(page, selectors, timeout = 2500) {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1200 })) {
        await el.click({ timeout, force: true });
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}

function randomEmail(prefix) {
  return `${prefix}.${Date.now()}@example.com`;
}

function randomPhone() {
  const seed = String(Date.now()).slice(-9);
  return `9${seed}`;
}

async function setupContext(browser) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("mairide_ui_language", "en");
      localStorage.setItem("mairide_ui_language_prompt_seen", "1");
      sessionStorage.setItem("mairide_ui_language_prompt_session", "1");
      document.cookie = "googtrans=/en/en; path=/";
    } catch {
      // ignore storage errors
    }
  });

  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (
      url.includes("accounts.google.com") ||
      url.includes("googleusercontent.com") ||
      url.includes("oauth")
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });

  return context;
}

async function forceEnglish(page) {
  // Keep explicit English choice if prompt still appears unexpectedly.
  await safeClick(page, [
    "button:has-text('Continue in English')",
    "button:has-text('English (English)')",
  ]);
  await pause(900);
}

async function openManualSignup(page, roleLabel) {
  await forceEnglish(page);
  const roleButtons = page.locator("button.flex-1.py-3.rounded-xl:visible");
  const roleCount = await roleButtons.count();
  if (roleCount >= 2) {
    await roleButtons.nth(roleLabel === "Driver" ? 1 : 0).click({ timeout: 2500 });
  } else {
    await safeClick(page, [
      `button:has-text('${roleLabel}')`,
      `[role='tab']:has-text('${roleLabel}')`,
    ]);
  }
  await pause(700);
  const authTabs = page.locator("button.text-sm.font-bold.pb-1:visible");
  const tabCount = await authTabs.count();
  if (tabCount >= 2) {
    await authTabs.nth(1).click({ timeout: 2500 }); // signup tab
  } else {
    await safeClick(page, [
      "button:has-text('Sign Up')",
      "[role='tab']:has-text('Sign Up')",
    ]);
  }
  await pause(900);

  // Retry once if the form is not yet visible.
  const emailInput = page.locator("input[type='email']:visible").first();
  if (!(await emailInput.isVisible({ timeout: 1500 }).catch(() => false))) {
    await safeClick(page, [
      "button:has-text('Sign Up')",
      "[role='tab']:has-text('Sign Up')",
      "text=/sign\\s*up/i",
    ]);
    await pause(900);
  }
}

async function fillSignupForm(page, { name, email, phone, password }) {
  await page.locator("input[placeholder='Full Name']").first().fill(name);
  await pause(450);
  await page.locator("input[type='email']:visible").first().fill(email);
  await pause(450);
  await page.locator("input[type='tel']:visible").first().fill(phone);
  await pause(450);
  await page.locator("input[type='password']:visible").first().fill(password);
  await pause(450);

  const checks = page.locator("input[type='checkbox']:visible");
  const count = await checks.count();
  for (let i = 0; i < count; i += 1) {
    try {
      await checks.nth(i).check({ force: true });
      await pause(250);
    } catch {
      // ignore
    }
  }
}

async function submitSignup(page) {
  await safeClick(page, [
    "button.w-full.bg-mairide-accent:has-text('Sign Up')",
    "button[type='submit']:has-text('Sign Up')",
    "button:has-text('Sign Up')",
  ]);
  await pause(2500);
}

async function loginWithCredentials(page, { email, password }) {
  await forceEnglish(page);
  const preLoginEmailField = page.locator("input[type='email']:visible").first();
  if (!(await preLoginEmailField.isVisible({ timeout: 1200 }).catch(() => false))) {
    // Already beyond auth wall (session continued), treat as dashboard-ready.
    await pause(1200);
    return;
  }

  const authTabs = page.locator("button.text-sm.font-bold.pb-1:visible");
  const tabCount = await authTabs.count();
  if (tabCount >= 1) {
    await authTabs.nth(0).click({ timeout: 2500 }); // login tab
  } else {
    await safeClick(page, [
      "button:has-text('Login')",
      "[role='tab']:has-text('Login')",
    ]);
  }
  await pause(700);

  await page.locator("input[type='email']:visible").first().fill(email);
  await pause(450);
  await page.locator("input[type='password']:visible").first().fill(password);
  await pause(450);

  await safeClick(page, [
    "button.w-full.bg-mairide-accent:has-text('Login')",
    "button[type='submit']:has-text('Login')",
    "button:has-text('Login')",
  ]);
  await pause(3500);
}

async function recordScenario(browser, fileName, fn) {
  const context = await setupContext(browser);
  const page = await context.newPage();
  const video = page.video();

  try {
    await fn(page);
  } finally {
    await context.close();
  }

  const source = await video.path();
  const target = path.join(VIDEO_DIR, `${fileName}.webm`);
  await fs.rm(target, { force: true });
  await fs.rename(source, target);
  return target;
}

async function recordLanding(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await forceEnglish(page);
  await pause(1200);
  await page.mouse.wheel(0, 450);
  await pause(1800);
  await page.mouse.wheel(0, 550);
  await pause(2000);
  await page.mouse.wheel(0, -500);
  await pause(1700);
  await page.mouse.wheel(0, -500);
  await pause(4000);
}

async function recordTravelerSignup(page) {
  const traveler = {
    name: "Tutorial Traveler",
    email: randomEmail("tutorial.traveler"),
    phone: randomPhone(),
    password: "Demo@1234",
  };

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await openManualSignup(page, "Traveler");
  await fillSignupForm(page, traveler);
  await submitSignup(page);

  // Tutorial requirement: skip OTP screen and continue to dashboard sequence.
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await loginWithCredentials(page, traveler);

  await page.mouse.wheel(0, 450);
  await pause(1500);
  await page.mouse.wheel(0, 500);
  await pause(1800);
  await page.mouse.wheel(0, -500);
  await pause(3500);
}

async function recordDriverSignup(page) {
  const driver = {
    name: "Tutorial Driver",
    email: randomEmail("tutorial.driver"),
    phone: randomPhone(),
    password: "Demo@1234",
  };

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await openManualSignup(page, "Driver");
  await fillSignupForm(page, driver);
  await submitSignup(page);

  // Continue through setup-like flow with document sections in view.
  await page.mouse.wheel(0, 450);
  await pause(1800);
  await page.mouse.wheel(0, 550);
  await pause(1800);
  await page.mouse.wheel(0, 700);
  await pause(2200);

  await safeClick(page, [
    "button:has-text('Continue')",
    "button:has-text('Next')",
  ]);
  await pause(1600);

  await page.mouse.wheel(0, 900);
  await pause(2200);

  await safeClick(page, [
    "button:has-text('Complete Setup')",
    "button:has-text('Submit')",
  ]);
  await pause(3500);
}

async function main() {
  await ensureDir(VIDEO_DIR);
  const browser = await chromium.launch({ headless: true });
  try {
    const outputs = [];
    outputs.push(await recordScenario(browser, "landing-overview", recordLanding));
    outputs.push(await recordScenario(browser, "traveler-signup-demo", recordTravelerSignup));
    outputs.push(await recordScenario(browser, "driver-signup-demo", recordDriverSignup));
    console.log("Recorded tutorial videos:");
    for (const o of outputs) console.log(`- ${o}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Tutorial video generation failed:", error);
  process.exit(1);
});
