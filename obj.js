// Copied from https://webgl2fundamentals.org/webgl/lessons/webgl-load-obj.html
/** Parse OBJ text into nonindexed triangle geometry arrays. */
function parseOBJ(text)
{
    // because indices are base 1 let's just fill in the 0th data
    const objPositions = [[0, 0, 0]];
    const objTexcoords = [[0, 0]];
    const objNormals = [[0, 0, 0]];
    const objColors = [[0, 0, 0]];

    // same order as `f` indices
    const objVertexData = [
        objPositions,
        objTexcoords,
        objNormals,
        objColors,
    ];

    // same order as `f` indices
    let webglVertexData = [
        [],   // positions
        [],   // texcoords
        [],   // normals
        [],   // colors
    ];

    const materialLibs = [];
    const geometries = [];
    let geometry;
    let groups = ['default'];
    let material = 'default';
    let object = 'default';

    const noop = () => {};

    function newGeometry() {
        // If there is an existing geometry and it's
        // not empty then start a new one.
        if (geometry && geometry.data.position.length) {
            geometry = undefined;
        }
    }

    function setGeometry() {
        if (!geometry) {
            const position = [];
            const texcoord = [];
            const normal = [];
            const color = [];
            webglVertexData = [
                position,
                texcoord,
                normal,
                color,
            ];
            geometry = {
                object,
                groups,
                material,
                data: {
                    position,
                    texcoord,
                    normal,
                    color,
                },
            };
            geometries.push(geometry);
        }
    }

    function addVertex(vert) {
        const ptn = vert.split('/');
        ptn.forEach((objIndexStr, i) => {
            if (!objIndexStr) {
                return;
            }
            const objIndex = parseInt(objIndexStr);
            const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
            webglVertexData[i].push(...objVertexData[i][index]);
            // if this is the position index (index 0) and we parsed
            // vertex colors then copy the vertex colors to the webgl vertex color data
            if (i === 0 && objColors.length > 1) {
                geometry.data.color.push(...objColors[index]);
            }
        });
    }

    const keywords = {
        v(parts) {
            // if there are more than 3 values here they are vertex colors
            if (parts.length > 3) {
                objPositions.push(parts.slice(0, 3).map(parseFloat));
                objColors.push(parts.slice(3).map(parseFloat));
            } else {
                objPositions.push(parts.map(parseFloat));
            }
        },
        vn(parts) {
            objNormals.push(parts.map(parseFloat));
        },
        vt(parts) {
            // should check for missing v and extra w?
            objTexcoords.push(parts.map(parseFloat));
        },
        f(parts) {
            setGeometry();
            const numTriangles = parts.length - 2;
            for (let tri = 0; tri < numTriangles; ++tri) {
                addVertex(parts[0]);
                addVertex(parts[tri + 1]);
                addVertex(parts[tri + 2]);
            }
        },
        s: noop,    // smoothing group
        mtllib(parts, unparsedArgs) {
            // the spec says there can be multiple filenames here
            // but many exist with spaces in a single filename
            materialLibs.push(unparsedArgs);
        },
        usemtl(parts, unparsedArgs) {
            material = unparsedArgs;
            newGeometry();
        },
        g(parts) {
            groups = parts;
            newGeometry();
        },
        o(parts, unparsedArgs) {
            object = unparsedArgs;
            newGeometry();
        },
    };

    const keywordRE = /(\w*)(?: )*(.*)/;
    const lines = text.split('\n');
    for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
        const line = lines[lineNo].trim();
        if (line === '' || line.startsWith('#')) {
            continue;
        }
        const m = keywordRE.exec(line);
        if (!m) {
            continue;
        }
        const [, keyword, unparsedArgs] = m;
        const parts = line.split(/\s+/).slice(1);
        const handler = keywords[keyword];
        if (!handler) {
            console.warn('unhandled keyword:', keyword);  // eslint-disable-line no-console
            continue;
        }
        handler(parts, unparsedArgs);
    }

    // remove any arrays that have no entries.
    for (const geometry of geometries) {
        geometry.data = Object.fromEntries(
            Object.entries(geometry.data).filter(([, array]) => array.length > 0));
    }

    return {
        geometries,
        materialLibs,
    };
}

/** Model-space rules for extracting the front from the atlas-mapped OBJ. */
const CARD_MESH_LAYOUT = Object.freeze({
    front_normal: Object.freeze([0.0, 1.0, 0.0]),
    front_normal_threshold: 0.999,
    front_uv_min: Object.freeze([0.5, 0.3]),
    front_uv_max: Object.freeze([1.0, 1.0]),
    uv_tolerance: 0.001,
});

/** Return a validated normalized three-component vector. */
function normalizedLayoutVector(value, name)
{
    if(!Array.isArray(value) || value.length != 3
       || !value.every(Number.isFinite))
    {
        throw(new Error(`Invalid ${name}.`));
    }
    const length = Math.hypot(...value);
    if(length < 1e-12)
    {
        throw(new Error(`Invalid ${name}: vector has zero length.`));
    }
    return [value[0] / length, value[1] / length, value[2] / length];
}

/** Return a geometry with empty arrays matching the source attributes. */
function emptyPartitionGeometry(geometry, suffix, material)
{
    const data = {};
    for(const name of Object.keys(geometry.data))
    {
        data[name] = [];
    }
    return {
        object: `${geometry.object}/${suffix}`,
        groups: geometry.groups,
        material,
        data,
    };
}

