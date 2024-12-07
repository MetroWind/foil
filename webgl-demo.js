function initScene(gl, obj_model)
{
    let models = [];
    for(const geo of obj_model.geometries)
    {
        models.push(new Model(gl, geo.data.position, geo.data.texcoord));
    }

    models[0].addTexture("test-uv.png");

    return new Scene(models);
}

function drawScene(canvas, gl, program, scene, camera_rotation=[0.0, 0.0, 0.0])
{
    const mat4 = glMatrix.mat4;
    resizeCanvas(canvas, gl);

    // Setup camera
    const fov = Math.PI / 8;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const z_near = 0.1;
    const z_far = 100.0;
    const projection_matrix = mat4.create();

    // note: glMatrix always has the first argument
    // as the destination to receive the result.
    mat4.perspective(projection_matrix, fov, aspect, z_near, z_far);

    // Set the drawing position to the "identity" point, which is
    // the center of the scene.
    const model_view_matrix = mat4.create();
    // Now move the drawing position a bit to where we want to
    // start drawing the square.
    mat4.rotateX(model_view_matrix, model_view_matrix, Math.PI / 2);
    mat4.translate(
        model_view_matrix, // destination matrix
        model_view_matrix, // matrix to translate
        [0.0, -5.0, 0.0],
    ); // amount to translate
    mat4.rotateX(model_view_matrix, model_view_matrix, camera_rotation[0]);
    mat4.rotateY(model_view_matrix, model_view_matrix, camera_rotation[1]);
    mat4.rotateZ(model_view_matrix, model_view_matrix, camera_rotation[2]);

    gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_projection"),
                        false, projection_matrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, "u_view"),
                        false, model_view_matrix);

    for(const model of scene.models)
    {
        model.texture_coords.use(program, "a_texcoord", {component_count: 2});
        model.vertices.use(program, "a_position", {});
        model.textures[0].use();
        gl.drawArrays(gl.TRIANGLES, 0, model.vertex_count);
    }
}

// Usually mouse position (either x or y) is from 0 to canvas
// width/height. This function normalizes it to [-0.5, 0.5] on the
// shorter direction. (0, 0) is set to be the center of canvas.
function getNormalizedMousePos(move_event, canvas)
{
    const rect = canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    mouse_x = (move_event.clientX - rect.left - (rect.width - size) * 0.5) / size - 0.5;
    // bottom is 0 in WebGL
    mouse_y = (rect.height - (move_event.clientY - rect.top) - (rect.height - size) * 0.5) / size - 0.5;
    return [mouse_x, mouse_y];
}

// This function returns a number ∈ (-0.5, 0.5). The return value
// monotonically increases with x, and approaches both the lower and
// upper bound asymptotically.
function asyBound(x)
{
    return Math.atan(x) / Math.PI;
}

function main()
{
    const canvas = document.getElementById("GLCanvas");
    const gl = canvas.getContext("webgl2");
    if(!gl)
    {
        console.error("Failed to initialize WebGL 2.");
        return;
    }

    gl.enable(gl.DEPTH_TEST); // Enable depth testing
    gl.depthFunc(gl.LEQUAL); // Near things obscure far things
    gl.enable(gl.CULL_FACE);
    // setup GLSL program
    const program = createProgramFromScripts(gl, "VertShader", "FragShader");

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);

    let xhr = new XMLHttpRequest();
    xhr.open("GET", "model/card.obj", false);
    xhr.send(null);
    if(xhr.status != 200)
    {
        throw("Failed to get model");
    }
    const model = parseOBJ(xhr.response);

    let deltaTime = 0;
    let then = 0;
    let camera_rotation = [0.0, 0.0, 0.0]
    // Draw the scene repeatedly

    const scene = initScene(gl, model);
    function render(now)
    {
        now *= 0.001; // convert to seconds
        deltaTime = now - then;
        then = now;

        drawScene(canvas, gl, program, scene, camera_rotation);
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render, camera_rotation);
    window.addEventListener('resize', () => resizeCanvas(canvas, gl));
    canvas.addEventListener('mousemove', (e) => {
        const pos = getNormalizedMousePos(e, canvas);
        camera_rotation[0] = - asyBound(pos[1] * 10);
        camera_rotation[2] = - asyBound(pos[0] * 10);
    });
}

window.addEventListener('load', main);
