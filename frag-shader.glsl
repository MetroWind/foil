#version 300 es
// -*- mode: c; -*-
precision highp float;

const int FOIL_KIND_WIDE_ANGLE = 0;
const int FOIL_KIND_DIRECTIONAL = 1;
const float PI = 3.14159265359;
const float TAU = 2.0 * PI;
const float REVEAL_MIN = 0.18;
const float REVEAL_MAX = 0.95;
const float WIDTH_MIN = 0.015;
const float WIDTH_MAX = 0.18;
const float PERPENDICULAR_WIDTH = 0.20;
const float VISIBLE_WAVELENGTH_MIN = 400.0;
const float VISIBLE_WAVELENGTH_MAX = 700.0;
const float REFERENCE_WAVELENGTH = 550.0;

in vec2 v_texcoord;
in vec3 v_model_position;
in vec3 v_view_position;

uniform mat4 u_view;
uniform sampler2D u_texture;
uniform sampler2D u_foil_control;
uniform int u_foil_kind;

out vec4 out_color;

struct FoilControl
{
    float reveal;
    vec2 grating_axis;
    float reveal_width;
    float coverage;
};

// Return stable pseudo-random noise for stationary foil microstructure.
float hash21(vec2 value)
{
    vec3 fraction = fract(vec3(value.xyx) * 0.1031);
    fraction += dot(fraction, fraction.yzx + 33.33);
    return fract((fraction.x + fraction.y) * fraction.z);
}

// Approximate a repeating visible spectrum with one lobe per RGB channel.
vec3 spectrum(float position)
{
    const vec3 CENTERS = vec3(0.02, 0.36, 0.67);
    const vec3 WIDTHS = vec3(0.18, 0.15, 0.16);
    vec3 distance = abs(fract(position) - CENTERS);
    distance = min(distance, 1.0 - distance);
    return exp(-0.5 * distance * distance / (WIDTHS * WIDTHS));
}

// Return three clipped parabolic lobes used by Zucconi's spectral fit.
vec3 spectralBump(vec3 position, vec3 offset)
{
    vec3 value = vec3(1.0) - position * position;
    return clamp(value - offset, 0.0, 1.0);
}

// Approximate the display-space color of a wavelength from 400 to 700 nm.
// This is Alan Zucconi's six-lobe, branchless visible-spectrum fit:
// https://www.alanzucconi.com/2017/07/15/improving-the-rainbow-2/
vec3 spectralZucconi6(float wavelength)
{
    float position = clamp(
        (wavelength - VISIBLE_WAVELENGTH_MIN)
        / (VISIBLE_WAVELENGTH_MAX - VISIBLE_WAVELENGTH_MIN),
        0.0, 1.0);
    const vec3 C_1 = vec3(3.54585104, 2.93225262, 2.41593945);
    const vec3 X_1 = vec3(0.69549072, 0.49228336, 0.27699880);
    const vec3 Y_1 = vec3(0.02312639, 0.15225084, 0.52607955);
    const vec3 C_2 = vec3(3.90307140, 3.21182957, 3.96587128);
    const vec3 X_2 = vec3(0.11748627, 0.86755042, 0.66077860);
    const vec3 Y_2 = vec3(0.84897130, 0.88445281, 0.73949448);

    return spectralBump(C_1 * (position - X_1), Y_1)
         + spectralBump(C_2 * (position - X_2), Y_2);
}

// Lighting is evaluated in approximately linear color space.
vec3 linearColor(vec3 color)
{
    return pow(max(color, vec3(0.0)), vec3(2.2));
}

vec3 displayColor(vec3 color)
{
    return pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
}

float bilinear(float value_00, float value_10, float value_01,
               float value_11, vec2 weight)
{
    float lower = mix(value_00, value_10, weight.x);
    float upper = mix(value_01, value_11, weight.x);
    return mix(lower, upper, weight.y);
}

vec2 orientationVector(float encoded_orientation)
{
    float doubled_angle = TAU * encoded_orientation;
    return vec2(cos(doubled_angle), sin(doubled_angle));
}

