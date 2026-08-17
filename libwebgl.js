/** Fetch one text resource synchronously during demo initialization. */
function loadTextResource(url)
{
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.send(null);
    if(request.status != 200 && request.status != 0)
    {
        throw(new Error(`Failed to load ${url}: HTTP ${request.status}`));
    }
    return request.responseText;
}

/** Insert validated compile-time numeric definitions after GLSL #version. */
function defineShaderConstants(source, definitions)
{
    const version_end = source.indexOf("\n");
    if(!source.startsWith("#version ") || version_end < 0)
    {
        throw(new Error("Shader source does not begin with #version."));
    }

    let definition_source = "";
    for(const [name, value] of Object.entries(definitions))
    {
        if(!/^[A-Z][A-Z0-9_]*$/.test(name) ||
           !Number.isFinite(value) || value < 0.0)
        {
            throw(new Error(`Invalid shader definition: ${name}=${value}`));
        }
        definition_source += `#define ${name} ${value}\n`;
    }
    return source.slice(0, version_end + 1) + definition_source
         + source.slice(version_end + 1);
}

/** Compile one shader and include its URL in any diagnostic. */
function compileShader(gl, source, shader_type, url)
{
    const shader = gl.createShader(shader_type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw(new Error(`Failed to compile ${url}: ${message}`));
    }
    return shader;
}

/** Link two compiled shaders into one WebGL program. */
function linkProgram(gl, vertex_shader, fragment_shader,
                     vertex_url, fragment_url)
{
    const program = gl.createProgram();
    gl.attachShader(program, vertex_shader);
    gl.attachShader(program, fragment_shader);
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program, gl.LINK_STATUS))
    {
        const message = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw(new Error(
            `Failed to link ${vertex_url} with ${fragment_url}: ${message}`));
    }
    return program;
}

/** Own a linked shader program and cache required variable locations. */
class ShaderProgram
{
    /** Compile and link a program from vertex and fragment source URLs. */
    constructor(gl, vertex_url, fragment_url, fragment_definitions = {})
    {
        const vertex_shader = compileShader(
            gl, loadTextResource(vertex_url), gl.VERTEX_SHADER, vertex_url);
        const fragment_source = defineShaderConstants(
            loadTextResource(fragment_url), fragment_definitions);
        const fragment_shader = compileShader(
            gl, fragment_source, gl.FRAGMENT_SHADER, fragment_url);
        this.program = linkProgram(
            gl, vertex_shader, fragment_shader, vertex_url, fragment_url);
        gl.deleteShader(vertex_shader);
        gl.deleteShader(fragment_shader);

        this.attribute_locations = new Map();
        this.uniform_locations = new Map();
        this.gl = gl;
    }

    /** Bind this program for subsequent drawing. */
    use()
    {
        this.gl.useProgram(this.program);
    }

    /** Return a required cached uniform location or throw. */
    uniform(name)
    {
        if(!this.uniform_locations.has(name))
        {
            const location = this.gl.getUniformLocation(this.program, name);
            this.uniform_locations.set(name, location);
        }
        const location = this.uniform_locations.get(name);
        if(location == null)
        {
            throw(new Error(`Required uniform not found: ${name}`));
        }
        return location;
    }

    /** Return a cached uniform location, or null when it is not active. */
    optionalUniform(name)
    {
        if(!this.uniform_locations.has(name))
        {
            const location = this.gl.getUniformLocation(this.program, name);
            this.uniform_locations.set(name, location);
        }
        return this.uniform_locations.get(name);
    }

    /** Return a required cached attribute location or throw. */
    attribute(name)
    {
        if(!this.attribute_locations.has(name))
        {
            const location = this.gl.getAttribLocation(this.program, name);
            if(location < 0)
            {
                throw(new Error(`Required attribute not found: ${name}`));
            }
            this.attribute_locations.set(name, location);
        }
        return this.attribute_locations.get(name);
    }
}

