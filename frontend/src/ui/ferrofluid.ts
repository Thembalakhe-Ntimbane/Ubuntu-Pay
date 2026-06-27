import { Renderer, Program, Mesh, Triangle } from 'ogl';
import './ferrofluid.css';

const MAX_COLORS = 8;

export interface FerrofluidOptions {
  dpr?: number;
  paused?: boolean;
  colors?: string[];
  speed?: number;
  scale?: number;
  turbulence?: number;
  fluidity?: number;
  rimWidth?: number;
  sharpness?: number;
  shimmer?: number;
  glow?: number;
  flowDirection?: 'up' | 'down' | 'left' | 'right';
  opacity?: number;
  mouseInteraction?: boolean;
  mouseStrength?: number;
  mouseRadius?: number;
  mouseDampening?: number;
  mixBlendMode?: string;
}

export interface FerrofluidHandle {
  destroy: () => void;
}

function hexToRGB(hex: string): [number, number, number] {
  const c = hex.replace('#', '').padEnd(6, '0');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return [r, g, b];
}

function prepColors(input: string[] | undefined): {
  arr: [number, number, number][];
  count: number;
  avg: [number, number, number];
} {
  const base = (input && input.length ? input : ['#4F46E5', '#06B6D4', '#E0F2FE']).slice(0, MAX_COLORS);
  const count = base.length;
  const arr: [number, number, number][] = [];
  for (let i = 0; i < MAX_COLORS; i++) {
    arr.push(hexToRGB(base[Math.min(i, base.length - 1)]));
  }
  const avg: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    avg[0] += arr[i][0];
    avg[1] += arr[i][1];
    avg[2] += arr[i][2];
  }
  avg[0] /= count;
  avg[1] /= count;
  avg[2] /= count;
  return { arr, count, avg };
}

function flowVec(d: FerrofluidOptions['flowDirection']): [number, number] {
  switch (d) {
    case 'up':    return [0, 1];
    case 'down':  return [0, -1];
    case 'left':  return [-1, 0];
    case 'right': return [1, 0];
    default:      return [0, -1];
  }
}

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `
precision highp float;

uniform vec3  iResolution;
uniform vec2  iMouse;
uniform float iTime;

uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uColor4;
uniform vec3  uColor5;
uniform vec3  uColor6;
uniform vec3  uColor7;
uniform int   uColorCount;

uniform vec3  uMouseColor;
uniform vec2  uFlow;
uniform float uSpeed;
uniform float uScale;
uniform float uTurbulence;
uniform float uFluidity;
uniform float uRimWidth;
uniform float uSharpness;
uniform float uShimmer;
uniform float uGlow;
uniform float uOpacity;
uniform float uMouseEnabled;
uniform float uMouseStrength;
uniform float uMouseRadius;

varying vec2 vUv;

#define PI 3.14159265

vec3 palette(float h) {
  int count = uColorCount;
  if (count < 1) count = 1;
  int idx = int(floor(clamp(h, 0.0, 0.999999) * float(count)));
  if (idx <= 0) return uColor0;
  if (idx == 1) return uColor1;
  if (idx == 2) return uColor2;
  if (idx == 3) return uColor3;
  if (idx == 4) return uColor4;
  if (idx == 5) return uColor5;
  if (idx == 6) return uColor6;
  return uColor7;
}

float hash(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smin(float a, float b, float k) {
  float r = exp2(-a / k) + exp2(-b / k);
  return -k * log2(r);
}

float sinlerp(float a, float b, float w) {
  return mix(a, b, (sin(w * PI - PI / 2.0) + 1.0) / 2.0);
}

float vn(vec2 p, float s, float seed) {
  vec2 cellp = floor(p / s);
  vec2 relp = mod(p, s);
  float g1 = hash(vec3(cellp, seed));
  float g2 = hash(vec3(cellp.x + 1.0, cellp.y, seed));
  float g3 = hash(vec3(cellp.x + 1.0, cellp.y + 1.0, seed));
  float g4 = hash(vec3(cellp.x, cellp.y + 1.0, seed));
  float bx = sinlerp(g1, g2, relp.x / s);
  float tx = sinlerp(g4, g3, relp.x / s);
  return sinlerp(bx, tx, relp.y / s);
}

float dbn(vec2 p, float s, float seed) {
  float o = s / 2.0;
  float n0 = vn(p, s, seed);
  float n1 = vn(p + vec2(o, o), s, seed + 0.1);
  float n2 = vn(p + vec2(-o, o), s, seed + 0.2);
  float n3 = vn(p + vec2(o, -o), s, seed + 0.3);
  float n4 = vn(p + vec2(-o, -o), s, seed + 0.4);
  return (2.0 * n0 + 1.5 * n1 + 1.25 * n2 + 1.125 * n3 + n4) / 7.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float ref = 700.0 / max(uScale, 0.05);
  vec2 p = fragCoord / iResolution.y * ref;

  float spd = 200.0 * uSpeed;
  float t = iTime;

  vec2 dir = uFlow;
  vec2 perp = vec2(-dir.y, dir.x);

  float distort1 = vn(p + perp * (t * spd), 60.0, 10.0) * 50.0 * uTurbulence;
  float distort2 = vn(p - perp * (t * spd), 120.0, 15.0) * 100.0 * uTurbulence;

  float peaks = dbn(p + distort1 + dir * (t * spd * 0.5), 40.0, 1.0);
  float peaks2 = dbn(p + distort2 - dir * (t * spd * 0.5), 40.0, 0.0);

  float mapeaks = smin(peaks, peaks2, max(uFluidity, 0.001));

  float mGlow = 0.0;
  if (uMouseEnabled > 0.5) {
    vec2 mp = iMouse / iResolution.y * ref;
    float md = length(p - mp) / ref;
    float rr = max(uMouseRadius, 0.02);
    mGlow = exp(-md * md / (rr * rr)) * uMouseStrength;
  }

  float band = (uRimWidth - abs((mapeaks - 0.4) * 2.0)) * 5.0;
  float ltn = clamp(band - vn(p + dir * (t * spd * 0.5), 60.0, 12.0) * uShimmer, 0.0, 1.0);
  ltn = pow(ltn, uSharpness) * uGlow;
  ltn *= clamp(1.0 - mGlow, 0.0, 1.0);

  float h = clamp(0.5 + (peaks - peaks2) * 0.8, 0.0, 1.0);
  vec3 col = palette(h);

  vec3 outc = col * ltn;
  float a = clamp(max(outc.r, max(outc.g, outc.b)), 0.0, 1.0);
  fragColor = vec4(outc, a * uOpacity);
}

void main() {
  vec4 color;
  mainImage(color, vUv * iResolution.xy);
  gl_FragColor = color;
}
`;

