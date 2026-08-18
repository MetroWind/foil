#version 300 es
// -*- mode: c; -*-
precision highp float;

#ifndef LIGHT_SAMPLE_COUNT
#define LIGHT_SAMPLE_COUNT 4
#endif
#ifndef ORDER_COUNT
#define ORDER_COUNT 4
#endif
#ifndef SPECTRAL_TAP_COUNT
#define SPECTRAL_TAP_COUNT 9
#endif
#ifndef DIFFRACTION_ORDER
#define DIFFRACTION_ORDER 0
#endif
#ifndef FOIL_INTENSITY
#define FOIL_INTENSITY 1.0
#endif
#ifndef LEVELS_BLACK_POINT
#define LEVELS_BLACK_POINT 0.0
#endif
#ifndef LEVELS_WHITE_POINT
#define LEVELS_WHITE_POINT 1.0
#endif
#ifndef LEVELS_MIDTONE
#define LEVELS_MIDTONE 1.0
#endif

const float PI = 3.14159265359;
const float BRDF_EPSILON = 0.00001;
const float MAX_GRATING_TILT_RADIANS = PI / 12.0;
const float FOIL_DISORDER = 1.0;
const float GROOVE_SPACING_MIN_UM = 0.55;
const float GROOVE_SPACING_MAX_UM = 3.20;
const float VISIBLE_WAVELENGTH_MIN_UM = 0.380;
const float VISIBLE_WAVELENGTH_MAX_UM = 0.780;
const float SPECTRAL_JACOBIAN_SCALE = 1000.0;
const float FOIL_GGX_ROUGHNESS = 0.16;
const vec3 FOIL_F_0 = vec3(0.82);
const float ZERO_ORDER_ENERGY = 0.20;
const float BASE_TOTAL_DIFFRACTION_ENERGY = 0.12;
const float BASE_TRANSMITTED_PRINT_ENERGY = 0.60;
const float FOIL_INTENSITY_VALUE = float(FOIL_INTENSITY);
const float TOTAL_DIFFRACTION_ENERGY =
    BASE_TOTAL_DIFFRACTION_ENERGY * FOIL_INTENSITY_VALUE;
const float SIGNED_DIFFRACTION_ENERGY =
    0.5 * TOTAL_DIFFRACTION_ENERGY;
const float TRANSMITTED_PRINT_ENERGY =
    BASE_TRANSMITTED_PRINT_ENERGY
    - BASE_TOTAL_DIFFRACTION_ENERGY * (FOIL_INTENSITY_VALUE - 1.0);
const float ORDER_DECAY = 3.00;
const float AMBIENT_PRINT_IRRADIANCE = 0.08;
const float EXPOSURE = 1.0;
const float GAMUT_KNEE_FRACTION = 0.55;
const float GAMUT_TARGET_FRACTION = 0.85;
const float ARTISTIC_COVERAGE_EXPONENT = 2.2;
const float LEVELS_BLACK_POINT_VALUE = float(LEVELS_BLACK_POINT);
const float LEVELS_WHITE_POINT_VALUE = float(LEVELS_WHITE_POINT);
const float LEVELS_MIDTONE_VALUE = float(LEVELS_MIDTONE);
const int MATERIAL_PHYSICAL_FOIL = 0;
const int MATERIAL_SOLID_COLOR = 1;
#if LIGHT_SAMPLE_COUNT == 2
const vec2 LIGHT_SAMPLES[LIGHT_SAMPLE_COUNT] = vec2[](
    vec2(-0.5, -0.5),
    vec2(0.5, 0.5)
);
#elif LIGHT_SAMPLE_COUNT == 4
const vec2 LIGHT_SAMPLES[LIGHT_SAMPLE_COUNT] = vec2[](
    vec2(-0.5, -0.5),
    vec2(0.5, -0.5),
    vec2(-0.5, 0.5),
    vec2(0.5, 0.5)
);
#elif LIGHT_SAMPLE_COUNT == 8
const vec2 LIGHT_SAMPLES[LIGHT_SAMPLE_COUNT] = vec2[](
    vec2(0.5, 0.0),
    vec2(0.0, 0.5),
    vec2(-0.5, 0.0),
    vec2(0.0, -0.5),
    vec2(0.612372436, 0.612372436),
    vec2(-0.612372436, 0.612372436),
    vec2(-0.612372436, -0.612372436),
    vec2(0.612372436, -0.612372436)
);
#elif LIGHT_SAMPLE_COUNT == 16
// Two staggered rings have zero centroid and mean squared radius 1/2,
// matching the first two radial moments of a uniform unit disk.
const vec2 LIGHT_SAMPLES[LIGHT_SAMPLE_COUNT] = vec2[](
    vec2(0.500000000, 0.000000000),
    vec2(0.353553391, 0.353553391),
    vec2(0.000000000, 0.500000000),
    vec2(-0.353553391, 0.353553391),
    vec2(-0.500000000, 0.000000000),
    vec2(-0.353553391, -0.353553391),
    vec2(0.000000000, -0.500000000),
    vec2(0.353553391, -0.353553391),
    vec2(0.800103145, 0.331413574),
    vec2(0.331413574, 0.800103145),
    vec2(-0.331413574, 0.800103145),
    vec2(-0.800103145, 0.331413574),
    vec2(-0.800103145, -0.331413574),
    vec2(-0.331413574, -0.800103145),
    vec2(0.331413574, -0.800103145),
    vec2(0.800103145, -0.331413574)
);
#else
#error Unsupported LIGHT_SAMPLE_COUNT
#endif

