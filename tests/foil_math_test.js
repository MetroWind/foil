const assert = require("assert");
const fs = require("fs");
const foil_math = require("../foil_math.js");

const EPSILON = 1e-6;

/** Assert that two scalar values are approximately equal. */
function assertNear(actual, expected, tolerance = EPSILON)
{
    assert.ok(Math.abs(actual - expected) <= tolerance,
              `Expected ${expected}, got ${actual}`);
}

/** Assert that all components of two vectors are approximately equal. */
function assertVectorNear(actual, expected, tolerance = EPSILON)
{
    assert.equal(actual.length, expected.length);
    for(let i = 0; i < actual.length; ++i)
    {
        assertNear(actual[i], expected[i], tolerance);
    }
}

/** Validate exact sRGB transfer-function round trips. */
function testSrgb()
{
    for(const value of [0.0, 0.0031308, 0.04045, 0.5, 1.0])
    {
        const decoded = foil_math.srgbToLinear(value);
        assertNear(foil_math.linearToSrgb(decoded), value, 2e-7);
    }
}

/** Validate display-referred black, white, and midtone Levels controls. */
function testLevels()
{
    assertNear(foil_math.applyLevels(0.0, 0.0, 0.88, 1.0), 0.0);
    assertNear(foil_math.applyLevels(0.44, 0.0, 0.88, 1.0), 0.5);
    assertNear(foil_math.applyLevels(0.88, 0.0, 0.88, 1.0), 1.0);
    assertNear(foil_math.applyLevels(0.44, 0.0, 0.88, 2.0),
               Math.sqrt(0.5));
    assert.throws(function rejectReversedLevels()
    {
        foil_math.applyLevels(0.5, 0.8, 0.2, 1.0);
    });
}

/** Validate OKLab round trips and perceptual out-of-gamut compression. */
function testGamutMapping()
{
    for(const color of [
        [0.0, 0.0, 0.0],
        [0.18, 0.18, 0.18],
        [0.2, 0.3, 0.25],
        [1.0, 1.0, 1.0],
        [1.4, -0.2, 0.35],
    ])
    {
        assertVectorNear(foil_math.oklabToLinearSrgb(
            foil_math.linearSrgbToOklab(color)), color, 2e-6);
    }

    const source = [1.4, -0.2, 0.35];
    const mapped = foil_math.perceptualGamutMap(source);
    assert.ok(foil_math.isInSrgbGamut(mapped));
    const source_lab = foil_math.linearSrgbToOklab(source);
    const mapped_lab = foil_math.linearSrgbToOklab(mapped);
    assertNear(mapped_lab[0], Math.min(Math.max(source_lab[0], 0.0), 1.0),
               2e-5);
    const hue_dot = (source_lab[1] * mapped_lab[1]
                   + source_lab[2] * mapped_lab[2])
                  / (Math.hypot(source_lab[1], source_lab[2])
                     * Math.hypot(mapped_lab[1], mapped_lab[2]));
    assert.ok(hue_dot > 0.9999);
    assert.ok(Math.hypot(mapped_lab[1], mapped_lab[2])
              < Math.hypot(source_lab[1], source_lab[2]));
}

/** Validate physical packed-control endpoint decoding. */
function testControls()
{
    assertNear(foil_math.decodeGrooveSpacing(0.0), 3.20);
    assertNear(foil_math.decodeGrooveSpacing(1.0), 0.55);
    const endpoint_0 = foil_math.decodeGratingAxis(0.0);
    const endpoint_1 = foil_math.decodeGratingAxis(1.0);
    assertNear(Math.abs(endpoint_0[0] * endpoint_1[0]
                      + endpoint_0[1] * endpoint_1[1]), 1.0);

    const seam_axis = foil_math.interpolateGratingAxis(
        [1.0 / 255.0, 254.0 / 255.0], [0.5, 0.5]);
    assert.ok(Math.abs(seam_axis[0]) > 0.999);
    assert.ok(Math.abs(seam_axis[1]) < 0.01);
}

/** Validate wavelength and order-energy equations. */
function testOrders()
{
    assertNear(foil_math.diffractionWavelength(1.1, 0.5, 1), 0.55);
    assertNear(foil_math.diffractionWavelength(1.1, 0.5, 2), 0.275);
    assertNear(foil_math.energyBudget(1), 1.0);
    assertNear(foil_math.energyBudget(4), 1.0);
    assertNear(foil_math.energyBudget(8), 1.0);
    for(const intensity of [0.0, 0.5, 1.0, 1.5, 3.0, 6.0])
    {
        assertNear(foil_math.energyBudget(4, intensity), 1.0);
        const allocation = foil_math.foilEnergyAllocation(intensity);
        assert.ok(allocation.diffraction >= 0.0);
        assert.ok(allocation.print >= 0.0);
    }
    assert.throws(function rejectExcessiveFoilIntensity()
    {
        foil_math.foilEnergyAllocation(6.01);
    });

    for(const count of [1, 4, 8])
    {
        const sum = foil_math.orderWeights(count).reduce(
            function addWeight(total, value)
            {
                return total + value;
            }, 0.0);
        assertNear(sum, 1.0);
    }
    assert.ok(foil_math.signedOrderEfficiency(1, 4)
              > 19.0 * foil_math.signedOrderEfficiency(2, 4));
}

