# Front-Only Card Textures

## Status

Proposed on 2026-08-17.

This document specifies how the renderer will replace its square card atlas
with front-only artwork and foil-control textures. The implementation must
upload the front images at their stored dimensions. It must not reconstruct,
pad, render into, or allocate a square atlas at runtime.

The design retains the existing physical foil renderer from
[`design-1-brdf.md`](design-1-brdf.md). It changes the spatial domain of the
artwork and foil-control textures, partitions the card mesh by surface, and
adds a texture-free solid-color material for the back and edge surfaces.

## Motivation

The card is five units wide for every seven units tall. Its OBJ texture
coordinates currently address a square atlas with this layout:

```text
             u = 0.0             u = 0.5             u = 1.0
        v = 1.0 +-------------------+-------------------+
                |                   |                   |
                |       back        |       front       |
                |                   |                   |
        v = 0.3 +-------------------+-------------------+
                |                                       |
                |               unused                  |
                |                                       |
        v = 0.0 +---------------------------------------+
```

The front therefore occupies only the atlas rectangle

$$
(u,v)\in[0.5,1.0]\times[0.3,1.0].
$$

The current artwork and packed foil-control files are both 2048 by 2048
pixels. The useful front rectangle is approximately 1024 by 1433.6 pixels.
The replacement resolution is an asset choice, not a renderer constant. This
document denotes it by $W\times H$, where $W/H$ approximates the card's $5/7$
aspect ratio after integer pixel rounding. For example, both 512 by 717 and
1000 by 1400 are valid; the latter is likely a better production resolution.

Reconstructing the old square atlas in a canvas would save download and
repository space but would not solve the GPU-memory problem. `texImage2D`
would still receive a square image and allocate a square texture. This design
instead changes the mesh coordinates so the GPU texture itself is the selected
$W$ by $H$ front image.

## Goals

1. Upload the front artwork as one $W$ by $H$ `RGBA8` texture.
2. Upload the packed front foil controls as one matching `RGBA8` texture.
3. Remap the existing front-face OBJ coordinates directly into $[0,1]^2$.
4. Render the back and card edges as an opaque, constant gray material.
5. Allocate no artwork or foil-control texture for the gray material.
6. Preserve the existing scene, model, material, and renderer abstractions.
7. Keep all WebGL texture calls inside the existing resource abstractions.
8. Preserve triangle winding, positions, normals, and tangent orientation.
9. Detect an incompatible OBJ or mismatched image pair with explicit errors.
10. Prove with tests that every source triangle is assigned exactly once.
11. Preserve the physical meaning and channel layout of the foil controls.
12. Support arbitrary valid, mipmapped front resolutions in WebGL 2, including
    non-power-of-two dimensions.

## Non-goals

This change will not:

- change the card's physical dimensions or model-space aspect ratio;
- edit or unwrap the OBJ in a three-dimensional modeling program;
- retain the printed back artwork from the old atlas;
- add artist-selectable side or back textures;
- reconstruct the square atlas in a DOM canvas, `OffscreenCanvas`, framebuffer,
  typed array, or temporary GPU texture;
- add blank padding around the front image;
- change the physical foil equations, energy calibration, or output Levels;
- change the packed foil-control channel meanings;
- pack separate grayscale control maps at runtime;
- introduce texture compression;
- infer card surfaces from pixel colors; or
- add a general multi-material OBJ/MTL implementation.

An offline migration step may crop and resize the current source assets once.
That operation produces the committed front-only files. It is not part of
application startup and does not permit the renderer to load the old atlases.

## Current model contract

`model/card.obj` contains one nonindexed triangle geometry after `parseOBJ()`.
Its model-space bounds are

$$
x\in[-0.5,0.5],\qquad
y\in[-0.0035,0.0035],\qquad
z\in[-0.7,0.7].
$$

The card width is therefore $1.0$, its height is $1.4$, and its aspect ratio
is exactly

$$
\frac{1.0}{1.4}=\frac{5}{7}.
$$

The thin $y$ dimension is the card thickness. In OBJ model space, the front
normal is $+\mathbf y$. The existing initialization rotates the model around
$x$ before displaying it; that presentation transform does not change how the
mesh is classified.