// Manually reconstruct the packed fields so the unoriented grating angle is
// interpolated correctly across its equivalent 0- and 180-degree values.
FoilControl sampleFoilControl(sampler2D control_texture,
                              vec2 texture_coord)
{
    ivec2 texture_size = textureSize(control_texture, 0);
    vec2 sample_position = clamp(texture_coord, 0.0, 1.0)
                         * vec2(texture_size) - 0.5;
    ivec2 lower_coord = ivec2(floor(sample_position));
    ivec2 upper_bound = texture_size - ivec2(1);
    vec2 weight = fract(sample_position);

    ivec2 coord_00 = clamp(lower_coord, ivec2(0), upper_bound);
    ivec2 coord_10 = clamp(lower_coord + ivec2(1, 0),
                           ivec2(0), upper_bound);
    ivec2 coord_01 = clamp(lower_coord + ivec2(0, 1),
                           ivec2(0), upper_bound);
    ivec2 coord_11 = clamp(lower_coord + ivec2(1, 1),
                           ivec2(0), upper_bound);

    vec4 value_00 = texelFetch(control_texture, coord_00, 0);
    vec4 value_10 = texelFetch(control_texture, coord_10, 0);
    vec4 value_01 = texelFetch(control_texture, coord_01, 0);
    vec4 value_11 = texelFetch(control_texture, coord_11, 0);

    float reveal_value = bilinear(value_00.r, value_10.r,
                                  value_01.r, value_11.r, weight);
    float width_value = bilinear(value_00.b, value_10.b,
                                 value_01.b, value_11.b, weight);
    float coverage = bilinear(value_00.a, value_10.a,
                              value_01.a, value_11.a, weight);

    vec2 axis_00 = orientationVector(value_00.g);
    vec2 axis_10 = orientationVector(value_10.g);
    vec2 axis_01 = orientationVector(value_01.g);
    vec2 axis_11 = orientationVector(value_11.g);
    vec2 lower_axis = mix(axis_00, axis_10, weight.x);
    vec2 upper_axis = mix(axis_01, axis_11, weight.x);
    vec2 doubled_axis = mix(lower_axis, upper_axis, weight.y);

    // Perpendicular axes can cancel inside a filtering footprint. In that
    // exceptional case, choose the closest texel rather than normalize zero.
    if(dot(doubled_axis, doubled_axis) < 0.000001)
    {
        vec2 nearest_lower = weight.x < 0.5 ? axis_00 : axis_10;
        vec2 nearest_upper = weight.x < 0.5 ? axis_01 : axis_11;
        doubled_axis = weight.y < 0.5 ? nearest_lower : nearest_upper;
    }
    doubled_axis = normalize(doubled_axis);
    float grating_angle = 0.5 * atan(doubled_axis.y, doubled_axis.x);

    FoilControl control;
    control.reveal = mix(REVEAL_MIN, REVEAL_MAX, reveal_value);
    control.grating_axis = vec2(cos(grating_angle),
                                sin(grating_angle));
    control.reveal_width = mix(WIDTH_MIN, WIDTH_MAX, width_value);
    control.coverage = clamp(coverage, 0.0, 1.0);
    return control;
}

vec3 evaluateDirectionalFoil(FoilControl control, vec3 base_color,
                             vec3 light_direction, vec3 view_direction,
                             vec3 normal, vec3 tangent, vec3 bitangent)
{
    vec3 grating = control.grating_axis.x * tangent
                 + control.grating_axis.y * bitangent;
    vec3 perpendicular = -control.grating_axis.y * tangent
                       + control.grating_axis.x * bitangent;

    vec3 half_sum = light_direction + view_direction;
    vec3 tangent_half = half_sum - dot(half_sum, normal) * normal;
    float u = dot(tangent_half, grating);
    float v = dot(tangent_half, perpendicular);

    float width_u = max(control.reveal_width, WIDTH_MIN);

    // Keep wavelength separation narrow along the authored sweep direction,
    // but accept a broader range of viewing directions across the grating.
    // Coupling both widths made the foil visible only in a tiny solid angle.
    float order_coordinate = abs(u);
    float lower_edge = control.reveal * VISIBLE_WAVELENGTH_MIN
                     / REFERENCE_WAVELENGTH;
    float upper_edge = control.reveal * VISIBLE_WAVELENGTH_MAX
                     / REFERENCE_WAVELENGTH;
    float lower_envelope = smoothstep(lower_edge - width_u,
                                      lower_edge, order_coordinate);
    float upper_envelope = 1.0 - smoothstep(upper_edge,
                                            upper_edge + width_u,
                                            order_coordinate);
    float local_v = v / PERPENDICULAR_WIDTH;
    float perpendicular_envelope = exp(-0.5 * local_v * local_v);
    float envelope = lower_envelope * upper_envelope
                   * perpendicular_envelope;

    // Invert the grating relation to obtain one continuous wavelength. The
    // published Zucconi6 fit approximates display-space colors, so convert it
    // to linear space before adding it to the linearly decoded artwork.
    float wavelength = REFERENCE_WAVELENGTH * order_coordinate
                     / max(control.reveal, REVEAL_MIN);
    vec3 diffraction = linearColor(spectralZucconi6(wavelength))
                     * envelope;

    float visibility = max(diffraction.r,
                           max(diffraction.g, diffraction.b));
    float normal_view = clamp(dot(normal, view_direction), 0.0, 1.0);
    float fresnel = 0.06 + 0.94 * pow(1.0 - normal_view, 5.0);

    // Outside the authored angular lobe the foil surface becomes the original
    // artwork exactly. The directional response deliberately contains no
    // neutral Phong highlight: it would wash the narrow rainbow out to white.
    vec3 foil_color = base_color * mix(1.0, 0.62, visibility);
    foil_color += diffraction * (0.82 + 0.24 * fresnel);
    return foil_color;
}