in vec2 v_texcoord;
in vec3 v_view_position;
in vec3 v_view_normal;
in vec3 v_view_tangent;
in vec3 v_view_bitangent;

uniform sampler2D u_artwork;
uniform sampler2D u_foil_control;
uniform sampler2D u_spectral_xyz;
uniform int u_material_kind;
uniform vec3 u_solid_color_srgb;
uniform vec3 u_light_position;
uniform vec3 u_light_normal;
uniform vec3 u_light_axis_x;
uniform vec3 u_light_axis_y;
uniform float u_light_radius;
uniform float u_light_radiance;

out vec4 out_color;

struct FoilControl
{
    float groove_spacing_um;
    vec2 grating_axis;
    float grating_tilt;
    float coverage;
};

// Construct finite controls that select only the ordinary printed layer.
FoilControl noFoilControl()
{
    FoilControl control;
    control.groove_spacing_um = GROOVE_SPACING_MIN_UM;
    control.grating_axis = vec2(1.0, 0.0);
    control.grating_tilt = 0.0;
    control.coverage = 0.0;
    return control;
}

// Decode display-referred artwork into the linear-light working space.
vec3 srgbToLinear(vec3 encoded)
{
    vec3 lower = encoded / 12.92;
    vec3 upper = pow((encoded + 0.055) / 1.055, vec3(2.4));
    return mix(upper, lower, lessThanEqual(encoded, vec3(0.04045)));
}

// Encode a tone-mapped linear-light value for the default sRGB framebuffer.
vec3 linearToSrgb(vec3 linear_color)
{
    vec3 lower = 12.92 * linear_color;
    vec3 upper = 1.055 * pow(linear_color, vec3(1.0 / 2.4)) - 0.055;
    return mix(upper, lower,
               lessThanEqual(linear_color, vec3(0.0031308)));
}

// Apply display-referred input Levels after the physical color pipeline.
// Midtone follows image-editor convention: values above one brighten.
vec3 applyLevels(vec3 encoded_color)
{
    float level_range = max(
        LEVELS_WHITE_POINT_VALUE - LEVELS_BLACK_POINT_VALUE,
        BRDF_EPSILON);
    vec3 normalized = clamp(
        (encoded_color - LEVELS_BLACK_POINT_VALUE) / level_range,
        0.0, 1.0);
    return pow(normalized, vec3(1.0 / LEVELS_MIDTONE_VALUE));
}