/** Resize the drawing buffer and viewport to the displayed canvas size. */
function resizeCanvas(canvas, gl)
{
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if(canvas.width != width || canvas.height != height)
    {
        canvas.width = width;
        canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
}

/** Own a complete set of buffered vertex inputs for a drawable. */
class VertexArray
{
    /** Create an initially empty vertex array. */
    constructor(gl)
    {
        this.vertex_array = gl.createVertexArray();
        this.buffers = [];
        this.gl = gl;
    }

    /** Add one buffered attribute to this vertex array. */
    addAttribute(program, attribute_name, data, {
        component_count = 3,
        num_type = this.gl.FLOAT,
        normalize = false,
        stride = 0,
        offset = 0,
    })
    {
        const buffer = this.gl.createBuffer();
        const attribute_ref = program.attribute(attribute_name);

        this.gl.bindVertexArray(this.vertex_array);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, data, this.gl.STATIC_DRAW);
        this.gl.enableVertexAttribArray(attribute_ref);
        this.gl.vertexAttribPointer(attribute_ref, component_count, num_type,
                                    normalize, stride, offset);
        this.buffers.push(buffer);
    }

    /** Bind this vertex array for drawing. */
    use()
    {
        this.gl.bindVertexArray(this.vertex_array);
    }
}

/** Color-space behavior for image texture resources. */
const TEXTURE_ROLE = Object.freeze({
    COLOR: "color",
    DATA: "data",
});

/** Own one asynchronously loaded image texture. */
class Texture
{
    /** Create a texture and start loading its image. */
    constructor(gl, url, {
        flip_y = false,
        placeholder_color = null,
        role = TEXTURE_ROLE.COLOR,
    } = {})
    {
        if(!Object.values(TEXTURE_ROLE).includes(role))
        {
            throw(new Error(`Unknown texture role: ${role}`));
        }
        if(placeholder_color == null)
        {
            placeholder_color = role == TEXTURE_ROLE.DATA
                ? [0, 0, 0, 0]
                : [0, 0, 255, 255];
        }

        this.texture = gl.createTexture();
        this.load_listeners = [];
        this.width = 0;
        this.height = 0;
        this.flip_y = flip_y;
        this.role = role;
        this.url = url;
        this.gl = gl;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA,
                      gl.UNSIGNED_BYTE,
                      new Uint8Array(placeholder_color));

        this.image = new Image();
        this.image.addEventListener("load", this.handleLoad.bind(this));
        this.image.addEventListener("error", this.handleError.bind(this));
        this.image.src = url;
    }

    /** Upload a successfully loaded image while preserving unpack state. */
    handleLoad(event)
    {
        const gl = this.gl;
        const previous_flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
        const previous_premultiply = gl.getParameter(
            gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
        const previous_color_space = gl.getParameter(
            gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);

        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.flip_y);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        if(this.role == TEXTURE_ROLE.DATA)
        {
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA,
                      gl.UNSIGNED_BYTE, event.target);

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previous_flip);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
                       previous_premultiply);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
                       previous_color_space);

        if(this.role == TEXTURE_ROLE.COLOR)
        {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
                             gl.LINEAR_MIPMAP_LINEAR);
            gl.generateMipmap(gl.TEXTURE_2D);
        }

        this.width = event.target.naturalWidth;
        this.height = event.target.naturalHeight;
        for(const listener of this.load_listeners)
        {
            listener(this);
        }
    }

    /** Report an image-load failure with its complete URL. */
    handleError()
    {
        throw(new Error(`Failed to load texture: ${this.url}`));
    }

    /** Run a callback after this texture has loaded. */
    onLoad(listener)
    {
        this.load_listeners.push(listener);
        if(this.width > 0 && this.height > 0)
        {
            listener(this);
        }
    }

    /** Bind this texture to a required sampler uniform. */
    use(program, uniform_name, unit)
    {
        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.uniform1i(program.uniform(uniform_name), unit);
    }
}

/** Own the D65-weighted CIE XYZ floating-point lookup texture. */
class SpectralLut
{
    /** Load, validate, and upload the binary spectral table. */
    constructor(gl, url)
    {
        this.texture = gl.createTexture();
        this.load_listeners = [];
        this.loaded = false;
        this.failed = false;
        this.pending_reported = false;
        this.url = url;
        this.gl = gl;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA,
                      gl.FLOAT, new Float32Array([0.0, 0.0, 0.0, 0.0]));

