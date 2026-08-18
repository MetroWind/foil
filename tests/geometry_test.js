const assert = require("assert");
const fs = require("fs");
const {
    DiskLight,
    MATERIAL_KIND,
    PhysicalFoilMaterial,
    ShaderProgram,
    SolidColorMaterial,
    TEXTURE_ROLE,
    Texture,
    bitmapDecodeOptions,
    calculateTangentFrames,
    defineShaderConstants,
} = require("../libwebgl.js");
const {
    CARD_MESH_LAYOUT,
    parseOBJ,
    partitionCardGeometry,
} = require("../obj.js");

/** Return a two-triangle card fixture with misleading vertex normals. */
function cardPartitionFixture()
{
    return {
        object: "fixture",
        groups: ["default"],
        material: "default",
        data: {
            position: [
                0.0, 0.0, 0.0,
                0.0, 0.0, 1.0,
                1.0, 0.0, 0.0,
                0.0, 0.0, 0.0,
                1.0, 0.0, 0.0,
                0.0, 0.0, 1.0,
            ],
            texcoord: [
                0.5, 0.3,
                0.5, 1.0,
                1.0, 0.3,
                0.1, 0.2,
                0.3, 0.4,
                0.5, 0.6,
            ],
            normal: [
                0.0, 1.0, 0.0,
                0.0, 1.0, 0.0,
                0.0, 1.0, 0.0,
                0.0, 1.0, 0.0,
                0.0, 1.0, 0.0,
                0.0, 1.0, 0.0,
            ],
        },
    };
}

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

/** Validate material-mode isolation and texture-free solid binding. */
function testMaterialModes()
{
    const calls = [];
    let uniform_control = null;
    const gl = {
        uniform1i: function uploadInteger(location, value)
        {
            calls.push(["uniform1i", location, value]);
        },
        uniform3fv: function uploadVector(location, value)
        {
            calls.push(["uniform3fv", location, Array.from(value)]);
        },
    };
    const program = {
        uniform: function uniform(name)
        {
            return name;
        },
    };
    const physical = Object.create(PhysicalFoilMaterial.prototype);
    physical.gl = gl;
    physical.artwork = {use: function useArtwork() {}};
    physical.foil_control = {
        is_constant: true,
        use: function useControls() {},
        setConstantColor: function setConstantColor(color)
        {
            uniform_control = color;
        },
    };
    physical.spectral_lut = {use: function useSpectrum() {}};
    const solid = new SolidColorMaterial(gl, [0.5, 0.5, 0.5]);

    physical.use(program);
    solid.use(program);
    physical.use(program);
    assert.deepEqual(calls.filter(function retainMaterialModes(call)
    {
        return call[1] == "u_material_kind";
    }), [
        ["uniform1i", "u_material_kind", MATERIAL_KIND.PHYSICAL_FOIL],
        ["uniform1i", "u_material_kind", MATERIAL_KIND.SOLID_COLOR],
        ["uniform1i", "u_material_kind", MATERIAL_KIND.PHYSICAL_FOIL],
    ]);
    assert.deepEqual(calls.find(function findSolidColor(call)
    {
        return call[1] == "u_solid_color_srgb";
    }), ["uniform3fv", "u_solid_color_srgb", [0.5, 0.5, 0.5]]);
    assert.throws(function rejectInvalidSolidColor()
    {
        return new SolidColorMaterial(gl, [0.0, 0.0, 2.0]);
    });
    assert.equal(physical.setUniformControl([155, 0, 8, 255]), true);
    assert.deepEqual(uniform_control, [155, 0, 8, 255]);
    physical.foil_control.is_constant = false;
    assert.equal(physical.setUniformControl([0, 0, 0, 0]), false);
}