vec3 evaluateWideAngleFoil(vec3 base_color, vec3 light_direction,
                           vec3 view_direction, vec3 normal,
                           vec3 tangent, vec3 bitangent,
                           vec3 model_position)
{
    vec3 reflection = reflect(-view_direction, normal);
    vec2 reflected_slope = vec2(dot(reflection, tangent),
                                dot(reflection, bitangent));

    const float GRATING_ANGLE = 0.35;
    vec2 grating_direction = vec2(cos(GRATING_ANGLE),
                                  sin(GRATING_ANGLE));
    vec2 second_grating = vec2(-grating_direction.y,
                               grating_direction.x);
    vec2 surface_position = vec2(model_position.x, model_position.z);

    float fine_grain = hash21(floor(surface_position * 1350.0));
    float phase_a = dot(reflected_slope, grating_direction) * 2.35;
    phase_a += dot(surface_position, grating_direction) * 0.68;
    phase_a += (fine_grain - 0.5) * 0.025;
    float phase_b = dot(reflected_slope, second_grating) * 1.55;
    phase_b -= dot(surface_position, second_grating) * 0.43;

    vec3 diffraction = spectrum(phase_a);
    diffraction = mix(diffraction, spectrum(phase_b + 0.19), 0.28);

    float normal_view = clamp(dot(normal, view_direction), 0.0, 1.0);
    float fresnel = 0.06 + 0.94 * pow(1.0 - normal_view, 5.0);
    float tilt_response = smoothstep(0.03, 0.58,
                                     length(reflected_slope));
    vec3 half_direction = normalize(light_direction + view_direction);
    float highlight = pow(max(dot(normal, half_direction), 0.0), 110.0);

    float sparkle_seed = hash21(floor(surface_position * 720.0) + 19.0);
    float sparkle_mask = smoothstep(0.965, 1.0, sparkle_seed);
    float sparkle = sparkle_mask
                  * pow(max(dot(normal, half_direction), 0.0), 38.0);

    float color_strength = mix(0.27, 0.82, tilt_response);
    color_strength += fresnel * 0.18;
    vec3 foil_color = base_color * mix(0.90, 0.66, tilt_response);
    foil_color += diffraction * color_strength;
    foil_color += vec3(highlight * 0.72 + sparkle * 1.35);
    return foil_color;
}

void main()
{
    vec4 artwork_sample = texture(u_texture, v_texcoord);
    FoilControl control = sampleFoilControl(u_foil_control,
                                            v_texcoord);

    vec3 view_direction = normalize(-v_view_position);
    mat3 view_rotation = mat3(u_view);
    vec3 normal = normalize(view_rotation * vec3(0.0, -1.0, 0.0));
    vec3 tangent = normalize(view_rotation * vec3(1.0, 0.0, 0.0));
    vec3 bitangent = normalize(view_rotation * vec3(0.0, 0.0, 1.0));
    if(dot(normal, view_direction) < 0.0)
    {
        normal = -normal;
    }

    vec3 light_direction = normalize(vec3(-0.35, 0.45, 0.82));
    vec3 base_color = linearColor(artwork_sample.rgb);
    vec3 foil_color;
    if(u_foil_kind == FOIL_KIND_DIRECTIONAL)
    {
        foil_color = evaluateDirectionalFoil(
            control, base_color, light_direction, view_direction,
            normal, tangent, bitangent);
    }
    else if(u_foil_kind == FOIL_KIND_WIDE_ANGLE)
    {
        foil_color = evaluateWideAngleFoil(
            base_color, light_direction, view_direction, normal,
            tangent, bitangent, v_model_position);
    }
    else
    {
        foil_color = base_color;
    }

    vec3 final_color = mix(base_color, foil_color, control.coverage);
    out_color = vec4(displayColor(final_color), artwork_sample.a);
}
