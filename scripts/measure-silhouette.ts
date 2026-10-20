// Measures the ASCII CITY capture and an examples/ascii silhouette frame the same way over
// each image's cell grid, and fails when the frame falls outside the bounds named from the
// capture. The frame's grid is its cell size from the origin; the capture's is fitted.
//   bun scripts/measure-silhouette.ts <ascii-city-live.png> <frame.png> [cellSize=8]
import { inflateSync } from "node:zlib";

interface Image {
    width: number;
    height: number;
    rgb: Uint8Array;
}

/** 8-bit non-interlaced RGB or RGBA PNG. */
export function decodePng(bytes: Uint8Array): Image {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0,
        height = 0,
        channels = 0;
    const idat: Uint8Array[] = [];
    for (let at = 8; at < bytes.length; ) {
        const length = view.getUint32(at);
        const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        const data = bytes.subarray(at + 8, at + 8 + length);
        if (type === "IHDR") {
            width = view.getUint32(at + 8);
            height = view.getUint32(at + 12);
            if (data[8] !== 8 || data[12] !== 0) throw new Error("8-bit non-interlaced PNG only");
            channels = { 2: 3, 6: 4 }[data[9]] ?? 0;
            if (!channels) throw new Error("RGB or RGBA PNG only");
        } else if (type === "IDAT") idat.push(data);
        at += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        for (let x = 0; x < stride; x++) {
            const v = raw[y * (stride + 1) + 1 + x];
            const a = x >= channels ? pixels[y * stride + x - channels] : 0;
            const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
            const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
            const p = a + b - c;
            const pa = Math.abs(p - a),
                pb = Math.abs(p - b),
                pc = Math.abs(p - c);
            const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][
                filter
            ];
            pixels[y * stride + x] = v + predictor;
        }
    }
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++)
        for (let c = 0; c < 3; c++) rgb[i * 3 + c] = pixels[i * channels + c];
    return { width, height, rgb };
}

export function crop(image: Image, x0: number, y0: number, x1: number, y1: number): Image {
    const width = x1 - x0,
        height = y1 - y0;
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++)
        rgb.set(
            image.rgb.subarray(
                ((y0 + y) * image.width + x0) * 3,
                ((y0 + y) * image.width + x1) * 3,
            ),
            y * width * 3,
        );
    return { width, height, rgb };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const percentile = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

// A pixel is ink when a channel exceeds 24, as the unit's Grounding measured the capture.
const inkThreshold = 24;

interface Grid {
    pitch: number;
    origin: number;
}
/** Cell pitch from the strongest Fourier period of the ink profile; origin at its emptiest phase. */
function fitAxis(profile: Float64Array): Grid {
    const mean = profile.reduce((s, v) => s + v, 0) / profile.length;
    let pitch = 0,
        power = -1;
    for (let period = 4.5; period <= 12; period += 0.001) {
        let re = 0,
            im = 0;
        for (let x = 0; x < profile.length; x++) {
            const angle = (2 * Math.PI * x) / period;
            re += (profile[x] - mean) * Math.cos(angle);
            im -= (profile[x] - mean) * Math.sin(angle);
        }
        if (re * re + im * im > power) {
            power = re * re + im * im;
            pitch = period;
        }
    }
    let origin = 0,
        least = Infinity;
    for (let phase = 0; phase < pitch; phase += 0.25) {
        let sum = 0,
            n = 0;
        for (let x = phase; x < profile.length - 1; x += pitch, n++) sum += profile[Math.floor(x)];
        if (sum / n < least) {
            least = sum / n;
            origin = phase;
        }
    }
    return { pitch, origin };
}
function bounds(length: number, { pitch, origin }: Grid) {
    const edges = new Set<number>();
    for (let x = origin - pitch; x < length + pitch; x += pitch)
        edges.add(Math.min(length, Math.max(0, Math.round(x))));
    return [...edges].sort((a, b) => a - b);
}

/** Line glyph: 1 horizontal, 2 vertical, 3 diagonal, else 0; ink in a thin band along most of the cell. */
function lineKind(xs: number[], ys: number[], w: number, h: number) {
    if (xs.length < 3) return 0;
    const extent = (v: number[]) => Math.max(...v) - Math.min(...v) + 1;
    const distinct = (v: number[]) => new Set(v).size;
    if (extent(xs) <= Math.max(2, 0.3 * w) && distinct(ys) >= 0.75 * h) return 2;
    if (extent(ys) <= Math.max(2, 0.3 * h) && distinct(xs) >= 0.75 * w) return 1;
    for (const sign of [1, -1]) {
        const off = xs.map((x, i) => {
            const u = (x + 0.5) / w,
                v = (ys[i] + 0.5) / h;
            return Math.abs(sign > 0 ? u - v : u + v - 1);
        });
        if (Math.max(...off) <= 0.25 && distinct(xs) >= 0.6 * w && distinct(ys) >= 0.6 * h)
            return 3;
    }
    return 0;
}

