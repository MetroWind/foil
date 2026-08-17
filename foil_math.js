// CPU reference equations for the physically based foil shader.

const GROOVE_SPACING_MIN_UM = 0.55;
const GROOVE_SPACING_MAX_UM = 3.20;
const VISIBLE_WAVELENGTH_MIN_UM = 0.380;
const VISIBLE_WAVELENGTH_MAX_UM = 0.780;
const ZERO_ORDER_ENERGY = 0.20;
const TOTAL_DIFFRACTION_ENERGY = 0.12;
const TRANSMITTED_PRINT_ENERGY = 0.60;
const ABSORBED_ENERGY = 0.08;
const ORDER_DECAY = 3.00;
const SPECTRAL_SAMPLE_COUNT = 401;

/** Decode one sRGB component into linear light. */
function srgbToLinear(value)
{
    if(value <= 0.04045)
    {
        return value / 12.92;
    }
    return Math.pow((value + 0.055) / 1.055, 2.4);
}

/** Encode one nonnegative linear-light component as sRGB. */
function linearToSrgb(value)
{
    if(value <= 0.0031308)
    {
        return 12.92 * value;
    }
    return 1.055 * Math.pow(value, 1.0 / 2.4) - 0.055;
}

/** Apply display-referred input Levels to one encoded component. */
function applyLevels(value, black_point, white_point, midtone)
{
    if(!Number.isFinite(black_point) || !Number.isFinite(white_point)
       || !Number.isFinite(midtone) || black_point < 0.0
       || white_point > 1.0 || black_point >= white_point
       || midtone <= 0.0)
    {
        throw(new Error("Invalid output Levels calibration."));
    }
    const normalized = Math.min(Math.max(
        (value - black_point) / (white_point - black_point), 0.0), 1.0);
    return Math.pow(normalized, 1.0 / midtone);
}

/** Convert D65 CIE XYZ values to linear sRGB. */
function xyzToLinearSrgb(xyz)
{
    return [
        3.24096994 * xyz[0] - 1.53738318 * xyz[1]
            - 0.49861076 * xyz[2],
        -0.96924364 * xyz[0] + 1.87596750 * xyz[1]
            + 0.04155506 * xyz[2],
        0.05563008 * xyz[0] - 0.20397696 * xyz[1]
            + 1.05697151 * xyz[2],
    ];
}

/** Return the real cube root of a possibly negative scalar. */
function signedCubeRoot(value)
{
    return Math.sign(value) * Math.pow(Math.abs(value), 1.0 / 3.0);
}

/** Convert linear sRGB components to OKLab. */
function linearSrgbToOklab(linear_rgb)
{
    const lms = [
        0.4122214708 * linear_rgb[0]
            + 0.5363325363 * linear_rgb[1]
            + 0.0514459929 * linear_rgb[2],
        0.2119034982 * linear_rgb[0]
            + 0.6806995451 * linear_rgb[1]
            + 0.1073969566 * linear_rgb[2],
        0.0883024619 * linear_rgb[0]
            + 0.2817188376 * linear_rgb[1]
            + 0.6299787005 * linear_rgb[2],
    ];
    const root_lms = lms.map(signedCubeRoot);
    return [
        0.2104542553 * root_lms[0] + 0.7936177850 * root_lms[1]
            - 0.0040720468 * root_lms[2],
        1.9779984951 * root_lms[0] - 2.4285922050 * root_lms[1]
            + 0.4505937099 * root_lms[2],
        0.0259040371 * root_lms[0] + 0.7827717662 * root_lms[1]
            - 0.8086757660 * root_lms[2],
    ];
}

