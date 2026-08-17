/**
 * Creates and compiles a shader.
 *
 * @param {!WebGLRenderingContext} gl The WebGL Context.
 * @param {string} shader_source The GLSL source code for the shader.
 * @param {number} shader_type The type of shader, VERTEX_SHADER or
 *     FRAGMENT_SHADER.
 * @return {!WebGLShader} The shader.
 */
function compileShader(gl, shader_source, shader_type)
{
    // Create the shader object
    var shader = gl.createShader(shader_type);

    // Set the shader source code.
    gl.shaderSource(shader, shader_source);

    // Compile the shader
    gl.compileShader(shader);

    // Check if it compiled
    var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if(!success)
    {
        // Something went wrong during compilation; get the error
        throw(gl.getShaderInfoLog(shader));
    }

    return shader;
}

/**
 * Creates a shader from the content of a script tag.
 *
 * @param {!WebGLRenderingContext} gl The WebGL Context.
 * @param {string} script_id The id of the script tag.
 * @param {string} shader_type. The type of shader to create.
 *     If not passed in will use the type attribute from the
 *     script tag.
 * @return {!WebGLShader} A shader.
 */
function createShaderFromScript(gl, script_id)
{
    // look up the script tag by id.
    let shader_script = document.getElementById(script_id);
    if(!shader_script)
    {
        throw("*** Error: unknown script element" + script_id);
    }

    let src = shader_script.getAttribute("src");
    let shader_source = "";

    if(src == null)
    {
        shader_source = shader_script.text;
    }
    else
    {
        var req = new XMLHttpRequest();
        req.open("GET", src, false); // false for synchronous request
        req.send(null);
        shader_source = req.responseText;
    }

    // extract the contents of the script tag.
    let shader_type = null;
    if(shader_script.type == "x-shader/x-vertex")
    {
        shader_type = gl.VERTEX_SHADER;
    }
    else if(shader_script.type == "x-shader/x-fragment")
    {
        shader_type = gl.FRAGMENT_SHADER;
    }
    else
    {
        throw("Shader type unsupported: " + shader_type);
    }

    try
    {
        return compileShader(gl, shader_source, shader_type);
    }
    catch(e)
    {
        throw(`Failed to compile shader at #${script_id}: ${e}`)
    }
};

/**
 * Creates a program from 2 shaders.
 *
 * @param {!WebGLRenderingContext) gl The WebGL context.
 * @param {!WebGLShader} vertex_shader A vertex shader.
 * @param {!WebGLShader} fragment_shader A fragment shader.
 * @return {!WebGLProgram} A program.
 */
function createProgram(gl, vertex_shader, fragment_shader)
{
    // create a program.
    var program = gl.createProgram();

    // attach the shaders.
    gl.attachShader(program, vertex_shader);
    gl.attachShader(program, fragment_shader);

    // link the program.
    gl.linkProgram(program);

    // Check if it linked.
    var success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if(!success)
    {
        // something went wrong with the link; get the error
        throw ("program failed to link:" + gl.getProgramInfoLog(program));
    }

    return program;
};

/**
 * Creates a program from 2 script tags.
 *
 * @param {!WebGLRenderingContext} gl The WebGL Context.
 * @param {string} vertex_shader_id The id of the vertex shader script tag.
 * @param {string} fragment_shader_id The id of the fragment shader script tag.
 * @return {!WebGLProgram} A program
 */
function createProgramFromScripts(gl, vertex_shader_id, fragment_shader_id)
{
    var vertexShader = createShaderFromScript(gl, vertex_shader_id, gl.VERTEX_SHADER);
    var fragmentShader = createShaderFromScript(gl, fragment_shader_id, gl.FRAGMENT_SHADER);
    return createProgram(gl, vertexShader, fragmentShader);
}

function resizeCanvas(canvas, gl)
{
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
}

class VertexArray
{
    /** Create a complete set of vertex inputs for a drawable. */
    constructor(gl)
    {
        this.vertex_array = gl.createVertexArray();
        this.buffers = [];
        this.gl = gl;
    }

