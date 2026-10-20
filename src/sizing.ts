// Internal sizing: not re-exported by the package entry point.
export function cellPixels(
    width: number,
    _height: number,
    clientWidth: number,
    _clientHeight: number,
    style: number,
    override: number,
): number {
    const ratio = clientWidth > 0 ? width / clientWidth : 1;
    const logicalSize = override > 0 ? override : style === 1 ? 16 : 8;
    return Math.max(8, Math.round((logicalSize * ratio) / 8) * 8);
}