const peaks = ({ width, height, rgb }: Image) => {
    const peak = new Uint8Array(width * height);
    for (let i = 0; i < peak.length; i++)
        peak[i] = Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    return peak;
};
export function fitGrid(image: Image): [Grid, Grid] {
    const { width, height } = image;
    const peak = peaks(image);
    const columns = new Float64Array(width),
        rows = new Float64Array(height);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            if (peak[y * width + x] > inkThreshold) {
                columns[x] += 1 / height;
                rows[y] += 1 / width;
            }
    return [fitAxis(columns), fitAxis(rows)];
}

export function measure(image: Image, [gridX, gridY]: [Grid, Grid]) {
    const { width, height, rgb } = image;
    const peak = peaks(image);
    const xb = bounds(width, gridX),
        yb = bounds(height, gridY);
    const I = xb.length - 1,
        J = yb.length - 1;
    const count = new Int32Array(I * J),
        density = new Float64Array(I * J),
        cellPeak = new Float64Array(I * J),
        chroma = new Float64Array(I * J * 3),
        line = new Uint8Array(I * J);
    for (let j = 0; j < J; j++)
        for (let i = 0; i < I; i++) {
            const k = j * I + i,
                w = xb[i + 1] - xb[i],
                h = yb[j + 1] - yb[j];
            const xs: number[] = [],
                ys: number[] = [];
            let top = 0;
            for (let y = yb[j]; y < yb[j + 1]; y++)
                for (let x = xb[i]; x < xb[i + 1]; x++) {
                    const v = peak[y * width + x];
                    if (v > inkThreshold) {
                        xs.push(x - xb[i]);
                        ys.push(y - yb[j]);
                        top = Math.max(top, v);
                    }
                }
            count[k] = xs.length;
            density[k] = xs.length / Math.max(1, w * h);
            cellPeak[k] = top;
            line[k] = lineKind(xs, ys, w, h);
            // Core colour: ink at least half the cell's peak, as chromaticity.
            const sum = [0, 0, 0];
            for (let n = 0; n < xs.length; n++) {
                const p = (yb[j] + ys[n]) * width + xb[i] + xs[n];
                if (peak[p] * 2 >= top) for (let c = 0; c < 3; c++) sum[c] += rgb[p * 3 + c];
            }
            const max = Math.max(...sum, 1);
            for (let c = 0; c < 3; c++) chroma[k * 3 + c] = sum[c] / max;
        }
    // Covered cells: inside both the row's and the column's span of inked cells.
    const covered = new Uint8Array(I * J);
    const span = (n: number, inked: (t: number) => boolean) => {
        const hits = Array.from({ length: n }, (_, t) => t).filter(inked);
        return hits.length ? [hits[0], hits[hits.length - 1]] : [-1, -1];
    };
    const spans = Array.from({ length: J }, (_, j) => span(I, (i) => count[j * I + i] > 0));
    const columnSpans = Array.from({ length: I }, (_, i) => span(J, (j) => count[j * I + i] > 0));
    for (let j = 0; j < J; j++)
        for (let i = 0; i < I; i++) {
            const [a, b] = spans[j],
                [c, e] = columnSpans[i];
            if (a >= 0 && i >= a && i <= b && j >= c && j <= e) covered[j * I + i] = 1;
        }
    let area = 0,
        inkPixels = 0;
    const pixelPeaks: number[] = [],
        cellPeaks: number[] = [];
    let cells = 0,
        blank = 0,
        sparse = 0,
        dense = 0,
        lines = 0;
    for (let j = 0; j < J; j++)
        for (let i = 0; i < I; i++) {
            const k = j * I + i;
            if (!covered[k]) continue;
            cells++;
            area += (xb[i + 1] - xb[i]) * (yb[j + 1] - yb[j]);
            inkPixels += count[k];
            for (let y = yb[j]; y < yb[j + 1]; y++)
                for (let x = xb[i]; x < xb[i + 1]; x++)
                    if (peak[y * width + x] > inkThreshold) pixelPeaks.push(peak[y * width + x]);
            if (count[k]) cellPeaks.push(cellPeak[k]);
            if (density[k] < 0.1) blank++;
            else if (density[k] < 0.3) sparse++;
            else dense++;
            if (line[k]) lines++;
        }
    // Broken fill: adjacent non-line covered cells whose ink densities differ by 0.1 or more.
    let pairs = 0,
        differing = 0;
    for (let j = 0; j < J; j++)
        for (let i = 0; i + 1 < I; i++) {
            const a = j * I + i;
            if (covered[a] && covered[a + 1] && !line[a] && !line[a + 1]) {
                pairs++;
                if (Math.abs(density[a] - density[a + 1]) >= 0.1) differing++;
            }
        }
    // Line runs: line cells with a neighbour of the same kind along their tangent.
    const steps = [
        [],
        [[0, 1]],
        [[1, 0]],
        [
            [1, 1],
            [1, -1],
        ],
    ];
    let lineCells = 0,
        running = 0;
    for (let j = 0; j < J; j++)
        for (let i = 0; i < I; i++) {
            const kind = line[j * I + i];
            if (!kind || !covered[j * I + i]) continue;
            lineCells++;
            const runs = steps[kind].some(([dj, di]) =>
                [1, -1].some((s) => {
                    const jj = j + s * dj,
                        ii = i + s * di;
                    return jj >= 0 && jj < J && ii >= 0 && ii < I && line[jj * I + ii] === kind;
                }),
            );
            if (runs) running++;
        }
    // Colour boundaries read from the drawn image: the median chromaticity of three inked fill
    // cells on each side differs by more than 0.25; carried when either cell at it is a line.
    const median = (cells: number[]) => {
        if (cells.length < 2) return null;
        return [0, 1, 2].map((c) =>
            percentile(
                cells.map((k) => chroma[k * 3 + c]),
                50,
            ),
        );
    };
    let boundaries = 0,
        carried = 0;
    for (let j = 0; j < J; j++)
        for (let i = 0; i < I; i++) {
            if (!covered[j * I + i]) continue;
            for (const [dj, di] of [
                [0, 1],
                [1, 0],
            ]) {
                const side = (s: number, t0: number) => {
                    const cells: number[] = [];
                    for (let t = t0; t < t0 + 3; t++) {
                        const jj = j + s * dj * t,
                            ii = i + s * di * t;
                        const k = jj * I + ii;
                        if (
                            jj >= 0 &&
                            jj < J &&
                            ii >= 0 &&
                            ii < I &&
                            count[k] &&
                            covered[k] &&
                            !line[k]
                        )
                            cells.push(k);
                    }
                    return median(cells);
                };
                const a = side(-1, 0),
                    b = side(1, 1);
                if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 0.25) continue;
                boundaries++;
                const jj = j + dj,
                    ii = i + di;
                if (line[j * I + i] || (jj < J && ii < I && line[jj * I + ii])) carried++;
            }
        }
    return {
        grid: { columns: I, rows: J, pitch: [round(gridX.pitch), round(gridY.pitch)] },
        coveredCells: cells,
        inkCoverage: round(inkPixels / area),
        inkPixelPeak: [10, 50, 90].map((p) => percentile(pixelPeaks, p)),
        inkCellPeak: [10, 50, 90].map((p) => percentile(cellPeaks, p)),
        fill: {
            blank: round(blank / cells),
            sparse: round(sparse / cells),
            dense: round(dense / cells),
        },
        fillVariation: round(differing / pairs),
        lineCells: round(lines / cells),
        lineRuns: round(running / lineCells),
        colourBoundaries: boundaries,
        boundaryContinuity: round(carried / Math.max(1, boundaries)),
    };
}