// Compress HDR luminance while preserving chromaticity for gamut mapping.
vec3 toneMap(vec3 hdr_color)
{
    float luminance = dot(hdr_color, vec3(0.2126, 0.7152, 0.0722));
    if(luminance <= 0.0)
    {
        return vec3(0.0);
    }
    float mapped_luminance = 1.0 - exp(-EXPOSURE * luminance);
    return hdr_color * mapped_luminance / luminance;
}

// Convert D65 CIE XYZ tristimulus values into linear sRGB.
vec3 xyzToLinearSrgb(vec3 xyz)
{
    const mat3 XYZ_TO_SRGB = mat3(
         3.24096994, -0.96924364,  0.05563008,
        -1.53738318,  1.87596750, -0.20397696,
        -0.49861076,  0.04155506,  1.05697151
    );
    return XYZ_TO_SRGB * xyz;
}

// Cube root with defined behavior for out-of-gamut negative LMS values.
float signedCubeRoot(float value)
{
    return sign(value) * pow(abs(value), 1.0 / 3.0);
}

// Convert linear sRGB to the perceptually uniform OKLab space.
vec3 linearSrgbToOklab(vec3 linear_rgb)
{
    vec3 lms = vec3(
        0.4122214708 * linear_rgb.r
            + 0.5363325363 * linear_rgb.g
            + 0.0514459929 * linear_rgb.b,
        0.2119034982 * linear_rgb.r
            + 0.6806995451 * linear_rgb.g
            + 0.1073969566 * linear_rgb.b,
        0.0883024619 * linear_rgb.r
            + 0.2817188376 * linear_rgb.g
            + 0.6299787005 * linear_rgb.b
    );
    vec3 root_lms = vec3(
        signedCubeRoot(lms.x),
        signedCubeRoot(lms.y),
        signedCubeRoot(lms.z));
    return vec3(
        0.2104542553 * root_lms.x
            + 0.7936177850 * root_lms.y
            - 0.0040720468 * root_lms.z,
        1.9779984951 * root_lms.x
            - 2.4285922050 * root_lms.y
            + 0.4505937099 * root_lms.z,
        0.0259040371 * root_lms.x
            + 0.7827717662 * root_lms.y
            - 0.8086757660 * root_lms.z
    );
}

// Convert OKLab back to linear sRGB without clipping its chroma.
vec3 oklabToLinearSrgb(vec3 lab)
{
    vec3 root_lms = vec3(
        lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
        lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
        lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z
    );
    vec3 lms = root_lms * root_lms * root_lms;
    return vec3(
        4.0767416621 * lms.x - 3.3077115913 * lms.y
            + 0.2309699292 * lms.z,
        -1.2684380046 * lms.x + 2.6097574011 * lms.y
            - 0.3413193965 * lms.z,
        -0.0041960863 * lms.x - 0.7034186147 * lms.y
            + 1.7076147010 * lms.z
    );
}

// Return whether a linear color lies inside the display cube.
bool isInSrgbGamut(vec3 linear_rgb)
{
    return all(greaterThanEqual(linear_rgb, vec3(0.0)))
        && all(lessThanEqual(linear_rgb, vec3(1.0)));
}

// Compress OKLab chroma at fixed perceived lightness and hue. A binary search
// finds the sRGB cusp for this hue; the soft knee maps extreme spectral colors
// to 85% of that cusp instead of clipping them to neon display primaries.
vec3 perceptualGamutMap(vec3 linear_rgb)
{
    vec3 lab = linearSrgbToOklab(linear_rgb);
    lab.x = clamp(lab.x, 0.0, 1.0);
    float chroma = length(lab.yz);
    if(chroma < BRDF_EPSILON)
    {
        return oklabToLinearSrgb(vec3(lab.x, 0.0, 0.0));
    }

    vec2 hue = lab.yz / chroma;
    float lower_chroma = 0.0;
    float upper_chroma = 0.5;
    for(int iteration = 0; iteration < 10; ++iteration)
    {
        float candidate_chroma = 0.5 * (lower_chroma + upper_chroma);
        vec3 candidate = oklabToLinearSrgb(
            vec3(lab.x, hue * candidate_chroma));
        if(isInSrgbGamut(candidate))
        {
            lower_chroma = candidate_chroma;
        }
        else
        {
            upper_chroma = candidate_chroma;
        }
    }

    float gamut_chroma = lower_chroma;
    float knee_chroma = GAMUT_KNEE_FRACTION * gamut_chroma;
    float target_chroma = GAMUT_TARGET_FRACTION * gamut_chroma;
    float mapped_chroma = chroma;
    if(chroma > knee_chroma)
    {
        float compression_range = max(
            target_chroma - knee_chroma, BRDF_EPSILON);
        float excess = (chroma - knee_chroma) / compression_range;
        mapped_chroma = knee_chroma
                      + compression_range * (1.0 - exp(-excess));
    }
    return clamp(oklabToLinearSrgb(
        vec3(lab.x, hue * mapped_chroma)), 0.0, 1.0);
}

