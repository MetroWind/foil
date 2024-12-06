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

// Push some JavaScript array “data” into a new vertex array, whose
// corresponding attribute is named “attr_name”. Return the new vertex
// array.
function createVertexArray(
    gl, program, data, attr_name, {
        component_count = 3,
        num_type = gl.FLOAT,
        normalize = false,
        stride = 0,
        offset = 0,
    })
{
    let vert_buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vert_buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    var position_ref = gl.getAttribLocation(program, attr_name);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(position_ref);
    gl.vertexAttribPointer(position_ref, component_count, num_type,
                           normalize, stride, offset);
    return vao;
}
