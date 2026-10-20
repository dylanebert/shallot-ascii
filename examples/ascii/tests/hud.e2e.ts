import { expect, test } from "@playwright/test";

for (const ratio of [1, 2]) {
    test.describe(`HUD at device scale ${ratio}`, () => {
        test.use({ deviceScaleFactor: ratio });
        test("uses Shallot UI tokens and follows T", async ({ page }, info) => {
            const errors: string[] = [];
            page.on("pageerror", (error) => errors.push(error.message));
            await page.goto("/");
            const hud = page.locator(".ascii-hud");
            await expect(hud.locator(".style")).toHaveText("Silhouette");
            // aperture-carbon ui tokens, with interact's translucent key panel.
            const font = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
            for (const element of [hud, hud.locator("kbd")]) {
                await expect(element).toHaveCSS("font-family", font);
                await expect(element).toHaveCSS("font-size", "14px");
                await expect(element).toHaveCSS("font-weight", "400");
                await expect(element).toHaveCSS("color", "rgb(238, 233, 223)");
            }
            const key = hud.locator("kbd");
            await expect(key).toHaveText("T");
            await expect(key).toHaveCSS("background-color", "rgba(40, 38, 34, 0.8)");
            await expect(key).toHaveCSS("border-radius", "2px");
            await expect(key).toHaveCSS("border-top-color", "rgb(238, 233, 223)");
            await expect(key).toHaveCSS("width", "28px");
            await expect(key).toHaveCSS("height", "28px");
            await expect(page.locator("[data-shallot-bootstrap]")).not.toBeVisible();
            await page.screenshot({ path: info.outputPath(`ascii-silhouette-ratio-${ratio}.png`) });
            await page.keyboard.press("t");
            await expect(hud.locator(".style")).toHaveText("Filled");
            await page.screenshot({ path: info.outputPath(`ascii-filled-ratio-${ratio}.png`) });
            await page.keyboard.press("t");
            await expect(hud.locator(".style")).toHaveText("Silhouette");
            expect(errors).toEqual([]);
        });
    });
}
