const assert = require("assert");
const fs = require("fs");

/** Return width and height from a validated PNG header. */
function pngDimensions(path)
{
    const data = fs.readFileSync(path);
    const signature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    assert.ok(data.subarray(0, 8).equals(signature), `${path} is not PNG`);
    assert.equal(data.subarray(12, 16).toString("ascii"), "IHDR");
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

const artwork_dimensions = pngDimensions("card_texture.png");
const control_dimensions = pngDimensions("foil_control_v2.png");
assert.deepEqual(control_dimensions, artwork_dimensions);
assert.deepEqual(control_dimensions, [2048, 2048]);
assert.equal(fs.statSync("spectral_xyz.bin").size, 6416);
console.log("assets_test: passed");