/** Ensure texture disposal releases a GPU allocation exactly once. */
function testTextureDisposal()
{
    let deletion_count = 0;
    let listener_removal_count = 0;
    const texture = Object.create(Texture.prototype);
    texture.texture = {};
    texture.image = {
        removeEventListener: function removeEventListener()
        {
            ++listener_removal_count;
        },
    };
    texture.handle_load = function handleLoad() {};
    texture.handle_error = function handleError() {};
    texture.disposed = false;
    texture.gl = {
        deleteTexture: function deleteTexture()
        {
            ++deletion_count;
        },
    };
    texture.dispose();
    texture.dispose();
    assert.equal(deletion_count, 1);
    assert.equal(listener_removal_count, 2);
    assert.equal(texture.image, null);
}

/** Keep ImageBitmap orientation separate from WebGL unpack orientation. */
function testBitmapDecodeOptions()
{
    assert.deepEqual(bitmapDecodeOptions(true, TEXTURE_ROLE.COLOR), {
        imageOrientation: "flipY",
        premultiplyAlpha: "none",
        colorSpaceConversion: "default",
    });
    assert.deepEqual(bitmapDecodeOptions(true, TEXTURE_ROLE.DATA), {
        imageOrientation: "flipY",
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
    });
}

/** Represent uniform foil controls with one exact RGBA data texel. */
function testConstantControlTexture()
{
    let uploaded_color = null;
    let updated_color = null;
    let active_texture = 0;
    let bound_texture = null;
    const gl = {
        TEXTURE0: 0,
        TEXTURE_2D: 1,
        TEXTURE_MIN_FILTER: 2,
        TEXTURE_MAG_FILTER: 3,
        TEXTURE_WRAP_S: 4,
        TEXTURE_WRAP_T: 5,
        LINEAR: 6,
        CLAMP_TO_EDGE: 7,
        RGBA8: 8,
        RGBA: 9,
        UNSIGNED_BYTE: 10,
        ACTIVE_TEXTURE: 11,
        TEXTURE_BINDING_2D: 12,
        createTexture: function createTexture()
        {
            return {};
        },
        activeTexture: function activeTexture(value)
        {
            active_texture = value;
        },
        bindTexture: function bindTexture(unused_target, value)
        {
            bound_texture = value;
        },
        getParameter: function getParameter(name)
        {
            return name == this.ACTIVE_TEXTURE
                ? active_texture : bound_texture;
        },
        texParameteri: function texParameteri() {},
        texImage2D: function uploadTexture()
        {
            uploaded_color = Array.from(arguments[8]);
        },
        texSubImage2D: function updateTexture()
        {
            updated_color = Array.from(arguments[8]);
        },
        deleteTexture: function deleteTexture() {},
    };
    const texture = Texture.constant(
        gl, [155, 64, 8, 255], {role: TEXTURE_ROLE.DATA});
    assert.deepEqual(uploaded_color, [155, 64, 8, 255]);
    assert.equal(texture.width, 1);
    assert.equal(texture.height, 1);
    assert.equal(texture.role, TEXTURE_ROLE.DATA);
    texture.setConstantColor([32, 64, 96, 128]);
    assert.deepEqual(updated_color, [32, 64, 96, 128]);
    assert.throws(function rejectInvalidConstantTexture()
    {
        Texture.constant(gl, [0, 0, 0], {role: TEXTURE_ROLE.DATA});
    }, /four bytes/);
    texture.dispose();
}