The parsed mesh contains 268 triangles:

| Surface | Geometric normal | Triangles | Destination material |
|---|---:|---:|---|
| front | $+\mathbf y$ | 66 | physical front material |
| back | $-\mathbf y$ | 66 | solid gray material |
| edges | perpendicular to $\mathbf y$ | 136 | solid gray material |

These counts are acceptance criteria for the current OBJ, not universal card
constants. The partition code must work on any triangle count. A production
test pins the counts so an accidental model replacement cannot silently move
faces between materials.

The actual front UV bounds are slightly inset from the nominal atlas rectangle
because of texture-packing margins. They lie within

$$
u\in[0.500118,0.999882],\qquad
v\in[0.300331,1.0].
$$

The affine remapping retains those subpixel margins instead of stretching the
outermost texels to the mesh boundary.

## Runtime data flow

The complete initialization flow is:

```text
card_front.png ----------------------> Texture(RGBA8, sRGB role) --+
                                                                  |
card_front_foil.png -----------------> Texture(RGBA8, data role) --+--+
                                                                      |
spectral_xyz.bin --------------------> SpectralLut --------------------+
                                                                      v
                                                           PhysicalFoilMaterial

model/card.obj -> parseOBJ -> partitionCardGeometry -> front geometry --+
                                             |                            |
                                             +-> shell geometry --+       |
                                                                  v       v
gray sRGB constant --------------------------------> SolidColorMaterial  Model
                                                                          |
                                                                          v
                                                                        Scene
```

There is deliberately no arrow from a front image to an atlas builder. The
only decoded bitmap passed to `gl.texImage2D` has the front asset's natural
$W$ by $H$ dimensions. The front and shell `Model` instances share material
objects; they do not create texture copies.

## Asset specification

### File manifest

The card description becomes:

```js
const card_description = {
    front: {
        artwork: "card_front.png",
        foil_control: "card_front_foil.png",
    },
    shell_color_srgb: [0.5, 0.5, 0.5],
};
```

Asset URLs use plain filenames without version or content-hash query
parameters. During local development, changed images may require manually
clearing or bypassing the browser cache. Cache invalidation is outside the
renderer and asset-format contracts.

The exact gray value is a visual calibration constant and may be tuned during
implementation. It remains internal renderer configuration, not an artist
texture. All three components must be finite and in $[0,1]$.

The old files `card_texture.png` and `foil_control_v2.png` are retired after
their front regions have been migrated and the new files pass validation. The
runtime manifest must not retain fallback URLs for them. A fallback could hide
a missing migration and reintroduce the old memory cost.

### Front artwork

`card_front.png` has the following contract:

- width: a positive integer $W$ selected for the card asset;
- height: the nearest practical integer to $7W/5$;
- PNG bit depth: 8 bits per channel after browser decoding;
- GPU internal format: `RGBA8`;
- color interpretation: display-referred sRGB;
- origin in the file: upper left, as customary for PNG images;
- mesh correspondence: the upper-left file pixel is the upper-left front;
- alpha: retained as the fragment output alpha; and
- mipmaps: enabled with `LINEAR_MIPMAP_LINEAR` minification.

The normative aspect test is

$$
\left|H-\frac{7W}{5}\right|\le\frac{1}{2}.
$$

In other words, $H$ must be the nearest integer pixel height to the exact 5:7
shape for the chosen width. Exact-ratio sizes such as 1000 by 1400 satisfy the
test with zero error. A size such as 512 by 717 has a 0.2-pixel rounding error
and also satisfies it. The test rejects a square image without requiring a
particular production resolution.

Both dimensions must be no larger than the WebGL context's
`MAX_TEXTURE_SIZE`. The loader checks this limit before uploading the decoded
image so an excessive artist asset produces a clear diagnostic instead of an
opaque WebGL error.

$W$ and $H$ are discovered from the decoded PNG's `naturalWidth` and
`naturalHeight`. They are not repeated in `card_description`, shader
definitions, or geometry constants. Replacing both front files with another
valid matching resolution therefore requires no renderer-code change. The
loader uploads the discovered dimensions unchanged; it never rescales them to
a preferred size.

