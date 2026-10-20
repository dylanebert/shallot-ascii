import { expect, test } from "bun:test";
import { edges, ramp } from "../src/ramp";

const ink = (rows: number[]) =>
    rows.reduce((n, row) => n + row.toString(2).replaceAll("0", "").length, 0);

test("ramp starts blank and measured ink never decreases", () => {
    expect(ramp.map((g) => g.char).sort()).toEqual([..." .:+*XZ0"].sort());
    expect(ramp[0].char).toBe(" ");
    expect(ramp[0].rows).toEqual(Array(8).fill(0));
    const inks = ramp.map((g) => ink(g.rows));
    expect(inks).toEqual([...inks].sort((a, b) => a - b));
    expect(new Set(inks).size).toBe(8);
});

test("edge glyphs are one-pixel lines spanning the cell", () => {
    for (const rows of edges) expect(ink(rows)).toBe(8);
    expect(edges[0].every((row) => row === edges[0][0])).toBe(true);
    expect(edges[2].filter((row) => row === 255)).toHaveLength(1);
    expect(edges[1].map((row, y) => row === 1 << (7 - y))).not.toContain(false);
    expect(edges[3].map((row, y) => row === 1 << y)).not.toContain(false);
});