        const request = new XMLHttpRequest();
        request.open("GET", url, true);
        request.responseType = "arraybuffer";
        request.addEventListener("load", this.handleLoad.bind(this));
        request.addEventListener("error", this.handleError.bind(this));
        request.send(null);
        this.request = request;
    }

    /** Validate and upload a completed binary request. */
    handleLoad(event)
    {
        const request = event.target;
        if(request.status != 200 && request.status != 0)
        {
            this.failed = true;
            throw(new Error(
                `Failed to load ${this.url}: HTTP ${request.status}`));
        }
        if(request.response == null || request.response.byteLength != 6416)
        {
            this.failed = true;
            const actual_size = request.response == null
                ? 0
                : request.response.byteLength;
            throw(new Error(
                `Malformed ${this.url}: expected 6416 bytes, got `
                + actual_size));
        }

        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 401, 1, 0,
                      gl.RGBA, gl.FLOAT,
                      new Float32Array(request.response));
        this.loaded = true;
        for(const listener of this.load_listeners)
        {
            listener(this);
        }
    }

    /** Report a binary-resource request failure. */
    handleError()
    {
        this.failed = true;
        throw(new Error(`Failed to load spectral table: ${this.url}`));
    }

    /** Run a callback after successful validation and upload. */
    onLoad(listener)
    {
        this.load_listeners.push(listener);
        if(this.loaded)
        {
            listener(this);
        }
    }

    /** Bind the spectral table to a required sampler uniform. */
    use(program, texture_unit)
    {
        if(!this.loaded && !this.failed && !this.pending_reported)
        {
            console.info(`Spectral table pending: ${this.url}`);
            this.pending_reported = true;
        }
        this.gl.activeTexture(this.gl.TEXTURE0 + texture_unit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.uniform1i(program.uniform("u_spectral_xyz"), texture_unit);
    }
}

/** Own artwork, physical foil controls, and the spectral lookup. */
class PhysicalFoilMaterial
{
    /** Load every resource required by a physical foil card. */
    constructor(gl, artwork_url, control_url, spectral_url)
    {
        this.artwork = new Texture(gl, artwork_url, {flip_y: true});
        this.foil_control = new Texture(gl, control_url, {
            flip_y: true,
            role: TEXTURE_ROLE.DATA,
        });
        this.spectral_lut = new SpectralLut(gl, spectral_url);
        this.gl = gl;

        this.artwork.onLoad(this.checkDimensions.bind(this));
        this.foil_control.onLoad(this.checkDimensions.bind(this));
    }

    /** Bind all physical card material resources. */
    use(program)
    {
        this.artwork.use(program, "u_artwork", 0);
        this.foil_control.use(program, "u_foil_control", 1);
        this.spectral_lut.use(program, 2);
    }

    /** Require artwork and control fields to use the same pixel grid. */
    checkDimensions()
    {
        if(this.artwork.width == 0 || this.foil_control.width == 0)
        {
            return;
        }
        if(this.artwork.width != this.foil_control.width ||
           this.artwork.height != this.foil_control.height)
        {
            throw(new Error(
                "Artwork and physical foil control dimensions differ: "
                + `${this.artwork.width}x${this.artwork.height} and `
                + `${this.foil_control.width}x${this.foil_control.height}`));
        }
    }
}

/** Return the cross product of two three-dimensional arrays. */
function crossVector(left, right)
{
    return [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ];
}

/** Return a normalized vector or a caller-provided fallback. */
function normalizeVector(value, fallback)
{
    const length = Math.hypot(value[0], value[1], value[2]);
    if(length < 1e-8)
    {
        return fallback.slice();
    }
    return value.map(function divideVectorComponent(component)
    {
        return component / length;
    });
}

/** Return whether a value is a finite three-dimensional numeric array. */
function isFiniteVector3(value)
{
    return (Array.isArray(value) || ArrayBuffer.isView(value))
        && value.length == 3
        && value.every(Number.isFinite);
}

