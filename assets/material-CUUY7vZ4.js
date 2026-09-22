function e(e,{mobile:t=!1}={}){let n=e.getContext(`webgl`,{antialias:!1,alpha:!1,powerPreference:`high-performance`});if(!n||!n.getExtension(`OES_standard_derivatives`))return null;let r=(e,t)=>{let r=n.createShader(e);if(n.shaderSource(r,t),n.compileShader(r),!n.getShaderParameter(r,n.COMPILE_STATUS))throw Error(n.getShaderInfoLog(r));return r},i=n.createProgram();if(n.attachShader(i,r(n.VERTEX_SHADER,`
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`)),n.attachShader(i,r(n.FRAGMENT_SHADER,`
#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec2 uRes;
uniform float uZoom;
uniform float uTime;

// ---- noise ----
float hash(vec2 p) {
  p = mod(p, 289.0);
  p = fract(p * vec2(0.1031, 0.1030) + vec2(0.37, 0.71));
  p *= vec2(123.34, 456.21);
  p = fract(p);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Pore field: distance to nearest random feature point.
float cells(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d = 1.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(i + g), hash(i + g + 17.1));
      d = min(d, length(g + o - f));
    }
  return d;
}

// Filtered concrete height field (metres in, 0..1 out). pix = metres per pixel.
float concreteH(vec2 p, float pix) {
  float h = 0.0;
  float amp = 0.5;
  float freq = 3.0;
  float norm = 0.0;
  for (int i = 0; i < 9; i++) {
    float wl = 1.0 / freq;
    float k = clamp(wl / (pix * 3.0) - 1.0, 0.0, 1.0);
    if (k <= 0.0) break; // finer octaves are below pixel size — skip them
    h += amp * k * vnoise(p * freq + float(i) * 7.3);
    norm += amp;
    freq *= 2.35;
    amp *= 0.56;
  }
  h /= norm;
  // Air voids ~0.6–2 mm
  float kp = clamp(0.0016 / (pix * 3.0) - 1.0, 0.0, 1.0);
  if (kp > 0.0) {
    float pore = smoothstep(0.12, 0.04, cells(p * 520.0));
    float pore2 = smoothstep(0.08, 0.02, cells(p * 1300.0 + 3.1));
    h -= (pore * 0.55 + pore2 * 0.3) * kp;
  }
  return h;
}

vec3 sky(vec2 p) {
  float t = clamp(p.y / 70.0, 0.0, 1.0);
  vec3 hor = vec3(0.86, 0.64, 0.46);
  vec3 top = vec3(0.24, 0.31, 0.38);
  return mix(hor, top, pow(t, 0.6));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y; // -0.5..0.5 vertically
  float z = uZoom;
  // View height in metres: 6 cm → 64 m (log-space)
  float h = exp(mix(log(0.055), log(64.0), z));
  float pix = h / uRes.y;
  vec2 start = vec2(2.745, 11.13); // on concrete, beside a formwork tie hole
  vec2 endC = vec2(0.0, 19.0);
  float cz = smoothstep(0.15, 1.0, z);
  vec2 c = mix(start, endC, cz);
  vec2 p = c + uv * h;

  // Building extents
  float BW = 16.8; // half width
  float BH = 21.9;
  vec3 col;

  // Background: dusk sky, ground, neighbour silhouettes
  vec3 bg = sky(p);
  float gnd = step(p.y, 0.0);
  bg = mix(bg, vec3(0.13, 0.13, 0.12) + 0.03 * vnoise(p * 0.3), gnd);
  float nb = step(abs(p.x - 42.0), 12.0) * step(p.y, 14.0 + step(p.x, 40.0) * 3.0) + step(abs(p.x + 44.0), 13.0) * step(p.y, 17.5);
  bg = mix(bg, mix(vec3(0.3, 0.3, 0.31), bg, 0.55), nb * (1.0 - gnd));
  // Neighbour windows glow
  vec2 nw = fract(p / vec2(2.4, 3.2));
  float nWin = step(0.35, nw.x) * step(nw.x, 0.7) * step(0.3, nw.y) * step(nw.y, 0.75) * step(0.55, hash(floor(p / vec2(2.4, 3.2))));
  bg += vec3(1.0, 0.72, 0.42) * nWin * nb * (1.0 - gnd) * 0.35;

  float inB = step(abs(p.x), BW) * step(0.0, p.y) * step(p.y, BH);

  // ---- Facade ----
  vec2 mod_ = vec2(2.4, 3.6);
  vec2 cell = floor(p / mod_);
  vec2 f = p - cell * mod_; // local metres inside module
  // Window opening
  vec2 wMin = vec2(0.42, 0.62);
  vec2 wMax = vec2(1.98, 3.18);
  bool ground = cell.y < 0.5;
  if (ground) { wMin = vec2(0.2, 0.25); wMax = vec2(2.2, 3.25); }
  float win = step(wMin.x, f.x) * step(f.x, wMax.x) * step(wMin.y, f.y) * step(f.y, wMax.y);

  // Concrete albedo + relief lighting (normal from screen-space derivatives: one sample per pixel)
  vec2 pn = p - vec2(3.0, 12.0); // local coords keep float precision at macro scale
  float Hc = inB > 0.0 ? concreteH(pn, pix) : 0.5;
  float bump = 0.0024 / max(pix, 0.00008);
  vec3 n = normalize(vec3(-dFdx(Hc) * bump, -dFdy(Hc) * bump, 1.0));
  vec3 L = normalize(vec3(-0.65, 0.55, 0.55));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  // Panel-to-panel tone variation, like real precast
  float panelTone = (hash(cell + 3.7) - 0.5) * 0.05;
  vec3 albedo = vec3(0.72, 0.7, 0.66) * (0.9 + Hc * 0.16 + panelTone);
  // Formwork tie holes
  float tieHole = smoothstep(0.0125 + pix, 0.0125, length(mod(f - vec2(0.3, 0.3), vec2(0.6, 0.6)) - 0.3));
  vec3 conc = albedo * (0.38 + 0.78 * diff);
  conc = mix(conc, conc * 0.35, tieHole * (1.0 - win));

  // Joints (15 mm) with soft shadow on the lower edge
  vec2 jd = min(f, mod_ - f);
  float jW = 0.0075;
  float joint = 1.0 - smoothstep(jW, jW + pix * 1.5, min(jd.x, jd.y));
  conc = mix(conc, vec3(0.12, 0.12, 0.12), joint * 0.85);

  // Window: deep reveal, frame, glass with reflection + interior light
  vec2 wc = (wMin + wMax) * 0.5;
  vec2 wd = min(f - wMin, wMax - f);
  float frame = 1.0 - smoothstep(0.045, 0.045 + pix * 1.5, min(wd.x, wd.y) - 0.12);
  float mull = 1.0 - smoothstep(0.02, 0.02 + pix * 1.5, abs(f.x - wc.x));
  float lit = step(0.64, hash(cell + 11.0));
  vec3 refl = mix(vec3(0.1, 0.12, 0.14), vec3(0.42, 0.44, 0.46), smoothstep(wMin.y, wMax.y, f.y));
  refl += 0.08 * vnoise(p * 1.4 + 3.0);
  vec3 interior = vec3(0.98, 0.74, 0.5) * (0.5 + 0.2 * vnoise(p * 2.0));
  vec3 glass = mix(refl, interior, lit * 0.62);
  float frameK = max(frame, mull);
  glass = mix(glass, vec3(0.16, 0.15, 0.14), frameK);
  // Reveal shading: top & left sides of the opening are in shadow
  float topShadow = smoothstep(0.35, 0.0, wMax.y - f.y) * 0.6;
  float leftShadow = smoothstep(0.25, 0.0, f.x - wMin.x) * 0.35;
  glass *= 1.0 - max(topShadow, leftShadow) * (1.0 - frameK);
  vec3 revealCol = conc * 0.55;
  vec3 winCol = mix(glass, revealCol, 1.0 - smoothstep(0.1, 0.1 + pix * 1.5, min(wd.x, wd.y)));
  vec3 facade = mix(conc, winCol, win);

  // Timber soffit band at the top floor & entrance canopy
  float band = step(BH - 1.0, p.y) * step(p.y, BH);
  facade = mix(facade, vec3(0.5, 0.36, 0.24) * (0.8 + 0.2 * vnoise(vec2(p.x * 3.0, p.y * 40.0))), band);

  col = mix(bg, facade, inB);

  // Building contact shadow + ambient occlusion at ground
  col *= mix(1.0, 0.75, (1.0 - smoothstep(0.0, 1.2, p.y)) * step(0.0, p.y) * inB);

  // Global grade: evening warmth increases as we pull back
  float pull = smoothstep(0.4, 1.0, z);
  col = mix(col, col * vec3(1.05, 0.98, 0.9), pull);
  // Vignette + grain
  vec2 q = gl_FragCoord.xy / uRes;
  col *= mix(0.72, 1.0, smoothstep(1.05, 0.25, length(q - 0.5)));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.025;
  gl_FragColor = vec4(col, 1.0);
}
`)),n.linkProgram(i),!n.getProgramParameter(i,n.LINK_STATUS))throw Error(n.getProgramInfoLog(i));n.useProgram(i);let a=n.createBuffer();n.bindBuffer(n.ARRAY_BUFFER,a),n.bufferData(n.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),n.STATIC_DRAW);let o=n.getAttribLocation(i,`aPos`);n.enableVertexAttribArray(o),n.vertexAttribPointer(o,2,n.FLOAT,!1,0,0);let s=n.getUniformLocation(i,`uRes`),c=n.getUniformLocation(i,`uZoom`),l=n.getUniformLocation(i,`uTime`),u=t?Math.min(window.devicePixelRatio||1,1.5)*.6:Math.min(window.devicePixelRatio||1,1),d=0,f=0,p=!1,m=0,h=!0;function g(){let t=e.getBoundingClientRect();e.width=Math.max(1,Math.round(t.width*u)),e.height=Math.max(1,Math.round(t.height*u)),n.viewport(0,0,e.width,e.height),n.uniform2f(s,e.width,e.height),h=!0}function _(e){if(!p)return;m=requestAnimationFrame(_);let t=f;f+=(d-f)*.12,Math.abs(d-f)<1e-4&&(f=d),(h||t!==f)&&(h=!1,n.uniform1f(c,f),n.uniform1f(l,e*.001),n.drawArrays(n.TRIANGLES,0,3))}return g(),{resize:g,setProgress(e){d=e},start(){p||(p=!0,m=requestAnimationFrame(_))},stop(){p=!1,cancelAnimationFrame(m)}}}export{e as createMaterialScene};