The `Texture` resource continues to set `flip_y: true`. Consequently, the top
row of the PNG maps to remapped texture coordinate $v=1$, while the bottom row
maps to $v=0$. No image pixels are flipped or copied by application code.

PNG encoding details do not alter the allocation contract. A browser may
decode indexed, RGB, or RGBA PNG storage differently, but `Texture` explicitly
uploads the result to an `RGBA8` WebGL texture.

### Packed front foil controls

`card_front_foil.png` must have exactly the same $W$ by $H$ pixel grid as the
artwork. Its channels retain the physical v2 meanings from the BRDF design:

| Channel | Meaning | Sampling interpretation |
|---|---|---|
| red | groove spacing | linear scalar field |
| green | grating orientation | periodic angular field |
| blue | microstructure disorder | linear scalar field |
| alpha | foil coverage | linear area fraction |

The file is a data texture, not a color texture. The loader must continue to
set `UNPACK_COLORSPACE_CONVERSION_WEBGL` to `NONE`, disable premultiplication,
and upload `RGBA8`. It uses linear base-level filtering and does not generate
mipmaps under the current material contract.

Artwork and controls must have identical dimensions. A mismatch is a hard
load error because one UV coordinate must address corresponding physical and
printed locations.

The front-only layout changes where the fields live, not what they mean. It
does not revive the retired `reveal`, `reveal_width`, or directional-band
format.

### Offline migration of the current assets

The current 2048-square atlases place the front in their top-right 50 by 70
percent. In top-left-origin image coordinates, the nominal crop is

$$
x\in[1024,2048),\qquad y\in[0,1433.6).
$$

The migration tool rounds the crop height to 1434 pixels and produces a 1024
by 1434 intermediate crop. That crop may be retained at its native integer
size or resampled offline to the asset's selected $W$ by $H$ resolution. For
example, it may be reduced to 512 by 717 or approximately retained as 1000 by
1400. The runtime is independent of this offline choice.

Artwork resizing should occur in linear light and be encoded back to sRGB so
dark and light pixels contribute according to light intensity rather than
encoded component values. The packed control map must be resized by a
field-aware operation. In particular, grating orientation is periodic: values
near zero and one describe nearly identical directions, so averaging the
encoded numbers directly can produce the opposite orientation. The current
control texture has constant fields and is safe to reduce without this issue.

The migration is successful only if its outputs are committed and the old
atlas files are no longer referenced. The browser never performs these crop
or resize operations.

## Geometry partition

### Public result type

`obj.js` will expose one geometry operation in addition to `parseOBJ()`:

```js
/** Partition and remap an atlas-mapped card into front and shell geometry. */
function partitionCardGeometry(geometry, layout);
```

It returns:

```js
{
    front: {
        object: "Cube.001/front",
        groups: geometry.groups,
        material: "front",
        data: {
            position: [],
            texcoord: [],
            normal: [],
            color: [],
        },
    },
    shell: {
        object: "Cube.001/shell",
        groups: geometry.groups,
        material: "shell",
        data: {
            position: [],
            texcoord: [],
            normal: [],
            color: [],
        },
    },
}
```

Empty optional arrays remain absent, matching the `parseOBJ()` convention.
The function does not mutate `geometry`. This makes failures atomic and lets
tests compare source data against both outputs.

### Layout description

The model-specific facts live in one immutable description:

```js
const CARD_MESH_LAYOUT = Object.freeze({
    front_normal: Object.freeze([0.0, 1.0, 0.0]),
    front_normal_threshold: 0.999,
    front_uv_min: Object.freeze([0.5, 0.3]),
    front_uv_max: Object.freeze([1.0, 1.0]),
    uv_tolerance: 0.001,
});
```

This is geometry metadata, not artist material data. Keeping it in one value
prevents classification constants and UV transforms from being scattered
through `initScene()`.

The threshold means a triangle is front-facing when

$$
\hat{\mathbf n}_{f}\cdot\mathbf n_{front}\ge0.999,
$$

where $\hat{\mathbf n}_{f}$ is the normalized geometric face normal. This
admits small exporter rounding error while excluding the current edge faces.