/** Calculate UV-aligned normals and tangent vectors for triangle data. */
function calculateTangentFrames(positions, texcoords, source_normals,
                                geometry_name)
{
    const normals = [];
    const tangents = [];
    let warned_degenerate_uv = false;

    for(let vertex = 0; vertex < positions.length / 3; vertex += 3)
    {
        const position = [];
        const uv = [];
        const normal = [];
        for(let local_vertex = 0; local_vertex < 3; ++local_vertex)
        {
            const position_offset = 3 * (vertex + local_vertex);
            const uv_offset = 2 * (vertex + local_vertex);
            position.push(positions.slice(position_offset,
                                          position_offset + 3));
            uv.push(texcoords.slice(uv_offset, uv_offset + 2));
            if(source_normals != null)
            {
                normal.push(source_normals.slice(position_offset,
                                                 position_offset + 3));
            }
        }

        const edge_1 = position[1].map(
            function subtractFirstPosition(value, index)
            {
                return value - position[0][index];
            });
        const edge_2 = position[2].map(
            function subtractSecondPosition(value, index)
            {
                return value - position[0][index];
            });
        const face_normal = normalizeVector(crossVector(edge_1, edge_2),
                                            [0.0, 1.0, 0.0]);
        const uv_1 = [uv[1][0] - uv[0][0], uv[1][1] - uv[0][1]];
        const uv_2 = [uv[2][0] - uv[0][0], uv[2][1] - uv[0][1]];
        const determinant = uv_1[0] * uv_2[1] - uv_1[1] * uv_2[0];

        let raw_tangent;
        let raw_bitangent;
        if(Math.abs(determinant) < 1e-8)
        {
            if(!warned_degenerate_uv)
            {
                console.warn(
                    `Degenerate UV triangle in geometry ${geometry_name}`);
                warned_degenerate_uv = true;
            }
            const reference = Math.abs(face_normal[2]) < 0.999
                ? [0.0, 0.0, 1.0]
                : [0.0, 1.0, 0.0];
            raw_tangent = normalizeVector(
                crossVector(reference, face_normal), [1.0, 0.0, 0.0]);
            raw_bitangent = crossVector(face_normal, raw_tangent);
        }
        else
        {
            const inverse = 1.0 / determinant;
            raw_tangent = edge_1.map(
                function calculateTangent(value, index)
                {
                    return inverse
                         * (uv_2[1] * value - uv_1[1] * edge_2[index]);
                });
            raw_bitangent = edge_1.map(
                function calculateBitangent(value, index)
                {
                    return inverse
                         * (-uv_2[0] * value + uv_1[0] * edge_2[index]);
                });
        }

        for(let local_vertex = 0; local_vertex < 3; ++local_vertex)
        {
            const vertex_normal = normal.length > 0
                ? normalizeVector(normal[local_vertex], face_normal)
                : face_normal;
            const normal_tangent = vertex_normal[0] * raw_tangent[0]
                                 + vertex_normal[1] * raw_tangent[1]
                                 + vertex_normal[2] * raw_tangent[2];
            const orthogonal_tangent = raw_tangent.map(
                function removeNormal(value, index)
                {
                    return value - normal_tangent * vertex_normal[index];
                });
            const tangent = normalizeVector(orthogonal_tangent,
                                            [1.0, 0.0, 0.0]);
            const handedness = crossVector(vertex_normal, tangent)
                .reduce(function dotBitangent(total, value, index)
                {
                    return total + value * raw_bitangent[index];
                }, 0.0) < 0.0 ? -1.0 : 1.0;
            normals.push(...vertex_normal);
            tangents.push(...tangent, handedness);
        }
    }
    return {normals, tangents};
}

/** Own one drawable geometry and its material. */
class Model
{
    /** Create a tangent-aware textured model from parsed OBJ geometry. */
    constructor(gl, program, geometry, material)
    {
        const data = geometry.data;
        const frame = calculateTangentFrames(
            data.position, data.texcoord, data.normal, geometry.object);

        this.vertex_array = new VertexArray(gl);
        this.vertex_array.addAttribute(
            program, "a_position", new Float32Array(data.position), {});
        this.vertex_array.addAttribute(
            program, "a_texcoord", new Float32Array(data.texcoord),
            {component_count: 2});
        this.vertex_array.addAttribute(
            program, "a_normal", new Float32Array(frame.normals), {});
        this.vertex_array.addAttribute(
            program, "a_tangent", new Float32Array(frame.tangents),
            {component_count: 4});
        this.vertex_count = data.position.length / 3;
        this.material = material;
        this.gl = gl;
    }
}

