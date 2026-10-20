// Independent literal translation of render.cpp at asciicker 9f494f2:
// create_auto_mat (579ff), RGB555 mesh samples, auto resolve (3300–3560).
// MIT, gumix / msokalski; notice beside the production port.
import { font } from "../src/font";
export function autoMaterial() {
    const mat: number[][] = [];
    const f = Math.fround;
    for (let b = 0; b < 32; b++)
        for (let g = 0; g < 32; g++)
            for (let r = 0; r < 32; r++) {
                const flo = [r, g, b].map((x) => Math.floor((5 * x) / 31));
                const p = [r, g, b].map((x, c) => 5 * x - 31 * flo[c]);
                const R = [flo[0], Math.min(5, flo[0] + 1)],
                    G = [flo[1], Math.min(5, flo[1] + 1)],
                    B = [flo[2], Math.min(5, flo[2] + 1)];
                let best_sd = -1,
                    best_pr = 0,
                    best_lo = 0,
                    best_hi = 0;
                for (let lo = 0; lo < 7; lo++) {
                    const v0 = [R[lo & 1], G[(lo & 2) >> 1], B[(lo & 4) >> 2]];
                    const pv0 = v0.map((v, c) => flo[c] * 31 + p[c] - v * 31);
                    for (let hi = lo + 1; hi < 8; hi++) {
                        const v1 = [R[hi & 1], G[(hi & 2) >> 1], B[(hi & 4) >> 2]];
                        const v10 = v1.map((v, c) => 31 * (v - v0[c]));
                        const sq = v10[0] ** 2 + v10[1] ** 2 + v10[2] ** 2;
                        const pr = sq
                            ? f((v10[0] * pv0[0] + v10[1] * pv0[1] + v10[2] * pv0[2]) / sq)
                            : 0;
                        const prp = v10.map((v) => f(v * pr));
                        const prv = pv0.map((v, c) => f(v - prp[c]));
                        const sd = f(
                            Math.sqrt(f(f(f(prv[0] ** 2) + f(prv[1] ** 2)) + f(prv[2] ** 2))),
                        );
                        if (sd < best_sd || best_sd < 0) {
                            best_sd = sd;
                            best_pr = pr;
                            best_lo = lo;
                            best_hi = hi;
                        }
                    }
                }
                const shd = Math.max(0, Math.min(11, Math.floor(f(f(best_pr * 11) + 0.5))));
                const palette = (v: number) =>
                    16 + 36 * R[v & 1] + 6 * G[(v & 2) >> 1] + B[(v & 4) >> 2];
                mat.push(
                    shd < 6
                        ? [palette(best_lo), palette(best_hi), " ..::%".charCodeAt(shd)]
                        : [palette(best_hi), palette(best_lo), " ..::%".charCodeAt(11 - shd)],
                );
            }
    return mat;
}
export const table = autoMaterial();
export function resolve(samples: number[][]) {
    const bg = [0, 0, 0],
        bg_h = [
            [0, 0, 0],
            [0, 0, 0],
        ],
        bg_v = [
            [0, 0, 0],
            [0, 0, 0],
        ];
    let err_h = 0,
        err_v = 0;
    for (let m = 0; m < 2; m++)
        for (let i = 0; i < 4; i++)
            for (let c = 0; c < 3; c++) {
                const value = samples[i][c];
                if (m) {
                    err_h += Math.abs(bg_h[i >> 1][c] - 4 * value);
                    err_v += Math.abs(bg_v[i & 1][c] - 4 * value);
                } else {
                    bg_h[i >> 1][c] += 2 * value;
                    bg_v[i & 1][c] += 2 * value;
                    bg[c] += value;
                }
            }
    const lookup = (v: number[], bias: number) =>
        table[
            Math.floor((v[0] + bias) / 33) +
                32 * (Math.floor((v[1] + bias) / 33) + 32 * Math.floor((v[2] + bias) / 33))
        ];
    let bk = 0,
        fg = 0,
        gl = 32,
        vh_near = true;
    if (err_h * 1000 < err_v * 999) {
        vh_near = false;
        gl = 0xdf;
        bk = lookup(bg_h[0], 20)[0];
        fg = lookup(bg_h[1], 20)[0];
    } else if (err_v * 1000 < err_h * 999) {
        vh_near = false;
        gl = 0xde;
        bk = lookup(bg_v[0], 20)[0];
        fg = lookup(bg_v[1], 20)[0];
    }
    if (bk === fg || vh_near) [bk, fg, gl] = lookup(bg, 0);
    return { bk, fg, gl, err_h, err_v };
}
export function filledReference(
    input: Uint8ClampedArray,
    width: number,
    height: number,
    size: number,
) {
    const out = new Uint8Array(input.length),
        cells = [];
    for (let cy = 0; cy < height; cy += size)
        for (let cx = 0; cx < width; cx += size) {
            const samples = Array.from({ length: 4 }, (_, i) => {
                const x = Math.min(width - 1, cx + Math.floor((((i % 2) * 2 + 1) * size) / 4));
                const y = Math.min(
                    height - 1,
                    cy + Math.floor((((1 - Math.floor(i / 2)) * 2 + 1) * size) / 4),
                );
                return [0, 1, 2].map((c) => {
                    const v = input[4 * (y * width + x) + c];
                    const v5 = (v * 249 + 1014) >> 11;
                    return (v5 * 527 + 23) >> 6;
                });
            });
            const cell = resolve(samples);
            cells.push(cell);
            const rows =
                cell.gl === 0xdf
                    ? [255, 255, 255, 255, 0, 0, 0, 0]
                    : cell.gl === 0xde
                      ? Array(8).fill(240)
                      : font[cell.gl - 32];
            for (let y = cy; y < Math.min(height, cy + size); y++)
                for (let x = cx; x < Math.min(width, cx + size); x++) {
                    const ink =
                        (rows[Math.floor(((y - cy) * 8) / size)] >>
                            Math.floor(((x - cx) * 8) / size)) &
                        1;
                    const index = (ink ? cell.fg : cell.bk) - 16;
                    const rgb = [Math.floor(index / 36), Math.floor(index / 6) % 6, index % 6];
                    for (let c = 0; c < 3; c++) out[4 * (y * width + x) + c] = rgb[c] * 51;
                    out[4 * (y * width + x) + 3] = 255;
                }
        }
    return { out, cells };
}
