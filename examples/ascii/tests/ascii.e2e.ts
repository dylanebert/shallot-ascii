import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("the package presents coloured ASCII ink over black", async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/stepped.html");
    await page.waitForFunction(
        () => "captureAscii" in window && document.querySelector("canvas")?.width === 1280,
    );
    const png = await page.evaluate(async () => {
        const capture = (window as unknown as { captureAscii(): Promise<string> }).captureAscii;
        return capture();
    });
    const bytes = Buffer.from(png.split(",")[1], "base64");
    await writeFile(info.outputPath("ascii.png"), bytes);
    const visible = await page.evaluate(async (data) => {
        const image = await createImageBitmap(await (await fetch(data)).blob());
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const rgba = context.getImageData(0, 0, image.width, image.height).data;
        image.close();
        let orange = 0;
        let black = 0;
        for (let i = 0; i < rgba.length; i += 4) {
            if (rgba[i] > rgba[i + 1] * 1.2 && rgba[i + 1] > rgba[i + 2] * 1.2) orange++;
            if (rgba[i] + rgba[i + 1] + rgba[i + 2] === 0) black++;
        }
        return { orange, black };
    }, png);
    expect(errors).toEqual([]);
    expect(visible.orange).toBeGreaterThan(1000);
    expect(visible.black).toBeGreaterThan(1280 * 720 * 0.5);
});
