#version 300 es
// -*- mode: c; -*-
precision highp float;

const float PI = 3.14159265359;
const float TAU = 2.0 * PI;

in vec2 v_texcoord;
in vec3 v_model_position;
in vec3 v_view_position;

uniform mat4 u_view;
uniform sampler2D u_texture;
uniform sampler2D u_foil_mask;

out vec4 out_color;

// Return stable pseudo-random noise for a two-dimensional cell. The foil uses
// this for stationary microstructure, so it does not shimmer with time.
float hash21(vec2 value)
{
    vec3 fraction = fract(vec3(value.xyx) * 0.1031);
    fraction += dot(fraction, fraction.yzx + 33.33);
    return fract((fraction.x + fraction.y) * fraction.z);
}

// Approximate a repeating visible spectrum with one Gaussian lobe per output
// channel. A periodic spectrum avoids a discontinuity between foil bands.
vec3 spectrum(float position)
{
    const vec3 CENTERS = vec3(0.02, 0.36, 0.67);
    const vec3 WIDTHS = vec3(0.18, 0.15, 0.16);
    vec3 distance = abs(fract(position) - CENTERS);
    distance = min(distance, 1.0 - distance);
    return exp(-0.5 * distance * distance / (WIDTHS * WIDTHS));
}

// Texture images arrive in display (approximately sRGB) space. Lighting and
// additive reflections must instead be evaluated in linear color space.
vec3 linearColor(vec3 color)
{
    return pow(max(color, vec3(0.0)), vec3(2.2));
}

vec3 displayColor(vec3 color)
{
    return pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
}

void main()
{
    vec4 base_sample = texture(u_texture, v_texcoord);
    vec3 mask = texture(u_foil_mask, v_texcoord).rgb;

    // Green is the authored foil coverage. Smooth edges tolerate filtering and
    // mipmapping without producing a hard halo around the foil region.
    float coverage = smoothstep(0.04, 0.72, mask.g);

    // Express the reflected view ray in the card's tangent space. This makes
    // the diffraction pattern follow the card as it rotates instead of being
    // fixed to the screen.
    vec3 view_direction = normalize(-v_view_position);
    mat3 view_rotation = mat3(u_view);
    vec3 normal = normalize(view_rotation * vec3(0.0, -1.0, 0.0));
    vec3 tangent = normalize(view_rotation * vec3(1.0, 0.0, 0.0));
    vec3 bitangent = normalize(view_rotation * vec3(0.0, 0.0, 1.0));
    if(dot(normal, view_direction) < 0.0)
    {
        normal = -normal;
    }

    vec3 reflection = reflect(-view_direction, normal);
    vec2 reflected_slope = vec2(dot(reflection, tangent),
                                dot(reflection, bitangent));

    // Red stores a local grating orientation. It lets different authored foil
    // regions split light in different directions.
    float grating_angle = mask.r * TAU + 0.35;
    vec2 grating_direction = vec2(cos(grating_angle),
                                  sin(grating_angle));
    vec2 second_grating = vec2(-grating_direction.y,
                               grating_direction.x);

    vec2 surface_position = vec2(v_model_position.x,
                                 v_model_position.z);

    // The angular terms make colors move when the card tilts. The smaller
    // spatial terms spread a rainbow across the flat card at any one angle.
    // Fine grain breaks up mathematically perfect bands without adding motion.
    float fine_grain = hash21(floor(surface_position * 1350.0));
    float phase_a = dot(reflected_slope, grating_direction) * 2.35;
    phase_a += dot(surface_position, grating_direction) * 0.68;
    phase_a += (fine_grain - 0.5) * 0.025;
    float phase_b = dot(reflected_slope, second_grating) * 1.55;
    phase_b -= dot(surface_position, second_grating) * 0.43;

    vec3 diffraction = spectrum(phase_a);
    diffraction = mix(diffraction, spectrum(phase_b + 0.19), 0.28);

    // Fresnel models the sharp reflectivity increase near grazing angles. The
    // demo has a limited tilt range, so a separate response makes diffraction
    // visible at the moderate angles a user can actually reach.
    float normal_view = clamp(dot(normal, view_direction), 0.0, 1.0);
    float fresnel = 0.06 + 0.94 * pow(1.0 - normal_view, 5.0);
    float tilt_response = smoothstep(0.03, 0.58,
                                     length(reflected_slope));
    vec3 light_direction = normalize(vec3(-0.35, 0.45, 0.82));
    vec3 half_direction = normalize(light_direction + view_direction);
    float highlight = pow(max(dot(normal, half_direction), 0.0), 110.0);

    // Only a small, deterministic subset of surface cells becomes a glint.
    // Their broad angular response resembles microscopic foil facets.
    float sparkle_seed = hash21(floor(surface_position * 720.0) + 19.0);
    float sparkle_mask = smoothstep(0.965, 1.0, sparkle_seed);
    float sparkle = sparkle_mask * pow(max(dot(normal, half_direction), 0.0),
                                       38.0);

    // Preserve the printed artwork beneath the foil, dim it slightly as the
    // reflection strengthens, then add spectral and neutral reflections.
    vec3 base_color = linearColor(base_sample.rgb);
    float color_strength = mix(0.27, 0.82, tilt_response);
    color_strength += fresnel * 0.18;
    vec3 foil_color = base_color * mix(0.90, 0.66, tilt_response);
    foil_color += diffraction * color_strength;
    foil_color += vec3(highlight * 0.72 + sparkle * 1.35);

    // Non-foil pixels remain exactly the base artwork. Convert the completed
    // lighting result back to display color space only once, at the end.
    vec3 final_color = mix(base_color, foil_color, coverage);
    out_color = vec4(displayColor(final_color), base_sample.a);
}