### Classification algorithm

For every parsed geometry, `partitionCardGeometry()` performs these steps:

1. Require positions and texture coordinates.
2. Require the position count to describe complete triangles.
3. Require every present vertex attribute to have the same vertex count.
4. Iterate three vertices at a time; OBJ parsing has already triangulated
   polygons and expanded their indices.
5. Calculate edges
   $\mathbf e_1=\mathbf p_1-\mathbf p_0$ and
   $\mathbf e_2=\mathbf p_2-\mathbf p_0$.
6. Calculate the geometric normal
   $\hat{\mathbf n}_{f}=\operatorname{normalize}
   (\mathbf e_1\times\mathbf e_2)$.
7. Reject a degenerate triangle whose cross product has negligible length.
8. Compare the normal with `layout.front_normal`.
9. Append a front triangle to `front`; append every other triangle to
   `shell`.
10. Preserve original vertex order and all non-UV attribute values exactly.
11. Apply the UV transform below only while appending a front triangle.
12. Return the two independent, nonindexed geometry objects.

Geometric normals, rather than smoothed per-vertex normals, determine surface
membership. A rounded edge may have vertex normals partially facing forward,
but its plane is still part of the shell. Material assignment is a property of
the surface, not its shading interpolation.

Every triangle follows exactly one branch. The outputs therefore partition,
rather than duplicate, vertex data:

$$
N_{front}+N_{shell}=N_{source}.
$$

For the current OBJ, the expected result is 66 front triangles and 202 shell
triangles.

### Front UV remapping

Let the old front rectangle be

$$
[u_0,u_1]\times[v_0,v_1]
=[0.5,1.0]\times[0.3,1.0].
$$

Each front coordinate is remapped by

$$
u'=\frac{u-u_0}{u_1-u_0}=2(u-0.5),
$$

$$
v'=\frac{v-v_0}{v_1-v_0}=\frac{10}{7}(v-0.3).
$$

This changes only vertex data. It does not sample either image and does not
allocate pixel storage. Rasterization interpolates $u'$ and $v'$ over the
front triangles exactly as it interpolated the atlas coordinates.

Before remapping, every front UV must fall inside the configured rectangle,
allowing `uv_tolerance` for floating-point exporter error. A coordinate farther
outside is an error identifying the geometry, triangle, coordinate, and
expected interval. Values inside the tolerance may be clamped after remapping
to avoid wrap artifacts. The current coordinates do not require clamping.

Shell coordinates remain untouched even though the solid shader path ignores
them. Preserving them keeps the operation lossless apart from the intentional
front transform and avoids special vertex formats in the first implementation.

### Geometry cost

Splitting one model creates two vertex-array objects and changes one draw call
into two. It does not duplicate triangles. With the current expanded mesh, the
front has 198 vertices, the shell has 606, and the combined total remains 804.

The existing vertex format consumes 48 bytes per vertex:

| Attribute | Components | Bytes per vertex |
|---|---:|---:|
| position | 3 floats | 12 |
| UV | 2 floats | 8 |
| normal | 3 floats | 12 |
| tangent and handedness | 4 floats | 16 |

The combined attribute payload remains about 38 KiB. The second vertex-array
object and buffer handles add small driver metadata, far less than the texture
memory removed by this design.

## Material abstraction

### Common contract

`Model` continues to depend on behavior rather than concrete WebGL calls. Any
material assigned to a model implements:

```js
/** Bind every per-material state required before drawing one model. */
use(program);
```

No scene-construction function calls `activeTexture`, `bindTexture`,
`uniform*`, or another WebGL primitive. `Renderer.draw()` remains responsible
for selecting each model and asking its material to bind itself.

### Physical front material

`PhysicalFoilMaterial` remains the owner of:

- one front artwork `Texture`;
- one front foil-control `Texture`; and
- one shared spectral lookup texture.

Its constructor still checks that artwork and controls have equal dimensions.
It additionally sets the material-mode uniform to `MATERIAL_PHYSICAL_FOIL`
before binding texture units 0, 1, and 2. One material instance is shared by
all front geometry; scene construction must not instantiate it inside a
geometry loop.

