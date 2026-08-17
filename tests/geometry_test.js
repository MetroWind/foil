const assert = require("assert");
const fs = require("fs");
const {
    DiskLight,
    ShaderProgram,
    calculateTangentFrames,
    defineShaderConstants,
} = require("../libwebgl.js");
const {parseOBJ} = require("../obj.js");

/** Validate tangent generation on one canonical UV triangle. */
function testTangentFrame()
{
    const frame = calculateTangentFrames(
        [0.0, 0.0, 0.0,
         1.0, 0.0, 0.0,
         0.0, 1.0, 0.0],
        [0.0, 0.0,
         1.0, 0.0,
         0.0, 1.0],
        [0.0, 0.0, 1.0,
         0.0, 0.0, 1.0,
         0.0, 0.0, 1.0],
        "test");
    assert.deepEqual(frame.normals,
                     [0.0, 0.0, 1.0,
                      0.0, 0.0, 1.0,
                      0.0, 0.0, 1.0]);
    assert.deepEqual(frame.tangents,
                     [1.0, 0.0, 0.0, 1.0,
                      1.0, 0.0, 0.0, 1.0,
                      1.0, 0.0, 0.0, 1.0]);
}

/** Validate that compile-time definitions follow the GLSL version line. */
function testShaderDefinitions()
{
    const source = defineShaderConstants(
        "#version 300 es\nvoid main() {}\n", {ORDER_COUNT: 4});
    assert.equal(source,
                 "#version 300 es\n#define ORDER_COUNT 4\nvoid main() {}\n");
    const float_source = defineShaderConstants(
        "#version 300 es\nvoid main() {}\n", {FOIL_INTENSITY: 1.5});
    assert.equal(float_source,
                 "#version 300 es\n#define FOIL_INTENSITY 1.5\n"
                 + "void main() {}\n");
    assert.throws(function rejectInvalidDefinition()
    {
        defineShaderConstants("#version 300 es\n", {bad_name: 4});
    });
}

/** Ensure required and optional uniform lookups cannot mask one another. */
function testUniformLookups()
{
    let lookup_count = 0;
    const program = Object.create(ShaderProgram.prototype);
    program.program = {};
    program.uniform_locations = new Map();
    program.gl = {
        getUniformLocation: function getUniformLocation(
            unused_program, name)
        {
            ++lookup_count;
            return name == "u_present" ? {name} : null;
        },
    };
    assert.equal(program.optionalUniform("u_absent"), null);
    assert.throws(function requireAbsentUniform()
    {
        program.uniform("u_absent");
    });
    assert.equal(lookup_count, 1);
    assert.deepEqual(program.uniform("u_present"), {name: "u_present"});
}

/** Validate tangent generation for every triangle in the production model. */
function testCardGeometry()
{
    const model = parseOBJ(fs.readFileSync("model/card.obj", "utf8"));
    assert.ok(model.geometries.length > 0);
    for(const geometry of model.geometries)
    {
        const frame = calculateTangentFrames(
            geometry.data.position, geometry.data.texcoord,
            geometry.data.normal, geometry.object);
        assert.equal(frame.normals.length, geometry.data.position.length);
        assert.equal(frame.tangents.length,
                     4 * geometry.data.position.length / 3);
        assert.ok(frame.normals.every(Number.isFinite));
        assert.ok(frame.tangents.every(Number.isFinite));
    }
}

/** Validate disk-emitter inputs and its derived orthonormal frame. */
function testDiskLight()
{
    const light = new DiskLight(
        [1.0, 2.0, 3.0], [1.0, -2.0, 4.0], 0.5, 3.0);
    const vectors = [light.normal, light.axis_x, light.axis_y];
    for(const vector of vectors)
    {
        assert.ok(Math.abs(Math.hypot(...vector) - 1.0) < 1e-12);
    }
    for(let left = 0; left < vectors.length; ++left)
    {
        for(let right = left + 1; right < vectors.length; ++right)
        {
            const dot = vectors[left].reduce(
                function dotVector(total, value, index)
                {
                    return total + value * vectors[right][index];
                }, 0.0);
            assert.ok(Math.abs(dot) < 1e-12);
        }
    }
    assert.throws(function rejectZeroNormal()
    {
        return new DiskLight([0.0, 0.0, 0.0], [0.0, 0.0, 0.0], 1.0, 1.0);
    });
    assert.throws(function rejectNegativeRadius()
    {
        return new DiskLight([0.0, 0.0, 0.0], [0.0, 0.0, 1.0], -1.0, 1.0);
    });
}

testTangentFrame();
testShaderDefinitions();
testUniformLookups();
testCardGeometry();
testDiskLight();
console.log("geometry_test: passed");