/** Set anonymous CORS before assigning a remote image URL. */
function testCorsTextureSetup()
{
    const assignment_order = [];
    const previous_image = global.Image;
    class FakeImage
    {
        /** Create an empty fake browser image. */
        constructor()
        {
            this.listeners = new Map();
        }

        /** Store one simulated image event listener. */
        addEventListener(name, listener)
        {
            this.listeners.set(name, listener);
        }

        /** Remove one simulated image event listener. */
        removeEventListener(name)
        {
            this.listeners.delete(name);
        }

        /** Record when the CORS mode is assigned. */
        set crossOrigin(value)
        {
            assignment_order.push(["cross_origin", value]);
        }

        /** Record when resource loading begins. */
        set src(value)
        {
            assignment_order.push(["src", value]);
        }
    }
    const gl = {
        TEXTURE0: 0,
        TEXTURE_2D: 1,
        TEXTURE_MIN_FILTER: 2,
        TEXTURE_MAG_FILTER: 3,
        TEXTURE_WRAP_S: 4,
        TEXTURE_WRAP_T: 5,
        LINEAR: 6,
        CLAMP_TO_EDGE: 7,
        RGBA8: 8,
        RGBA: 9,
        UNSIGNED_BYTE: 10,
        createTexture: function createTexture()
        {
            return {};
        },
        activeTexture: function activeTexture() {},
        bindTexture: function bindTexture() {},
        texParameteri: function texParameteri() {},
        texImage2D: function texImage2D() {},
        deleteTexture: function deleteTexture() {},
    };

    global.Image = FakeImage;
    try
    {
        const url = "https://images.example/card.webp";
        const texture = new Texture(
            gl, url, {cross_origin: "anonymous"});
        assert.deepEqual(assignment_order, [
            ["cross_origin", "anonymous"],
            ["src", url],
        ]);
        texture.dispose();
    }
    finally
    {
        if(previous_image == null)
        {
            delete global.Image;
        }
        else
        {
            global.Image = previous_image;
        }
    }
}

/** Keep JavaScript material mode values synchronized with the GLSL contract. */
function testMaterialShaderContract()
{
    const source = fs.readFileSync("frag-shader.glsl", "utf8");
    assert.ok(source.includes(
        `const int MATERIAL_PHYSICAL_FOIL = `
        + `${MATERIAL_KIND.PHYSICAL_FOIL};`));
    assert.ok(source.includes(
        `const int MATERIAL_SOLID_COLOR = ${MATERIAL_KIND.SOLID_COLOR};`));
    assert.ok(source.includes("uniform int u_material_kind;"));
    assert.ok(source.includes("uniform vec3 u_solid_color_srgb;"));
    assert.ok(source.includes(
        "if(u_material_kind == MATERIAL_SOLID_COLOR)"));
    assert.ok(source.includes(
        "else if(u_material_kind == MATERIAL_PHYSICAL_FOIL)"));
}

/** Keep foil gamut mapping continuous at zero and partial coverage. */
function testCoverageGamutContract()
{
    const source = fs.readFileSync("frag-shader.glsl", "utf8");
    assert.ok(source.includes(
        "vec3 applyFoilGamutMap(vec3 linear_rgb, float coverage)"));
    assert.ok(source.includes(
        "return mix(ordinary_rgb, mapped_rgb, clamp(coverage, 0.0, 1.0));"));
    assert.ok(source.includes(
        "tone_mapped, control.coverage);"));
    assert.ok(!source.includes(
        "control.coverage > 0.0\n"
        + "                        ? perceptualGamutMap(tone_mapped)"));
}

/** Keep authored foil coverage on the intentional artistic response curve. */
function testArtisticCoverageContract()
{
    const source = fs.readFileSync("frag-shader.glsl", "utf8");
    assert.ok(source.includes(
        "const float ARTISTIC_COVERAGE_EXPONENT = 2.2;"));
    assert.ok(source.includes(
        "float decodeArtisticCoverage(float encoded_coverage)"));
    assert.ok(source.includes(
        "control.coverage = decodeArtisticCoverage(coverage);"));
}

/** Keep blue-channel tilt and fixed disorder synchronized with the shader. */
function testGratingTiltContract()
{
    const source = fs.readFileSync("frag-shader.glsl", "utf8");
    assert.ok(source.includes(
        "const float MAX_GRATING_TILT_RADIANS = PI / 12.0;"));
    assert.ok(source.includes("const float FOIL_DISORDER = 1.0;"));
    assert.ok(source.includes(
        "float grating_tilt;"));
    assert.ok(source.includes(
        "control.grating_tilt = MAX_GRATING_TILT_RADIANS"));
    assert.ok(source.includes(
        "vec3 tilted_grating = tilt_cosine * grating + tilt_sine * normal;"));
    assert.ok(!source.includes("control.disorder"));
}