/** Convert OKLab components to linear sRGB without gamut clipping. */
function oklabToLinearSrgb(lab)
{
    const root_lms = [
        lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2],
        lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2],
        lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2],
    ];
    const lms = root_lms.map(function cube(value)
    {
        return value * value * value;
    });
    return [
        4.0767416621 * lms[0] - 3.3077115913 * lms[1]
            + 0.2309699292 * lms[2],
        -1.2684380046 * lms[0] + 2.6097574011 * lms[1]
            - 0.3413193965 * lms[2],
        -0.0041960863 * lms[0] - 0.7034186147 * lms[1]
            + 1.7076147010 * lms[2],
    ];
}

/** Return whether a linear RGB color lies inside the sRGB display cube. */
function isInSrgbGamut(linear_rgb)
{
    return linear_rgb.every(function testChannel(value)
    {
        return value >= 0.0 && value <= 1.0;
    });
}

/** Apply the shader's fixed-lightness OKLab chroma compression. */
function perceptualGamutMap(linear_rgb)
{
    const lab = linearSrgbToOklab(linear_rgb);
    lab[0] = Math.min(Math.max(lab[0], 0.0), 1.0);
    const chroma = Math.hypot(lab[1], lab[2]);
    if(chroma < 1e-5)
    {
        return oklabToLinearSrgb([lab[0], 0.0, 0.0]);
    }

    const hue = [lab[1] / chroma, lab[2] / chroma];
    let lower_chroma = 0.0;
    let upper_chroma = 0.5;
    for(let iteration = 0; iteration < 10; ++iteration)
    {
        const candidate_chroma = 0.5 * (lower_chroma + upper_chroma);
        const candidate = oklabToLinearSrgb([
            lab[0], hue[0] * candidate_chroma,
            hue[1] * candidate_chroma,
        ]);
        if(isInSrgbGamut(candidate))
        {
            lower_chroma = candidate_chroma;
        }
        else
        {
            upper_chroma = candidate_chroma;
        }
    }

    const knee_chroma = 0.55 * lower_chroma;
    const target_chroma = 0.85 * lower_chroma;
    let mapped_chroma = chroma;
    if(chroma > knee_chroma)
    {
        const compression_range = Math.max(
            target_chroma - knee_chroma, 1e-5);
        const excess = (chroma - knee_chroma) / compression_range;
        mapped_chroma = knee_chroma + compression_range
                      * (1.0 - Math.exp(-excess));
    }
    return oklabToLinearSrgb([
        lab[0], hue[0] * mapped_chroma, hue[1] * mapped_chroma,
    ]).map(function clampChannel(value)
    {
        return Math.min(Math.max(value, 0.0), 1.0);
    });
}

/** Decode normalized red into physical groove spacing in micrometers. */
function decodeGrooveSpacing(encoded_spacing)
{
    return GROOVE_SPACING_MAX_UM * Math.pow(
        GROOVE_SPACING_MIN_UM / GROOVE_SPACING_MAX_UM,
        encoded_spacing);
}

/** Decode normalized green into an unoriented two-dimensional axis. */
function decodeGratingAxis(encoded_orientation)
{
    const angle = Math.PI * encoded_orientation;
    return [Math.cos(angle), Math.sin(angle)];
}

/** Interpolate unoriented axes with doubled-angle circular arithmetic. */
function interpolateGratingAxis(encoded_values, weights)
{
    let axis_x = 0.0;
    let axis_y = 0.0;
    for(let i = 0; i < encoded_values.length; ++i)
    {
        const doubled_angle = 2.0 * Math.PI * encoded_values[i];
        axis_x += weights[i] * Math.cos(doubled_angle);
        axis_y += weights[i] * Math.sin(doubled_angle);
    }

    const length = Math.hypot(axis_x, axis_y);
    if(length < 1e-8)
    {
        return decodeGratingAxis(encoded_values[0]);
    }

    const angle = 0.5 * Math.atan2(axis_y / length, axis_x / length);
    return [Math.cos(angle), Math.sin(angle)];
}

/** Calculate the wavelength selected by one diffraction-order magnitude. */
function diffractionWavelength(spacing_um, order_coordinate, order)
{
    return spacing_um * Math.abs(order_coordinate) / order;
}

