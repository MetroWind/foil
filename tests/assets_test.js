const assert = require("assert");
const fs = require("fs");

/** Return the parsed fixed header from one production PNG. */
function pngHeader(path)
{
    const data = fs.readFileSync(path);
    const signature = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    assert.ok(data.subarray(0, 8).equals(signature), `${path} is not PNG`);
    assert.equal(data.subarray(12, 16).toString("ascii"), "IHDR");
    return {
        width: data.readUInt32BE(16),
        height: data.readUInt32BE(20),
        color_type: data.readUInt8(25),
    };
}

const artwork_header = pngHeader("card_front.png");
const control_header = pngHeader("card_front_foil.png");
assert.equal(artwork_header.width, control_header.width);
assert.equal(artwork_header.height, control_header.height);
assert.equal(control_header.color_type, 6);

const demo_source = fs.readFileSync("webgl-demo.js", "utf8");
assert.ok(demo_source.includes('artwork: "card_front.png"'));
assert.ok(demo_source.includes('foil_control: "card_front_foil.png"'));
assert.ok(!demo_source.includes("card_texture.png"));
assert.ok(!demo_source.includes("foil_control_v2.png"));
assert.ok(!fs.existsSync("card_texture.png"));
assert.ok(!fs.existsSync("foil_control_v2.png"));
assert.equal(fs.statSync("spectral_xyz.bin").size, 6416);

const html_source = fs.readFileSync("index.html", "utf8");
assert.ok(html_source.includes('<script src="card_link.js"></script>'));
assert.ok(html_source.includes('id="ArtworkFile"'));
assert.ok(html_source.includes('id="FoilControlFile"'));
assert.ok(html_source.includes('id="ArtworkUrl"'));
assert.ok(html_source.includes('id="FoilControlUrl"'));
assert.ok(html_source.includes('value="files" checked'));
assert.ok(html_source.includes('value="urls"'));
assert.ok(html_source.includes('id="ApplyCardImages"'));
assert.ok(html_source.includes('id="ResetCardFiles"'));
assert.equal((html_source.match(/accept="image\/\*"/g) || []).length, 2);
assert.ok(demo_source.includes("applyUrls"));
const webgl_source = fs.readFileSync("libwebgl.js", "utf8");
assert.ok(webgl_source.includes('cross_origin: "anonymous"'));
assert.ok(!demo_source.includes("localStorage"));
assert.ok(!demo_source.includes("indexedDB"));
console.log("assets_test: passed");