/** Validate tangent generation for every triangle in the production model. */
function testCardGeometry()
{
    const model = parseOBJ(fs.readFileSync("model/card.obj", "utf8"));
    assert.ok(model.geometries.length > 0);
    let source_triangle_count = 0;
    let front_triangle_count = 0;
    let shell_triangle_count = 0;
    for(const geometry of model.geometries)
    {
        const partition = partitionCardGeometry(
            geometry, CARD_MESH_LAYOUT);
        source_triangle_count += geometry.data.position.length / 9;
        front_triangle_count += partition.front.data.position.length / 9;
        shell_triangle_count += partition.shell.data.position.length / 9;

        for(const part of [partition.front, partition.shell])
        {
            const frame = calculateTangentFrames(
                part.data.position, part.data.texcoord,
                part.data.normal, part.object);
            assert.equal(frame.normals.length, part.data.position.length);
            assert.equal(frame.tangents.length,
                         4 * part.data.position.length / 3);
            assert.ok(frame.normals.every(Number.isFinite));
            assert.ok(frame.tangents.every(Number.isFinite));
        }
        assert.ok(partition.front.data.texcoord.every(
            function validateRemappedCoordinate(value)
            {
                return Number.isFinite(value) && value >= 0.0 && value <= 1.0;
            }));
    }
    assert.equal(source_triangle_count, 268);
    assert.equal(front_triangle_count, 66);
    assert.equal(shell_triangle_count, 202);
    assert.equal(front_triangle_count + shell_triangle_count,
                 source_triangle_count);
}

/** Validate stable classification, UV remapping, and source immutability. */
function testCardPartition()
{
    const geometry = cardPartitionFixture();
    const source_snapshot = JSON.stringify(geometry);
    const partition = partitionCardGeometry(geometry, CARD_MESH_LAYOUT);
    assert.equal(JSON.stringify(geometry), source_snapshot);
    assert.deepEqual(partition.front.data.position,
                     geometry.data.position.slice(0, 9));
    assert.deepEqual(partition.front.data.texcoord,
                     [0.0, 0.0, 0.0, 1.0, 1.0, 0.0]);
    assert.deepEqual(partition.shell.data.position,
                     geometry.data.position.slice(9));
    assert.deepEqual(partition.shell.data.texcoord,
                     geometry.data.texcoord.slice(6));
    assert.deepEqual(partition.front.data.normal,
                     geometry.data.normal.slice(0, 9));
    assert.deepEqual(partition.shell.data.normal,
                     geometry.data.normal.slice(9));
}

/** Reject malformed card geometry and invalid front coordinates. */
function testCardPartitionErrors()
{
    const incomplete = cardPartitionFixture();
    incomplete.data.position.pop();
    assert.throws(function rejectIncompleteGeometry()
    {
        partitionCardGeometry(incomplete, CARD_MESH_LAYOUT);
    }, /incomplete triangles/);

    const degenerate = cardPartitionFixture();
    degenerate.data.position.splice(3, 3, 0.0, 0.0, 0.0);
    assert.throws(function rejectDegenerateGeometry()
    {
        partitionCardGeometry(degenerate, CARD_MESH_LAYOUT);
    }, /Degenerate triangle 0/);

    const invalid_uv = cardPartitionFixture();
    invalid_uv.data.texcoord[0] = 0.4;
    assert.throws(function rejectFrontUvOutsideAtlas()
    {
        partitionCardGeometry(invalid_uv, CARD_MESH_LAYOUT);
    }, /Front UV outside atlas region/);
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
testMaterialModes();
testTextureDisposal();
testBitmapDecodeOptions();
testConstantControlTexture();
testCorsTextureSetup();
testMaterialShaderContract();
testCoverageGamutContract();
testArtisticCoverageContract();
testGratingTiltContract();
testCardGeometry();
testCardPartition();
testCardPartitionErrors();
testDiskLight();
console.log("geometry_test: passed");
