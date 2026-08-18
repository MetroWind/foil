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

/** Construct shared front and shell materials and their partitioned models. */
function initScene(gl, program, obj_model)
{
    const card_description = {
        front: {
            artwork: "card_front.png",
            foil_control: "card_front_foil.png",
        },
        shell_color_srgb: [0.5, 0.5, 0.5],
    };

    const front_material = new PhysicalFoilMaterial(
        gl, card_description.front.artwork,
        card_description.front.foil_control, "spectral_xyz.bin");
    const shell_material = new SolidColorMaterial(
        gl, card_description.shell_color_srgb);
    const models = [];
    const front_models = [];
    let front_triangle_count = 0;
    let shell_triangle_count = 0;
    for(const geometry of obj_model.geometries)
    {
        const partition = partitionCardGeometry(
            geometry, CARD_MESH_LAYOUT);
        const front_vertices = partition.front.data.position == null
            ? 0
            : partition.front.data.position.length / 3;
        const shell_vertices = partition.shell.data.position == null
            ? 0
            : partition.shell.data.position.length / 3;
        if(front_vertices > 0)
        {
            const front_model = new Model(
                gl, program, partition.front, front_material);
            models.push(front_model);
            front_models.push(front_model);
            front_triangle_count += front_vertices / 3;
        }
        if(shell_vertices > 0)
        {
            models.push(new Model(
                gl, program, partition.shell, shell_material));
            shell_triangle_count += shell_vertices / 3;
        }
    }
    if(front_triangle_count == 0 || shell_triangle_count == 0)
    {
        throw(new Error(
            "Card model must contain both front and shell triangles."));
    }
    return new CardScene(models, front_models, front_material);
}

/** Own the replaceable material shared by all card-front drawables. */
class CardScene extends Scene
{
    /** Create a card scene with one permanent default front material. */
    constructor(models, front_models, default_material)
    {
        super(models);
        this.front_models = front_models;
        this.default_material = default_material;
        this.front_material = default_material;
    }

    /** Atomically replace the material used by every front drawable. */
    setFrontMaterial(material)
    {
        const previous_material = this.front_material;
        for(const model of this.front_models)
        {
            model.material = material;
        }
        this.front_material = material;
        if(previous_material != this.default_material)
        {
            previous_material.dispose();
        }
    }

    /** Restore the bundled front material and release an uploaded one. */
    resetFrontMaterial()
    {
        this.setFrontMaterial(this.default_material);
    }

    /** Release all texture resources owned by this card scene. */
    dispose()
    {
        this.resetFrontMaterial();
        this.default_material.dispose();
    }
}

/** Decode and install temporary uploaded card materials. */
class CardMaterialController
{
    /** Connect upload processing to one card scene and WebGL context. */
    constructor(gl, card_scene)
    {
        this.gl = gl;
        this.card_scene = card_scene;
        this.load_revision = 0;
    }

    /** Decode both files and replace the front only after both succeed. */
    async applyFiles(artwork_file, control_file)
    {
        const revision = ++this.load_revision;
        const material = await PhysicalFoilMaterial.fromFiles(
            this.gl, artwork_file, control_file,
            this.card_scene.default_material.spectral_lut);
        if(revision != this.load_revision)
        {
            material.dispose();
            return null;
        }
        this.card_scene.setFrontMaterial(material);
        return {
            artwork: material.artwork,
            control: material.foil_control,
        };
    }

    /** Cancel pending work and restore the bundled card appearance. */
    reset()
    {
        ++this.load_revision;
        this.card_scene.resetFrontMaterial();
    }
}

