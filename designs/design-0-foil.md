# Spatially Varying Foil Material

## Status

Proposed.

This document specifies the physical model, artist-facing data format,
WebGL 2 implementation, and validation plan for two holographic foil
materials:

- a wide-angle foil that remains visibly iridescent over a broad range of
  viewing directions; and
- a directional foil whose colored response appears in a narrow, moving
  band or pattern as the card is tilted.

The design deliberately favors a compact, controllable real-time model over
a complete wave-optics simulation. It should look plausible, respond
predictably to authored maps, and run interactively in the existing WebGL 2
demo.

## Goals

The implementation must:

1. Support both wide-angle and directional holographic foil.
2. Let the card designer select the foil kind explicitly.
3. Use one packed RGBA control texture for all artist-authored foil fields.
4. Give directional foil spatially varying coverage, reveal angle, grating
   orientation, and angular reveal width.
5. Let artists tune apparent foil strength through the coverage field.
6. Keep all additional intensity constants internal to the renderer.
7. Preserve the existing separation between the base artwork texture and
   the foil control texture.
8. Keep texture, material, mesh, and draw-state responsibilities separated
   in JavaScript.
9. Document enough of the optical model that the shader can be reviewed and
   extended without reverse-engineering unexplained constants.

## Non-goals

The first implementation will not:

- perform a Fourier-optics simulation of the actual foil height field;
- integrate a full spectral power distribution against CIE color-matching
  functions;
- model polarization;
- infer foil fields from photographs;
- generate or pack the RGBA control texture from grayscale source images;
- support multiple independent foil layers on one card;
- support different foil kinds in different regions of one card;
- model an area-light environment or image-based lighting; or
- expose a user-controlled intensity parameter.

A future packing tool may accept four grayscale source files and produce the
packed texture defined here. Until that tool exists, the renderer accepts only
the packed texture.

## Terminology

**Artwork texture**
: The ordinary color image printed on the card. It contains display-referred
  color and is treated approximately as sRGB.

**Foil control texture**
: A non-color RGBA image whose channels encode four scalar material fields.
  Its values must not undergo gamma correction or alpha premultiplication.

**Coverage**
: The fractional contribution of foil at a surface point. Coverage also acts
  as the artist-facing control over apparent foil strength.

**Reveal value**
: The reference angular coordinate at which a directional-foil point produces
  its strongest response. Equal reveal values activate together.

**Grating orientation**
: The local axis along which a one-dimensional grating diffracts light. It is
  the grating vector direction, perpendicular to the physical grooves. Because
  a groove axis is unoriented, angles separated by $180^\circ$ are equivalent.

**Reveal width**
: The angular width of the local diffraction response. A narrow width produces
  a brief, crisp flash; a broad width produces a persistent, soft response.

**Wide-angle foil**
: Foil modeled as a broad distribution of microscopic grating orientations
  and periods. Some component of the distribution reflects colored light
  toward the viewer over most supported card orientations.

**Directional foil**
: Foil modeled as locally coherent grating fields with authored preferred
  directions and reveal coordinates. Only fields satisfying the local angular
  condition become strongly visible.

## Real-world basis

### Trading-card foil is a diffraction structure

Holographic trading-card foil is not merely a metallic color layer. Its
microscopic grooves form a diffraction grating. Under white illumination,
constructive interference separates wavelengths into different outgoing
directions, producing rainbow-colored maxima. A patent concerned specifically
with identifying foil trading cards describes horizontal and vertical grooves
in the foil layer and the resulting rainbow interference pattern:

