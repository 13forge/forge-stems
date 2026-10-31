// Moonforge sky shader for the stem mixer. The moon disc mask is a smoothstep.
// launcher_sky — molten front-door sky: gradient+stars+horizon+radiant disc+rings+moon.
// Contract: Uniforms@binding(0); channels array<vec4<f32>,2>@binding(1); vs_main fullscreen tri; fs_main.
// Donors: hello_gradient(uniforms/vs), shaderbind_meter(channels/ch), sky_sun+night_sky(math).

struct Uniforms {
    resolution: vec2<f32>,
    mouse: vec2<f32>,
    time: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<uniform> channels: array<vec4<f32>, 2>;

fn ch(i: u32) -> f32 {
    return channels[i / 4u][i % 4u];
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

const BG_FAR: vec3<f32> = vec3<f32>(0.0392, 0.0275, 0.0196);
const BG_NEAR: vec3<f32> = vec3<f32>(0.1020, 0.0588, 0.0353);
const ACCENT_PRIMARY: vec3<f32> = vec3<f32>(1.0, 0.4157, 0.1020);
const ACCENT_SECONDARY: vec3<f32> = vec3<f32>(0.85, 0.55, 0.35);
const MOON_LIT: vec3<f32> = vec3<f32>(0.92, 0.90, 0.85);
const MOON_DARK: vec3<f32> = vec3<f32>(0.05, 0.04, 0.045);
const HORIZON_Y: f32 = 0.62;

fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn noise2(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let w = f * f * (3.0 - 2.0 * f);
    let a = hash2(i);
    let b = hash2(i + vec2<f32>(1.0, 0.0));
    let c = hash2(i + vec2<f32>(0.0, 1.0));
    let d = hash2(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn bg_stars(uv: vec2<f32>) -> f32 {
    let n1 = noise2(uv * 200.0);
    let n2 = noise2(uv * 400.0 + vec2<f32>(42.0, 17.0));
    let n3 = noise2(uv * 800.0 + vec2<f32>(7.0, 91.0));
    var field = smoothstep(0.82, 0.92, n1) * 0.6;
    field += smoothstep(0.88, 0.96, n2) * 1.0;
    field += smoothstep(0.93, 0.99, n3) * 1.5;
    return field;
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32((idx << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(idx & 2u) * 2.0 - 1.0;
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>(x * 0.5 + 0.5, -y * 0.5 + 0.5);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let aspect = u.resolution.x / max(u.resolution.y, 1.0);
    let star_lift = ch(0u);
    let moon_wheel = ch(1u);
    let ground_light = ch(2u);

    var color = BG_NEAR * 0.35 * smoothstep(0.35, 1.0, in.uv.y);
    color += vec3<f32>(0.9, 0.85, 0.8) * bg_stars(in.uv) * (0.15 + star_lift * 0.6);

    let horizon_dist = abs(in.uv.y - HORIZON_Y);
    let horizon_line = exp(-horizon_dist * horizon_dist * 900.0);
    color += ACCENT_SECONDARY * horizon_line * 0.22;

    let disc_center = vec2<f32>(0.82, 0.16);
    let disc_uv = vec2<f32>((in.uv.x - disc_center.x) * aspect, in.uv.y - disc_center.y);
    let disc_d = length(disc_uv);
    let pulse = 0.85 + 0.15 * sin(u.time * 0.6);
    let disc_r = 0.13 * pulse;
    let disc_core = 1.0 - smoothstep(disc_r * 0.6, disc_r * 1.5, disc_d);
    let disc_glow = exp(-disc_d * (3.2 - ground_light * 1.5)) * (0.25 + ground_light * 0.9);
    color += ACCENT_PRIMARY * (disc_core * 0.14 + disc_glow * 0.42);

    let ring_phase = fract(disc_d * 4.0 - u.time * 0.05);
    let ring = smoothstep(0.0, 0.08, ring_phase) * smoothstep(0.30, 0.12, ring_phase);
    let ring_fade = 1.0 - smoothstep(0.08, 0.38, disc_d);
    color += ACCENT_PRIMARY * ring * ring_fade * 0.035;

    let moon_center = vec2<f32>(0.82, 0.16);
    let moon_uv = vec2<f32>((in.uv.x - moon_center.x) * aspect, in.uv.y - moon_center.y);
    let moon_d = length(moon_uv);
    let moon_r = 0.045;
    let moon_mask = 1.0 - smoothstep(moon_r * 0.95, moon_r, moon_d);
    let phase_angle = moon_wheel * 6.28318;
    let terminator = moon_uv.x * cos(phase_angle) - moon_uv.y * sin(phase_angle);
    let lit = smoothstep(-0.002, 0.002, terminator);
    let moon_col = mix(MOON_DARK, MOON_LIT, lit);
    color = mix(color, moon_col, moon_mask);

    let lit_alpha = clamp(max(color.r, max(color.g, color.b)) * 1.15, 0.0, 1.0);
    let alpha = max(lit_alpha, moon_mask);
    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), alpha);
}
