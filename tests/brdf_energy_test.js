const assert = require("assert");
const fs = require("fs");
const foil_math = require("../foil_math.js");

const THETA_SAMPLE_COUNT = 80;
const PHI_SAMPLE_COUNT = 160;
const FOIL_ROUGHNESS = 0.16;
const FOIL_F_0 = 0.82;

/** Return a normalized sum of two direction vectors. */
function halfVector(left, right)
{
    const value = left.map(function addComponent(component, index)
    {
        return component + right[index];
    });
    const length = Math.hypot(...value);
    return value.map(function normalizeComponent(component)
    {
        return component / length;
    });
}

/** Evaluate the scalar neutral GGX BRDF used by the shader. */
function specularBrdf(light, view)
{
    const half = halfVector(light, view);
    const normal_light = light[2];
    const normal_view = view[2];
    const normal_half = half[2];
    const view_half = view.reduce(function dotHalf(total, value, index)
    {
        return total + value * half[index];
    }, 0.0);
    const fresnel = FOIL_F_0 + (1.0 - FOIL_F_0)
                  * Math.pow(1.0 - view_half, 5.0);
    return foil_math.ZERO_ORDER_ENERGY
         * foil_math.distributionGgx(normal_half, FOIL_ROUGHNESS)
         * foil_math.visibilitySmithGgx(
             normal_light, normal_view, FOIL_ROUGHNESS)
         * fresnel;
}

/** Sample the Y component after the shader's three-tap convolution. */
function sampleDisorderedY(table, wavelength_um, disorder)
{
    const width = wavelength_um
                * foil_math.decodePeriodSpread(disorder);
    return 0.25 * foil_math.sampleSpectralXyz(
        table, wavelength_um - width)[1]
         + 0.50 * foil_math.sampleSpectralXyz(
             table, wavelength_um)[1]
         + 0.25 * foil_math.sampleSpectralXyz(
             table, wavelength_um + width)[1];
}

/** Reproduce the shader's scalar Y diffraction BRDF. */
function diffractionBrdfY(table, light, view, spacing_um, disorder)
{
    const projection = foil_math.tangentProjection(
        light, view, [0.0, 0.0, 1.0],
        [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]);
    const cross_response = foil_math.crossGrooveGaussian(
        projection.v, foil_math.decodeCrossGrooveWidth(disorder));
    let result = 0.0;
    for(let order = 1; order <= 4; ++order)
    {
        const wavelength_um = foil_math.diffractionWavelength(
            spacing_um, projection.u, order);
        result += foil_math.signedOrderEfficiency(order, 4)
                * cross_response
                * 1000.0 * spacing_um / order
                * sampleDisorderedY(table, wavelength_um, disorder);
    }
    return result;
}

/** Integrate the foil BRDF over outgoing hemisphere directions. */
function integrateFoil(table, light, spacing_um, disorder)
{
    let reflected_energy = foil_math.TRANSMITTED_PRINT_ENERGY;
    let specular_energy = 0.0;
    let diffraction_energy = 0.0;
    const theta_step = 0.5 * Math.PI / THETA_SAMPLE_COUNT;
    const phi_step = 2.0 * Math.PI / PHI_SAMPLE_COUNT;

    for(let theta_index = 0;
        theta_index < THETA_SAMPLE_COUNT; ++theta_index)
    {
        const theta = (theta_index + 0.5) * theta_step;
        const sine = Math.sin(theta);
        const cosine = Math.cos(theta);
        for(let phi_index = 0;
            phi_index < PHI_SAMPLE_COUNT; ++phi_index)
        {
            const phi = (phi_index + 0.5) * phi_step;
            const view = [sine * Math.cos(phi),
                          sine * Math.sin(phi), cosine];
            const integration_weight = cosine * sine
                                     * theta_step * phi_step;
            specular_energy += specularBrdf(light, view)
                             * integration_weight;
            diffraction_energy += diffractionBrdfY(
                table, light, view, spacing_um, disorder)
                                * integration_weight;
        }
    }
    reflected_energy += specular_energy + diffraction_energy;
    return {reflected_energy, specular_energy, diffraction_energy};
}

const binary = fs.readFileSync("spectral_xyz.bin");
const table = new Float32Array(
    binary.buffer, binary.byteOffset, binary.byteLength / 4);
for(const incident_degrees of [0.0, 30.0, 60.0])
{
    const angle = incident_degrees * Math.PI / 180.0;
    const light = [Math.sin(angle), 0.0, Math.cos(angle)];
    for(const spacing_um of [0.60, 1.10, 2.50])
    {
        const result = integrateFoil(table, light, spacing_um, 0.15);
        assert.ok(Number.isFinite(result.reflected_energy));
        assert.ok(result.reflected_energy <= 1.10,
                  `Energy ${result.reflected_energy} at `
                  + `${incident_degrees} degrees, d=${spacing_um}`);
        assert.ok(result.specular_energy <= foil_math.ZERO_ORDER_ENERGY
                  * 1.02);
    }
}
console.log("brdf_energy_test: passed");
