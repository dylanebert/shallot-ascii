// Checks a silhouette frame against the frame without Ascii for the ASCII CITY row's
// observables, and records the capture's image statistics beside the frame's, measured the
// same way over each image's cell grid; the statistics are the scene's and are not bounded.
// The frame's grid is its cell size from the origin; the capture's is fitted.
//   bun scripts/measure-silhouette.ts <ascii-city-live.png> <frame.png> <plain.png> [cellSize=8]
import { inflateSync } from "node:zlib";
import { ramp } from "../src/ramp";

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

/**
 * Line glyph, ink in a thin band along most of the cell: 1 horizontal, 2 vertical, 3 rising
 * (bottom-left to top-right), 4 falling, else 0.
 */
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
            return sign > 0 ? 4 : 3;
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
            // Core color: ink at least half the cell's peak, as chromaticity.
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
    // Line runs: line cells with a neighbor of the same kind along their tangent.
    const steps = [[], [[0, 1]], [[1, 0]], [[1, -1]], [[1, 1]]];
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
    // Color boundaries read from the drawn image: the median chromaticity of three inked fill
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
    const kinds = [1, 2, 3, 4].map((kind) => {
        let n = 0;
        for (let k = 0; k < I * J; k++) if (covered[k] && line[k] === kind) n++;
        return round(n / cells);
    });
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
        lineKinds: {
            horizontal: kinds[0],
            vertical: kinds[1],
            rising: kinds[2],
            falling: kinds[3],
        },
        lineRuns: round(running / lineCells),
        colorBoundaries: boundaries,
        boundaryContinuity: round(carried / Math.max(1, boundaries)),
    };
}

// font8x8_box.h tangent lines, keyed by the measure's line kinds.
const box: Record<number, number[]> = {
    1: [0, 0, 0, 0, 255, 0, 0, 0],
    2: [8, 8, 8, 8, 8, 8, 8, 8],
    3: [128, 64, 32, 16, 8, 4, 2, 1],
    4: [1, 2, 4, 8, 16, 32, 64, 128],
};
/**
 * Our side only: the cells the frame without Ascii shows crossed by one straight color
 * boundary; coverage, the share of them drawing the box line of that boundary's tangent; and
 * precision, the share of box-line cells that are crossed. A cell is
 * crossed when two-means on its colors splits it into sides at least 0.1 apart in RGB, each of
 * at least a row of pixels, that a straight line through the cell separates with at most a
 * tenth of either side misplaced. The capture has no frame without its renderer, so it gives no
 * such ground truth.
 */
export function boundaryCoverage(frame: Image, plain: Image, size: number) {
    const { width, height } = plain;
    let crossed = 0,
        carried = 0,
        edgeCells = 0,
        edgesCrossed = 0;
    for (let cy = 0; cy + size <= height; cy += size)
        for (let cx = 0; cx + size <= width; cx += size) {
            const colors: number[][] = [];
            for (let y = 0; y < size; y++)
                for (let x = 0; x < size; x++) {
                    const i = ((cy + y) * width + cx + x) * 3;
                    colors.push([0, 1, 2].map((c) => plain.rgb[i + c] / 255));
                }
            const drawn = Array.from({ length: size }, (_, y) => {
                let row = 0;
                for (let x = 0; x < size; x++) {
                    const i = ((cy + y) * width + cx + x) * 3;
                    if (frame.rgb[i] + frame.rgb[i + 1] + frame.rgb[i + 2]) row |= 1 << x;
                }
                return row;
            }).join();
            const kind = Number(Object.keys(box).find((k) => box[Number(k)].join() === drawn) ?? 0);
            const tangent = straightBoundary(colors, size);
            if (kind) edgeCells++;
            if (kind && tangent) edgesCrossed++;
            if (!tangent) continue;
            crossed++;
            if (kind === tangent) carried++;
        }
    return {
        crossedCells: crossed,
        edgeGlyphCells: edgeCells,
        coverage: round(carried / Math.max(1, crossed)),
        precision: round(edgesCrossed / Math.max(1, edgeCells)),
    };
}
function straightBoundary(colors: number[][], size: number) {
    const luma = colors.map((c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722);
    let a = colors[luma.indexOf(Math.min(...luma))],
        b = colors[luma.indexOf(Math.max(...luma))];
    let side: boolean[] = [];
    for (let iteration = 0; iteration < 8; iteration++) {
        side = colors.map(
            (c) =>
                Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]) <
                Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]),
        );
        const mean = (s: boolean) => {
            const members = colors.filter((_, i) => side[i] === s);
            return [0, 1, 2].map((c) => members.reduce((sum, m) => sum + m[c], 0) / members.length);
        };
        if (side.every(Boolean) || !side.some(Boolean)) return 0;
        a = mean(false);
        b = mean(true);
    }
    const minority = Math.min(side.filter(Boolean).length, side.filter((s) => !s).length);
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.1 || minority < size) return 0;
    // The separating line: normal from side a's pixel centroid to side b's, through their midpoint.
    const centroid = (s: boolean) => {
        const at = side.flatMap((v, i) => (v === s ? [[i % size, Math.floor(i / size)]] : []));
        return [0, 1].map((c) => at.reduce((sum, p) => sum + p[c], 0) / at.length);
    };
    const ca = centroid(false),
        cb = centroid(true);
    const normal = [cb[0] - ca[0], cb[1] - ca[1]];
    const project = (i: number) => (i % size) * normal[0] + Math.floor(i / size) * normal[1];
    const projections = side.map((_, i) => project(i));
    // Best threshold along the normal, then the misplaced share on each side.
    let best = Infinity;
    for (const t of projections) {
        const wrongB = side.filter((s, i) => s && projections[i] < t).length;
        const wrongA = side.filter((s, i) => !s && projections[i] >= t).length;
        best = Math.min(
            best,
            Math.max(wrongB / side.filter(Boolean).length, wrongA / side.filter((s) => !s).length),
        );
    }
    if (best > 0.1) return 0;
    // Gradient angle (y down), quantized to 45°; the tangent's line kind.
    const angle = Math.atan2(normal[1], normal[0]);
    const step = ((Math.round(angle / (Math.PI / 4)) % 4) + 4) % 4;
    return [2, 3, 1, 4][step];
}

