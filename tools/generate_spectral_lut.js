const crypto = require("crypto");
const fs = require("fs");

const CIE_CHECKSUM = "17cca777db64b17170f06f67ce9d3ab7";
const D65_CHECKSUM = "03d4eb9b837c60671627c946fb534deb";
const FIRST_WAVELENGTH = 380;
const LAST_WAVELENGTH = 780;
const COMPONENT_COUNT = 4;

/** Return the MD5 checksum used by the CIE dataset pages. */
function checksum(data)
{
    return crypto.createHash("md5").update(data).digest("hex");
}

/** Parse a numeric comma-separated table indexed by wavelength. */
function parseTable(data, expected_column_count)
{
    const table = new Map();
    for(const line of data.trim().split(/\r?\n/))
    {
        const columns = line.split(",").map(Number);
        if(columns.length != expected_column_count ||
           columns.some(Number.isNaN))
        {
            throw(new Error(`Malformed spectral row: ${line}`));
        }
        table.set(columns[0], columns.slice(1));
    }
    return table;
}

/** Read one checked official CIE source file. */
function readCheckedFile(path, expected_checksum)
{
    const data = fs.readFileSync(path);
    const actual_checksum = checksum(data);
    if(actual_checksum != expected_checksum)
    {
        throw(new Error(
            `Checksum mismatch for ${path}: expected ${expected_checksum}, `
            + `got ${actual_checksum}`));
    }
    return data.toString("utf8");
}

/** Generate the normalized D65-weighted XYZ binary resource. */
function generate(cie_path, d65_path, output_path)
{
    const cie_table = parseTable(
        readCheckedFile(cie_path, CIE_CHECKSUM), 4);
    const d65_table = parseTable(
        readCheckedFile(d65_path, D65_CHECKSUM), 2);

    let y_integral = 0.0;
    for(let wavelength = FIRST_WAVELENGTH;
        wavelength <= LAST_WAVELENGTH; ++wavelength)
    {
        if(!cie_table.has(wavelength) || !d65_table.has(wavelength))
        {
            throw(new Error(`Missing wavelength ${wavelength} nm`));
        }
        y_integral += cie_table.get(wavelength)[1]
                    * d65_table.get(wavelength)[0];
    }

    const sample_count = LAST_WAVELENGTH - FIRST_WAVELENGTH + 1;
    const output = Buffer.alloc(sample_count * COMPONENT_COUNT * 4);
    let output_offset = 0;
    for(let wavelength = FIRST_WAVELENGTH;
        wavelength <= LAST_WAVELENGTH; ++wavelength)
    {
        const xyz = cie_table.get(wavelength);
        const illuminant = d65_table.get(wavelength)[0];
        for(let channel = 0; channel < 3; ++channel)
        {
            output.writeFloatLE(
                illuminant * xyz[channel] / y_integral, output_offset);
            output_offset += 4;
        }
        output.writeFloatLE(0.0, output_offset);
        output_offset += 4;
    }
    fs.writeFileSync(output_path, output);
}

if(process.argv.length != 5)
{
    throw(new Error(
        "Usage: node tools/generate_spectral_lut.js "
        + "<cie.csv> <d65.csv> <output.bin>"));
}

generate(process.argv[2], process.argv[3], process.argv[4]);
