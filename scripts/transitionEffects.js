// Wipe, diamond, melt, and zoom effects adapted from Unarekin's Battle Transitions.
// Upstream MIT notice and source revision: ./vendor/battle-transitions.LICENSE.txt.
export const TRANSITION_EFFECTS = Object.freeze({
  none: "None",
  fade: "Fade",
  "wipe-left": "Wipe from left",
  "wipe-right": "Wipe from right",
  "wipe-up": "Wipe from bottom",
  "wipe-down": "Wipe from top",
  "bilinear": "Split from center",
  bars: "Alternating bars",
  clock: "Clock wipe",
  radial: "Radial wipe",
  diamond: "Diamond wipe",
  wave: "Wave wipe",
  melt: "Melt",
  pixelate: "Pixelate",
  zoom: "Zoom",
  spiral: "Spiral wipe"
});

export function normalizeTransitionEffect(value) {
  return Object.hasOwn(TRANSITION_EFFECTS, value) ? value : "fade";
}

// PIXI's filter input can be larger than the visible output rectangle. Work in
// normalized output coordinates, then map samples back into the input texture.
const FRAGMENT_HEADER = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 inputClamp;
uniform vec4 outputFrame;
uniform float progress;

vec4 sampleImage(vec2 uv) {
  vec2 coord = uv * outputFrame.zw * inputSize.zw;
  return texture2D(uSampler, clamp(coord, inputClamp.xy, inputClamp.zw));
}

float noise(vec2 point) {
  return fract(sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vTextureCoord * inputSize.xy / max(outputFrame.zw, vec2(1.0));
  if (progress <= 0.0) { gl_FragColor = vec4(0.0); return; }
  if (progress >= 1.0) { gl_FragColor = sampleImage(uv); return; }
  float threshold = uv.x;
`;

const WIPE_SHADERS = {
  "wipe-left": "threshold = uv.x;",
  "wipe-right": "threshold = 1.0 - uv.x;",
  "wipe-up": "threshold = 1.0 - uv.y;",
  "wipe-down": "threshold = uv.y;",
  bilinear: "threshold = abs(uv.x - 0.5) * 2.0;",
  bars: "threshold = mod(floor(uv.y * 12.0), 2.0) < 1.0 ? uv.x : 1.0 - uv.x;",
  clock: "threshold = fract(atan(uv.y - 0.5, uv.x - 0.5) / 6.2831853 + 0.25);",
  radial: "threshold = length(uv - 0.5) * 1.4142136;",
  diamond: `
    vec2 cell = abs(fract(uv * outputFrame.zw / 64.0) - 0.5);
    threshold = (cell.x + cell.y + uv.x) * 0.5;
  `,
  wave: "threshold = (uv.x + sin(uv.y * 25.1327412) * 0.08 + 0.08) / 1.16;",
  spiral: `
    vec2 centered = uv - 0.5;
    float angle = atan(centered.y, centered.x) / 6.2831853 + 0.5;
    threshold = fract(angle + length(centered) * 3.0);
  `
};

const OTHER_SHADERS = {
  melt: `
    float offset = 1.0 + noise(vec2(floor(uv.x * 128.0), 0.0));
    vec2 melted = uv - vec2(0.0, (1.0 - progress) * offset);
    gl_FragColor = melted.y < 0.0 ? vec4(0.0) : sampleImage(melted);
  `,
  pixelate: `
    float block = max(1.0, pow(1.0 - progress, 2.0) * 80.0);
    vec2 size = max(vec2(1.0), outputFrame.zw / block);
    vec2 pixel = (floor(uv * size) + 0.5) / size;
    gl_FragColor = sampleImage(pixel) * progress;
  `,
  zoom: `
    vec2 zoomed = (uv - 0.5) * mix(3.0, 1.0, progress) + 0.5;
    bool outside = any(lessThan(zoomed, vec2(0.0))) || any(greaterThan(zoomed, vec2(1.0)));
    gl_FragColor = outside ? vec4(0.0) : sampleImage(zoomed) * progress;
  `
};

export function createTransitionFilter(effect) {
  const type = normalizeTransitionEffect(effect);
  if (type === "none" || type === "fade") return null;
  const body = OTHER_SHADERS[type] ?? `${WIPE_SHADERS[type]}
    float edge = mix(-0.025, 1.025, progress);
    float alpha = 1.0 - smoothstep(edge - 0.02, edge + 0.02, threshold);
    gl_FragColor = sampleImage(uv) * alpha;
  `;
  return new PIXI.Filter(undefined, `${FRAGMENT_HEADER}${body}\n}`, { progress: 0 });
}

export function setTransitionProgress(displayObject, filter, progress) {
  const value = Math.min(1, Math.max(0, progress));
  displayObject.alpha = filter ? 1 : value;
  if (filter) filter.uniforms.progress = value;
}