type Measures = ReturnType<typeof measure>;
// Bounded measures, each the capture's value ±30%. Pixel-level peaks are recorded only: the
// capture's antialiased font puts its 10th percentile at edge pixels a bitmap glyph lacks.
// Line-cell share and colour-boundary continuity are recorded only: the first follows the
// scene's edge-to-area ratio, and the capture draws its boundaries in the face's own colour,
// so its colour boundaries are mostly window-fill variation, not faces.
const bounded: [string, (m: Measures) => number][] = [
    ["inkCoverage", (m) => m.inkCoverage],
    ["inkCellPeak p50", (m) => m.inkCellPeak[1]],
    ["inkCellPeak p90", (m) => m.inkCellPeak[2]],
    ["fill dense", (m) => m.fill.dense],
    ["fillVariation", (m) => m.fillVariation],
    ["lineRuns", (m) => m.lineRuns],
];

// The capture's game viewport, inside its one-pixel frame at x 40, 956 and y 144, 755.
export const captureViewport = [42, 146, 955, 755] as const;

if (import.meta.main) {
    const [capturePath, framePath, cellSize = "8"] = process.argv.slice(2);
    if (!capturePath || !framePath) {
        console.error(
            "usage: bun scripts/measure-silhouette.ts <ascii-city-live.png> <frame.png> [cellSize]",
        );
        process.exit(2);
    }
    const capturePng = decodePng(await Bun.file(capturePath).bytes());
    const viewport = crop(capturePng, ...captureViewport);
    const capture = measure(viewport, fitGrid(viewport));
    const size = { pitch: Number(cellSize), origin: 0 };
    const frame = measure(decodePng(await Bun.file(framePath).bytes()), [size, size]);
    const failures = bounded.flatMap(([name, get]) => {
        const reference = get(capture),
            value = get(frame);
        const low = reference * 0.7,
            high = Math.min(name === "lineRuns" ? 1 : Infinity, reference * 1.3);
        return value >= low && value <= high
            ? []
            : [`${name} ${value} outside [${round(low)}, ${round(high)}]`];
    });
    console.log(JSON.stringify({ capture, frame, failures }, null, 2));
    if (failures.length) process.exit(1);
}
