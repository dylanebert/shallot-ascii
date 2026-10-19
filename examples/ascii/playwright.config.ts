import { BROWSER_CONFIG, WEB_SERVER_CONFIG } from "@dylanebert/shallot/testing";
import type { PlaywrightTestConfig } from "@playwright/test";

export default {
    ...BROWSER_CONFIG,
    testDir: "./tests",
    use: {
        ...BROWSER_CONFIG.use,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        baseURL: "http://127.0.0.1:4179",
    },
    webServer: {
        command: "bunx vite --host 127.0.0.1 --port 4179 --strictPort",
        url: "http://127.0.0.1:4179",
        ...WEB_SERVER_CONFIG,
    },
} satisfies PlaywrightTestConfig;
