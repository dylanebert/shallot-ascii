import { expect, test } from "bun:test";
import { ramp } from "../src/ramp";

test("ramp starts blank and measured ink never decreases", () => {
    expect(ramp.map((g) => g.char).sort()).toEqual([..." .:-=+*#%@"].sort());
    expect(ramp[0].char).toBe(" ");
    expect(ramp[0].rows).toEqual(Array(8).fill(0));
    const ink = ramp.map((g) =>
        g.rows.reduce((n, row) => n + row.toString(2).replaceAll("0", "").length, 0),
    );
    expect(ink).toEqual([...ink].sort((a, b) => a - b));
    expect(new Set(ink).size).toBe(10);
});