export function mountFerrofluid(
  container: HTMLElement,
  options: FerrofluidOptions = {},
): FerrofluidHandle {
  const {
    dpr,
    paused = false,
    colors = ['#ffffff', '#ffffff', '#ffffff'],
    speed = 0.5,
    scale = 1.6,
    turbulence = 1,
    fluidity = 0.1,
    rimWidth = 0.2,
    sharpness = 2.5,
    shimmer = 1.5,
    glow = 2,
    flowDirection = 'down',
    opacity = 1,
    mouseInteraction = true,
    mouseStrength = 1,
    mouseRadius = 0.35,
    mouseDampening = 0.15,
    mixBlendMode,
  } = options;

  const inner = document.createElement('div');
  inner.className = 'ferrofluid-container';
  if (mixBlendMode) inner.style.mixBlendMode = mixBlendMode;
  container.appendChild(inner);

  const renderer = new Renderer({
    dpr: dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
    alpha: true,
    antialias: true,
  });
  const gl = renderer.gl;
  const canvas = gl.canvas as HTMLCanvasElement;
  gl.clearColor(0, 0, 0, 0);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  inner.appendChild(canvas);

  const { arr, count, avg } = prepColors(colors);

  const uniforms = {
    iResolution: { value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1] as [number, number, number] },
    iMouse:      { value: [0, 0] as [number, number] },
    iTime:       { value: 0 },
    uColor0:     { value: arr[0] },
    uColor1:     { value: arr[1] },
    uColor2:     { value: arr[2] },
    uColor3:     { value: arr[3] },
    uColor4:     { value: arr[4] },
    uColor5:     { value: arr[5] },
    uColor6:     { value: arr[6] },
    uColor7:     { value: arr[7] },
    uColorCount: { value: count },
    uMouseColor: { value: avg },
    uFlow:       { value: flowVec(flowDirection) },
    uSpeed:      { value: speed },
    uScale:      { value: scale },
    uTurbulence: { value: turbulence },
    uFluidity:   { value: fluidity },
    uRimWidth:   { value: rimWidth },
    uSharpness:  { value: sharpness },
    uShimmer:    { value: shimmer },
    uGlow:       { value: glow },
    uOpacity:    { value: opacity },
    uMouseEnabled:  { value: mouseInteraction ? 1 : 0 },
    uMouseStrength: { value: mouseStrength },
    uMouseRadius:   { value: mouseRadius },
  };

  const program = new Program(gl, { vertex, fragment, uniforms });
  const geometry = new Triangle(gl);
  const mesh = new Mesh(gl, { geometry, program });

  const resize = () => {
    const rect = container.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height);
    uniforms.iResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight, 1];
  };

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const mouseTarget: [number, number] = [0, 0];
  let lastTime = 0;
  let rafId = 0;

  const onPointerMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const sc = renderer.dpr || 1;
    const x = (e.clientX - rect.left) * sc;
    const y = (rect.height - (e.clientY - rect.top)) * sc;
    mouseTarget[0] = x;
    mouseTarget[1] = y;
    if (mouseDampening <= 0) {
      uniforms.iMouse.value = [x, y];
    }
  };

  if (mouseInteraction) {
    window.addEventListener('pointermove', onPointerMove);
  }

  const loop = (t: number) => {
    rafId = requestAnimationFrame(loop);
    uniforms.iTime.value = t * 0.001;
    if (mouseDampening > 0) {
      if (!lastTime) lastTime = t;
      const dt = (t - lastTime) / 1000;
      lastTime = t;
      const tau = Math.max(1e-4, mouseDampening);
      let factor = 1 - Math.exp(-dt / tau);
      if (factor > 1) factor = 1;
      const cur = uniforms.iMouse.value;
      cur[0] += (mouseTarget[0] - cur[0]) * factor;
      cur[1] += (mouseTarget[1] - cur[1]) * factor;
    } else {
      lastTime = t;
    }
    if (!paused) {
      try {
        renderer.render({ scene: mesh });
      } catch (e) {
        console.error(e);
      }
    }
  };
  rafId = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(rafId);
      if (mouseInteraction) window.removeEventListener('pointermove', onPointerMove);
      ro.disconnect();
      if (canvas.parentElement === inner) inner.removeChild(canvas);
      if (inner.parentElement === container) container.removeChild(inner);
      const r = renderer as Renderer & { destroy?: () => void };
      const p = program as Program & { remove?: () => void };
      const g = geometry as Triangle & { remove?: () => void };
      const m = mesh as Mesh & { remove?: () => void };
      p.remove?.();
      g.remove?.();
      m.remove?.();
      r.destroy?.();
    },
  };
}