    /** Add one buffered attribute to this vertex array. */
    addAttribute(program, attr_name, data, {
        component_count = 3,
        num_type = this.gl.FLOAT,
        normalize = false,
        stride = 0,
        offset = 0,
    })
    {
        const buffer = this.gl.createBuffer();
        const attribute_ref = this.gl.getAttribLocation(program, attr_name);

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

/** Color-space behavior for texture resources. */
const TEXTURE_ROLE = Object.freeze({
    COLOR: "color",
    DATA: "data",
});

/** Foil variants understood by the fragment shader. */
const FOIL_KIND = Object.freeze({
    WIDE_ANGLE: 0,
    DIRECTIONAL: 1,
});

/** Convert an artist-facing foil-kind name into its shader value. */
function parseFoilKind(kind)
{
    if(kind == "wide_angle")
    {
        return FOIL_KIND.WIDE_ANGLE;
    }
    if(kind == "directional")
    {
        return FOIL_KIND.DIRECTIONAL;
    }
    throw(new Error(`Unknown foil kind: ${kind}`));
}

class Texture
{
    /** Create a texture and load its image asynchronously. */
    constructor(gl, url, {
        // OBJ texture coordinates use the opposite vertical convention from
        // the imported card artwork.
        flip_y = false,
        // A per-texture placeholder keeps sampling valid before image load.
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
        this.role = role;
        this.url = url;
        this.gl = gl;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // Keep the texture complete while its image loads.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA,
                      gl.UNSIGNED_BYTE,
                      new Uint8Array(placeholder_color));

        // Asynchronously load the image while preserving global unpack state.
        this.image = new Image();
        this.image.addEventListener('load', (event) => {
            const previous_flip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
            const previous_premultiply = gl.getParameter(
                gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
            const previous_color_space = gl.getParameter(
                gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);

            gl.bindTexture(gl.TEXTURE_2D, this.texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip_y);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            if(role == TEXTURE_ROLE.DATA)
            {
                gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
                               gl.NONE);
            }
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA,
                          gl.UNSIGNED_BYTE, event.target);

            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previous_flip);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
                           previous_premultiply);
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
                           previous_color_space);

            if(role == TEXTURE_ROLE.COLOR)
            {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
                                 gl.LINEAR_MIPMAP_LINEAR);
                gl.generateMipmap(gl.TEXTURE_2D);
            }

            this.width = event.target.naturalWidth;
            this.height = event.target.naturalHeight;
            console.debug(`Texture loaded: ${url}`);
            for(const listener of this.load_listeners)
            {
                listener(this);
            }
        });
        this.image.addEventListener('error', () => {
            console.error(`Failed to load texture: ${url}`);
        });
        this.image.src = url;
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

    /** Bind this texture to a sampler for drawing. */
    use(program, uniform_name, unit = 0)
    {
        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        const uniform_ref = this.gl.getUniformLocation(program, uniform_name);
        if(uniform_ref == null)
        {
            throw(new Error(`Texture uniform not found: ${uniform_name}`));
        }
        this.gl.uniform1i(uniform_ref, unit);
    }
}

class CardMaterial
{
    /** Create the artwork and packed foil control for a card. */
    constructor(gl, artwork_url, foil_kind, foil_control_url)
    {
        this.artwork = new Texture(gl, artwork_url, {flip_y: true});
        this.foil_control = new Texture(gl, foil_control_url, {
            flip_y: true,
            role: TEXTURE_ROLE.DATA,
        });
        this.foil_kind = parseFoilKind(foil_kind);
        this.gl = gl;

        this.artwork.onLoad(() => this.checkDimensions());
        this.foil_control.onLoad(() => this.checkDimensions());
    }

    /** Bind all card material state before drawing. */
    use(program)
    {
        this.artwork.use(program, "u_texture", 0);
        this.foil_control.use(program, "u_foil_control", 1);
        const kind_ref = this.gl.getUniformLocation(program, "u_foil_kind");
        if(kind_ref == null)
        {
            throw(new Error("Foil-kind uniform not found: u_foil_kind"));
        }
        this.gl.uniform1i(kind_ref, this.foil_kind);
    }

    /** Warn when artwork and foil fields do not share a pixel grid. */
    checkDimensions()
    {
        if(this.artwork.width == 0 || this.foil_control.width == 0)
        {
            return;
        }
        if(this.artwork.width != this.foil_control.width ||
           this.artwork.height != this.foil_control.height)
        {
            console.warn("Artwork and foil control dimensions differ.");
        }
    }
}

class Model
{
    /** Create a textured model from position and texture coordinates. */
    constructor(gl, program, vertices_coords, texture_coords, material)
    {
        this.vertex_array = new VertexArray(gl);
        this.vertex_array.addAttribute(program, "a_position",
                                       new Float32Array(vertices_coords), {});
        this.vertex_array.addAttribute(program, "a_texcoord",
                                       new Float32Array(texture_coords),
                                       {component_count: 2});
        this.vertex_count = vertices_coords.length / 3;
        this.material = material;
        this.gl = gl;
    }
}

class Scene
{
    constructor(models)
    {
        this.models = models;
    }
}