### Solid shell material

The new texture-free material is:

```js
/** Shade geometry with one opaque, non-foil sRGB color. */
class SolidColorMaterial
{
    /** Create a validated solid-color material. */
    constructor(gl, color_srgb);

    /** Select solid shading and upload the encoded sRGB color. */
    use(program);
}
```

The constructor copies and validates a three-component sRGB array. `use()`
sets `u_material_kind` to `MATERIAL_SOLID_COLOR` and uploads
`u_solid_color_srgb`. It does not create, upload, or bind a one-pixel texture.
It does not bind the foil controls or spectral table.

Both materials must set `u_material_kind` on every `use()` call. Explicitly
setting mode prevents the previous model's material state from leaking into
the next draw.

## Shader design

The fragment shader adds:

```glsl
const int MATERIAL_PHYSICAL_FOIL = 0;
const int MATERIAL_SOLID_COLOR = 1;

uniform int u_material_kind;
uniform vec3 u_solid_color_srgb;
```

Material sampling is isolated in one function or a small branch at the start
of `main()`. The logical result is:

```glsl
vec4 artwork_sample;
FoilControl control;
if(u_material_kind == MATERIAL_SOLID_COLOR)
{
    artwork_sample = vec4(u_solid_color_srgb, 1.0);
    control = noFoilControl();
}
else
{
    artwork_sample = texture(u_artwork, v_texcoord);
    control = sampleFoilControl(v_texcoord);
}
```

`noFoilControl()` returns zero coverage. Its other fields use finite defaults
because finite values are easier to inspect and safer if the BRDF is later
refactored. Zero coverage guarantees that the solid material follows the
ordinary Lambertian print path, including direct disk illumination, ambient
print illumination, tone mapping, exact sRGB encoding, and output Levels.

The shader decodes `u_solid_color_srgb` with the same `srgbToLinear()` function
used for artwork. This makes `[0.5, 0.5, 0.5]` mean the same displayed gray as
a 50-percent encoded artwork pixel before lighting.

The solid branch must not call `texture()` on `u_artwork` or
`u_foil_control`. The zero-coverage path must not call the spectral lookup.
This is required semantically even if a particular GPU could speculate across
a uniform branch. The shell owns no card texture storage regardless of shader
execution strategy.

An unknown `u_material_kind` is a programming error. JavaScript only uploads
the two declared values. Debug shader builds may render an obvious diagnostic
color for another value; production code need not expose a third material.

The vertex shader and `Model` attribute contract do not change. Keeping one
shader program avoids program switches and preserves the current renderer
architecture. A dedicated solid shader could remove unused UV and tangent
attributes, but the saved vertex memory would be small and would require
program-aware model and renderer changes unrelated to the primary texture
saving.

## Scene construction

`initScene()` becomes a domain-level assembler:

1. Validate the card description.
2. Construct one `PhysicalFoilMaterial` from the two front images and spectral
   table.
3. Construct one `SolidColorMaterial` from `shell_color_srgb`.
4. Partition every parsed OBJ geometry using `CARD_MESH_LAYOUT`.
5. Create a front `Model` for each nonempty front partition.
6. Create a shell `Model` for each nonempty shell partition.
7. Require at least one front triangle and at least one shell triangle for the
   current card asset.
8. Return one `Scene` containing the resulting models.

This is the only code that knows a card has a physical front and gray shell.
`Renderer`, `Model`, `Texture`, and `ShaderProgram` remain reusable rendering
components. The scene expresses the relationship by assigning materials; it
does not issue rendering commands.

Draw order is not a correctness requirement because depth testing and face
culling remain enabled. Grouping shell and front models minimizes material
changes. The expected current scene has two models and two draw calls.

## GPU-memory behavior

### Allocation formula

An uncompressed `RGBA8` base level consumes

$$
B_0=4WH\ \text{bytes}.
$$

A complete two-dimensional mip chain consumes the sum

$$
B_{mip}=4\sum_{i=0}^{L}
\max(1,\lfloor W/2^i\rfloor)
\max(1,\lfloor H/2^i\rfloor),
$$

