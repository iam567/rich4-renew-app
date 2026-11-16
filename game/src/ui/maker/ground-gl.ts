/**
 * 自建地圖's ground, drawn by the GPU from the cells (model.ts) every time the view or a cell changes:
 *
 * - Where a point belongs: its position warped by two sizes of seeded noise, then the 3 × 3 cells round it weighed by
 *   distance — the ground with the most weight wins. Corners round off and every border wanders, so a coast or a
 *   wood painted on the grid never shows the grid's steps (the user 2026-11-11: no 「規律的鋸齒感」).
 * - Water against land: the shallows lighten toward the shore, a line of surf, then a beach of changing width.
 * - Each ground's texture: four tiles (its first and three variations, tools/tycoon-art/maker_terrain.py atlas) laid
 *   shifted, turned or flipped, one winning from place to place by slow noise, so a hundred cells show no repeat; waves,
 *   ripples, rows and bricks are only flipped (they have a direction).
 * - Edges that look placed, not pasted (the user 2026-11-12, after the original maps): a dark rim on every border
 *   between grounds; raised grounds (rock, flagstones, bricks, woods, flowers) cast a shadow down-right and catch the
 *   light top-left; sunken ones (mud, sand, desert, red earth) get an inner shadow under their top-left edge.
 */
import { CELL, DEFAULT_LIGHT, DEFAULT_TEX, DEFAULT_WOOD, GROUNDS, type MakerMap } from './model';

const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform sampler2D uCells, uAtlas;
uniform vec2 uMap, uCanvas;
uniform vec3 uView;           // world x, y at the canvas's top-left; world px per canvas px
uniform float uSeed, uCell, uGrid;
uniform vec4 uLight;          // the shadow's offset (x, y, world px), softness 0..1, strength 0..1
uniform float uRim;           // the border line's strength 0..1
uniform vec3 uTex;            // a texture tile's size in world px, its angle (radians), the randomness 0..1 (MkTex)
uniform float uPlant;         // 1: woods are planted tree by tree (woods.ts), the ground under them drawn here

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21) + uSeed * 0.0137); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float cellAt(vec2 c) {
  if (c.x < 0.0 || c.y < 0.0 || c.x >= uMap.x || c.y >= uMap.y) return 0.0;   // beyond the map: deep sea
  return floor(texture2D(uCells, (c + 0.5) / uMap).r * 255.0 + 0.5);
}
bool water(float g) { return g < 2.5; }
// raised 1, sunken -1, flat 0
float relief(float g) {
  if (g == 5.0 && uPlant > 0.5) return 0.0;      // planted trees cast their own shadows
  if (g == 12.0 || g == 14.0 || g == 16.0 || g == 5.0 || g == 6.0 || g == 13.0) return 1.0;
  if (g == 7.0 || g == 3.0 || g == 10.0 || g == 11.0 || g == 17.0) return -1.0;
  return 0.0;
}
bool directional(float g) { return g < 2.5 || g == 10.0 || g == 14.0 || g == 17.0; }

// Where a world point belongs: the winning ground, how far inside it (0 on the border .. 1), and how much land.
vec3 classify(vec2 w) {
  vec2 c = w / uCell;
  vec2 q = c + (vec2(vnoise(c * 0.33), vnoise(c * 0.33 + 17.0)) - 0.5) * 1.15
             + (vec2(vnoise(c * 1.3 + 5.0), vnoise(c * 1.3 + 41.0)) - 0.5) * 0.42;
  vec2 b = floor(q);
  float ids[9]; float ws[9];
  float land = 0.0, total = 0.0;
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    vec2 cc = b + vec2(float(i) - 1.0, float(j) - 1.0);
    float g = cellAt(cc);
    vec2 d = q - (cc + 0.5);
    float wt = exp(-dot(d, d) / 0.42);
    ids[j * 3 + i] = g; ws[j * 3 + i] = wt;
    total += wt; if (!water(g)) land += wt;
  }
  float best = 0.0, bw = -1.0, sw = 0.0;
  for (int k = 0; k < 9; k++) {
    float s = 0.0;
    for (int m = 0; m < 9; m++) if (ids[m] == ids[k]) s += ws[m];
    if (s > bw) { if (ids[k] != best) sw = bw; best = ids[k]; bw = s; }
    else if (ids[k] != best && s > sw) sw = s;
  }
  return vec3(best, clamp((bw - max(sw, 0.0)) / total, 0.0, 1.0), land / total);
}

