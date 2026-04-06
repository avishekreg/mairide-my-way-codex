import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.TUTORIAL_BASE_URL || "https://www.mairide.in";
const VIDEO_DIR = path.resolve("public/tutorials/videos");
const VIEWPORT = { width: 1365, height: 768 };

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function pause(ms = 1200) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeClick(page, selectors, timeout = 3500) {
  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 1200 })) {
        await el.click({ timeout, force: true });
        return true;
      }
    } catch {
      // continue trying alternates
    }
  }
  return false;
}

function randomEmail(prefix) {
  return `${prefix}.${Date.now()}@mairide.in`;
}

function randomPhone() {
  const seed = String(Date.now()).slice(-9);
  return `9${seed}`;
}

async function createDemoUser(role, name) {
  const email = randomEmail(`tutorial.${role}`);
  const phone = randomPhone();
  const password = "Demo@1234";
  const payload = {
    email,
    password,
    displayName: name,
    phoneNumber: phone,
    role,
    referralCodeInput: "",
  };

  const response = await fetch(`${BASE_URL}/api/auth/complete-signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json?.error || json?.message || `Failed to create demo ${role} user`);
  }

  return { email, phone, password, name };
}

async function setupContext(browser) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
    permissions: ["camera", "geolocation"],
  });

  await context.addInitScript(() => {
    try {
      localStorage.setItem("mairide_ui_language", "en");
      localStorage.setItem("mairide_ui_language_prompt_seen", "1");
      sessionStorage.setItem("mairide_ui_language_prompt_session", "1");
      document.cookie = "googtrans=/en/en; path=/";
    } catch {
      // ignore storage exceptions
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
  await safeClick(page, [
    "button:has-text('Continue in English')",
    "button:has-text('English (English)')",
    "button:has-text('English')",
  ]);
  await pause(700);
}

async function loginWithCredentials(page, { email, password, role }) {
  await forceEnglish(page);

  await safeClick(page, [
    `button:has-text('${role === "driver" ? "Driver" : "Traveler"}')`,
  ]);
  await pause(450);

  await safeClick(page, [
    "button:has-text('Login')",
    "[role='tab']:has-text('Login')",
  ]);
  await pause(500);

  await page.locator("input[type='text']:visible").first().fill(email);
  await pause(300);
  await page.locator("input[type='password']:visible").first().fill(password);
  await pause(300);

  await safeClick(page, [
    "button.w-full.bg-mairide-accent:has-text('Login')",
    "button[type='submit']:has-text('Login')",
    "button:has-text('Login')",
  ]);

  await pause(4500);
}

async function clickTabSequence(page, labels) {
  for (const label of labels) {
    await safeClick(page, [
      `button:has-text('${label}')`,
      `a:has-text('${label}')`,
    ]);
    await pause(900);
    await page.mouse.wheel(0, 280);
    await pause(900);
    await page.mouse.wheel(0, -240);
    await pause(650);
  }
}

async function capturePhotoFromModal(page) {
  const modal = page.locator("div.fixed.inset-0.bg-black\\/90.z-\\[60\\]");
  await modal.waitFor({ state: "visible", timeout: 12000 });

  const captureBtn = page.locator("button:has-text('Capture Photo')").first();
  await captureBtn.waitFor({ state: "visible", timeout: 12000 });

  await pause(1600);
  if (!(await captureBtn.isDisabled())) {
    await captureBtn.click({ force: true, timeout: 4000 });
  }
  await modal.waitFor({ state: "hidden", timeout: 15000 });
  await pause(400);
}

async function fillDriverOnboarding(page) {
  await page.locator("text=Step 1/5").first().waitFor({ state: "visible", timeout: 20000 });

  // Step 1
  await safeClick(page, ["button:has-text('Capture Selfie')", "button:has-text('Retake Selfie')"]);
  await capturePhotoFromModal(page);
  await safeClick(page, ["button:has-text('Continue')"]);
  await pause(800);

  // Step 2
  const aadhaarInputs = page.locator("input[placeholder='0000']:visible");
  await aadhaarInputs.nth(0).fill("1234");
  await aadhaarInputs.nth(1).fill("5678");
  await aadhaarInputs.nth(2).fill("9012");
  await pause(450);

  const aadhaarSlots = page.locator("div.aspect-\\[3\\/2\\].border-2.border-dashed");
  await aadhaarSlots.nth(0).click({ force: true });
  await capturePhotoFromModal(page);
  await aadhaarSlots.nth(1).click({ force: true });
  await capturePhotoFromModal(page);
  await safeClick(page, ["button:has-text('Continue')"]);
  await pause(800);

  // Step 3
  await page.locator("input[placeholder='DL Number']:visible").fill("WB0120260001234");
  await pause(450);
  const dlSlots = page.locator("div.aspect-\\[3\\/2\\].border-2.border-dashed");
  await dlSlots.nth(0).click({ force: true });
  await capturePhotoFromModal(page);
  await dlSlots.nth(1).click({ force: true });
  await capturePhotoFromModal(page);
  await safeClick(page, ["button:has-text('Continue')"]);
  await pause(800);

  // Step 4
  await page.locator("input[placeholder='e.g. Maruti']:visible").fill("Maruti");
  await page.locator("input[placeholder='e.g. Swift']:visible").fill("Swift Dzire");
  await page.locator("input[placeholder='e.g. White']:visible").fill("White");
  await page.locator("input[type='number']:visible").first().fill("4");
  await page.locator("input[placeholder='e.g. DL 01 AB 1234']:visible").fill("WB12AB1234");
  await page.locator("input[placeholder='e.g. ICICI Lombard']:visible").fill("Acko");
  const insuranceDate = page.locator("input[type='date']:visible").first();
  if (await insuranceDate.isVisible().catch(() => false)) {
    await insuranceDate.fill("2027-12-31");
  }
  await pause(600);
  await safeClick(page, ["button:has-text('Continue')"]);
  await pause(800);

  // Step 5
  const docSlots = page.locator("div.aspect-square.border-2.border-dashed");
  await docSlots.nth(0).click({ force: true });
  await capturePhotoFromModal(page);
  await docSlots.nth(1).click({ force: true });
  await capturePhotoFromModal(page);

  const declarationCheckbox = page.locator("input[type='checkbox']:visible").last();
  await declarationCheckbox.check({ force: true }).catch(async () => {
    await declarationCheckbox.click({ force: true });
  });
  await pause(500);

  await safeClick(page, ["button:has-text('Complete Setup')"]);
  await pause(6000);
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
  await pause(1100);
  await page.mouse.wheel(0, 420);
  await pause(1200);
  await page.mouse.wheel(0, 520);
  await pause(1500);
  await page.mouse.wheel(0, -540);
  await pause(1400);
  await page.mouse.wheel(0, -500);
  await pause(2800);
}

async function recordTravelerSignup(page) {
  const traveler = await createDemoUser("consumer", "Tutorial Traveler");

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await loginWithCredentials(page, { ...traveler, role: "consumer" });
  await forceEnglish(page);

  await clickTabSequence(page, ["Search", "History", "Wallet", "Support", "Profile", "Home"]);

  await page.mouse.wheel(0, 800);
  await pause(1300);
  await page.mouse.wheel(0, -720);
  await pause(2500);
}

async function recordDriverSignup(page) {
  const driver = await createDemoUser("driver", "Tutorial Driver");

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await loginWithCredentials(page, { ...driver, role: "driver" });
  await forceEnglish(page);

  await fillDriverOnboarding(page);

  await page.locator("text=Verification Pending").first().waitFor({ state: "visible", timeout: 20000 });
  await pause(2500);
}

async function cleanupTransientFiles() {
  const files = await fs.readdir(VIDEO_DIR).catch(() => []);
  await Promise.all(
    files
      .filter((name) => name.startsWith("page@") && name.endsWith(".webm"))
      .map((name) => fs.rm(path.join(VIDEO_DIR, name), { force: true }))
  );
}

async function main() {
  await ensureDir(VIDEO_DIR);
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  try {
    const outputs = [];
    outputs.push(await recordScenario(browser, "landing-overview", recordLanding));
    outputs.push(await recordScenario(browser, "traveler-signup-demo", recordTravelerSignup));
    outputs.push(await recordScenario(browser, "driver-signup-demo", recordDriverSignup));

    await cleanupTransientFiles();

    console.log("Recorded tutorial videos:");
    for (const out of outputs) console.log(`- ${out}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Tutorial video generation failed:", error);
  process.exit(1);
});