/** Store the drawable models in one scene. */
class Scene
{
    /** Create a scene from an ordered model list. */
    constructor(models)
    {
        this.models = models;
    }
}

/** Represent a one-sided disk emitter with D65 spectral radiance. */
class DiskLight
{
    /** Create a validated disk emitter in world space. */
    constructor(position, normal, radius, radiance)
    {
        const normal_length = isFiniteVector3(normal)
            ? Math.hypot(...normal)
            : 0.0;
        if(!isFiniteVector3(position) || normal_length < 1e-8
           || !Number.isFinite(radius) || !Number.isFinite(radiance)
           || radius <= 0.0 || radiance < 0.0)
        {
            throw(new Error("Disk-light parameters are invalid."));
        }
        this.position = position.slice();
        this.normal = normalizeVector(normal, [0.0, 0.0, -1.0]);
        const reference = Math.abs(this.normal[2]) < 0.999
            ? [0.0, 0.0, 1.0]
            : [0.0, 1.0, 0.0];
        this.axis_x = normalizeVector(crossVector(reference, this.normal),
                                      [1.0, 0.0, 0.0]);
        this.axis_y = normalizeVector(crossVector(this.normal, this.axis_x),
                                      [0.0, 1.0, 0.0]);
        this.radius = radius;
        this.radiance = radiance;
    }

    /** Transform and upload this disk light for the current view. */
    use(program, view_matrix)
    {
        const vec3 = glMatrix.vec3;
        const view_position = vec3.transformMat4(
            vec3.create(), this.position, view_matrix);
        const view_normal = vec3.transformMat3(
            vec3.create(), this.normal, glMatrix.mat3.fromMat4(
                glMatrix.mat3.create(), view_matrix));
        const view_axis_x = vec3.transformMat3(
            vec3.create(), this.axis_x, glMatrix.mat3.fromMat4(
                glMatrix.mat3.create(), view_matrix));
        const view_axis_y = vec3.transformMat3(
            vec3.create(), this.axis_y, glMatrix.mat3.fromMat4(
                glMatrix.mat3.create(), view_matrix));
        const gl = program.gl;
        gl.uniform3fv(program.uniform("u_light_position"), view_position);
        gl.uniform3fv(program.uniform("u_light_normal"), view_normal);
        gl.uniform3fv(program.uniform("u_light_axis_x"), view_axis_x);
        gl.uniform3fv(program.uniform("u_light_axis_y"), view_axis_y);
        gl.uniform1f(program.uniform("u_light_radius"), this.radius);
        gl.uniform1f(program.uniform("u_light_radiance"), this.radiance);
    }
}

/** Own frame-level WebGL state and draw scenes declaratively. */
class Renderer
{
    /** Create a renderer for one WebGL context and shader program. */
    constructor(gl, program)
    {
        this.canvas = gl.canvas;
        this.program = program;
        this.gl = gl;

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.CULL_FACE);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
    }

    /** Draw a scene under one disk light from supplied camera matrices. */
    draw(scene, camera, light)
    {
        const mat3 = glMatrix.mat3;
        const mat4 = glMatrix.mat4;
        const model_view_matrix = mat4.multiply(
            mat4.create(), camera.view_matrix, camera.model_matrix);
        const normal_matrix = mat3.normalFromMat4(
            mat3.create(), model_view_matrix);

        resizeCanvas(this.canvas, this.gl);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
        this.program.use();
        this.gl.uniformMatrix4fv(
            this.program.uniform("u_projection"), false,
            camera.projection_matrix);
        this.gl.uniformMatrix4fv(
            this.program.uniform("u_model_view"), false,
            model_view_matrix);
        this.gl.uniformMatrix3fv(
            this.program.uniform("u_normal_matrix"), false, normal_matrix);
        light.use(this.program, camera.view_matrix);

        for(const model of scene.models)
        {
            model.vertex_array.use();
            model.material.use(this.program);
            this.gl.drawArrays(this.gl.TRIANGLES, 0, model.vertex_count);
        }
    }
}

if(typeof module != "undefined")
{
    module.exports = {
        DiskLight,
        ShaderProgram,
        calculateTangentFrames,
        defineShaderConstants,
    };
}
