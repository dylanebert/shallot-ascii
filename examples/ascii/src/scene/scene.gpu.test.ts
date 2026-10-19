import { expect, setDefaultTimeout, test } from "bun:test";
import { Camera, DirectionalLight, MeshInstance, Transform } from "@dylanebert/shallot";
import { Orbit } from "@dylanebert/shallot/extras";
import { TIMEOUT } from "@dylanebert/shallot/testing";
import { openGpuApp } from "@dylanebert/shallot/testing/gpu";
import { Ascii } from "@dylanebert/shallot-ascii";
import { Welcome, WelcomeCube } from "./index";

setDefaultTimeout(TIMEOUT.gpu);
test("the scene installs an ASCII orbit camera, cube, platform and light", async () => {
    const app = await openGpuApp({ defaults: false, plugins: [Welcome] });
    try {
        const { world } = app;
        expect([...world.query([Camera, Ascii, Orbit])]).toHaveLength(1);
        expect([...world.query([WelcomeCube, MeshInstance])]).toHaveLength(1);
        expect([...world.query([MeshInstance])]).toHaveLength(2);
        expect([...world.query([DirectionalLight, Transform])]).toHaveLength(1);
    } finally {
        app.dispose();
    }
});