// Introduce spectral gamut compression continuously with foil coverage. The
// early return avoids the expensive OKLab search for ordinary card regions,
// while mix() makes its limiting value equal the non-foil rendering.
vec3 applyFoilGamutMap(vec3 linear_rgb, float coverage)
{
    vec3 ordinary_rgb = clamp(linear_rgb, 0.0, 1.0);
    if(coverage <= 0.0)
    {
        return ordinary_rgb;
    }
    vec3 mapped_rgb = perceptualGamutMap(linear_rgb);
    return mix(ordinary_rgb, mapped_rgb, clamp(coverage, 0.0, 1.0));
}

// Normalize a vector without allowing a zero-length interpolation to produce
// NaNs. Callers choose a fallback appropriate to their geometric role.
vec3 safeNormalize(vec3 value, vec3 fallback)
{
    float length_squared = dot(value, value);
    if(length_squared < BRDF_EPSILON)
    {
        return fallback;
    }
    return value * inversesqrt(length_squared);
}

// Construct a stable tangent for the rare case where interpolation cancels a
// vertex tangent exactly.
vec3 orthogonalVector(vec3 normal)
{
    vec3 reference = abs(normal.z) < 0.999
                   ? vec3(0.0, 0.0, 1.0)
                   : vec3(0.0, 1.0, 0.0);
    return safeNormalize(cross(reference, normal), vec3(1.0, 0.0, 0.0));
}

// Interpolate four scalar texels with one two-dimensional weight.
float bilinear(float value_00, float value_10, float value_01,
               float value_11, vec2 weight)
{
    float lower = mix(value_00, value_10, weight.x);
    float upper = mix(value_01, value_11, weight.x);
    return mix(lower, upper, weight.y);
}

// Map the unoriented green value onto its doubled-angle unit circle.
vec2 doubledOrientation(float encoded_orientation)
{
    float doubled_angle = 2.0 * PI * encoded_orientation;
    return vec2(cos(doubled_angle), sin(doubled_angle));
}

// A physical area-coverage field would mix the ordinary and foil BRDFs
// linearly, making reflected energy proportional to the stored alpha. Tone
// mapping and sRGB encoding make small linear foil energies look much stronger
// than artists expect. For a representative full-coverage linear foil peak of
// 0.84, the unmodified display pipeline produces approximately:
//
//     Coverage    Linear foil    sRGB display value
//     1.00        0.840          0.78
//     0.10        0.084          0.32
//     0.01        0.0084         0.09
//
// Ten percent of the physical foil energy can therefore still appear about
// forty percent as bright numerically. Treat alpha as an artistic control and
// apply a display-inspired response curve so partial values fade faster. This
// deliberately breaks energy conservation with respect to the authored
// coverage value: the stored alpha is no longer a literal physical area
// fraction. The endpoint BRDFs remain energy bounded because the effective
// coverage still lies in [0, 1].
float decodeArtisticCoverage(float encoded_coverage)
{
    return pow(clamp(encoded_coverage, 0.0, 1.0),
               ARTISTIC_COVERAGE_EXPONENT);
}