- [Method and apparatus for identifying characteristics of trading
  cards](https://patents.google.com/patent/US12400308B2/en)

The places where foil exists and the optical response of that foil are
different properties. A manufacturer may apply foil only to selected artwork,
but the applied foil can still contain any of several grating structures. This
distinction motivates keeping coverage separate from the other three fields.

### Wide-angle foil

A simple one-axis grating has a limited field of view: it sends diffraction
orders into preferred directions. Crossed, multi-axis, or stochastic grating
structures distribute useful diffraction over more azimuths. A multi-axis
grating patent explicitly describes rotating and combining grating exposures
to make rainbow color visible from more directions:

- [Multi-axis diffraction
  grating](https://patents.google.com/patent/US20100116156A1/en)

The paper *Acquiring spatially varying appearance of printed holographic
surfaces* describes manufactured holographic papers containing regular and
stochastic distributions of grating orientations and periodicities. The
stochastic samples produce broad iridescent glitter, whereas authored local
maps produce gradients, circular features, fireworks, and kinematic effects:

- [Toisoul, Dhillon, and Ghosh, ACM Transactions on Graphics
  37(6)](https://doi.org/10.1145/3272127.3275077)

"Wide-angle" does not mean perfectly angle independent. Illumination and view
direction still change its hue and brightness. It means the distribution of
microstructures is broad enough that a visible foil response persists across
the ordinary interaction range.

### Directional and patterned foil

Directional foils divide the surface into local grating fields. Orientation,
curvature, spacing, and groove profile may vary between fields. Each field can
therefore have a preferred viewing direction, and a collection of fields can
form a motif that shifts, expands, rotates, appears, or disappears as the card
is tilted:

- [Grid image and viewing-angle-dependent grating
  fields](https://patents.google.com/patent/US8526085B2/en)

The linked research paper measures spatially varying orientation and
periodicity maps from real holographic papers. Its examples include circular
diffractive areas and firework-like patterns. This provides direct support for
representing orientation and reveal behavior as fields rather than constants.

The two foil kinds in this design are therefore two ends of an angular
selectivity spectrum, not a claim that commercial foils fall into exactly two
manufacturing categories.

## Physical model

### Scalar grating equation

For a simple reflection grating with groove spacing $a$, incident angle
$\alpha$, outgoing angle $\beta$, diffraction order $m$, and vacuum wavelength
$\lambda$, one common sign convention gives

$$
m\lambda = a\left(\sin\alpha + \sin\beta\right).
$$

The important consequence is independent of sign convention: different
wavelengths satisfy constructive interference at different outgoing angles.
The relationship between wavelength, spacing, incident angle, and outgoing
angle is reviewed by
[Edmund Optics](https://www.edmundoptics.com/Knowledge-Center/application-notes/optics/all-about-diffraction-gratings/).

### Tangent-space vector form

Let $\boldsymbol{\omega}_i$ point from the surface toward the light and
$\boldsymbol{\omega}_o$ point from the surface toward the observer. Let
$\mathbf{n}$ be the surface normal, and let $P_T$ project a vector onto the
surface tangent plane:

$$
P_T(\mathbf{x}) = \mathbf{x} - (\mathbf{x}\cdot\mathbf{n})\mathbf{n}.
$$

With these direction conventions, define the non-normalized, tangent-space
half-vector coordinate

$$
\mathbf{q} = P_T\left(\boldsymbol{\omega}_i +
                         \boldsymbol{\omega}_o\right).
$$

For a one-dimensional grating, let $\mathbf{g}$ be the unit grating vector and
$\mathbf{p}$ its in-plane perpendicular:

$$
\mathbf{g} = (\cos\theta,\sin\theta), \qquad
\mathbf{p} = (-\sin\theta,\cos\theta).
$$

Projecting $\mathbf{q}$ into this local frame gives

$$
u = \mathbf{q}\cdot\mathbf{g}, \qquad
v = \mathbf{q}\cdot\mathbf{p}.
$$

Specular reflection is centered at $u=v=0$. Diffraction order $m$ is centered
approximately at

$$
u = \frac{m\lambda}{a}, \qquad v=0.
$$

This is the same structure used in the Toisoul, Dhillon, and Ghosh model: the
BRDF is a sum of lobes centered at the zeroth, first, and second diffraction
orders in projected half-vector space.

### Finite angular width

An infinite, perfectly periodic grating illuminated by a monochromatic plane
wave would produce idealized sharp orders. Real materials have finite coherent
regions, manufacturing variation, roughness, and non-point illumination. The
orders therefore have nonzero angular width.

The directional shader approximates each order with a two-dimensional
Gaussian:

$$
D(\lambda) =
\exp\left[
    -\frac{(u-u_\lambda)^2}{2\sigma_u^2}
    -\frac{v^2}{2\sigma_v^2}
\right].
$$

Here $u_\lambda$ is the wavelength-dependent lobe center. The authored reveal
width controls $\sigma_u$ and, through an internal scale factor, $\sigma_v$.
This Gaussian is a practical real-time approximation of local angular
selectivity, not a claim that all physical foil lobes are exactly Gaussian.

### Interpreting the reveal field

For a reference green wavelength $\lambda_0=550\,\mathrm{nm}$, the red channel
is decoded into a target coordinate $u_0$. Physically, $u_0$ corresponds to a
local first-order reciprocal-grating coordinate:

$$
u_0 \simeq \frac{\lambda_0}{a}.
$$

Rather than requiring artists to paint grating periods in micrometers, the
renderer maps the normalized reveal value $r\in[0,1]$ into a useful interaction
range:

$$
u_0(r) = U_{\min} + r(U_{\max}-U_{\min}).
$$

The implied center for another wavelength is

$$
u_\lambda = u_0\frac{\lambda}{\lambda_0}.
$$

Consequently, equal red values illuminate together, while a red gradient
causes the active contour to sweep through the card. A radial red gradient
produces a circular contour; a diamond distance field produces a diamond
contour.

Both $+1$ and $-1$ orders must be evaluated:

$$
D_{\pm}(\lambda) = D(u-u_\lambda,v) + D(u+u_\lambda,v).
$$

Including both orders makes $\theta$ and $\theta+\pi$ equivalent, as required
for an unoriented physical grating axis.

### RGB spectral approximation

The initial shader evaluates the directional response at three representative
wavelengths:

$$
\lambda_R=610\,\mathrm{nm},\qquad
\lambda_G=550\,\mathrm{nm},\qquad
\lambda_B=460\,\mathrm{nm}.
$$

The resulting samples form the linear RGB diffraction color:

$$
\mathbf{c}_{\mathrm{diff}} =
\left(D_{\pm}(\lambda_R),
      D_{\pm}(\lambda_G),
      D_{\pm}(\lambda_B)\right).
$$

This approximation produces wavelength separation without the cost of a full
spectral integral. It is not colorimetric. A later implementation may sample
more wavelengths and integrate against standard color-matching functions.

### Wide-angle approximation

A wide-angle surface can be described conceptually by a distribution
$p(\theta,a)$ over local grating orientations and periods:

$$
D_{\mathrm{wide}}(\lambda) =
\int\!\!\int p(\theta,a)
    D(\lambda;\theta,a)\,d\theta\,da.
$$

A broad $p$ makes some diffraction response available for many projected
half-vector directions. Evaluating this integral per fragment is unnecessary
for the demo. The first implementation will retain a procedural, broad-angle
spectral approximation based on the tangent-space reflected direction, two
internal grating axes, and stationary microstructure. It must not sample the
red, green, or blue control channels. Only alpha coverage affects wide-angle
foil.

This deliberate difference is important:

- directional mode uses authored local grating fields and narrow Gaussian
  angular lobes;
- wide-angle mode uses an internal broad grating distribution and remains
  visible across the supported tilt range.

### Base reflection and compositing

The artwork texture is converted approximately from display space to linear
space before lighting:

$$
\mathbf{c}_{\mathrm{linear}} =
\max(\mathbf{c}_{\mathrm{display}},0)^{2.2}.
$$

The renderer constructs an internal foil color from the diffraction response,
a neutral specular lobe, Fresnel response, and stationary micro-glints. All
strength constants remain shader implementation details.

The final linear color is

$$
\mathbf{c}_{\mathrm{final}} =
(1-C)\mathbf{c}_{\mathrm{base}} + C\mathbf{c}_{\mathrm{foil}},
$$

where $C$ is alpha coverage sampled directly from the control texture. This
means gray coverage values intentionally reduce apparent foil intensity. No
separate artist-authored intensity property exists.

The final color is converted back to approximate display space once, after
compositing.

## Artist-facing file format

### Card manifest

Each card will eventually be described by a small JSON manifest. The first
implementation may instantiate the equivalent JavaScript object directly, but
the object shape must match this future file format.

Wide-angle example:

```json
{
    "artwork": "card_texture.png",
    "foil": {
        "kind": "wide_angle",
        "control": "foil_control.png"
    }
}
```

Directional example:

```json
{
    "artwork": "card_texture.png",
    "foil": {
        "kind": "directional",
        "control": "foil_control.png"
    }
}
```

Allowed `kind` values are exactly `wide_angle` and `directional`. Unknown
values are errors. There is intentionally no `intensity` property.

### Packed foil control texture

The control texture must be an 8-bit-per-channel, lossless RGBA PNG with the
same pixel dimensions, UV layout, and vertical orientation as the artwork
texture.

| Channel | Field | Wide-angle | Directional |
|---|---|---:|---:|
| Red | Reveal coordinate | Ignored | Used |
| Green | Grating orientation | Ignored | Used |
| Blue | Reveal width | Ignored | Used |
| Alpha | Coverage | Used | Used |

All four channels are linear data. They are not colors.

#### Alpha: coverage

Let the stored alpha byte be $A_8\in[0,255]$. Decode it as

$$
C=\frac{A_8}{255}.
$$

- `0` means no foil contribution.
- `255` means full foil contribution.
- Intermediate values linearly blend the foil response with the artwork.

The shader must not apply a contrast-changing `smoothstep` to coverage. The
artist's grayscale values are the requested apparent intensity control.

#### Red: reveal

Let the stored red byte be $R_8$. Decode

$$
r=\frac{R_8}{255}, \qquad
u_0=\operatorname{mix}(U_{\min},U_{\max},r).
$$

The initial internal constants are

$$
U_{\min}=0.04, \qquad U_{\max}=0.72.
$$

These values are dimensionless projected-half-vector coordinates. They may be
tuned after visual testing, but they are renderer constants rather than asset
metadata.

#### Green: grating orientation

Let the stored green byte be $G_8$. Decode the unoriented grating axis as

$$
g=\frac{G_8}{255}, \qquad \theta=\pi g.
$$

Thus:

- `0` represents $0^\circ$;
- `128` represents approximately $90^\circ$; and
- `255` represents approximately $180^\circ$, which is physically equivalent
  to `0`.

The value describes the direction of diffraction, perpendicular to the
physical groove lines.

#### Blue: reveal width

Let the stored blue byte be $B_8$. Decode

$$
b=\frac{B_8}{255}, \qquad
\sigma_u=\operatorname{mix}(\sigma_{\min},\sigma_{\max},b).
$$

The initial internal constants are

$$
\sigma_{\min}=0.015, \qquad \sigma_{\max}=0.18.
$$

The perpendicular width is

$$
\sigma_v=K_v\sigma_u,
$$

with initial internal constant $K_v=1.5$. A nonzero minimum avoids unstable,
sub-pixel angular impulses.

### PNG and image-processing requirements

The packed control PNG must satisfy all of these requirements:

1. It must retain straight, unpremultiplied alpha.
2. RGB values under transparent pixels must not be destroyed by an image
   optimizer. Those values are irrelevant at exactly zero coverage but remain
   relevant near antialiased coverage edges.
3. It must not use lossy compression.
4. It must not be uploaded through an sRGB internal texture format.
5. Browser color-space conversion must be disabled for this texture.
6. Browser alpha premultiplication must be disabled for this texture.
7. It must use clamp-to-edge addressing.
8. The renderer must vertically flip it exactly as it flips the artwork.

The later packing program should strip or normalize misleading color-profile
metadata, but the renderer must still explicitly treat the texture as data.

## Texture filtering

### Orientation seam

Ordinary bilinear interpolation is incorrect for grating orientation. Values
near `0` and `255` represent nearly identical axes, but scalar interpolation
would produce a value near `128`, which represents a perpendicular axis.

The shader must interpolate orientation on the doubled-angle unit circle. For
each neighboring sample $g_i$, construct

$$
\mathbf{o}_i =
(\cos 2\pi g_i,\sin 2\pi g_i).
$$

Bilinearly interpolate the four $\mathbf{o}_i$, normalize the result, and
decode

$$
\theta = \frac{1}{2}\operatorname{atan2}(o_y,o_x).
$$

The doubled angle makes $0^\circ$ and $180^\circ$ identical before
interpolation.

### Manual control-texture sampling

The control texture will use base-level sampling without generated mipmaps.
The fragment shader will obtain the four surrounding texels with
`texelFetch()` and perform:

- scalar bilinear interpolation for reveal;
- circular bilinear interpolation for grating orientation;
- scalar bilinear interpolation for reveal width; and
- scalar bilinear interpolation for coverage.

Four base-level fetches are acceptable for one card and guarantee that all
channels share exactly the same reconstruction footprint.

Generated mipmaps are initially forbidden for the control texture because a
standard mipmap generator would scalar-average the green orientation channel.
At large minification this may alias. A future packer can produce custom
orientation-aware mip levels or a future renderer can use a separate encoded
orientation representation.

## GLSL design

### Shader inputs

The vertex shader continues to output:

```glsl
out vec2 v_texcoord;
out vec3 v_model_position;
out vec3 v_view_position;
```

The fragment shader adds or retains:

```glsl
uniform mat4 u_view;
uniform sampler2D u_texture;
uniform sampler2D u_foil_control;
uniform int u_foil_kind;
```

Foil-kind values are renderer constants:

```glsl
const int FOIL_KIND_WIDE_ANGLE = 0;
const int FOIL_KIND_DIRECTIONAL = 1;
```

The branch on `u_foil_kind` is uniform for the entire draw call, so all
fragments follow the same branch. This avoids divergent execution within the
card.

### Decoded control structure

GLSL ES has no methods on structures, so sampling and decoding remain free
functions:

```glsl
struct FoilControl
{
    float reveal;
    vec2 grating_axis;
    float reveal_width;
    float coverage;
};

FoilControl sampleFoilControl(sampler2D control_texture,
                              vec2 texture_coord);
```

`grating_axis` is returned as a decoded two-dimensional unit vector. Keeping it
decoded avoids repeated angle conversion in the directional evaluator.

### Coordinate frame

The fragment shader requires a tangent frame for the flat card face. The first
implementation can continue deriving it from known model axes:

```glsl
mat3 view_rotation = mat3(u_view);
vec3 normal = normalize(view_rotation * vec3(0.0, -1.0, 0.0));
vec3 tangent = normalize(view_rotation * vec3(1.0, 0.0, 0.0));
vec3 bitangent = normalize(view_rotation * vec3(0.0, 0.0, 1.0));
```

This is correct for the current card model and avoids adding tangent and normal
attributes. If arbitrary meshes are supported later, the mesh must provide a
normal and tangent basis.

### Directional evaluation

The directional evaluator has the conceptual signature:

```glsl
vec3 evaluateDirectionalFoil(FoilControl control,
                             vec3 base_color,
                             vec3 light_direction,
                             vec3 view_direction,
                             vec3 normal,
                             vec3 tangent,
                             vec3 bitangent);
```

It performs these steps:

1. Transform the two-dimensional control `grating_axis` into view space:

   ```glsl
   vec3 grating = control.grating_axis.x * tangent
                + control.grating_axis.y * bitangent;
   vec3 perpendicular = -control.grating_axis.y * tangent
                      + control.grating_axis.x * bitangent;
   ```

2. Compute the tangent projection of the non-normalized half vector:

   ```glsl
   vec3 half_sum = light_direction + view_direction;
   vec3 tangent_half = half_sum - dot(half_sum, normal) * normal;
   float u = dot(tangent_half, grating);
   float v = dot(tangent_half, perpendicular);
   ```

3. Decode the green-reference center and local widths.
4. Scale that center by each representative wavelength.
5. Evaluate positive and negative first-order Gaussian lobes.
6. Store the red-, green-, and blue-wavelength responses in linear RGB.
7. Apply internal Fresnel, neutral highlight, and micro-glint terms.
8. Combine the internal reflection terms with retained base artwork.
9. Return the uncomposited foil-surface color. Coverage is applied later.

The Gaussian helper should be explicit:

```glsl
float diffractionLobe(float u, float v, float center,
                       float width_u, float width_v)
{
    float local_u = (u - center) / width_u;
    float local_v = v / width_v;
    return exp(-0.5 * (local_u * local_u + local_v * local_v));
}
```

The implementation must clamp widths to their internal minimum before
division, even though valid packed values already decode to nonzero widths.

### Wide-angle evaluation

The wide-angle evaluator has the conceptual signature:

```glsl
vec3 evaluateWideAngleFoil(vec3 base_color,
                           vec3 light_direction,
                           vec3 view_direction,
                           vec3 normal,
                           vec3 tangent,
                           vec3 bitangent,
                           vec3 model_position);
```

It must not accept `FoilControl`, except that the caller uses coverage during
final compositing. This API shape makes accidental dependence on ignored RGB
channels difficult.

The existing broad-angle spectral palette, dual internal axes, Fresnel term,
neutral highlight, and stationary micro-glints may be refactored into this
function. During refactoring, the output should remain visually close to the
currently accepted wide-angle effect.

### Main fragment flow

The main function follows this order:

```glsl
void main()
{
    vec4 artwork_sample = texture(u_texture, v_texcoord);
    FoilControl control = sampleFoilControl(u_foil_control,
                                            v_texcoord);

    vec3 base_color = linearColor(artwork_sample.rgb);
    vec3 foil_color;
    if(u_foil_kind == FOIL_KIND_DIRECTIONAL)
    {
        foil_color = evaluateDirectionalFoil(/* inputs */);
    }
    else
    {
        foil_color = evaluateWideAngleFoil(/* inputs */);
    }

    vec3 final_color = mix(base_color, foil_color,
                           control.coverage);
    out_color = vec4(displayColor(final_color),
                     artwork_sample.a);
}
```

The artwork alpha remains the output alpha. Foil coverage is material data and
must not replace the card's geometric opacity.

## JavaScript design

### Foil kind

JavaScript uses a frozen enumeration whose integer values match GLSL:

```js
/** Foil shader variants accepted by CardMaterial. */
const FOIL_KIND = Object.freeze({
    WIDE_ANGLE: 0,
    DIRECTIONAL: 1,
});
```

A parsing function converts manifest strings into these values and throws a
descriptive error for unknown strings. It must not silently fall back, because
using wide-angle rendering for a directional asset would make all RGB control
fields appear broken.

### Texture roles

`Texture` gains an explicit data/color role rather than accumulating foil-only
behavior:

```js
/** Color-space and filtering behavior for a texture resource. */
const TEXTURE_ROLE = Object.freeze({
    COLOR: "color",
    DATA: "data",
});
```

For `DATA` textures, upload must:

1. set `UNPACK_COLORSPACE_CONVERSION_WEBGL` to `NONE`;
2. set `UNPACK_PREMULTIPLY_ALPHA_WEBGL` to `false`;
3. apply the requested vertical flip;
4. upload as linear `RGBA8` data;
5. use `LINEAR` minification and magnification for ordinary scalar sampling,
   while directional mode uses `texelFetch()` for manual reconstruction;
6. use `CLAMP_TO_EDGE` wrapping; and
7. omit mipmap generation.

Pixel-store settings are global WebGL state. `Texture` must save the previous
values and restore them immediately after upload so loading one resource does
not alter later uploads.

The data-texture placeholder must be `[0, 0, 0, 0]`. It represents zero
coverage, so the card shows only its artwork until the control texture loads.

### Card material

Texture-to-uniform binding belongs in a material abstraction rather than in
`drawScene()`:

```js
class CardMaterial
{
    /** Create artwork and foil resources for one card material. */
    constructor(gl, artwork_url, foil_kind, foil_control_url)
    {
        // Validate arguments and create both Texture resources.
    }

    /** Bind all material resources and uniforms before drawing. */
    use(program)
    {
        this.artwork.use(program, "u_texture", 0);
        this.foil_control.use(program, "u_foil_control", 1);
        const kind_ref = this.gl.getUniformLocation(program,
                                                     "u_foil_kind");
        this.gl.uniform1i(kind_ref, this.foil_kind);
    }
}
```

The initial implementation may continue looking up uniform locations during
`use()`, matching the current code. Caching uniform locations in a future
`ShaderProgram` abstraction is desirable but not required for this feature.

`Model` owns or references one `CardMaterial`. Its draw sequence becomes:

```js
model.vertex_array.use();
model.material.use(program);
gl.drawArrays(gl.TRIANGLES, 0, model.vertex_count);
```

This guarantees that each draw explicitly binds its VAO, artwork, control
texture, and foil kind. It does not depend on initialization order or stale
global WebGL bindings.

### Initial scene configuration

Until JSON loading is implemented, `initScene()` defines an object equivalent
to the manifest:

```js
const card_description = {
    artwork: "card_texture.png",
    foil: {
        kind: "directional",
        control: "foil_control.png",
    },
};
```

Changing `kind` is the only action required to select the other foil model.
The same packed texture remains valid. In wide-angle mode its RGB channels are
ignored.

### Loading and error behavior

The implementation must report:

- an image-load error containing the failed URL;
- an unknown foil-kind error containing the invalid value;
- a shader uniform error if a required uniform is absent; and
- a warning when artwork and control texture dimensions differ.

Dimension mismatch is a warning rather than an immediate failure because UVs
are normalized and differently sized maps are technically usable. Equal sizes
remain the asset specification because they make authored alignment and edge
filtering predictable.

## Implementation sequence

1. Rename the current `foil_mask.png` concept to `foil_control.png` and create
   a packed control texture conforming to this specification.
2. Add `TEXTURE_ROLE` and data-texture upload behavior to `Texture`.
3. Add `FOIL_KIND` and strict string parsing.
4. Add `CardMaterial` and move texture/uniform binding out of `drawScene()`.
5. Replace `u_foil_mask` with `u_foil_control` in JavaScript and GLSL.
6. Implement manual four-texel control sampling and circular orientation
   interpolation.
7. Refactor the current effect into `evaluateWideAngleFoil()` without changing
   its artist-facing behavior.
8. Implement tangent-space half-vector calculation.
9. Implement directional RGB diffraction lobes using the packed fields.
10. Composite both kinds using unmodified alpha coverage.
11. Add strict error reporting and dimension validation.
12. Validate shaders, JavaScript, packed channels, and interactive behavior.

Each step should leave the shader compiling. The wide-angle path should remain
usable while the directional evaluator is being developed.

## Validation plan

### Static validation

- Run `node --check` on every modified JavaScript file.
- Run `git diff --check`.
- Compile and link the vertex and fragment shaders with
  `glslangValidator`.
- Confirm modified source lines follow the repository's 80-byte soft limit.

### Channel-isolation tests

Create small diagnostic packed textures in which only one channel varies.

1. **Coverage test:** Keep RGB constant and sweep alpha from 0 to 1. The result
   must continuously blend from artwork to foil in both modes.
2. **Wide-angle isolation test:** Change RGB arbitrarily while preserving
   alpha. Wide-angle output must not change.
3. **Reveal test:** Use equal red blocks separated spatially. Equal blocks must
   activate together. A red gradient must produce a moving contour.
4. **Orientation test:** Put perpendicular green values in adjacent regions.
   Horizontal and vertical card tilts must preferentially activate different
   regions.
5. **Orientation seam test:** Place green values `1` and `254` adjacent. Their
   interpolated axis must remain near the common physical orientation rather
   than rotating toward $90^\circ$.
6. **Width test:** Use a constant reveal with a blue gradient. The narrow side
   must flash briefly; the wide side must remain active over a larger tilt
   interval.

### Pattern tests

Author these directional reveal maps:

- horizontal linear gradient;
- radial distance field;
- diamond signed-distance field;
- several flat-valued symbols; and
- a continuous spiral orientation field.

Verify that they respectively produce a moving straight band, circular band,
diamond band, simultaneous symbol reveals, and locally rotating angular
responses.

### Interaction tests

- Test the center and all four extremes of mouse-controlled tilt.
- Verify that directional foil can become nearly invisible outside its lobe.
- Verify that wide-angle foil remains visible throughout the same range.
- Verify that moving the mouse along orthogonal directions exercises the
  orientation field correctly.
- Verify that no foil appears before the control texture finishes loading.
- Verify that a hard refresh and an ordinary cached refresh produce identical
  results after assets load.

### Numerical tests

- Clamp all decoded widths to at least $\sigma_{\min}$.
- Guard normalization of a nearly zero interpolated orientation vector by
  falling back to the nearest texel's orientation.
- Clamp coverage to $[0,1]$.
- Clamp final negative linear RGB values before display conversion.
- Confirm that NaN or infinity cannot result at face-on or grazing views.

### Performance tests

Measure frame time at the canvas's largest expected display size. Compare:

- the existing wide-angle shader;
- the refactored wide-angle path with manual control sampling; and
- the directional path with six Gaussian evaluations.

The directional path evaluates two orders for three wavelengths, hence six
lobes per fragment. If performance is inadequate, first replace the two
explicit order evaluations with symmetry-aware algebra or reduce control-map
sampling cost. Do not remove correct orientation interpolation without a
replacement.

## Edge cases and limitations

### Zero coverage

RGB channels under zero alpha have no visible effect. They must nevertheless
remain unpremultiplied so antialiased transitions do not corrupt field values.

### Eight-bit quantization

Each field has 256 stored levels. Linear filtering makes coverage and reveal
gradients smoother, but very narrow reveal widths may expose quantization as
stepped motion. The nonzero internal minimum width is partly intended to hide
this. If it remains visible, a 16-bit or floating-point control format can be
considered later.

### Orientation cancellation

When a filter footprint contains equally strong perpendicular axes, the
doubled-angle vectors can cancel. No unique mean orientation exists in that
case. The shader falls back to the nearest texel orientation. Artists should
use coverage transitions or sufficient spatial resolution at intentional hard
orientation boundaries.

### Minification

Base-level manual filtering does not solve distant minification. The current
demo presents one large card, so this is acceptable. A scene with many small
cards will require orientation-aware custom mipmaps or a different packed
representation.

### Coverage as intensity

Coverage normally describes a spatial mixture, while optical amplitude is a
different physical quantity. This design intentionally conflates their
artist-facing effect: lowering alpha blends more base artwork into the result
and therefore looks like weaker foil. Internal diffraction intensity remains
fixed. This is a usability decision requested for the asset format.

### One foil kind per material

The manifest selects one foil kind for the entire material. A card cannot yet
use wide-angle foil on its border and directional foil in its illustration.
The natural extension is an array of foil layers, each with its own packed
control texture and kind. That extension is outside this design.

### Approximate illumination

The initial renderer uses one internal directional light. Real diffraction is
strongly dependent on the incident illumination distribution. A small bright
source produces crisp bands; a broad source convolves and softens them. The
reveal-width field can mimic some broadening, but it is not a substitute for
integrating an environment map.

### Approximate spectrum

Three wavelength samples produce a plausible RGB rainbow but do not guarantee
spectral or colorimetric accuracy. This is explicitly an interactive artistic
model grounded in the geometry of diffraction orders.

## Alternatives considered

### Four separate grayscale textures

This would be easy to author and filter but would require four texture files,
four samplers, and additional asset coordination. The requested packed RGBA
format is more compact. A future packing tool restores the convenience of
separate authoring files without changing the runtime contract.

### Encode orientation as two channels

Encoding $(\cos2\theta,\sin2\theta)$ directly would permit correct hardware
filtering, but it consumes two of the four available channels. Packing all four
requested fields into one RGBA texture takes priority, so orientation uses one
channel and the shader performs circular reconstruction.

### Store an artist intensity field

An independent intensity field would separate optical amplitude from coverage,
but it would require another channel or texture. The design instead uses alpha
coverage as the apparent-strength control and keeps intensity internal.

### Use reveal as a purely artistic animation phase

A periodic animation phase is simple, but it is less directly connected to the
grating equation. Interpreting reveal as the target projected-half-vector
coordinate at a reference wavelength gives equal-value activation, natural
wavelength separation, and a physical relationship to local grating spacing.

### Full Fourier diffraction

A height-field Fourier model can reproduce much richer microstructure, but it
is expensive, difficult to author, and unnecessary for the current demo. The
Gaussian-order model preserves the most important directional and spectral
behavior in a compact shader.

## Future extensions

Potential follow-up work includes:

- a packer that combines four grayscale source images into the RGBA contract;
- orientation-aware custom mipmap generation;
- multiple foil layers per card;
- environment-map illumination;
- more spectral samples with CIE integration;
- a live artist preview showing reveal contours over tilt;
- procedural generators for radial, tangential, diamond, spiral, and faceted
  orientation fields;
- signed or asymmetric diffraction orders;
- arbitrary-mesh tangent frames; and
- measured control fields reconstructed from photographs of physical foil.

These extensions must preserve the packed texture semantics defined here unless
the asset format receives an explicit version number.
