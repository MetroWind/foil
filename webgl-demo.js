/** Load and parse one OBJ resource during demo initialization. */
function loadModel(url)
{
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.send(null);
    if(request.status != 200 && request.status != 0)
    {
        throw(new Error(`Failed to load ${url}: HTTP ${request.status}`));
    }
    return parseOBJ(request.responseText);
}

/** Construct the physical card material and every parsed geometry. */
function initScene(gl, program, obj_model)
{
    const card_description = {
        artwork: "card_texture.png",
        foil: {
            kind: "physical_linear",
            control: "foil_control_v2.png?version=constant-spacing-1",
        },
    };
    if(card_description.foil.kind != "physical_linear")
    {
        throw(new Error(
            `Unsupported physical foil kind: ${card_description.foil.kind}`));
    }

    const material = new PhysicalFoilMaterial(
        gl, card_description.artwork, card_description.foil.control,
        "spectral_xyz.bin");
    const models = [];
    for(const geometry of obj_model.geometries)
    {
        models.push(new Model(gl, program, geometry, material));
    }
    return new Scene(models);
}

/** Build the projection, view, and interactive card-model matrices. */
function calculateMatrices(canvas, camera_rotation)
{
    const mat4 = glMatrix.mat4;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const projection_matrix = mat4.perspective(
        mat4.create(), Math.PI / 8.0, aspect, 0.1, 100.0);
    const view_matrix = mat4.translate(
        mat4.create(), mat4.create(), [0.0, 0.0, -5.0]);
    const model_matrix = mat4.create();
    mat4.rotateX(model_matrix, model_matrix, Math.PI / 2.0);
    mat4.rotateX(model_matrix, model_matrix, camera_rotation[0]);
    mat4.rotateZ(model_matrix, model_matrix, camera_rotation[1]);
    return {projection_matrix, view_matrix, model_matrix};
}

/** Normalize a pointer position around the center of the short canvas axis. */
function getNormalizedMousePos(move_event, canvas)
{
    const rect = canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const mouse_x = (move_event.clientX - rect.left
                    - (rect.width - size) * 0.5) / size - 0.5;
    const mouse_y = (rect.height - (move_event.clientY - rect.top)
                    - (rect.height - size) * 0.5) / size - 0.5;
    return [mouse_x, mouse_y];
}

/** Smoothly bound an unbounded pointer coordinate to a half turn. */
function asymptoticBound(value)
{
    return Math.atan(value) / Math.PI;
}

/** Internal compile-time shader variants for renderer quality. */
const RENDER_QUALITY = Object.freeze({
    LOW: Object.freeze({
        LIGHT_SAMPLE_COUNT: 2,
        ORDER_COUNT: 3,
        SPECTRAL_TAP_COUNT: 1,
    }),
    DEFAULT: Object.freeze({
        LIGHT_SAMPLE_COUNT: 4,
        ORDER_COUNT: 4,
        SPECTRAL_TAP_COUNT: 9,
    }),
    HIGH: Object.freeze({
        LIGHT_SAMPLE_COUNT: 8,
        ORDER_COUNT: 8,
        SPECTRAL_TAP_COUNT: 9,
    }),
});

// Internal calibration, deliberately separate from artist-authored fields.
// A value of 1.0 uses the baseline energy budget; the supported range is
// 0.0 through 6.0. Increasing it moves energy from print into diffraction.
const FOIL_CALIBRATION = Object.freeze({
    FOIL_INTENSITY: 0.5,
});

// Display-referred post-processing, separate from physical light/material
// calibration. Lowering the white point makes dull whites reach display white;
// midtone values above one brighten midtones without moving the endpoints.
const OUTPUT_CALIBRATION = Object.freeze({
    LEVELS_BLACK_POINT: 0.0,
    LEVELS_WHITE_POINT: 0.88,
    LEVELS_MIDTONE: 1.0,
});

/** Initialize and run the physical foil demo. */
function main()
{
    try
    {
        const canvas = document.getElementById("GLCanvas");
        const gl = canvas.getContext("webgl2");
        if(!gl)
        {
            throw(new Error("Failed to initialize WebGL 2."));
        }

        // Quality is a renderer policy, not an artist-authored material
        // parameter. Keep the selected variant here so the shader loops have
        // compile-time bounds on WebGL implementations that require unrolling.
        const quality = RENDER_QUALITY.DEFAULT;
        if(!Number.isFinite(FOIL_CALIBRATION.FOIL_INTENSITY)
           || FOIL_CALIBRATION.FOIL_INTENSITY < 0.0
           || FOIL_CALIBRATION.FOIL_INTENSITY > 6.0)
        {
            throw(new Error("FOIL_INTENSITY must be between 0.0 and 6.0."));
        }
        if(!Number.isFinite(OUTPUT_CALIBRATION.LEVELS_BLACK_POINT)
           || !Number.isFinite(OUTPUT_CALIBRATION.LEVELS_WHITE_POINT)
           || !Number.isFinite(OUTPUT_CALIBRATION.LEVELS_MIDTONE)
           || OUTPUT_CALIBRATION.LEVELS_BLACK_POINT < 0.0
           || OUTPUT_CALIBRATION.LEVELS_WHITE_POINT > 1.0
           || OUTPUT_CALIBRATION.LEVELS_BLACK_POINT
              >= OUTPUT_CALIBRATION.LEVELS_WHITE_POINT
           || OUTPUT_CALIBRATION.LEVELS_MIDTONE <= 0.0)
        {
            throw(new Error("Invalid output Levels calibration."));
        }
        const shader_definitions = Object.assign(
            {}, quality, FOIL_CALIBRATION, OUTPUT_CALIBRATION);
        const program = new ShaderProgram(
            gl, "vert-shader.glsl?version=physical-brdf-7",
            "frag-shader.glsl?version=physical-brdf-7",
            shader_definitions);
        const renderer = new Renderer(gl, program);
        const scene = initScene(gl, program, loadModel("model/card.obj"));
        // const light = new DiskLight(
        //     [-1.5, 1.8, 2.0],  // Position: [x, y, z]
        //     [1.5, -1.8, -2.0], // Direction the light faces
        //     0.65,              // Radius
        //     20.45,             // Radiance
        // );
        const light = new DiskLight(
            [0, 0, 2.0],  // Position: [x, y, z]
            [0, 0, -2.0], // Direction the light faces
            1,              // Radius
            3.6,             // Radiance
        );
        const camera_rotation = [0.0, 0.0];

        /** Draw one animation frame using the latest pointer rotation. */
        function render()
        {
            const matrices = calculateMatrices(canvas, camera_rotation);
            renderer.draw(scene, matrices, light);
            requestAnimationFrame(render);
        }

        canvas.addEventListener("mousemove", function rotateCard(event)
        {
            const position = getNormalizedMousePos(event, canvas);
            camera_rotation[0] = -asymptoticBound(position[1] * 10.0);
            camera_rotation[1] = -asymptoticBound(position[0] * 10.0);
        });
        requestAnimationFrame(render);
    }
    catch(error)
    {
        console.error(error);
    }
}

window.addEventListener("load", main);
