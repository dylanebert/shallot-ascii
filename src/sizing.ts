// Internal sizing: not re-exported by the package entry point.
export function cellPixels(
    width: number,
    height: number,
    clientWidth: number,
    _clientHeight: number,
    style: number,
    override: number,
): number {
    const ratio = clientWidth > 0 ? width / clientWidth : 1;
    if (override > 0) return Math.max(8, Math.round((override * ratio) / 8) * 8);
    if (style !== 1) return Math.max(8, Math.round(ratio) * 8);
    // asciicker FindFont, replacing its authored font list with font8x8 scales.
    const target = (7.5 * Math.hypot(width, height) * ratio) / 1000;
    let size = 8;
    for (let candidate = 16; candidate <= 40; candidate += 8) {
        if (Math.abs(candidate - target) < Math.abs(size - target)) size = candidate;
    }
    // Resize backs down until both minimum grid dimensions fit (or the smallest font).
    while (size > 8 && (Math.floor(width / size) < 45 || Math.floor(height / size) < 36)) size -= 8;
    return size;
}
