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
    async applyFiles(artwork_file, control_file, control_color)
    {
        const revision = ++this.load_revision;
        return this.installMaterial(
            PhysicalFoilMaterial.fromFiles(
                this.gl, artwork_file, control_file, control_color,
                this.card_scene.default_material.spectral_lut),
            revision, control_file != null);
    }

    /** Load two image URLs and replace the front after both succeed. */
    async applyUrls(artwork_url, control_url, control_color)
    {
        const revision = ++this.load_revision;
        return this.installMaterial(
            PhysicalFoilMaterial.fromUrls(
                this.gl, artwork_url, control_url, control_color,
                this.card_scene.default_material.spectral_lut),
            revision, control_url != null);
    }

    /** Install one completed material unless newer work superseded it. */
    async installMaterial(material_promise, revision, has_control_image)
    {
        const material = await material_promise;
        if(revision != this.load_revision)
        {
            material.dispose();
            return null;
        }
        this.card_scene.setFrontMaterial(material);
        return {
            artwork: material.artwork,
            control: material.foil_control,
            has_control_image,
        };
    }

    /** Cancel pending work and restore the bundled card appearance. */
    reset()
    {
        ++this.load_revision;
        this.card_scene.resetFrontMaterial();
    }

    /** Update installed uniform controls without reloading artwork. */
    updateUniformControl(control_color)
    {
        return this.card_scene.front_material.setUniformControl(control_color);
    }

    /** Return whether the displayed material uses a control image. */
    usesControlImage()
    {
        return !this.card_scene.front_material.foil_control.is_constant;
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

/** Available sources for temporary card images. */
const CARD_SOURCE_MODE = Object.freeze({
    FILES: "files",
    URLS: "urls",
});

/** Coordinate image-source form state without exposing WebGL primitives. */
class CardImageUi
{
    /** Bind the upload form to one card-material controller. */
    constructor(controller)
    {
        this.controller = controller;
        this.form = document.getElementById("CardUploadForm");
        this.mode_inputs = Array.from(
            this.form.querySelectorAll('input[name="source_mode"]'));
        this.file_source = document.getElementById("FileSourceFields");
        this.url_source = document.getElementById("UrlSourceFields");
        this.artwork_input = document.getElementById("ArtworkFile");
        this.control_input = document.getElementById("FoilControlFile");
        this.artwork_url = document.getElementById("ArtworkUrl");
        this.control_url = document.getElementById("FoilControlUrl");
        this.artwork_meta = document.getElementById("ArtworkMeta");
        this.control_meta = document.getElementById("FoilControlMeta");
        this.uniform_control = document.getElementById(
            "UniformFoilControls");
        this.control_sliders = ["Red", "Green", "Blue", "Alpha"].map(
            function findChannelSlider(channel)
            {
                return document.getElementById(`Foil${channel}`);
            });
        this.apply_button = document.getElementById("ApplyCardImages");
        this.reset_button = document.getElementById("ResetCardFiles");
        this.status = document.getElementById("UploadStatus");
        this.is_busy = false;

        this.form.addEventListener("submit", this.apply.bind(this));
        this.form.addEventListener("reset", this.reset.bind(this));
        this.artwork_input.addEventListener(
            "change", this.updateSelection.bind(this));
        this.control_input.addEventListener(
            "change", this.updateSelection.bind(this));
        this.artwork_url.addEventListener(
            "input", this.updateSelection.bind(this));
        this.control_url.addEventListener(
            "input", this.updateSelection.bind(this));
        for(const slider of this.control_sliders)
        {
            slider.addEventListener(
                "input", this.updateUniformControl.bind(this));
        }
        for(const mode_input of this.mode_inputs)
        {
            mode_input.addEventListener(
                "change", this.updateMode.bind(this));
        }
        this.updateMode();
        this.restoreCardLink();
    }

    /** Return the selected image-source mode. */
    mode()
    {
        return this.mode_inputs.find(function findCheckedMode(input)
        {
            return input.checked;
        }).value;
    }

    /** Show and enable only the controls belonging to the selected mode. */
    updateMode()
    {
        const uses_files = this.mode() == CARD_SOURCE_MODE.FILES;
        this.file_source.hidden = !uses_files;
        this.url_source.hidden = uses_files;
        this.setSourceInputs(
            [this.artwork_input, this.control_input], uses_files);
        this.setSourceInputs(
            [this.artwork_url, this.control_url], !uses_files);
        this.artwork_input.required = uses_files;
        this.control_input.required = false;
        this.artwork_url.required = !uses_files;
        this.control_url.required = false;
        this.apply_button.textContent = uses_files
            ? "Preview files"
            : "Preview URLs";
        this.updateSelection();
    }

    /** Set validation and interaction state for one source group. */
    setSourceInputs(inputs, is_active)
    {
        for(const input of inputs)
        {
            input.disabled = this.is_busy || !is_active;
        }
    }

    /** Return whether the active source mode specifies custom artwork. */
    hasArtworkSelection()
    {
        return this.mode() == CARD_SOURCE_MODE.FILES
            ? this.artwork_input.files[0] != null
            : this.artwork_url.value.trim() != "";
    }

    /** Return whether selected or displayed controls come from an image. */
    hasControlImage()
    {
        const selected_control = this.mode() == CARD_SOURCE_MODE.FILES
            ? this.control_input.files[0] != null
            : this.control_url.value.trim() != "";
        return selected_control
            || (!this.hasArtworkSelection()
                && this.controller.usesControlImage());
    }

    /** Read the four normalized texture channels as exact 8-bit values. */
    uniformControlColor()
    {
        return this.control_sliders.map(function readChannel(slider)
        {
            return Number(slider.value);
        });
    }

    /** Update slider labels and select image or uniform control editing. */
    updateUniformControls()
    {
        for(const slider of this.control_sliders)
        {
            document.getElementById(`${slider.id}Value`).value = slider.value;
        }
        this.uniform_control.disabled = this.is_busy
            || this.hasControlImage();
    }

    /** Apply one slider edit immediately to an installed uniform material. */
    updateUniformControl()
    {
        this.updateSelection();
        const control_color = this.uniformControlColor();
        if(!this.controller.updateUniformControl(control_color))
        {
            return;
        }
        if(this.mode() == CARD_SOURCE_MODE.URLS
           && this.control_url.value.trim() == ""
           && this.artwork_url.validity.valid
           && this.artwork_url.value.trim() != "")
        {
            this.updateCardLink(
                this.artwork_url.value.trim(), null);
        }
    }

    /** Refresh source metadata and whether the pair can be applied. */
    updateSelection()
    {
        const artwork_file = this.artwork_input.files[0];
        const control_file = this.control_input.files[0];
        this.artwork_meta.textContent = artwork_file == null
            ? "No file selected"
            : `${artwork_file.name} · ${formatFileSize(artwork_file.size)}`;
        this.control_meta.textContent = control_file == null
            ? "No file selected · using uniform controls"
            : `${control_file.name} · ${formatFileSize(control_file.size)}`;
        this.updateUniformControls();
        const files_ready = artwork_file != null;
        const control_url_value = this.control_url.value.trim();
        const urls_ready = this.artwork_url.value.trim() != ""
            && this.artwork_url.validity.valid
            && (control_url_value == "" || this.control_url.validity.valid);
        const selection_ready = this.mode() == CARD_SOURCE_MODE.FILES
            ? files_ready
            : urls_ready;
        this.apply_button.disabled = this.is_busy || !selection_ready;
    }

    /** Decode and apply the currently selected image pair. */
    async apply(event)
    {
        event.preventDefault();
        await this.applySelection();
    }

    /** Decode and apply the selected sources without a form event. */
    async applySelection()
    {
        const uses_files = this.mode() == CARD_SOURCE_MODE.FILES;
        this.setBusy(true);
        this.showStatus(
            uses_files ? "Decoding images…" : "Loading image URLs…",
            "progress");
        try
        {
            const artwork_url = uses_files
                ? null
                : validateRemoteImageUrl(
                    this.artwork_url.value.trim(), "Artwork URL");
            const control_url_value = this.control_url.value.trim();
            const control_url = uses_files || control_url_value == ""
                ? null
                : validateRemoteImageUrl(
                    control_url_value, "Control URL");
            const textures = uses_files
                ? await this.controller.applyFiles(
                    this.artwork_input.files[0],
                    this.control_input.files[0] || null,
                    this.uniformControlColor())
                : await this.controller.applyUrls(
                    artwork_url, control_url,
                    this.uniformControlColor());
            if(textures != null)
            {
                this.updateCardLink(
                    uses_files ? null : artwork_url,
                    uses_files ? null : control_url);
                this.showStatus(
                    `Rendered artwork ${textures.artwork.width}×`
                    + `${textures.artwork.height}`
                    + (textures.has_control_image
                        ? ` with controls ${textures.control.width}×`
                          + `${textures.control.height}.`
                        : ` with uniform RGBA controls (`
                          + `${this.uniformControlColor().join(", ")}).`),
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

    /** Restore URL fields and render a card encoded in the page fragment. */
    async restoreCardLink()
    {
        let card_link;
        try
        {
            card_link = parseCardLink(window.location.href);
        }
        catch(error)
        {
            console.error(error);
            this.showStatus(error.message, "error");
            return;
        }
        if(card_link == null)
        {
            return;
        }

        this.mode_inputs.find(function findUrlMode(input)
        {
            return input.value == CARD_SOURCE_MODE.URLS;
        }).checked = true;
        this.artwork_url.value = card_link.artwork_url;
        this.control_url.value = card_link.control_url || "";
        if(card_link.control_color != null)
        {
            this.control_sliders.forEach(function restoreChannel(
                slider, index)
            {
                slider.value = card_link.control_color[index];
            });
        }
        this.updateMode();
        await this.applySelection();
    }

    /** Replace the fragment with the current remote sources, or clear it. */
    updateCardLink(artwork_url, control_url)
    {
        const page_url = artwork_url == null
            ? clearCardLink(window.location.href)
            : encodeCardLink(
                window.location.href, artwork_url, control_url,
                this.uniformControlColor());
        window.history.replaceState(null, "", page_url);
    }

    /** Restore the bundled textures and clear both file selections. */
    reset()
    {
        this.controller.reset();
        this.updateCardLink(null, null);
        window.setTimeout(function updateResetForm()
        {
            this.updateMode();
            this.showStatus("Bundled example restored.", "neutral");
        }.bind(this), 0);
    }

    /** Toggle controls while browser image decoding is in progress. */
    setBusy(is_busy)
    {
        this.is_busy = is_busy;
        for(const mode_input of this.mode_inputs)
        {
            mode_input.disabled = is_busy;
        }
        this.reset_button.disabled = is_busy;
        this.form.setAttribute("aria-busy", String(is_busy));
        this.updateMode();
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
        const image_ui = new CardImageUi(material_controller);
        card_scene.default_material.ready.catch(
            function reportBundledTextureFailure(error)
            {
                console.error(error);
                image_ui.showStatus(error.message, "error");
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