where $L$ ends at a 1 by 1 level. For large power-of-two textures this is
approximately $4B_0/3$; the implementation and tests use exact integer level
sizes for non-power-of-two dimensions.

### Current and example allocations

The current color artwork has mipmaps. The current data-role control texture
does not. The selected asset resolution therefore determines the saving.
Ignoring small driver metadata, representative allocations are:

| Resolution | Artwork with mips | Controls | Total | Reduction |
|---|---:|---:|---:|---:|
| current 2048×2048 atlas | 21.333 MiB | 16.000 MiB | 37.333 MiB | — |
| 1000×1400 front | 7.120 MiB | 5.341 MiB | 12.461 MiB | 66.62% |
| 512×717 front | 1.866 MiB | 1.400 MiB | 3.267 MiB | 91.25% |

These rows are examples, not an allowed-resolution table. For any selected
$W$ and $H$, the implementation uses the formulas above to calculate the
allocation. A 1000 by 1400 production pair saves about 24.87 MiB relative to
the current pair while retaining substantially more front detail than the
smaller example.

The 401-entry floating-point spectral lookup is unchanged and contributes
only 6416 bytes of texel data.

The gray shell adds three uniform floats and no texture allocation. The front
and shell geometry share their two material instances, so partitioning does
not multiply texture storage.

These calculations describe explicit texel storage. A browser or driver may
add alignment, bookkeeping, staging, cache, or platform-specific storage, so
JavaScript cannot promise an exact process-level VRAM number. It can guarantee
that the requested WebGL dimensions equal the source images' $W$ by $H$ and
that no square card atlas is created. A 2048 by 2048 source image would fail
the front-aspect validation; choosing a width of 2048 would instead require a
height of approximately 2867 pixels.

### Non-power-of-two support

The application requires WebGL 2. WebGL 2 is based on OpenGL ES 3.0 and
supports complete mipmapped non-power-of-two textures. A selected front size
therefore does not need padding to the next power of two. For example, neither
1000 by 1400 nor 512 by 717 requires a larger backing atlas.
`CLAMP_TO_EDGE` remains appropriate at the card boundary, but it is no longer
a workaround for WebGL 1 texture-completeness restrictions.