vec3 tile(float g, float k, vec2 uv) {
  vec2 cell = vec2(mod(g, 2.0) * 4.0 + k, floor(g / 2.0));
  vec2 t = clamp(fract(uv) * 256.0, 0.75, 255.25);
  return texture2D(uAtlas, (cell * 256.0 + t) / vec2(2048.0, 2304.0)).rgb;
}
// A ground's colour: four tiles shifted, turned / flipped, one winning from place to place by slow noise.
vec3 ground(float g, vec2 w) {
  float ca = cos(uTex.y), sa = sin(uTex.y);
  vec2 u = vec2(ca * w.x + sa * w.y, -sa * w.x + ca * w.y) / uTex.x;
  bool dir = directional(g);
  vec2 v = w / 110.0 * mix(0.25, 0.9, uTex.z);   // where each tile wins: wide patches .. small ones (in world px)
  float n0 = vnoise(v * 1.1 + 3.0), n1 = vnoise(v * 0.9 + 11.0), n2 = vnoise(v * 1.3 + 29.0), n3 = vnoise(v * 0.8 + 47.0);
  float m = max(max(n0, n1), max(n2, n3));
  float r = uTex.z;
  float w0 = exp((n0 - m) * 22.0) + (1.0 - r) * 40.0, w1 = exp((n1 - m) * 22.0) * r, w2 = exp((n2 - m) * 22.0) * r, w3 = exp((n3 - m) * 22.0) * r;
  vec3 c0 = tile(g, 0.0, u);
  vec3 c1 = tile(g, 1.0, dir ? vec2(-u.x, u.y) + 0.37 : vec2(u.y, -u.x) + 0.21);
  vec3 c2 = tile(g, 2.0, dir ? u + vec2(0.53, 0.11) : -u + 0.63);
  vec3 c3 = tile(g, 3.0, dir ? vec2(-u.x, u.y) + vec2(0.17, 0.71) : vec2(-u.y, u.x) + 0.45);
  return (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / (w0 + w1 + w2 + w3);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 w = uView.xy + px * uView.z;
  vec3 k = classify(w);
  float g = k.x, inside = k.y, land = k.z;
  vec3 col;
  if (land < 0.5) {
    // water: the shallows toward the shore, then the surf
    col = ground(g, w);
    float s = smoothstep(0.12, 0.5, land);
    if (g == 0.0) col = mix(col, ground(1.0, w), s * 0.85);
    col = mix(col, vec3(0.98, 0.99, 1.0), smoothstep(0.43, 0.49, land) * (1.0 - smoothstep(0.49, 0.5, land)) * 0.75);
  } else {
    float beach = 0.58 + (vnoise(w / 70.0 + 9.0) - 0.5) * 0.14;
    if (land < beach && g != 3.0 && g != 10.0) {
      col = ground(3.0, w);
      col *= mix(0.88, 1.0, smoothstep(0.5, 0.53, land));                     // wet sand by the water
    } else {
      col = ground(g, w);
      // planted woods: grass on the edge, under the trees' shade inside (the trees themselves come over it)
      if (g == 5.0 && uPlant > 0.5) col = mix(ground(4.0, w), col * 0.42, smoothstep(0.2, 0.9, inside));
      float r = relief(g);
      // Shadows by the map's light (the user 2026-11-12: adjustable angle, length, softness, strength): what stands up
      // shades the ground on the far side of the light, what is pressed in is shaded under its near edge. Soft: the
      // average of four looks toward the light, spread along it.
      if (uLight.w > 0.0 && dot(uLight.xy, uLight.xy) > 0.01) {
        float shade = 0.0, lip = 0.0;
        for (int k = 0; k < 4; k++) {
          float t = mix(1.0, 0.35 + 0.15 * float(k), uLight.z);
          vec3 up = classify(w - uLight.xy * t);
          float s = 0.0;
          if (r < 0.0 && up.x != g && up.z >= 0.5) s = 1.0;
          if (r == 0.0 && relief(up.x) > 0.0 && up.x != g) s = 1.0;
          if (r > 0.0 && up.x != g) lip += 0.25;
          shade += s * 0.25;
        }
        col *= 1.0 - shade * 0.5 * uLight.w;
        col = mix(col, vec3(1.0), lip * 0.12 * uLight.w);                     // the lit lip of a raised ground
      }
      // the line on every border between grounds
      if (!(g == 5.0 && uPlant > 0.5)) col *= mix(1.0 - 0.45 * uRim, 1.0, smoothstep(0.0, 0.12, inside));
    }
  }
  // beyond the map: dimmed
  vec2 c = w / uCell;
  if (c.x < 0.0 || c.y < 0.0 || c.x > uMap.x || c.y > uMap.y) col *= 0.45;
  // the grid when asked (and close enough to see it)
  if (uGrid > 0.5 && uView.z < 1.2) {
    vec2 f = abs(fract(c + 0.5) - 0.5) * uCell / uView.z;
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 1.2, min(f.x, f.y))) * 0.22);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class GroundGL {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private prog!: WebGLProgram;
  private cells!: WebGLTexture;
  private atlas!: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private ready = false;
  private atlasLoaded: Promise<void>;
  grid = true;

  constructor(private m: MakerMap, atlasUrl: string, private onReady: () => void) {
    const gl = this.canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.build();
    this.atlasLoaded = this.loadAtlas(atlasUrl);
  }

  private build() {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, 'a');
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uCells', 'uAtlas', 'uMap', 'uCanvas', 'uView', 'uSeed', 'uCell', 'uGrid', 'uLight', 'uRim', 'uTex', 'uPlant']) this.u[n] = gl.getUniformLocation(p, n);
    this.cells = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cells);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.uploadCells();
  }

  private loadAtlas(url: string): Promise<void> {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => {
        const gl = this.gl;
        this.atlas = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.atlas);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        this.ready = true;
        this.onReady();
        ok();
      };
      img.onerror = () => fail(new Error(`atlas ${url}`));
      img.src = url;
    });
  }

  /** The cells changed (painting): send them to the GPU again (a few dozen KB at most). */
  uploadCells() {
    const gl = this.gl, m = this.m;
    const data = new Uint8Array(m.w * m.h * 4);
    for (let i = 0; i < m.cells.length; i++) data[i * 4] = m.cells[i];
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cells);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, m.w, m.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  /** Draws the view: world point (x, y) at the canvas's top-left, `scale` canvas px per world px. */
  draw(x: number, y: number, scale: number) {
    if (!this.ready) return;
    const gl = this.gl, c = this.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cells);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(this.u.uCells, 0); gl.uniform1i(this.u.uAtlas, 1);
    gl.uniform2f(this.u.uMap, this.m.w, this.m.h);
    gl.uniform2f(this.u.uCanvas, c.width, c.height);
    gl.uniform3f(this.u.uView, x, y, 1 / scale);
    gl.uniform1f(this.u.uSeed, this.m.seed % 9973);
    gl.uniform1f(this.u.uCell, CELL);
    gl.uniform1f(this.u.uGrid, this.grid ? 1 : 0);
    const L = { ...DEFAULT_LIGHT, ...this.m.light }, a = (L.angle * Math.PI) / 180;
    gl.uniform4f(this.u.uLight, Math.cos(a) * L.length, Math.sin(a) * L.length, L.soft, L.strength);
    gl.uniform1f(this.u.uRim, L.rim);
    const T = { ...DEFAULT_TEX, ...this.m.tex };
    gl.uniform3f(this.u.uTex, T.size, (T.angle * Math.PI) / 180, T.random);
    gl.uniform1f(this.u.uPlant, (this.m.wood?.mode ?? DEFAULT_WOOD.mode) === 0 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  get loaded() { return this.atlasLoaded; }
}

export const GROUND_NAMES = GROUNDS.map(g => g.name);
