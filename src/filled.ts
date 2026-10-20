// Port of create_auto_mat and the auto-material resolve in asciicker render.cpp,
// 9f494f2. See asciicker-NOTICE (MIT, gumix / msokalski).
import { font } from "./font";

// font8x8_block.h, Daniel Hepper, public domain; see font8x8-NOTICE.
export const filledRows = [
    font[0],
    font[14],
    font[26],
    font[5],
    [255, 255, 255, 255, 0, 0, 0, 0],
    [240, 240, 240, 240, 240, 240, 240, 240],
].flat();

/** RGB555 indexed, packed background | foreground << 8 | bitmap index << 16. */
export function createAutoMat() {
    const mat = new Uint32Array(32768);
    const f = Math.fround;
    for (let b = 0; b < 32; b++)
        for (let g = 0; g < 32; g++)
            for (let r = 0; r < 32; r++) {
                const rgb = [r, g, b];
                const low = rgb.map((x) => Math.floor((5 * x) / 31));
                const high = low.map((x) => Math.min(5, x + 1));
                const vertex = (n: number) => low.map((x, c) => (n & (1 << c) ? high[c] : x));
                let bestSd = -1,
                    bestPr = 0,
                    bestLo = 0,
                    bestHi = 0;
                for (let lo = 0; lo < 7; lo++) {
                    const v0 = vertex(lo),
                        pv0 = rgb.map((x, c) => 5 * x - v0[c] * 31);
                    for (let hi = lo + 1; hi < 8; hi++) {
                        const v1 = vertex(hi),
                            v10 = v1.map((x, c) => 31 * (x - v0[c]));
                        const len = v10.reduce((s, x) => s + x * x, 0);
                        const pr = len ? f(v10.reduce((s, x, c) => s + x * pv0[c], 0) / len) : 0;
                        const prv = pv0.map((x, c) => f(x - f(v10[c] * pr)));
                        const sd = f(
                            Math.sqrt(
                                f(f(f(prv[0] * prv[0]) + f(prv[1] * prv[1])) + f(prv[2] * prv[2])),
                            ),
                        );
                        if (sd < bestSd || bestSd < 0) {
                            bestSd = sd;
                            bestPr = pr;
                            bestLo = lo;
                            bestHi = hi;
                        }
                    }
                }
                const shade = Math.max(0, Math.min(11, Math.floor(f(f(bestPr * 11) + 0.5))));
                const palette = (n: number) => {
                    const v = vertex(n);
                    return 16 + 36 * v[0] + 6 * v[1] + v[2];
                };
                const bg = palette(shade < 6 ? bestLo : bestHi),
                    fg = palette(shade < 6 ? bestHi : bestLo);
                const gl = [0, 1, 1, 2, 2, 3][shade < 6 ? shade : 11 - shade];
                mat[r + 32 * (g + 32 * b)] = bg | (fg << 8) | (gl << 16);
            }
    return mat;
}

// Samples are the centres of the cell's quadrants, clamped at partial edges.
// Upstream's sample rows run bottom-up. Its lighting/reflection has already
// happened at this after-tonemapping boundary; RGB555 conversion remains.
export const filledBody = `(position: vec4f, image: texture_2d<f32>, cellSize: u32) -> vec4f {
    const rows = array<u32, 48>(${filledRows.map((x) => `${x}u`).join(",")});
    let pixel=vec2u(position.xy);
    let size=max(cellSize,1u);
    let origin=pixel/size*size;
    var samples: array<vec3i,4>;
    var bg=vec3i(0);
    var bh: array<vec3i,2>;
    var bv: array<vec3i,2>;
    for(var i=0u;i<4u;i++) {
        let q=vec2u(i%2u,1u-i/2u);
        let p=min(origin+(q*2u+1u)*size/4u,textureDimensions(image)-1u);
        let rgb=vec3u(round(textureLoad(image,p,0).rgb*255.0));
        let rgb5=(rgb*249u+1014u)>>vec3u(11u);
        let c=vec3i((rgb5*527u+23u)>>vec3u(6u));
        samples[i]=c;
        bg+=c;
        bh[i/2u]+=2*c;
        bv[i%2u]+=2*c;
    }
    var eh=0;
    var ev=0;
    for(var i=0u;i<4u;i++) {
        let h=abs(bh[i/2u]-4*samples[i]);
        let v=abs(bv[i%2u]-4*samples[i]);
        eh+=h.x+h.y+h.z;
        ev+=v.x+v.y+v.z;
    }
    var bk=0u; var fg=0u; var gl=0u;
    var near=true;
    if(eh*1000<ev*999) {
        near=false; gl=4u;
        let a=vec3u((bh[0]+20)/33); let b=vec3u((bh[1]+20)/33);
        bk=layout.$.table[a.x+32u*(a.y+32u*a.z)]&255u;
        fg=layout.$.table[b.x+32u*(b.y+32u*b.z)]&255u;
    } else if(ev*1000<eh*999) {
        near=false; gl=5u;
        let a=vec3u((bv[0]+20)/33); let b=vec3u((bv[1]+20)/33);
        bk=layout.$.table[a.x+32u*(a.y+32u*a.z)]&255u;
        fg=layout.$.table[b.x+32u*(b.y+32u*b.z)]&255u;
    }
    if(bk==fg || near) {
        let a=vec3u(bg/33);
        let entry=layout.$.table[a.x+32u*(a.y+32u*a.z)];
        bk=entry&255u; fg=(entry>>8u)&255u; gl=entry>>16u;
    }
    let local=(pixel%size)*8u/size;
    let ink=(rows[gl*8u+local.y]>>local.x)&1u;
    let index=select(bk,fg,ink==1u)-16u;
    return vec4f(vec3f(f32(index/36u),f32(index/6u%6u),f32(index%6u))/5.0,1);
}`;