Relevant primary references are the
[WebGL 2.0 specification](https://registry.khronos.org/webgl/specs/latest/2.0/),
the Khronos [`glTexImage2D` reference](https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glTexImage2D.xhtml),
and the Khronos [`glGenerateMipmap` reference](https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glGenerateMipmap.xhtml).
The file format is specified by the
[W3C Portable Network Graphics specification](https://www.w3.org/TR/png-3/).

## Error handling

Initialization must fail with an actionable error in these cases:

- WebGL 2 is unavailable;
- either front PNG fails to load;
- artwork and controls have different dimensions;
- either image has a zero, invalid, or over-limit dimension;
- the common dimensions fail the nearest-integer 5:7 aspect test;
- the OBJ contains no geometry;
- a geometry lacks positions or texture coordinates;
- an attribute array has an inconsistent vertex count;
- the position array does not contain complete triangles;
- a source triangle is degenerate;
- the configured front normal is invalid;
- the UV rectangle has zero or negative extent;
- a classified front UV lies outside the rectangle beyond tolerance;
- no triangle is classified as front;
- no triangle is classified as shell; or
- the solid color is malformed or outside $[0,1]$.

An image placeholder may still exist while asynchronous loading is pending,
as in the current `Texture` abstraction. Its dimensions are one by one and it
does not reconstruct an atlas. Once both files load, dimension checks are
mandatory. A malformed final asset must not silently continue using the
placeholder.

Error messages include the resource or geometry name and actual values. For
example:

```text
Front UV outside atlas region in Cube.001 triangle 42:
u=0.482, expected 0.5..1.0 (tolerance 0.001).
```

## Testing strategy

### Asset tests

`tests/assets_test.js` will verify:

1. `card_front.png` is a PNG with positive dimensions $W$ by $H$.
2. `card_front_foil.png` is a PNG with positive dimensions.
3. Artwork and control dimensions are equal.
4. Their dimensions satisfy
   $|H-7W/5|\le1/2$ without matching a hard-coded resolution.
5. Representative valid pairs, including 512 by 717 and 1000 by 1400, pass
   the reusable aspect validator.
6. Square and mismatched pairs fail the validator.
7. The spectral lookup remains exactly 6416 bytes.
8. Runtime JavaScript references the new asset names.
9. Runtime JavaScript does not reference the retired atlas names.

These header tests do not prove visual content, but they prevent a later asset
replacement from silently restoring square GPU allocations.

### Geometry unit tests

`tests/geometry_test.js` will verify the partition operation with a minimal
synthetic mesh and with `model/card.obj`:

- the production source has 268 triangles;
- front contains 66 triangles and shell contains 202;
- front and shell contain 198 and 606 vertices respectively;
- their total vertex count equals the source count;
- each source position, normal, and optional color appears in exactly one
  corresponding output slot;
- triangle winding and order within each partition are preserved;
- all remapped front UVs are finite and in $[0,1]$;
- the known atlas corners map to the four unit-square corners;
- shell UVs are byte-for-byte unchanged;
- tangent calculation remains finite for every output triangle;
- a side triangle with forward-leaning vertex normals still follows its
  geometric normal into the shell;
- malformed attribute lengths are rejected;
- degenerate triangles are rejected; and
- out-of-region front UVs are rejected with a useful diagnostic.

The source-to-output comparison must account for stable partition order: front
triangles preserve their order relative to other front triangles, and shell
triangles preserve their order relative to other shell triangles.

### Material and shader tests

Tests with a small fake WebGL interface will verify that:

- `PhysicalFoilMaterial.use()` selects physical mode;
- `SolidColorMaterial.use()` selects solid mode;
- the solid material uploads three color components;
- the solid material performs no texture binding;
- invalid colors are rejected; and
- switching physical, solid, then physical material resets mode each time.

The fragment shader will continue to be compiled by `glslangValidator`. An
integration check will exercise both uniform values so the solid branch cannot
be removed accidentally during a later refactor.

### Visual acceptance

The implementation is accepted visually when:

1. The front artwork has the same orientation and crop as the current card.
2. Foil controls align with the same printed features as before.
3. No half-pixel seam appears around the front perimeter.
4. The back is uniformly gray under spatially varying direct illumination.
5. The edges use the same gray material and remain distinguishable through
   their normals and lighting.
6. The gray surfaces show no rainbow diffraction.
7. Rotating the card reveals no back-atlas artwork.
8. Browser inspection reports the selected source dimensions $W$ by $H$ for
   both front textures.
9. No square card atlas appears in a GPU capture.

The gray material is lit, so it is not expected to display one constant screen
value at every angle. "Uniformly gray" means uniform albedo and no texture or
foil pattern.

## Implementation order

The change should be implemented atomically in this order:

1. Add `partitionCardGeometry()` and its unit tests.
2. Add material-mode uniforms and `SolidColorMaterial`.
3. Update `PhysicalFoilMaterial` to select its mode explicitly.
4. Update `initScene()` to build shared front and shell materials.
5. Select a production resolution and produce the two matching front assets
   offline; 1000 by 1400 is one reasonable choice, not a renderer constant.
6. Switch the manifest to the new files.
7. Update asset tests for the new plain asset filenames.
8. Compile both shaders and run all Node tests.
9. Perform visual and browser/GPU-dimension acceptance checks.
10. Remove the retired square atlas files only after no source references them.

Geometry, shader, manifest, and assets must land together. A front-only image
with old atlas UVs would sample the wrong region; remapped UVs with an old
atlas would do the same.

## Future extensions

The design leaves several deliberate extension points:

- A later card description may supply a back material instead of gray.
- A shell material may gain roughness or clear-coat constants without adding
  a texture.
- An offline control-map packer may produce the front-domain packed PNG.
- A field-aware mipmap generator may add mipmaps to packed control textures.
- A model exporter may eventually emit separate front and shell primitives,
  eliminating runtime classification while retaining the same material API.
- Texture compression may reduce VRAM further if its artifacts are acceptable
  for physical control fields.

None of these extensions requires returning to a square atlas. The enduring
contract is that each material owns only the texel domain it actually samples.