// Decode the version-2 packed control texture with orientation-safe filtering.
FoilControl sampleFoilControl(vec2 texture_coord)
{
    ivec2 texture_size = textureSize(u_foil_control, 0);
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
    vec4 value_00 = texelFetch(u_foil_control, coord_00, 0);
    vec4 value_10 = texelFetch(u_foil_control, coord_10, 0);
    vec4 value_01 = texelFetch(u_foil_control, coord_01, 0);
    vec4 value_11 = texelFetch(u_foil_control, coord_11, 0);

    float encoded_spacing = bilinear(
        value_00.r, value_10.r, value_01.r, value_11.r, weight);
    float encoded_tilt = bilinear(
        value_00.b, value_10.b, value_01.b, value_11.b, weight);
    float coverage = bilinear(
        value_00.a, value_10.a, value_01.a, value_11.a, weight);

    vec2 lower_axis = mix(doubledOrientation(value_00.g),
                          doubledOrientation(value_10.g), weight.x);
    vec2 upper_axis = mix(doubledOrientation(value_01.g),
                          doubledOrientation(value_11.g), weight.x);
    vec2 doubled_axis = mix(lower_axis, upper_axis, weight.y);
    if(dot(doubled_axis, doubled_axis) < BRDF_EPSILON)
    {
        doubled_axis = doubledOrientation(value_00.g);
    }
    doubled_axis = normalize(doubled_axis);
    float grating_angle = 0.5 * atan(doubled_axis.y, doubled_axis.x);

    FoilControl control;
    control.groove_spacing_um = GROOVE_SPACING_MAX_UM * pow(
        GROOVE_SPACING_MIN_UM / GROOVE_SPACING_MAX_UM,
        encoded_spacing);
    control.grating_axis = vec2(cos(grating_angle), sin(grating_angle));
    control.grating_tilt = MAX_GRATING_TILT_RADIANS
                         * (2.0 * clamp(encoded_tilt, 0.0, 1.0) - 1.0);
    control.coverage = decodeArtisticCoverage(coverage);
    return control;
}

// Interpolate the source-weighted CIE table without float texture filtering.
vec3 sampleSpectralXyz(float wavelength_um)
{
    if(wavelength_um < VISIBLE_WAVELENGTH_MIN_UM ||
       wavelength_um > VISIBLE_WAVELENGTH_MAX_UM)
    {
        return vec3(0.0);
    }

    float position = (wavelength_um - VISIBLE_WAVELENGTH_MIN_UM) * 1000.0;
    int lower_index = min(int(floor(position)), 400);
    int upper_index = min(lower_index + 1, 400);
    float weight = position - float(lower_index);
    vec3 lower = texelFetch(u_spectral_xyz, ivec2(lower_index, 0), 0).rgb;
    vec3 upper = texelFetch(u_spectral_xyz, ivec2(upper_index, 0), 0).rgb;
    return mix(lower, upper, weight);
}

// Evaluate the isotropic GGX normal distribution.
float distributionGgx(float normal_half)
{
    float alpha_squared = FOIL_GGX_ROUGHNESS * FOIL_GGX_ROUGHNESS;
    float denominator = normal_half * normal_half
                      * (alpha_squared - 1.0) + 1.0;
    return alpha_squared
         / max(PI * denominator * denominator, BRDF_EPSILON);
}

// Evaluate height-correlated Smith visibility including the BRDF denominator.
float visibilitySmithGgx(float normal_light, float normal_view)
{
    float alpha_squared = FOIL_GGX_ROUGHNESS * FOIL_GGX_ROUGHNESS;
    float view_term = normal_light * sqrt(
        normal_view * normal_view * (1.0 - alpha_squared)
        + alpha_squared);
    float light_term = normal_view * sqrt(
        normal_light * normal_light * (1.0 - alpha_squared)
        + alpha_squared);
    return 0.5 / max(view_term + light_term, BRDF_EPSILON);
}

// Approximate neutral coating Fresnel reflectance.
vec3 fresnelSchlick(float view_half)
{
    return FOIL_F_0 + (vec3(1.0) - FOIL_F_0)
         * pow(1.0 - view_half, 5.0);
}