/**
 * Second review's controls. Sparse: every inked fill cell becomes two pixels in its own ink
 * color, placed by cell position. Quartered: every channel divided by four.
 */
export function sparseControl(image: Image, size: number): Image {
    const rgb = image.rgb.slice();
    const boxes = Object.values(box).map((rows) => rows.join());
    for (let cy = 0; cy + size <= image.height; cy += size)
        for (let cx = 0; cx + size <= image.width; cx += size) {
            const rows: number[] = [];
            let color: number[] | undefined;
            for (let y = 0; y < size; y++) {
                let row = 0;
                for (let x = 0; x < size; x++) {
                    const p = ((cy + y) * image.width + cx + x) * 3;
                    if (rgb[p] + rgb[p + 1] + rgb[p + 2]) {
                        row |= 1 << x;
                        color = [rgb[p], rgb[p + 1], rgb[p + 2]];
                    }
                }
                rows.push(row);
            }
            if (!color || boxes.includes(rows.join())) continue;
            for (let y = 0; y < size; y++)
                rgb.fill(
                    0,
                    ((cy + y) * image.width + cx) * 3,
                    ((cy + y) * image.width + cx + size) * 3,
                );
            const x = (cx / size) % 4,
                y = (cy / size) % 4;
            for (const [px, py] of [
                [x, y],
                [x + 4, y + 4],
            ])
                rgb.set(color, ((cy + py) * image.width + cx + px) * 3);
        }
    return { ...image, rgb };
}
export function quarterControl(image: Image): Image {
    return { ...image, rgb: image.rgb.map((v) => v >> 2) };
}

/** The reviewer's control: each cell keeps its brightest ink pixel, other ink set to 25 gray. */
export function dimControl(image: Image, size: number): Image {
    const rgb = image.rgb.slice();
    for (let cy = 0; cy < image.height; cy += size)
        for (let cx = 0; cx < image.width; cx += size) {
            let brightest = -1,
                top = -1;
            for (let y = cy; y < Math.min(cy + size, image.height); y++)
                for (let x = cx; x < Math.min(cx + size, image.width); x++) {
                    const i = (y * image.width + x) * 3;
                    const v = Math.max(rgb[i], rgb[i + 1], rgb[i + 2]);
                    if (v > inkThreshold && v > top) {
                        top = v;
                        brightest = i;
                    }
                }
            for (let y = cy; y < Math.min(cy + size, image.height); y++)
                for (let x = cx; x < Math.min(cx + size, image.width); x++) {
                    const i = (y * image.width + x) * 3;
                    if (i !== brightest && Math.max(rgb[i], rgb[i + 1], rgb[i + 2]) > inkThreshold)
                        rgb.set([25, 25, 25], i);
                }
        }
    return { ...image, rgb };
}