/** Validate reciprocal vector geometry and unoriented-axis symmetry. */
function testVectorGeometry()
{
    const light = [0.2, 0.3, 0.9327379];
    const view = [-0.1, 0.4, 0.9110434];
    const normal = [0.0, 0.0, 1.0];
    const grating = [1.0, 0.0, 0.0];
    const groove = [0.0, 1.0, 0.0];
    const forward = foil_math.tangentProjection(
        light, view, normal, grating, groove);
    const reciprocal = foil_math.tangentProjection(
        view, light, normal, grating, groove);
    assertNear(forward.u, reciprocal.u);
    assertNear(forward.v, reciprocal.v);

    const reversed = foil_math.tangentProjection(
        light, view, normal, [-1.0, 0.0, 0.0], groove);
    assertNear(Math.abs(forward.u), Math.abs(reversed.u));
}

/** Validate GGX and disorder functions at representative values. */
function testLobes()
{
    assert.ok(foil_math.distributionGgx(1.0, 0.16) > 0.0);
    assertNear(foil_math.geometryGgx(1.0, 0.16), 1.0);
    assert.ok(foil_math.crossGrooveGaussian(
        0.0, foil_math.decodeCrossGrooveWidth(0.0)) > 0.0);
    assert.ok(foil_math.decodePeriodSpread(1.0)
              > foil_math.decodePeriodSpread(0.0));
    assertNear(foil_math.diskAngularSigma(1.0, 4.0), 0.125);
    assertNear(foil_math.combineWidths(3.0, 4.0), 5.0);
    assert.ok(foil_math.diffractionWavelengthWidth(
        0.55, 0.01, 1.1, 1, 0.1) > 0.1);
}

/** Validate the generated spectral table and D65 white point. */
function testSpectralTable()
{
    const data = fs.readFileSync("spectral_xyz.bin");
    assert.equal(data.byteLength, 6416);
    const table = new Float32Array(
        data.buffer, data.byteOffset, data.byteLength / 4);

    const xyz_sum = [0.0, 0.0, 0.0];
    for(let sample = 0; sample < 401; ++sample)
    {
        for(let channel = 0; channel < 3; ++channel)
        {
            xyz_sum[channel] += table[4 * sample + channel];
        }
    }
    assertNear(xyz_sum[1], 1.0, 2e-6);
    assertVectorNear(foil_math.xyzToLinearSrgb(xyz_sum),
                     [1.0, 1.0, 1.0], 6e-4);

    assertVectorNear(foil_math.sampleSpectralXyz(table, 0.379),
                     [0.0, 0.0, 0.0]);
    assertVectorNear(foil_math.sampleSpectralXyz(table, 0.781),
                     [0.0, 0.0, 0.0]);
    assert.ok(foil_math.sampleSpectralXyz(table, 0.380)
              .every(Number.isFinite));
    assert.ok(foil_math.sampleSpectralXyz(table, 0.780)
              .every(Number.isFinite));
    assert.ok(foil_math.sampleSpectralXyz(table, 0.550)[1] > 0.0);
}

/** Confirm duplicated shader constants remain equal to the CPU reference. */
function testShaderConstants()
{
    const shader = fs.readFileSync("frag-shader.glsl", "utf8");
    const expected_constants = new Map([
        ["GROOVE_SPACING_MIN_UM", foil_math.GROOVE_SPACING_MIN_UM],
        ["GROOVE_SPACING_MAX_UM", foil_math.GROOVE_SPACING_MAX_UM],
        ["VISIBLE_WAVELENGTH_MIN_UM",
         foil_math.VISIBLE_WAVELENGTH_MIN_UM],
        ["VISIBLE_WAVELENGTH_MAX_UM",
         foil_math.VISIBLE_WAVELENGTH_MAX_UM],
        ["ZERO_ORDER_ENERGY", foil_math.ZERO_ORDER_ENERGY],
        ["BASE_TOTAL_DIFFRACTION_ENERGY",
         foil_math.TOTAL_DIFFRACTION_ENERGY],
        ["BASE_TRANSMITTED_PRINT_ENERGY",
         foil_math.TRANSMITTED_PRINT_ENERGY],
    ]);
    for(const [name, expected] of expected_constants)
    {
        const match = shader.match(new RegExp(
            `const float ${name} = ([0-9.]+);`));
        assert.ok(match, `Missing shader constant ${name}`);
        assertNear(Number(match[1]), expected);
    }
}

/** Sweep deterministic valid inputs and reject non-finite reference results. */
function testFiniteSweep()
{
    let state = 0x91e10da5;
    function random()
    {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0x100000000;
    }

    for(let sample = 0; sample < 1000; ++sample)
    {
        const spacing = foil_math.decodeGrooveSpacing(random());
        const disorder = random();
        const angle_1 = 2.0 * Math.PI * random();
        const angle_2 = 2.0 * Math.PI * random();
        const light = [Math.cos(angle_1), Math.sin(angle_1), random()];
        const view = [Math.cos(angle_2), Math.sin(angle_2), random()];
        const projection = foil_math.tangentProjection(
            light, view, [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]);
        const values = [
            spacing,
            foil_math.diffractionWavelength(spacing, projection.u, 1),
            foil_math.decodeCrossGrooveWidth(disorder),
            foil_math.decodePeriodSpread(disorder),
            foil_math.crossGrooveGaussian(
                projection.v,
                foil_math.decodeCrossGrooveWidth(disorder)),
            foil_math.distributionGgx(random(), 0.16),
            foil_math.visibilitySmithGgx(random(), random(), 0.16),
        ];
        assert.ok(values.every(Number.isFinite));
    }
}

testSrgb();
testLevels();
testGamutMapping();
testControls();
testOrders();
testVectorGeometry();
testLobes();
testSpectralTable();
testShaderConstants();
testFiniteSweep();
console.log("foil_math_test: passed");