// Evaluate the ordinary zeroth-order reflection BRDF.
vec3 evaluateSpecularBrdf(vec3 light_direction, vec3 view_direction,
                          vec3 normal)
{
    vec3 half_sum = light_direction + view_direction;
    if(dot(half_sum, half_sum) < BRDF_EPSILON)
    {
        return vec3(0.0);
    }
    vec3 half_vector = normalize(half_sum);
    float normal_light = max(dot(normal, light_direction), 0.0);
    float normal_view = max(dot(normal, view_direction), 0.0);
    float normal_half = max(dot(normal, half_vector), 0.0);
    float view_half = max(dot(view_direction, half_vector), 0.0);
    return distributionGgx(normal_half)
         * visibilitySmithGgx(normal_light, normal_view)
         * fresnelSchlick(view_half);
}

// Evaluate the normalized cross-groove density at the fixed maximum disorder.
float crossGrooveLobe(float cross_coordinate, float source_sigma)
{
    float material_width = mix(
        0.008, 0.16, FOIL_DISORDER * FOIL_DISORDER);
    float width = sqrt(material_width * material_width
                     + source_sigma * source_sigma);
    float normalized = cross_coordinate / width;
    return exp(-0.5 * normalized * normalized)
         / (sqrt(2.0 * PI) * width);
}

// Convolve the spectrum with the fixed maximum period disorder.
vec3 sampleDisorderedSpectrum(float wavelength_um, float source_width_um)
{
#if SPECTRAL_TAP_COUNT == 1
    return sampleSpectralXyz(wavelength_um);
#elif SPECTRAL_TAP_COUNT == 3
    float relative_spread = mix(
        0.003, 0.08, FOIL_DISORDER * FOIL_DISORDER);
    float material_width_um = wavelength_um * relative_spread;
    float wavelength_width = sqrt(
        material_width_um * material_width_um
        + source_width_um * source_width_um);
    return 0.25 * sampleSpectralXyz(wavelength_um - wavelength_width)
         + 0.50 * sampleSpectralXyz(wavelength_um)
         + 0.25 * sampleSpectralXyz(wavelength_um + wavelength_width);
#elif SPECTRAL_TAP_COUNT == 9
    // A normalized binomial kernel approximates a Gaussian without allowing
    // a broad source to degenerate into three isolated spectral primaries.
    float relative_spread = mix(
        0.003, 0.08, FOIL_DISORDER * FOIL_DISORDER);
    float material_width_um = wavelength_um * relative_spread;
    float wavelength_width = sqrt(
        material_width_um * material_width_um
        + source_width_um * source_width_um);
    float step_width = wavelength_width / sqrt(2.0);
    return (sampleSpectralXyz(wavelength_um - 4.0 * step_width)
          + 8.0 * sampleSpectralXyz(wavelength_um - 3.0 * step_width)
          + 28.0 * sampleSpectralXyz(wavelength_um - 2.0 * step_width)
          + 56.0 * sampleSpectralXyz(wavelength_um - step_width)
          + 70.0 * sampleSpectralXyz(wavelength_um)
          + 56.0 * sampleSpectralXyz(wavelength_um + step_width)
          + 28.0 * sampleSpectralXyz(wavelength_um + 2.0 * step_width)
          + 8.0 * sampleSpectralXyz(wavelength_um + 3.0 * step_width)
          + sampleSpectralXyz(wavelength_um + 4.0 * step_width)) / 256.0;
#else
#error Unsupported SPECTRAL_TAP_COUNT
#endif
}

// Allocate half the nonzero-order energy to the visible signed order.
float orderEfficiency(int order_index)
{
#if DIFFRACTION_ORDER > 0
    return order_index + 1 == DIFFRACTION_ORDER
         ? SIGNED_DIFFRACTION_ENERGY
         : 0.0;
#else
    float weight_sum = 0.0;
    for(int index = 0; index < ORDER_COUNT; ++index)
    {
        weight_sum += exp(-ORDER_DECAY * float(index));
    }
    float weight = exp(-ORDER_DECAY * float(order_index));
    return SIGNED_DIFFRACTION_ENERGY * weight / weight_sum;
#endif
}