// The rule's black point: plain cells under this Rec. 709 luma draw no ink.
const black = 0.12;
// The rule's ramp index is floor(sqrt((luma - black) / (1 - black)) * n + 3 * bayer), and the
// 4x4 dither reaches 3 * (0.5 - 1/32) steps down. The lowest luma at which every dithered index
// reaches at least `index`:
const ditherReach = 3 * (0.5 - 1 / 32);
const lumaFor = (index: number) => black + (1 - black) * ((index + ditherReach) / ramp.length) ** 2;
// Lit: no dithered index reaches blank (0.200).
const lit = lumaFor(1);
// Density follows luma: a lit fill cell whose luma guarantees index k inks at least ramp[k]'s
// share of the cell. From luma 0.522 that is the ramp's dense half, `*XZ0`, at least `*`'s 24
// of 64 pixels.
const dense = lumaFor(ramp.length / 2);
const guaranteedInk = (l: number) => {
    let k = 0;
    while (k + 1 < ramp.length && l >= lumaFor(k + 1)) k++;
    return ramp[k].ink / 64;
};
// Fill ink is the cell's plain mean color: within 1.5 of 255 per channel, the output's rounding
// and float headroom.
const colorTolerance = 1.5;
const ditherPeriod = 4;

/** The row's observables on our frame, read against the frame without Ascii. */
export function observables(frame: Image, plain: Image, size: number) {
    const { width, height } = plain;
    const I = Math.floor(width / size),
        J = Math.floor(height / size);
    const means: number[][] = [],
        inks: number[][][] = [],
        glyphs: string[] = [],
        kinds: number[] = [];
    for (let j = 0; j < J; j++)
        for (let i = 0; i < I; i++) {
            const sum = [0, 0, 0],
                ink: number[][] = [],
                rows: number[] = [];
            for (let y = 0; y < size; y++) {
                let row = 0;
                for (let x = 0; x < size; x++) {
                    const p = ((j * size + y) * width + i * size + x) * 3;
                    for (let c = 0; c < 3; c++) sum[c] += plain.rgb[p + c];
                    const rgb = [frame.rgb[p], frame.rgb[p + 1], frame.rgb[p + 2]];
                    if (rgb[0] + rgb[1] + rgb[2]) {
                        ink.push(rgb);
                        row |= 1 << x;
                    }
                }
                rows.push(row);
            }
            means.push(sum.map((v) => v / (size * size)));
            inks.push(ink);
            glyphs.push(rows.join());
            kinds.push(
                Number(Object.keys(box).find((k) => box[Number(k)].join() === rows.join()) ?? 0),
            );
        }
    const luma = (m: number[]) => (m[0] * 0.2126 + m[1] * 0.7152 + m[2] * 0.0722) / 255;
    const peakOf = (ink: number[][]) => Math.max(0, ...ink.map((p) => Math.max(...p)));
    let dark = 0,
        darkInked = 0,
        inked = 0,
        chromaHeld = 0,
        litCells = 0,
        litInked = 0,
        longestRun = 0,
        edgeCells = 0,
        edgeBrighter = 0,
        fillCells = 0,
        fillColorHeld = 0,
        denseCells = 0,
        denseHeld = 0,
        gradedCells = 0,
        gradedHeld = 0;
    for (let k = 0; k < I * J; k++) {
        const m = means[k],
            ink = inks[k];
        if (luma(m) < black) {
            dark++;
            if (ink.length) darkInked++;
        }
        if (luma(m) >= lit) {
            litCells++;
            if (ink.length) litInked++;
        }
        if (!kinds[k] && luma(m) >= lit) {
            gradedCells++;
            const held = ink.length >= guaranteedInk(luma(m)) * size * size;
            if (held) gradedHeld++;
            if (luma(m) >= dense) {
                denseCells++;
                if (held) denseHeld++;
            }
        }
        if (!ink.length) continue;
        inked++;
        if (!kinds[k]) {
            fillCells++;
            if (ink.every((p) => p.every((v, c) => Math.abs(v - m[c]) <= colorTolerance)))
                fillColorHeld++;
        }
        // Every ink pixel is the cell's plain color scaled: within 1.5 of 255 per channel.
        const top = Math.max(...m);
        if (ink.every((p) => p.every((v, c) => Math.abs(v - (m[c] * Math.max(...p)) / top) <= 1.5)))
            chromaHeld++;
    }
    // Flat faces: consecutive lit fill cells whose plain means stay within 2 of the run's first.
    for (let j = 0; j < J; j++) {
        let run = 0;
        for (let i = 0; i < I; i++) {
            const k = j * I + i,
                previous = k - 1;
            const continues =
                run > 0 &&
                !kinds[k] &&
                inks[k].length &&
                luma(means[k]) >= lit &&
                glyphs[k] === glyphs[previous] &&
                means[k].every((v, c) => Math.abs(v - means[k - run][c]) <= 2);
            run = continues
                ? run + 1
                : !kinds[k] && inks[k].length && luma(means[k]) >= lit
                  ? 1
                  : 0;
            longestRun = Math.max(longestRun, run);
        }
    }
    // Edge ink against the brightest neighboring fill ink.
    for (let j = 0; j < J; j++)
        for (let i = 0; i < I; i++) {
            const k = j * I + i;
            if (!kinds[k]) continue;
            let neighbor = -1;
            for (let dj = -1; dj <= 1; dj++)
                for (let di = -1; di <= 1; di++) {
                    const jj = j + dj,
                        ii = i + di;
                    if ((dj || di) && jj >= 0 && jj < J && ii >= 0 && ii < I) {
                        const n = jj * I + ii;
                        if (!kinds[n] && inks[n].length)
                            neighbor = Math.max(neighbor, peakOf(inks[n]));
                    }
                }
            if (neighbor < 0) continue;
            edgeCells++;
            if (peakOf(inks[k]) >= neighbor) edgeBrighter++;
        }
    return {
        blackGround: { darkCells: dark, inked: darkInked },
        chromaticity: { inkedCells: inked, held: round(chromaHeld / Math.max(1, inked)) },
        litInked: { litCells, inked: round(litInked / Math.max(1, litCells)) },
        fillColor: { fillCells, held: round(fillColorHeld / Math.max(1, fillCells)) },
        densityFollowsLuma: {
            litFillCells: gradedCells,
            held: round(gradedHeld / Math.max(1, gradedCells)),
            denseHalf: {
                luma: round(dense),
                cells: denseCells,
                held: round(denseHeld / Math.max(1, denseCells)),
            },
        },
        longestFlatRun: longestRun,
        boundaries: boundaryCoverage(frame, plain, size),
        edgeBrighter: { edgeCells, brighter: round(edgeBrighter / Math.max(1, edgeCells)) },
    };
}
type Observables = ReturnType<typeof observables>;
function failing(o: Observables) {
    const failures: string[] = [];
    if (o.blackGround.inked) failures.push(`${o.blackGround.inked} cells under black draw ink`);
    if (o.chromaticity.held < 0.99)
        failures.push(`chromaticity held ${o.chromaticity.held} < 0.99`);
    if (o.litInked.inked < 0.999) failures.push(`lit cells inked ${o.litInked.inked} < 0.999`);
    if (o.fillColor.held < 0.99) failures.push(`fill color held ${o.fillColor.held} < 0.99`);
    const density = o.densityFollowsLuma;
    if (density.held < 0.999) failures.push(`density follows luma ${density.held} < 0.999`);
    if (!density.denseHalf.cells || density.denseHalf.held < 0.999)
        failures.push(`dense half held ${density.denseHalf.held} of ${density.denseHalf.cells}`);
    if (o.longestFlatRun > ditherPeriod)
        failures.push(`flat run of ${o.longestFlatRun} > ${ditherPeriod}`);
    if (o.boundaries.coverage < 0.6)
        failures.push(`boundary coverage ${o.boundaries.coverage} < 0.6`);
    if (o.boundaries.precision < 0.6)
        failures.push(`boundary precision ${o.boundaries.precision} < 0.6`);
    if (o.edgeBrighter.brighter < 0.95)
        failures.push(`edges brighter ${o.edgeBrighter.brighter} < 0.95`);
    return failures;
}