/** Validate geometry arrays and return their components per vertex. */
function geometryComponents(geometry)
{
    if(geometry == null || geometry.data == null
       || !Array.isArray(geometry.data.position)
       || !Array.isArray(geometry.data.texcoord))
    {
        throw(new Error("Card geometry requires positions and texcoords."));
    }
    const vertex_count = geometry.data.position.length / 3;
    if(vertex_count == 0 || !Number.isInteger(vertex_count)
       || vertex_count % 3 != 0)
    {
        throw(new Error(
            `Card geometry ${geometry.object} has incomplete triangles.`));
    }

    const components = {};
    for(const [name, data] of Object.entries(geometry.data))
    {
        if(!Array.isArray(data) || data.length == 0
           || !data.every(Number.isFinite)
           || data.length % vertex_count != 0)
        {
            throw(new Error(
                `Card geometry ${geometry.object} has invalid ${name} data.`));
        }
        components[name] = data.length / vertex_count;
    }
    if(components.position != 3 || components.texcoord != 2
       || (components.normal != null && components.normal != 3))
    {
        throw(new Error(
            `Card geometry ${geometry.object} has invalid attribute sizes.`));
    }
    return components;
}

/** Remap one validated card-front coordinate into the unit square. */
function remapCardFrontUv(u, v, layout, geometry_name, triangle)
{
    const values = [u, v];
    const remapped = [];
    for(let axis = 0; axis < 2; ++axis)
    {
        const minimum = layout.front_uv_min[axis];
        const maximum = layout.front_uv_max[axis];
        if(values[axis] < minimum - layout.uv_tolerance
           || values[axis] > maximum + layout.uv_tolerance)
        {
            const coordinate = axis == 0 ? "u" : "v";
            throw(new Error(
                `Front UV outside atlas region in ${geometry_name} triangle `
                + `${triangle}: ${coordinate}=${values[axis]}, expected `
                + `${minimum}..${maximum} (tolerance `
                + `${layout.uv_tolerance}).`));
        }
        const value = (values[axis] - minimum) / (maximum - minimum);
        remapped.push(Math.min(Math.max(value, 0.0), 1.0));
    }
    return remapped;
}

/** Append one source triangle, optionally remapping its texture coordinates. */
function appendPartitionTriangle(source, destination, components,
                                 triangle, layout)
{
    const first_vertex = triangle * 3;
    for(const [name, component_count] of Object.entries(components))
    {
        const first = first_vertex * component_count;
        const last = first + 3 * component_count;
        if(name != "texcoord" || layout == null)
        {
            destination.data[name].push(
                ...source.data[name].slice(first, last));
            continue;
        }

        for(let vertex = 0; vertex < 3; ++vertex)
        {
            const offset = first + 2 * vertex;
            destination.data.texcoord.push(...remapCardFrontUv(
                source.data.texcoord[offset],
                source.data.texcoord[offset + 1], layout,
                source.object, triangle));
        }
    }
}

/** Partition and remap an atlas-mapped card into front and shell geometry. */
function partitionCardGeometry(geometry, layout)
{
    const components = geometryComponents(geometry);
    if(layout == null || !Number.isFinite(layout.front_normal_threshold)
       || layout.front_normal_threshold < -1.0
       || layout.front_normal_threshold > 1.0
       || !Number.isFinite(layout.uv_tolerance)
       || layout.uv_tolerance < 0.0)
    {
        throw(new Error("Invalid card mesh layout."));
    }
    const front_normal = normalizedLayoutVector(
        layout.front_normal, "card front normal");
    const uv_min = layout.front_uv_min;
    const uv_max = layout.front_uv_max;
    if(!Array.isArray(uv_min) || !Array.isArray(uv_max)
       || uv_min.length != 2 || uv_max.length != 2
       || !uv_min.every(Number.isFinite) || !uv_max.every(Number.isFinite)
       || uv_min[0] >= uv_max[0] || uv_min[1] >= uv_max[1])
    {
        throw(new Error("Invalid card front UV rectangle."));
    }

    const front = emptyPartitionGeometry(geometry, "front", "front");
    const shell = emptyPartitionGeometry(geometry, "shell", "shell");
    const positions = geometry.data.position;
    const texcoords = geometry.data.texcoord;
    const triangle_count = positions.length / 9;

    for(let triangle = 0; triangle < triangle_count; ++triangle)
    {
        const offset = triangle * 9;
        const edge_1 = [
            positions[offset + 3] - positions[offset],
            positions[offset + 4] - positions[offset + 1],
            positions[offset + 5] - positions[offset + 2],
        ];
        const edge_2 = [
            positions[offset + 6] - positions[offset],
            positions[offset + 7] - positions[offset + 1],
            positions[offset + 8] - positions[offset + 2],
        ];
        const face_normal = [
            edge_1[1] * edge_2[2] - edge_1[2] * edge_2[1],
            edge_1[2] * edge_2[0] - edge_1[0] * edge_2[2],
            edge_1[0] * edge_2[1] - edge_1[1] * edge_2[0],
        ];
        const normal_length = Math.hypot(...face_normal);
        if(normal_length < 1e-12)
        {
            throw(new Error(
                `Degenerate triangle ${triangle} in ${geometry.object}.`));
        }
        const facing = (face_normal[0] * front_normal[0]
                      + face_normal[1] * front_normal[1]
                      + face_normal[2] * front_normal[2]) / normal_length;
        if(facing < layout.front_normal_threshold)
        {
            appendPartitionTriangle(
                geometry, shell, components, triangle, null);
            continue;
        }

        appendPartitionTriangle(
            geometry, front, components, triangle, layout);
    }

    for(const partition of [front, shell])
    {
        for(const [name, data] of Object.entries(partition.data))
        {
            if(data.length == 0)
            {
                delete partition.data[name];
            }
        }
    }
    return {front, shell};
}

if(typeof module != "undefined")
{
    module.exports = {
        CARD_MESH_LAYOUT,
        parseOBJ,
        partitionCardGeometry,
    };
}