// Evaluate all supported nonzero diffraction orders in CIE XYZ.
vec3 evaluateDiffractionXyz(FoilControl control,
                            vec3 light_direction, vec3 view_direction,
                            vec3 normal, vec3 tangent, vec3 bitangent,
                            float source_sigma)
{
    vec3 grating = control.grating_axis.x * tangent
                 + control.grating_axis.y * bitangent;
    vec3 groove = -control.grating_axis.y * tangent
                + control.grating_axis.x * bitangent;
    // Tilt only the microscopic grating frame around the groove axis. The
    // macroscopic card normal still controls print lighting and visibility.
    float tilt_cosine = cos(control.grating_tilt);
    float tilt_sine = sin(control.grating_tilt);
    vec3 tilted_grating = tilt_cosine * grating + tilt_sine * normal;
    vec3 tilted_normal = tilt_cosine * normal - tilt_sine * grating;
    vec3 direction_sum = light_direction + view_direction;
    vec3 tangent_sum = direction_sum
                     - tilted_normal * dot(direction_sum, tilted_normal);
    float order_coordinate = abs(dot(tangent_sum, tilted_grating));
    float cross_coordinate = dot(tangent_sum, groove);
    float cross_response = crossGrooveLobe(
        cross_coordinate, source_sigma);
    vec3 diffraction_xyz = vec3(0.0);

    for(int order_index = 0; order_index < ORDER_COUNT; ++order_index)
    {
#if DIFFRACTION_ORDER > 0
        if(order_index + 1 != DIFFRACTION_ORDER)
        {
            continue;
        }
#endif
        float order = float(order_index + 1);
        float wavelength_um = control.groove_spacing_um
                            * order_coordinate / order;
        float source_width_um = control.groove_spacing_um
                              * source_sigma / order;
        vec3 spectral_xyz = sampleDisorderedSpectrum(
            wavelength_um, source_width_um);
        float jacobian = SPECTRAL_JACOBIAN_SCALE
                       * control.groove_spacing_um / order;
        diffraction_xyz += orderEfficiency(order_index)
                         * cross_response * jacobian
                         * spectral_xyz;
    }
    return diffraction_xyz;
}

// Evaluate nonspectral card layers without radiance or cosine factors.
vec3 evaluateOrdinaryBrdf(FoilControl control, vec3 albedo,
                          vec3 light_direction, vec3 view_direction,
                          vec3 normal)
{
    float print_energy = mix(1.0, TRANSMITTED_PRINT_ENERGY,
                             control.coverage);
    vec3 print_brdf = print_energy * albedo / PI;
    if(control.coverage > 0.0)
    {
        vec3 specular_brdf = ZERO_ORDER_ENERGY * evaluateSpecularBrdf(
            light_direction, view_direction, normal);
        print_brdf += control.coverage * specular_brdf;
    }
    return print_brdf;
}