/** Project incident and outgoing directions into a local grating frame. */
function tangentProjection(light_direction, view_direction, normal,
                           grating_axis, groove_axis)
{
    const direction_sum = light_direction.map(
        function addDirection(value, index)
        {
            return value + view_direction[index];
        });
    const normal_component = direction_sum.reduce(
        function dotNormal(total, value, index)
        {
            return total + value * normal[index];
        }, 0.0);
    const tangent_sum = direction_sum.map(
        function removeNormal(value, index)
        {
            return value - normal_component * normal[index];
        });

    return {
        u: tangent_sum.reduce(function dotGrating(total, value, index)
        {
            return total + value * grating_axis[index];
        }, 0.0),
        v: tangent_sum.reduce(function dotGroove(total, value, index)
        {
            return total + value * groove_axis[index];
        }, 0.0),
    };
}

/** Return normalized positive-order weights for an active order count. */
function orderWeights(order_count)
{
    const weights = [];
    let weight_sum = 0.0;
    for(let order = 1; order <= order_count; ++order)
    {
        const weight = Math.exp(-ORDER_DECAY * (order - 1));
        weights.push(weight);
        weight_sum += weight;
    }
    return weights.map(function normalizeOrderWeight(weight)
    {
        return weight / weight_sum;
    });
}

/** Return the energy allocation at one internal foil-intensity setting. */
function foilEnergyAllocation(foil_intensity = 1.0)
{
    if(!Number.isFinite(foil_intensity) || foil_intensity < 0.0
       || foil_intensity > 6.0)
    {
        throw(new Error("Foil intensity must be between 0.0 and 6.0."));
    }
    const diffraction = TOTAL_DIFFRACTION_ENERGY * foil_intensity;
    const print = TRANSMITTED_PRINT_ENERGY
                - TOTAL_DIFFRACTION_ENERGY * (foil_intensity - 1.0);
    return {diffraction, print};
}

/** Return the energy assigned to one sign of an order. */
function signedOrderEfficiency(order, order_count, foil_intensity = 1.0)
{
    return 0.5 * foilEnergyAllocation(foil_intensity).diffraction
         * orderWeights(order_count)[order - 1];
}

/** Return the complete material energy allocation for validation. */
function energyBudget(order_count, foil_intensity = 1.0)
{
    const allocation = foilEnergyAllocation(foil_intensity);
    let diffraction_energy = 0.0;
    for(let order = 1; order <= order_count; ++order)
    {
        diffraction_energy += 2.0
                            * signedOrderEfficiency(
                                order, order_count, foil_intensity);
    }
    return ZERO_ORDER_ENERGY + diffraction_energy
         + allocation.print + ABSORBED_ENERGY;
}

/** Decode blue into the cross-groove projected standard deviation. */
function decodeCrossGrooveWidth(encoded_disorder)
{
    const weight = encoded_disorder * encoded_disorder;
    return 0.008 + (0.16 - 0.008) * weight;
}

/** Decode blue into relative groove-period standard deviation. */
function decodePeriodSpread(encoded_disorder)
{
    const weight = encoded_disorder * encoded_disorder;
    return 0.003 + (0.08 - 0.003) * weight;
}

/** Approximate one-axis angular standard deviation of a distant disk. */
function diskAngularSigma(radius, distance)
{
    return 0.5 * radius / distance;
}

/** Combine statistically independent material and source widths. */
function combineWidths(material_width, source_width)
{
    return Math.hypot(material_width, source_width);
}

/** Return wavelength width from material disorder and disk extent. */
function diffractionWavelengthWidth(wavelength_um, relative_spread,
                                    spacing_um, order,
                                    source_angular_sigma)
{
    return combineWidths(
        wavelength_um * relative_spread,
        spacing_um * source_angular_sigma / order);
}