// The capture's game viewport, inside its one-pixel frame at x 40, 956 and y 144, 755.
export const captureViewport = [42, 146, 955, 755] as const;

if (import.meta.main) {
    const [capturePath, framePath, plainPath, cellSize = "8"] = process.argv.slice(2);
    if (!capturePath || !framePath || !plainPath) {
        console.error(
            "usage: bun scripts/measure-silhouette.ts <ascii-city-live.png> <frame.png> <plain.png> [cellSize]",
        );
        process.exit(2);
    }
    const capturePng = decodePng(await Bun.file(capturePath).bytes());
    const viewport = crop(capturePng, ...captureViewport);
    const pitch = Number(cellSize);
    const grid: [Grid, Grid] = [
        { pitch, origin: 0 },
        { pitch, origin: 0 },
    ];
    const image = decodePng(await Bun.file(framePath).bytes());
    const plain = decodePng(await Bun.file(plainPath).bytes());
    const frame = observables(image, plain, pitch);
    const failures = failing(frame);
    // Each review control must fail, or the observables don't constrain the ink it changes.
    const controls = {
        dimmed: failing(observables(dimControl(image, pitch), plain, pitch)),
        sparse: failing(observables(sparseControl(image, pitch), plain, pitch)),
        quartered: failing(observables(quarterControl(image), plain, pitch)),
    };
    for (const [name, red] of Object.entries(controls))
        if (!red.length) failures.push(`the ${name} control passes`);
    const statistics = {
        capture: measure(viewport, fitGrid(viewport)),
        frame: measure(image, grid),
    };
    console.log(JSON.stringify({ observables: frame, failures, controls, statistics }, null, 2));
    if (failures.length) process.exit(1);
}