// Integrate all BRDF components over the deterministic disk-light samples.
vec3 integrateDiskLight(FoilControl control, vec3 albedo,
                        vec3 view_direction, vec3 normal,
                        vec3 tangent, vec3 bitangent)
{
    float light_area = PI * u_light_radius * u_light_radius;
    vec3 direct_rgb = vec3(0.0);
    vec3 diffraction_xyz = vec3(0.0);

    for(int sample_index = 0;
        sample_index < LIGHT_SAMPLE_COUNT; ++sample_index)
    {
        vec2 disk_coord = LIGHT_SAMPLES[sample_index];
        vec3 sample_position = u_light_position
                             + u_light_radius
                             * (disk_coord.x * u_light_axis_x
                                + disk_coord.y * u_light_axis_y);
        vec3 to_light = sample_position - v_view_position;
        float distance_squared = dot(to_light, to_light);
        vec3 light_direction = to_light
                             * inversesqrt(max(distance_squared,
                                               BRDF_EPSILON));
        float surface_cosine = max(dot(normal, light_direction), 0.0);
        float emitter_cosine = max(dot(u_light_normal,
                                       -light_direction), 0.0);
        if(surface_cosine <= 0.0 || emitter_cosine <= 0.0)
        {
            continue;
        }

        float sample_weight = light_area / float(LIGHT_SAMPLE_COUNT)
                            * u_light_radiance * surface_cosine
                            * emitter_cosine
                            / max(distance_squared, BRDF_EPSILON);
        direct_rgb += sample_weight * evaluateOrdinaryBrdf(
            control, albedo, light_direction, view_direction, normal);
    }

    // A handful of point samples visibly duplicate a narrow rainbow. For the
    // diffraction layer, convolve one center ray with the continuous angular
    // footprint of the disk instead. A uniform disk coordinate has standard
    // deviation R/2; the distant-light angular approximation is therefore
    // R/(2D). It broadens both the cross-groove lobe and selected wavelength.
    if(control.coverage > 0.0)
    {
        vec3 center_vector = u_light_position - v_view_position;
        float center_distance_squared = dot(center_vector, center_vector);
        vec3 center_direction = center_vector * inversesqrt(
            max(center_distance_squared, BRDF_EPSILON));
        float surface_cosine = max(dot(normal, center_direction), 0.0);
        float emitter_cosine = max(dot(u_light_normal,
                                       -center_direction), 0.0);
        if(surface_cosine > 0.0 && emitter_cosine > 0.0)
        {
            float center_weight = light_area * u_light_radiance
                                * surface_cosine * emitter_cosine
                                / max(center_distance_squared,
                                      BRDF_EPSILON);
            float source_sigma = 0.5 * u_light_radius * inversesqrt(
                max(center_distance_squared, BRDF_EPSILON));
            diffraction_xyz = center_weight * control.coverage
                            * evaluateDiffractionXyz(
                                control, center_direction, view_direction,
                                normal, tangent, bitangent, source_sigma);
        }
    }

    return direct_rgb + xyzToLinearSrgb(diffraction_xyz);
}

void main()
{
    vec4 artwork_sample;
    FoilControl control;
    if(u_material_kind == MATERIAL_SOLID_COLOR)
    {
        // The shell deliberately owns no texture. A uniform branch keeps its
        // draw from sampling any of the front-only material resources.
        artwork_sample = vec4(u_solid_color_srgb, 1.0);
        control = noFoilControl();
    }
    else if(u_material_kind == MATERIAL_PHYSICAL_FOIL)
    {
        artwork_sample = texture(u_artwork, v_texcoord);
        control = sampleFoilControl(v_texcoord);
    }
    else
    {
        // Unknown modes are programming errors; magenta makes them obvious.
        artwork_sample = vec4(1.0, 0.0, 1.0, 1.0);
        control = noFoilControl();
    }
    vec3 albedo = srgbToLinear(artwork_sample.rgb);
    vec3 view_direction = safeNormalize(
        -v_view_position, vec3(0.0, 0.0, 1.0));
    vec3 normal = safeNormalize(v_view_normal, vec3(0.0, 0.0, 1.0));
    vec3 tangent = safeNormalize(
        v_view_tangent - normal * dot(v_view_tangent, normal),
        orthogonalVector(normal));
    vec3 bitangent = safeNormalize(
        v_view_bitangent - normal * dot(v_view_bitangent, normal),
        cross(normal, tangent));

    if(dot(normal, view_direction) < 0.0)
    {
        normal = -normal;
        bitangent = -bitangent;
    }

    vec3 hdr_color = integrateDiskLight(
        control, albedo, view_direction, normal, tangent, bitangent);
    float ambient_energy = mix(1.0, TRANSMITTED_PRINT_ENERGY,
                               control.coverage);
    hdr_color += AMBIENT_PRINT_IRRADIANCE * ambient_energy * albedo;

    vec3 tone_mapped = toneMap(hdr_color);
    vec3 display_linear = applyFoilGamutMap(
        tone_mapped, control.coverage);
    vec3 encoded_color = linearToSrgb(display_linear);
    out_color = vec4(applyLevels(encoded_color),
                     artwork_sample.a);
}