/** Evaluate the normalized cross-groove Gaussian density. */
function crossGrooveGaussian(value, width)
{
    const normalized = value / width;
    return Math.exp(-0.5 * normalized * normalized)
         / (Math.sqrt(2.0 * Math.PI) * width);
}

/** Manually interpolate one source-weighted XYZ spectral table. */
function sampleSpectralXyz(table, wavelength_um)
{
    if(wavelength_um < VISIBLE_WAVELENGTH_MIN_UM ||
       wavelength_um > VISIBLE_WAVELENGTH_MAX_UM)
    {
        return [0.0, 0.0, 0.0];
    }

    const position = (wavelength_um - VISIBLE_WAVELENGTH_MIN_UM) * 1000.0;
    const lower_index = Math.min(Math.floor(position),
                                 SPECTRAL_SAMPLE_COUNT - 1);
    const upper_index = Math.min(lower_index + 1,
                                 SPECTRAL_SAMPLE_COUNT - 1);
    const weight = position - lower_index;
    const result = [];
    for(let channel = 0; channel < 3; ++channel)
    {
        const lower = table[4 * lower_index + channel];
        const upper = table[4 * upper_index + channel];
        result.push(lower + weight * (upper - lower));
    }
    return result;
}

/** Evaluate the isotropic GGX normal distribution. */
function distributionGgx(normal_half, roughness)
{
    const alpha = Math.max(roughness, 0.04);
    const alpha_squared = alpha * alpha;
    const denominator = normal_half * normal_half
                      * (alpha_squared - 1.0) + 1.0;
    return alpha_squared / (Math.PI * denominator * denominator);
}

/** Evaluate one GGX Smith masking term. */
function geometryGgx(normal_direction, roughness)
{
    const cosine = Math.max(normal_direction, 0.0);
    const alpha = Math.max(roughness, 0.04);
    const root = Math.sqrt(alpha * alpha
                         + (1.0 - alpha * alpha) * cosine * cosine);
    return 2.0 * cosine / Math.max(cosine + root, 1e-8);
}

/** Evaluate correlated Smith visibility including the BRDF denominator. */
function visibilitySmithGgx(normal_light, normal_view, roughness)
{
    const alpha = Math.max(roughness, 0.04);
    const alpha_squared = alpha * alpha;
    const view_term = normal_light * Math.sqrt(
        normal_view * normal_view * (1.0 - alpha_squared)
        + alpha_squared);
    const light_term = normal_view * Math.sqrt(
        normal_light * normal_light * (1.0 - alpha_squared)
        + alpha_squared);
    return 0.5 / Math.max(view_term + light_term, 1e-8);
}

if(typeof module != "undefined")
{
    module.exports = {
        ABSORBED_ENERGY,
        GROOVE_SPACING_MAX_UM,
        GROOVE_SPACING_MIN_UM,
        TOTAL_DIFFRACTION_ENERGY,
        TRANSMITTED_PRINT_ENERGY,
        VISIBLE_WAVELENGTH_MAX_UM,
        VISIBLE_WAVELENGTH_MIN_UM,
        ZERO_ORDER_ENERGY,
        applyLevels,
        crossGrooveGaussian,
        decodeCrossGrooveWidth,
        decodeGratingAxis,
        decodeGrooveSpacing,
        decodePeriodSpread,
        diffractionWavelengthWidth,
        diffractionWavelength,
        diskAngularSigma,
        distributionGgx,
        energyBudget,
        foilEnergyAllocation,
        geometryGgx,
        interpolateGratingAxis,
        isInSrgbGamut,
        linearToSrgb,
        linearSrgbToOklab,
        oklabToLinearSrgb,
        orderWeights,
        sampleSpectralXyz,
        signedOrderEfficiency,
        srgbToLinear,
        perceptualGamutMap,
        tangentProjection,
        visibilitySmithGgx,
        combineWidths,
        xyzToLinearSrgb,
    };
}
