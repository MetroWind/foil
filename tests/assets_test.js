const assert = require("assert");
const crypto = require("crypto");
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

/** Return a stable digest for one binary asset. */
function digest(path)
{
    return crypto.createHash("sha256").update(
        fs.readFileSync(path)).digest("hex");
}

const artwork_dimensions = pngDimensions("card_texture.png");
const control_dimensions = pngDimensions("foil_control_v2.png");
assert.deepEqual(control_dimensions, artwork_dimensions);
assert.deepEqual(control_dimensions, [2048, 2048]);
assert.notEqual(digest("foil_control_v2.png"), digest("foil_control.png"));
assert.equal(fs.statSync("spectral_xyz.bin").size, 6416);
console.log("assets_test: passed");