/** Format a browser file size for compact upload metadata. */
function formatFileSize(byte_count)
{
    if(byte_count < 1024)
    {
        return `${byte_count} B`;
    }
    if(byte_count < 1024 * 1024)
    {
        return `${(byte_count / 1024).toFixed(1)} KiB`;
    }
    return `${(byte_count / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Coordinate upload form state without exposing WebGL primitives. */
class CardUploadUi
{
    /** Bind the upload form to one card-material controller. */
    constructor(controller)
    {
        this.controller = controller;
        this.form = document.getElementById("CardUploadForm");
        this.artwork_input = document.getElementById("ArtworkFile");
        this.control_input = document.getElementById("FoilControlFile");
        this.artwork_meta = document.getElementById("ArtworkMeta");
        this.control_meta = document.getElementById("FoilControlMeta");
        this.apply_button = document.getElementById("ApplyCardFiles");
        this.reset_button = document.getElementById("ResetCardFiles");
        this.status = document.getElementById("UploadStatus");

        this.form.addEventListener("submit", this.apply.bind(this));
        this.form.addEventListener("reset", this.reset.bind(this));
        this.artwork_input.addEventListener(
            "change", this.updateSelection.bind(this));
        this.control_input.addEventListener(
            "change", this.updateSelection.bind(this));
        this.updateSelection();
    }

    /** Refresh filenames and whether the paired upload can be applied. */
    updateSelection()
    {
        const artwork_file = this.artwork_input.files[0];
        const control_file = this.control_input.files[0];
        this.artwork_meta.textContent = artwork_file == null
            ? "No file selected"
            : `${artwork_file.name} · ${formatFileSize(artwork_file.size)}`;
        this.control_meta.textContent = control_file == null
            ? "No file selected"
            : `${control_file.name} · ${formatFileSize(control_file.size)}`;
        this.apply_button.disabled = artwork_file == null
            || control_file == null;
    }

    /** Decode and apply the currently selected file pair. */
    async apply(event)
    {
        event.preventDefault();
        const artwork_file = this.artwork_input.files[0];
        const control_file = this.control_input.files[0];
        if(artwork_file == null || control_file == null)
        {
            return;
        }

        this.setBusy(true);
        this.showStatus("Decoding images…", "progress");
        try
        {
            const textures = await this.controller.applyFiles(
                artwork_file, control_file);
            if(textures != null)
            {
                this.showStatus(
                    `Rendered artwork ${textures.artwork.width}×`
                    + `${textures.artwork.height} with controls `
                    + `${textures.control.width}×${textures.control.height}.`,
                    "success");
            }
        }
        catch(error)
        {
            console.error(error);
            this.showStatus(error.message, "error");
        }
        finally
        {
            this.setBusy(false);
            this.updateSelection();
        }
    }

    /** Restore the bundled textures and clear both file selections. */
    reset()
    {
        this.controller.reset();
        window.setTimeout(function updateResetForm()
        {
            this.updateSelection();
            this.showStatus("Bundled example restored.", "neutral");
        }.bind(this), 0);
    }

    /** Toggle controls while browser image decoding is in progress. */
    setBusy(is_busy)
    {
        this.artwork_input.disabled = is_busy;
        this.control_input.disabled = is_busy;
        this.apply_button.disabled = is_busy;
        this.reset_button.disabled = is_busy;
        this.form.setAttribute("aria-busy", String(is_busy));
    }

    /** Present one accessible upload status message. */
    showStatus(message, kind)
    {
        this.status.textContent = message;
        this.status.dataset.kind = kind;
    }
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
            gl, "vert-shader.glsl?version=physical-brdf-9",
            "frag-shader.glsl?version=physical-brdf-9",
            shader_definitions);
        const renderer = new Renderer(gl, program);
        const card_scene = initScene(
            gl, program, loadModel("model/card.obj"));
        const material_controller = new CardMaterialController(
            gl, card_scene);
        const upload_ui = new CardUploadUi(material_controller);
        card_scene.default_material.ready.catch(
            function reportBundledTextureFailure(error)
            {
                console.error(error);
                upload_ui.showStatus(error.message, "error");
            });
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
            renderer.draw(card_scene, matrices, light);
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
        const status = document.getElementById("UploadStatus");
        if(status != null)
        {
            status.textContent = error.message;
            status.dataset.kind = "error";
        }
    }
}

window.addEventListener("load", main);
