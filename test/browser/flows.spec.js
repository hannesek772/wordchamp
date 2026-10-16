import { test, expect } from "@playwright/test";
test("teacher + two mobile students: live answers, refresh, round results, next round and vocabulary management", async ({
  browser,
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Small words." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/landing-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Lärarrummet" }).click();
  await page.getByLabel("Lärarlösenord").fill("browser-test-password");
  await page.getByRole("button", { name: "Logga in →", exact: true }).click();
  await expect(page.getByText("750 glosor · 30 veckor")).toBeVisible();
  await page.getByRole("button", { name: "+ Nytt spelrum" }).click();
  await expect(page.locator("#controls")).toBeVisible();
  await expect(page.locator("#start-round")).toBeDisabled();
  const pin = (await page.locator("#controls .game-pin").innerText()).trim();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const a = await mobile.newPage();
  a.on("pageerror", (e) => errors.push(e.message));
  await a.goto("/?pin=" + pin);
  await expect(a.locator("#pin")).toHaveValue(pin);
  await a.getByLabel("Ditt smeknamn").fill("Nova");
  await a.getByRole("button", { name: "Hoppa in i spelet" }).click();
  await expect(
    a.getByRole("heading", { name: "Du är med, Nova!" }),
  ).toBeVisible();
  const mobile2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const b = await mobile2.newPage();
  await b.goto("/?pin=" + pin);
  await b.getByLabel("Ditt smeknamn").fill("Alex");
  await b.getByRole("button", { name: "Hoppa in i spelet" }).click();
  await expect(page.getByText("2 deltagare · 2 online")).toBeVisible();
  await expect(a.locator(".answer")).toHaveCount(0);
  await expect(b.locator(".answer")).toHaveCount(0);
  await page.locator('.week input[value="38"]').check();
  await page.locator('.week input[value="39"]').check();
  await page.getByRole("button", { name: "Starta rundan →" }).click();
  await expect(a.locator(".answer")).toHaveCount(4);
  await expect(b.locator(".answer")).toHaveCount(4);
  const lateContext = await browser.newContext();
  const late = await lateContext.newPage();
  await late.goto("/?pin=" + pin);
  await late.getByLabel("Ditt smeknamn").fill("Sen elev");
  await late.getByRole("button", { name: "Hoppa in i spelet" }).click();
  await expect(
    late.getByText("Rundan har redan startat.", { exact: false }),
  ).toBeVisible();
  await expect(late.locator(".answer")).toHaveCount(0);
  await late.reload();
  await expect(
    late.getByText("Rundan har redan startat.", { exact: false }),
  ).toBeVisible();
  await expect(late.locator(".answer")).toHaveCount(0);

  await a.screenshot({
    path: "test-results/student-mobile.png",
    fullPage: true,
  });
  const prompt = await a.locator(".question h1").innerText();
  await a.reload();
  await expect(a.locator(".question h1")).toHaveText(prompt);
  await a.locator(".answer").first().click();
  await expect(a.getByRole("button", { name: "Nästa glosa" })).toBeVisible();
  await a.getByRole("button", { name: "Nästa glosa" }).click();
  await expect(a.locator(".answer:enabled")).toHaveCount(4);
  await page.screenshot({
    path: "test-results/teacher-desktop.png",
    fullPage: true,
  });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Avsluta rundan", exact: true })
    .click();
  await expect(
    a.getByRole("heading", { name: "Meet the champions." }),
  ).toBeVisible();
  await expect(
    b.getByRole("heading", { name: "Meet the champions." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Starta nästa runda" }).click();
  await expect(a.locator(".answer")).toHaveCount(4);
  await expect(a.getByText("DIN STREAK · RUNDA 2")).toBeVisible();
  await expect(late.locator(".answer")).toHaveCount(4);
  await lateContext.close();
  await page.getByRole("button", { name: "Glosbanken", exact: true }).click();
  await page.getByRole("button", { name: "+ Lägg till glosa" }).click();
  await page.getByLabel("Engelska", { exact: true }).fill("browser entry");
  await page.getByLabel("Svenska", { exact: true }).fill("webbläsartest");
  await page.getByRole("button", { name: "Spara glosa" }).click();
  await expect(page.locator("#editor")).not.toBeVisible();
  await page.getByRole("textbox", { name: "Sök glosor" }).fill("browser entry");
  await expect(
    page.getByRole("cell", { name: "browser entry", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Redigera browser entry" }).click();
  await page.getByLabel("Svenska", { exact: true }).fill("ändrad");
  await page.getByRole("button", { name: "Spara glosa" }).click();
  await expect(page.locator("#editor")).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "ändrad", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Redigera browser entry" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Radera", exact: true }).click();
  await expect(page.getByText("Inga glosor matchar sökningen.")).toBeVisible();
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  expect(errors).toEqual([]);
  await mobile.close();
  await mobile2.close();
});

test("a student can win a full round and see a real podium", async ({
  browser,
  page,
}) => {
  const { readFileSync } = await import("node:fs");
  const { parse } = await import("csv-parse/sync");
  const words = parse(readFileSync("data/vocabulary.csv", "utf8"), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  }).filter((w) => ["38", "39"].includes(w.Vecka));
  await page.goto("/#teacher");
  await page.getByLabel("Lärarlösenord").fill("browser-test-password");
  await page.getByRole("button", { name: "Logga in →", exact: true }).click();
  await page.getByRole("button", { name: "+ Nytt spelrum" }).click();
  await expect(page.locator("#controls")).toBeVisible();
  const pin = (await page.locator("#controls .game-pin").innerText()).trim();
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await c.newPage();
  await p.goto("/?pin=" + pin);
  await p.getByLabel("Ditt smeknamn").fill("Champion");
  await p.getByRole("button", { name: "Hoppa in i spelet" }).click();
  await expect(
    p.getByRole("heading", { name: "Du är med, Champion!" }),
  ).toBeVisible();
  await page.locator('.week input[value="38"]').check();
  await page.locator('.week input[value="39"]').check();
  await page.getByRole("button", { name: "Starta rundan →" }).click();
  for (let i = 0; i < 15; i++) {
    await expect(p.locator(".answer:enabled")).toHaveCount(4);
    const prompt = await p.locator(".question h1").innerText();
    const match = words.find((w) => w.Engelska === prompt);
    expect(match).toBeTruthy();
    const options = await p.locator(".answer").allTextContents();
    const index = options.findIndex((o) => o.slice(1) === match.Svenska);
    expect(index).toBeGreaterThanOrEqual(0);
    await p.locator(".answer").nth(index).click();
    if (i < 14) {
      await expect(p.getByText("Rätt! Snyggt jobbat.")).toBeVisible();
      await p.getByRole("button", { name: "Nästa glosa" }).click();
    }
  }
  await expect(
    p.getByRole("heading", { name: "Meet the champions." }),
  ).toBeVisible();
  await expect(p.locator(".podium-place.first")).toContainText("Champion");
  await expect(page.locator(".podium-place.first")).toContainText("Champion");
  await p.screenshot({
    path: "test-results/podium-mobile.png",
    fullPage: true,
  });
  await c.close();
});
