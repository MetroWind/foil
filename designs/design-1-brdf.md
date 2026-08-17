# Physically Based Foil BRDF

## Status

Implemented on 2026-08-17. Visual acceptance and browser/GPU performance
validation remain pending.

This document specifies the next foil renderer. It replaces the current
artistically tuned directional effect with a physically based, rasterized
bidirectional reflectance model. It does not require ray tracing. It evaluates
direct illumination from a finite area light in a WebGL 2 fragment shader.

The word "physical" in this document means that directions, wavelengths,
light transport, order weights, and color-space conversions have explicit
physical meanings. It does not mean that the renderer solves Maxwell's
equations for the microscopic foil structure at runtime.

## Relationship to the previous design

[`design-0-foil.md`](design-0-foil.md) defines the packed control texture,
the `CardMaterial` abstraction, and two qualitative foil appearances. This
design retains the useful resource and material abstractions but supersedes
the following parts of that document:

- the red channel is interpreted as physical groove frequency rather than an
  artistic reveal coordinate;
- the blue channel describes microstructure disorder rather than only the
  width of a hand-tuned angular envelope;
- the directional shader becomes a multi-order diffraction BRDF;
- the arbitrary wide-angle spectrum, Phong highlight, and sparkle terms are
  not part of the physical path;
- wavelength conversion uses CIE color-matching data rather than Zucconi6;
- the renderer integrates a disk light instead of evaluating one ideal
  directional ray; and
- output uses explicit exposure, tone mapping, and the sRGB transfer function.

The existing `wide_angle` path remains available as a legacy comparison until
the physical linear-grating path passes visual and numerical validation. A
physical distribution of many grating orientations is a later extension.

## Goals

1. Ground the card in a conventional direct-light material model.
2. Preserve the printed artwork beneath partially reflective foil.
3. Render ordinary, zeroth-order reflection with a GGX microfacet BRDF.
4. Render multiple nonzero diffraction orders from a linear reflection
   grating.
5. Handle arbitrary incident, viewing, and groove directions without a
   special-case conical-diffraction formula.
6. Make diffraction visible over a realistic range of card angles by
   integrating a finite light source and finite microstructure disorder.
7. Keep all light arithmetic in a linear, high-dynamic-range working space.
8. Convert wavelengths through CIE 1931 tristimulus data before converting to
   linear sRGB.
9. Keep the sum of transmitted, absorbed, specular, and diffracted energy
   explicitly bounded.
10. Preserve the renderer abstraction: scene code describes materials and
    lights without issuing texture and uniform calls directly.
11. Remain interactive in WebGL 2 on an ordinary desktop GPU.
12. Provide a CPU reference implementation for numerical tests.

## Non-goals

The initial implementation does not include:

- ray-traced shadows, indirect illumination, or interreflection;
- a general environment-map diffraction integral;
- full spectral rendering of the printed artwork;
- polarization;
- thin-film interference;
- transmission through a transparent card;
- a Maxwell solver in the fragment shader;
- runtime rigorous coupled-wave analysis;
- arbitrary measured groove profiles;
- physically distributed wide-angle foil;
- self-shadowing by individual microscopic grooves;
- multiple foil layers; or
- automatic conversion of unpacked grayscale artist maps.

These omissions must be visible in code and documentation. They must not be
hidden behind names such as `exact`, `real`, or `ground_truth`.

## Terminology and units

All vectors used by the BRDF point away from the shaded surface:

- $\boldsymbol{\omega}_i$ points from the surface toward a light sample;
- $\boldsymbol{\omega}_o$ points from the surface toward the observer;
- $\mathbf n$ is the macroscopic surface normal;
- $\mathbf t$ is the texture-space tangent;
- $\mathbf b$ is the texture-space bitangent;
- $\mathbf g$ is the in-plane grating vector, perpendicular to the grooves;
- $\mathbf p$ is parallel to the grooves; and
- $\mathbf h$ is the normalized reflection half-vector.

Distances used for scene geometry are in the model's existing arbitrary world
units. Microscopic grating distances and wavelengths are in micrometers. A
wavelength of 550 nm is therefore represented as $0.550\,\mu\mathrm m$.
Keeping both microscopic quantities in the same unit makes their ratio
dimensionless.

Radiance is represented in renderer-relative units. The equations preserve
relative energy, inverse-square attenuation, projected-area terms, and
material energy partitions. Absolute calibration in watts and steradians is
outside the initial scope.

## Rendering equation

For a disk light with emitting area $A_L$, the direct outgoing radiance is

$$
L_o(\boldsymbol{\omega}_o)=
\int_{A_L}
f_r(\boldsymbol{\omega}_i,\boldsymbol{\omega}_o)
L_e
\frac{(\mathbf n\cdot\boldsymbol{\omega}_i)^+
      (\mathbf n_L\cdot-\boldsymbol{\omega}_i)^+}
     {r^2}
\,dA.
$$

Here $r$ is the distance to a sampled point on the disk, $\mathbf n_L$ is
the light normal, $L_e$ is its emitted radiance, and $x^+=\max(x,0)$. The
fragment shader approximates the area integral using a fixed deterministic
quadrature rule:

$$
L_o\approx\frac{A_L}{N_L}
\sum_{j=1}^{N_L}
f_r(\boldsymbol{\omega}_{i,j},\boldsymbol{\omega}_o)
L_e
\frac{(\mathbf n\cdot\boldsymbol{\omega}_{i,j})^+
      (\mathbf n_L\cdot-\boldsymbol{\omega}_{i,j})^+}
     {r_j^2}.
$$

No visibility term is present because the first implementation renders one
isolated card and has no shadow map. The API must leave room to multiply each
sample by visibility later.

## Layered card reflectance

Let $c\in[0,1]$ be foil coverage from the control texture. The complete BRDF
is an area mixture:

$$
f_r=(1-c)f_{\mathrm{print}}+c f_{\mathrm{foil}}.
$$

Coverage is an area fraction, not an arbitrary additive intensity. This
interpretation guarantees that zero coverage reproduces the ordinary printed
card exactly and full coverage evaluates only the foil-layer model.

The foil-layer BRDF is

$$
f_{\mathrm{foil}}=
T_{\mathrm{print}}f_{\mathrm{print}}+
\eta_0 f_{\mathrm{GGX}}+
\sum_{m\ne0}f_{\mathrm{diff},m}.
$$

$T_{\mathrm{print}}$ is the energy assigned to artwork visible through or
between the reflective microstructure. $\eta_0$ is the zeroth-order energy
allocation. The remaining nonzero-order allocations are described below.

This is an effective layered BRDF. It does not model refraction through a
finite plastic film. Its purpose is to retain the important energy paths
without inventing unrelated additive highlights.

## Printed layer

The initial printed layer is Lambertian:

$$
f_{\mathrm{print}}=\frac{\mathbf a}{\pi},
$$

where $\mathbf a$ is the artwork texture decoded into linear sRGB. Lambertian
reflection is sufficient for the current card artwork. A rough diffuse or
clear-coat model may replace it later without changing the diffraction API.

The artwork must use the exact sRGB electro-optical transfer function instead
of the current approximate exponent of 2.2. For an encoded component $c_s$,

$$
c_l=
\begin{cases}
c_s/12.92,&c_s\le0.04045,\\
\left((c_s+0.055)/1.055\right)^{2.4},&c_s>0.04045.
\end{cases}
$$

The inverse function is applied only after lighting and tone mapping. The
[W3C CSS Color specification](https://www.w3.org/TR/css-color-4/) documents
the sRGB transfer functions, D65 white point, and linear-light sRGB space.

## Zeroth-order reflection

The zeroth diffraction order is ordinary reflection. It must not be deleted
merely because an earlier Phong highlight looked artificial. The replacement
is an isotropic GGX microfacet BRDF:

$$
f_{\mathrm{GGX}}=
\frac{D_{\mathrm{GGX}}(\mathbf h)
      G_{\mathrm{Smith}}(\boldsymbol{\omega}_i,
                         \boldsymbol{\omega}_o)
      F(\boldsymbol{\omega}_i,\mathbf h)}
     {4(\mathbf n\cdot\boldsymbol{\omega}_i)^+
        (\mathbf n\cdot\boldsymbol{\omega}_o)^+}.
$$

For roughness parameter $\alpha$,

$$
D_{\mathrm{GGX}}(\mathbf h)=
\frac{\alpha^2}
{\pi\left[(\mathbf n\cdot\mathbf h)^2(\alpha^2-1)+1\right]^2}.
$$

The implementation uses the height-correlated Smith masking-shadowing form.
All dot products used as denominators must be clamped to `BRDF_EPSILON`.
The Fresnel term uses Schlick's approximation with an internal neutral
$\mathbf F_0$ appropriate for the selected foil coating.

The GGX distribution and associated microfacet terminology follow Walter,
Marschner, Li, and Torrance,
[Microfacet Models for Refraction through Rough Surfaces](https://diglib.eg.org/items/590e957c-92d6-4d8f-9c4c-c23ec106ecda).
Although that paper emphasizes transmission, it reviews the reflection model
and introduces the GGX distribution used here.

Initial constants are renderer constants, not artist controls:

```text
FOIL_GGX_ROUGHNESS = 0.16
FOIL_F0 = (0.82, 0.82, 0.82)
```

These are starting values for validation, not measured properties.

## Vector diffraction geometry

Project the sum of incident and outgoing directions onto the tangent plane:

$$
\mathbf q=P_T(\boldsymbol{\omega}_i+
               \boldsymbol{\omega}_o),
$$

where

$$
P_T(\mathbf x)=\mathbf x-(\mathbf x\cdot\mathbf n)\mathbf n.
$$

Decode an unoriented grating axis $\mathbf g$ from the green control channel.
Its in-plane perpendicular is

$$
\mathbf p=\mathbf n\times\mathbf g.
$$

The two local projected coordinates are

$$
u=\mathbf q\cdot\mathbf g,
\qquad
v=\mathbf q\cdot\mathbf p.
$$

For groove spacing $d$, diffraction order $m$, and wavelength $\lambda$, an
ideal linear reflection grating is centered on

$$
u=\frac{m\lambda}{d},
\qquad v=0.
$$

This is tangential wave-vector conservation. It automatically handles
non-coplanar incidence. The shader must not calculate an effective spacing
from an incident azimuth. The scalar conical equation is a coordinate form of
the same constraint; the vector form is both simpler and less error-prone.

The classical and conical equations, order existence, and the special
zeroth-order case are described in section 2 of the
[MKS Diffraction Grating Handbook](https://www.newport.com/mam/celum/celum_assets/np/resources/MKS_Diffraction_Grating_Handbook.pdf?0=).

## Inverse wavelength evaluation

At a fixed light and view direction, solve the order equation for wavelength:

$$
\lambda_m=\frac{d|u|}{m},
\qquad m=1,2,\ldots,M.
$$

The absolute value represents symmetric positive and negative orders for an
unblazed linear grating. Only one sign sends energy toward a particular
outgoing direction. Therefore the shader loops over positive order magnitudes
and uses a per-signed-order efficiency.

Each spectral lookup contributes only when

$$
\lambda_{\min}\le\lambda_m\le\lambda_{\max},
$$

with initial bounds

```text
VISIBLE_WAVELENGTH_MIN_UM = 0.380
VISIBLE_WAVELENGTH_MAX_UM = 0.780
```

The lookup returns zero outside those bounds. There is deliberately no outer
boundary gate on the order's center wavelength. Such a gate incorrectly cuts
off the whole finite-source convolution while some of its wavelength samples
remain visible, producing a hard spatial and temporal edge. Each convolution
sample instead leaves the CIE interval independently; the near-zero CIE values
at the endpoints provide the natural fade.

## Finite microstructure response

An infinite perfect grating produces delta-function orders. Real transferred
foil has finite coherent regions, imperfect periods, local curvature, and
orientation variation. The blue control field encodes a single
microstructure-disorder value $b\in[0,1]$ from which the initial renderer
derives two correlated widths.

The cross-groove projected width is

$$
\sigma_p(b)=
\operatorname{mix}(0.008,0.16,b^2).
$$

The cross-groove lobe is

$$
P_p(v)=
\frac{1}{\sqrt{2\pi}\sigma_p}
\exp\left(-\frac{v^2}{2\sigma_p^2}\right).
$$

The relative period spread is

$$
\rho_d(b)=\operatorname{mix}(0.003,0.08,b^2),
$$

giving wavelength standard deviation

$$
\sigma_{\lambda,m}=\rho_d\lambda_m.
$$

The low-quality shader can approximate the resulting convolution with one or
three taps. The default uses the normalized nine-tap binomial kernel

$$
(1,8,28,56,70,56,28,8,1)/256.
$$

With sample spacing $\sigma_{\lambda,m}/\sqrt2$, this kernel has standard
deviation $\sigma_{\lambda,m}$. In expanded form,

$$
\overline{\mathbf X}(\lambda_m)=
\frac1{256}\sum_{j=-4}^{4}
{8\choose j+4}\,
\mathbf X\left(\lambda_m+
\frac{j\sigma_{\lambda,m}}{\sqrt2}\right).
$$

Here $\mathbf X(\lambda)$ is the source-weighted CIE XYZ lookup described
below. Nine taps remain inexpensive after diffraction was separated from disk
point quadrature. Three taps were tested and rejected for the default tier:
a broad source reduced to three isolated wavelength samples produced neon
green, cyan, and magenta stripes instead of a convolved spectrum.

The two widths are correlated because only one packed channel remains. A
future asset version may separate period variation, orientation variation,
and coherent patch length.

## Diffraction-order energy

The grating equation predicts order directions, not their intensities.
Efficiency depends on groove depth and profile, wavelength, order, incidence,
coating, and polarization. Rigorous surface-relief calculations confirm that
profile and depth materially change efficiency; see Moharam and Gaylord,
[Diffraction analysis of dielectric surface-relief gratings](https://opg.optica.org/josa/abstract.cfm?uri=josa-72-10-1385).

Runtime RCWA is outside scope. The initial shader uses an explicit normalized
energy budget and a fixed symmetric order distribution. Define

```text
ZERO_ORDER_ENERGY = 0.20
TOTAL_DIFFRACTION_ENERGY = 0.12
TRANSMITTED_PRINT_ENERGY = 0.60
ABSORBED_ENERGY = 0.08
```

These constants sum to one. `TOTAL_DIFFRACTION_ENERGY` includes both signs of
every nonzero order. Let normalized positive-order weights $w_m$ satisfy

$$
\sum_{m=1}^{M}w_m=1.
$$

The efficiency for one signed order is

$$
\eta_m=\frac12 E_{\mathrm{diff}}w_m.
$$

An internal global calibration factor $I_f$ redistributes energy between the
printed and diffracted layers:

$$
E_{\mathrm{diff}}'=I_f E_{\mathrm{diff}},
\qquad
E_{\mathrm{print}}'=E_{\mathrm{print}}
-(I_f-1)E_{\mathrm{diff}}.
$$

Thus the complete allocation remains one. `FOIL_INTENSITY` is initially 1.5
and may range from zero through six; six transfers all baseline print energy
into diffraction. It is renderer calibration, not an artist-authored field,
and does not change coverage. The demo declares it separately from quality:

```js
const FOIL_CALIBRATION = Object.freeze({
    FOIL_INTENSITY: 1.5,
});
```

Initial weights are generated from

$$
\widetilde w_m=\exp[-3.00(m-1)],
\qquad
w_m=\frac{\widetilde w_m}
          {\sum_{k=1}^{M}\widetilde w_k}.
$$

The steeper decay is a fixed blazed-film approximation. It keeps higher orders
in the physical calculation without rendering every order as an equally
prominent repeated rainbow. This distribution is energy-bounded but not a
claim about a particular commercial foil. It remains isolated behind
`orderEfficiency()` so an RCWA, measured, or profile-derived lookup can
replace it.

The default quality level evaluates four order magnitudes. The shader supports
up to eight:

```text
DEFAULT_ORDER_COUNT = 4
MAX_ORDER_COUNT = 8
```

Orders beyond the active count receive zero energy, and the active weights
are renormalized so changing quality does not dim the material.

## Spectral contribution

For an ideal order, integrating the delta constraint over wavelength produces
the Jacobian $d/|m|$. The approximate XYZ contribution is

$$
\mathbf C_m=
K\,\eta_m\,P_p(v)\,
\frac{d}{m}\,
\overline{\mathbf X}(\lambda_m).
$$

$K$ is a single renderer normalization derived from the discrete D65 and CIE
tables. It is not exposed as foil intensity. Its calculation must live beside
the LUT generator and must be reproduced by the CPU reference tests.

The shader sums XYZ contributions from all active orders and all disk-light
samples. It converts the completed diffraction sum to linear sRGB once. It
must not clamp individual monochromatic samples to the sRGB gamut before
accumulation, because negative linear RGB components are part of an accurate
XYZ-to-RGB representation of out-of-gamut monochromatic stimuli.

## Spectral lookup table

The renderer uses the CIE 1931 two-degree color-matching functions sampled at
1 nm from 380 through 780 nm. The source data come from the official
[CIE 1931 color-matching function dataset](https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer).
The source spectrum comes from the official
[CIE standard illuminant D65 dataset](https://www.cie.co.at/datatable/cie-standard-illuminant-d65).

The initial light has a fixed D65 spectral power distribution. An offline
generator multiplies each color-matching triple by the normalized D65 value:

$$
\mathbf X(\lambda)=
S_{D65}(\lambda)
\begin{pmatrix}
\overline x(\lambda)\\
\overline y(\lambda)\\
\overline z(\lambda)
\end{pmatrix}.
$$

It normalizes the table so the discrete integral of the $Y$ component is one:

$$
\sum_{\lambda=380}^{780}X_Y(\lambda)\Delta\lambda=1.
$$

The generated project resource is `spectral_xyz.bin`. Its exact format is:

| Property | Value |
|---|---|
| Byte order | little-endian |
| Header | none |
| Wavelength count | 401 |
| First wavelength | 380 nm |
| Step | 1 nm |
| Components | X, Y, Z, zero padding |
| Component type | IEEE-754 binary32 |
| Bytes per texel | 16 |
| Total bytes | 6416 |

`SpectralLut` loads this file as an `ArrayBuffer`, validates the exact byte
length, constructs a `Float32Array`, and uploads a 401-by-1 `RGBA32F` texture.
Sampling uses `texelFetch()` and explicit interpolation between adjacent
texels. It does not depend on float linear-filter support.

WebGL 2 permits typed floating-point texture uploads. The relevant sized
formats are listed in the
[WebGL 2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/).
The `EXT_color_buffer_float` extension is not required merely to sample this
texture. It becomes necessary only if a later multipass renderer writes HDR
values to a floating-point framebuffer; see the
[Khronos extension specification](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/).

Failure to load or validate the spectral table is fatal for a physical foil
material. The renderer must report the URL and expected and actual byte sizes.
It must not silently fall back to Zucconi6.

## XYZ to linear sRGB

After summing diffraction in XYZ, convert from D65 XYZ to linear sRGB:

$$
\begin{pmatrix}R\\G\\B\end{pmatrix}=
\begin{pmatrix}
 3.24096994&-1.53738318&-0.49861076\\
-0.96924364& 1.87596750& 0.04155506\\
 0.05563008&-0.20397696& 1.05697151
\end{pmatrix}
\begin{pmatrix}X\\Y\\Z\end{pmatrix}.
$$

The matrix and transfer functions must be kept in one documented color module
in the fragment shader. The W3C specification provides reference conversion
code and rational matrix coefficients.

Negative RGB components are retained while diffraction orders and light
samples are accumulated. They are not independently clamped: monochromatic
spectral colors frequently lie outside the sRGB triangle, and channel clipping
maps them to artificial display primaries.

## HDR accumulation and output

All direct-light samples, BRDF terms, and spectral terms are accumulated in
unbounded `highp vec3` values. Do not clamp each light or material layer.

The implementation remains single pass and tone-maps luminance in the card
fragment shader. Let

$$
Y=0.2126R+0.7152G+0.0722B.
$$

It uses the monotonic exponential operator

$$
Y_{tm}=1-\exp(-EY),
\qquad
\mathbf c_{tm}=\frac{Y_{tm}}{Y}\mathbf c,
$$

where $E$ is an internal exposure. Scaling the complete color by one scalar
preserves chromaticity; per-channel exponential mapping would change hue.

The tone-mapped linear color is then converted to OKLab using Björn Ottosson's
[reference matrices](https://bottosson.github.io/posts/oklab/). At fixed OKLab
lightness and hue, a ten-iteration binary search finds the largest chroma
inside the linear-sRGB cube. Chroma below 55% of that cusp is unchanged. Above
the knee it is exponentially compressed toward 85% of the cusp. This maps
out-of-gamut spectral colors into a displayable interior rather than clipping
them to neon cyan, magenta, green, or red.

Only the gamut-mapped result receives a final numerical clamp to the display
cube. The clamp removes floating-point search tolerance and is not the color
mapping operation.

The exact sRGB output transfer is then applied:

$$
c_s=
\begin{cases}
12.92c_l,&c_l\le0.0031308,\\
1.055c_l^{1/2.4}-0.055,&c_l>0.0031308.
\end{cases}
$$

Alpha remains the artwork alpha. Tone mapping must not alter alpha.

## Approximate environment fill

Without indirect illumination, regions not facing the disk would become
black. The initial renderer adds a constant diffuse hemispherical irradiance
to the printed component only:

$$
L_{\mathrm{ambient}}=E_{\mathrm{ambient}}\mathbf a.
$$

It does not add ambient specular or ambient diffraction. The constant is an
acknowledged approximation to room fill and is named
`AMBIENT_PRINT_IRRADIANCE`. Replacing it with image-based lighting is a later
feature.

## Packed control texture version 2

The physical renderer continues to accept one packed RGBA PNG. The image must
have the same dimensions and UV layout as the artwork.

| Channel | Name | Meaning |
|---|---|---|
| R | groove frequency | reciprocal physical groove spacing |
| G | grating orientation | unoriented axis perpendicular to grooves |
| B | disorder | correlated period and orientation/coherence spread |
| A | coverage | area fraction using the foil BRDF |

The texture remains a data texture:

- no browser color-space conversion;
- no premultiplied alpha;
- no mipmap generation in the initial implementation;
- clamp-to-edge wrapping; and
- manual orientation-safe bilinear reconstruction.

### Red-channel decoding

Use logarithmic interpolation over physical spacing. Let $r=R_8/255$:

$$
d(r)=d_{\max}
\left(\frac{d_{\min}}{d_{\max}}\right)^r,
$$

with

```text
GROOVE_SPACING_MIN_UM = 0.55
GROOVE_SPACING_MAX_UM = 3.20
```

Red zero therefore means coarse 3.20-micrometer grooves; red one means fine
0.55-micrometer grooves. Logarithmic interpolation gives comparable relative
precision across the range. A spatial gradient still produces a moving foil
band, but its values now have a direct material interpretation.

### Green-channel decoding

The unoriented axis encoding remains

$$
\theta=\pi\frac{G_8}{255}.
$$

The renderer must retain doubled-angle circular interpolation:

$$
\mathbf a=(\cos2\theta,\sin2\theta).
$$

After bilinear interpolation and normalization, divide the reconstructed
angle by two. Ordinary scalar interpolation is invalid at the equivalent
zero- and 180-degree boundary.

### Blue-channel decoding

Let $b=B_8/255$. The shader uses $b^2$ in the width equations so artists have
more precision near coherent, narrow responses. Blue zero is still nonzero
disorder; an exact delta response is neither stable nor properly sampled by a
rasterizer.

### Alpha-channel decoding

Coverage is

$$
c=A_8/255.
$$

Do not apply `smoothstep()` to coverage. Filtering already produces fractional
area coverage at boundaries. Artists continue to tune apparent foil amount by
painting alpha rather than by receiving a separate intensity control.

### Migration of the current demo texture

The old red field encodes an artistic reveal coordinate, not a physical groove
period. An initial attempted migration mapped it to spacing using the previous
relation

$$
d=\frac{0.550}{u_0}\;\mu\mathrm m
$$

and then inverted the new logarithmic encoding. Visual testing rejected that
migration: the reveal ramp became a spatial groove-frequency ramp and painted
repeated rainbows directly across every covered region.

The demo asset therefore uses a constant $d=1.10\,\mu\mathrm m$, encoded as
red byte 155. Green, blue, and alpha are copied without semantic changes. A
future artist-authored spacing field may vary red where the intended physical
film genuinely changes groove frequency, but an artistic reveal field must
not be repurposed as one.

The converted file should be named `foil_control_v2.png`. A versioned filename
is preferable to a query string because the pixel contract has changed.

## Tangent frame

Physical grating orientation is defined relative to artwork UVs. Model-space
X and Z axes are insufficient for a generic textured mesh. Each vertex must
provide:

```glsl
in vec3 a_position;
in vec3 a_normal;
in vec4 a_tangent;
in vec2 a_texcoord;
```

`a_tangent.xyz` is the texture-space tangent and `a_tangent.w` is handedness.
The vertex shader constructs the bitangent after transforming the normal and
tangent:

```glsl
vec3 normal = normalize(u_normal_matrix * a_normal);
vec3 tangent = normalize(mat3(u_view) * a_tangent.xyz);
vec3 bitangent = a_tangent.w * normalize(cross(normal, tangent));
```

The JavaScript loader calculates tangents once for OBJ triangles. For each
triangle with position edges $\Delta\mathbf p_1,\Delta\mathbf p_2$ and UV
edges $\Delta\mathbf u_1,\Delta\mathbf u_2$, it solves

$$
\begin{pmatrix}\mathbf t&\mathbf b\end{pmatrix}=
\begin{pmatrix}\Delta\mathbf p_1&\Delta\mathbf p_2\end{pmatrix}
\begin{pmatrix}
\Delta u_{1x}&\Delta u_{1y}\\
\Delta u_{2x}&\Delta u_{2y}
\end{pmatrix}^{-1}.
$$

Degenerate UV triangles fall back to a stable orthonormal basis derived from
the normal and emit one warning containing the geometry name. Tangents are
orthogonalized against the normal before upload.

## Disk-light model

The demo uses one two-sided-disabled disk light with:

```text
position: view-space center
normal: view-space emitting normal
axis_x: view-space radius axis
axis_y: view-space radius axis
radius: world-space radius
radiance: scalar D65 radiance
```

`axis_x`, `axis_y`, and `normal` must be mutually orthonormal. JavaScript
validates this within `1e-4` when the light is constructed.

The shader stores a fixed low-discrepancy unit-disk point set for the printed
and zeroth-order GGX layers. Each sample position is

$$
\mathbf x_j=\mathbf x_L+R(a_j\mathbf e_x+b_j\mathbf e_y).
$$

The point set must be rotationally balanced and must not contain duplicated
points. It is deterministic so screenshots are stable. The default uses four
samples; quality testing includes two, four, eight, and sixteen.

The default four-sample coordinates are

```text
(-0.5, -0.5)
( 0.5, -0.5)
(-0.5,  0.5)
( 0.5,  0.5)
```

All four lie at radius $1/\sqrt2$, and their mean squared radius is $1/2$,
matching the mean squared radius of a uniformly sampled unit disk. The
eight-sample variant uses four points at radius 0.5 on the coordinate axes and
four points at radius $\sqrt{3}/2$ on the diagonals. The diagonal coordinates
are $(\pm\sqrt{3/8},\pm\sqrt{3/8})$. The sixteen-sample diagnostic variant
uses two staggered rotational rings at radii $1/2$ and $\sqrt{3}/2$. It is
committed as constants and has zero centroid and mean squared radius $1/2$.

Directly applying those few points to a narrow diffraction lobe produces a
visibly separate rainbow for each sample. The implemented diffraction layer
therefore uses the disk-center direction and convolves the material response
with the disk's continuous angular footprint. For a sufficiently distant
uniform disk, either projected coordinate has standard deviation

$$
\sigma_L\simeq\frac{R}{2D},
$$

where $D$ is the center-to-surface distance. Independent material and source
widths add in quadrature. The cross-groove width becomes

$$
\sigma_v'=\sqrt{\sigma_v^2+\sigma_L^2},
$$

and the wavelength width of order $m$ becomes

$$
\sigma_{\lambda,m}'=
\sqrt{(\lambda_m\sigma_d)^2+
      \left(\frac{d\sigma_L}{m}\right)^2}.
$$

The ordinary layers retain disk quadrature because their lobes are broad
enough to sample without visible copies. This hybrid is a zeroth-order
area-light approximation: it ignores perspective variation across the disk,
but produces one continuously broadened diffraction response rather than
several point-source replicas.

## JavaScript architecture

Scene setup must not bind textures or set physical uniforms directly. The
following types own the WebGL calls.

### `ShaderProgram`

`ShaderProgram` owns a linked program and caches attribute and uniform
locations. Its public interface is:

```js
class ShaderProgram
{
    /** Create, compile, and link a shader program from source URLs. */
    constructor(gl, vertex_url, fragment_url,
                fragment_definitions = {});

    /** Bind this program for subsequent drawing. */
    use();

    /** Return a required cached uniform location or throw. */
    uniform(name);

    /** Return an optional cached uniform location or null. */
    optionalUniform(name);

    /** Return a required cached attribute location or throw. */
    attribute(name);
}
```

Missing required variables are errors. Optional shader features must use a
separate `optionalUniform()` method so a typo cannot masquerade as an optional
feature.

### `SpectralLut`

`SpectralLut` owns the floating-point CIE/D65 texture:

```js
class SpectralLut
{
    /** Load, validate, and upload a source-weighted CIE XYZ table. */
    constructor(gl, url);

    /** Bind the table to a texture unit and its sampler uniform. */
    use(program, texture_unit);

    /** Register a function invoked after successful validation and upload. */
    onLoad(listener);
}
```

Its one-texel placeholder contains zeros. A material using it is allowed to
draw before loading, but it produces no diffraction and the console reports
that the spectral resource is pending. Malformed data throws from the load
handler and marks the resource permanently failed.

### `DiskLight`

`DiskLight` stores physical light data independently of the material:

```js
class DiskLight
{
    /** Create a validated one-sided disk emitter. */
    constructor(position, normal, radius, radiance);

    /** Transform and upload disk-light uniforms for the current view. */
    use(program, view_matrix);
}
```

The constructor derives stable disk axes. `use()` transforms position as a
point and directions as vectors. It never calls `gl.useProgram()`; the renderer
binds the program first.

### `PhysicalFoilMaterial`

The existing `CardMaterial` responsibilities are retained in a specialized
physical material:

```js
class PhysicalFoilMaterial
{
    /** Load artwork, packed physical controls, and the spectral table. */
    constructor(gl, artwork_url, control_url, spectral_url);

    /** Bind material textures and fixed physical constants. */
    use(program);
}
```

Texture units are fixed by the material contract:

| Unit | Resource | Sampler |
|---|---|---|
| 0 | artwork | `u_artwork` |
| 1 | packed foil controls | `u_foil_control` |
| 2 | spectral XYZ table | `u_spectral_xyz` |

The material checks artwork and control dimensions when both finish loading.
Dimension mismatch is a hard error for the physical path.

### `Renderer`

`Renderer` owns frame-level state:

```js
class Renderer
{
    /** Create a renderer for one WebGL 2 context and shader program. */
    constructor(gl, program);

    /** Draw a scene from a camera under one disk light. */
    draw(scene, camera, light);
}
```

`draw()` performs these operations in order:

1. resize the drawing buffer;
2. clear color and depth;
3. bind the program;
4. upload camera and normal matrices;
5. upload the disk light;
6. bind each model's vertex array;
7. bind its material; and
8. issue `drawArrays()`.

This keeps the scene description declarative and prevents physical parameters
from being scattered across event handlers and render loops.

## Manifest and demo configuration

The in-code card description becomes:

```js
const card_description = {
    artwork: "card_texture.png",
    foil: {
        kind: "physical_linear",
        control: "foil_control_v2.png?version=constant-spacing-1",
    },
};
```

No artist-facing foil intensity, order count, F0, exposure, groove-depth, or
light-width parameter is introduced. Renderer quality and calibration
constants remain internal. The only artist-authored strength control is
coverage alpha.

Allowed foil kinds during migration are:

- `physical_linear`: the new implementation;
- `wide_angle`: the existing legacy comparison; and
- `directional_legacy`: the current Zucconi6 path, temporarily renamed.

After the physical path is accepted, `directional_legacy` and its shader code
are removed rather than maintained indefinitely.

## GLSL organization

The fragment shader is divided into small functions with explicit domains:

```glsl
vec3 srgbToLinear(vec3 encoded);
vec3 linearToSrgb(vec3 linear_color);
vec3 toneMap(vec3 hdr_color);
vec3 xyzToLinearSrgb(vec3 xyz);
FoilControl sampleFoilControl(vec2 uv);
vec3 sampleSpectralXyz(float wavelength_um);
float distributionGgx(float normal_half);
float visibilitySmithGgx(float normal_light, float normal_view);
vec3 fresnelSchlick(float view_half);
vec3 evaluateSpecularBrdf(...);
vec3 evaluateDiffractionXyz(...);
vec3 evaluateOrdinaryBrdf(...);
vec3 integrateDiskLight(...);
```

Functions that return a BRDF do not multiply by incident radiance or
$\mathbf n\cdot\boldsymbol{\omega}_i$. `integrateDiskLight()` owns those
factors. Print and GGX values accumulate in linear RGB over the disk samples;
nonzero orders accumulate in XYZ under the continuous disk approximation.
After every order has been summed, `integrateDiskLight()` converts the complete
XYZ result to linear sRGB and adds it to the ordinary result. This prevents
premature gamut clipping and duplicated cosine terms.

Global constants use uppercase names. Multiline function names use camel case
as required by the repository style.

## Numerical safeguards

The shader defines

```text
BRDF_EPSILON = 1e-5
MIN_ROUGHNESS = 0.04
MIN_GROOVE_SPACING_UM = 0.55
MIN_DISORDER_WIDTH = 0.008
```

It applies the following rules:

- reject light samples with nonpositive surface or emitter cosine;
- never normalize a vector whose squared length is below the epsilon;
- clamp GGX roughness before squaring it;
- clamp all BRDF denominators;
- reject non-finite or out-of-range wavelengths before LUT indexing;
- clamp LUT texel indices to 0 through 400;
- clamp coverage to zero through one;
- retain negative linear RGB only during complete XYZ accumulation;
- clamp completed HDR RGB to nonnegative before tone mapping; and
- never call `pow()` with a negative base.

The development shader may optionally replace non-finite output with magenta,
but production behavior must not hide the original calculation in tests.

## Quality levels and performance

After continuous disk convolution, the dominant cost is approximately

$$
N_L+M\times N_\lambda,
$$

where $N_L$ is disk samples, $M$ is active order magnitudes, and
$N_\lambda=9$ is the default spectral convolution tap count.

Initial quality levels are:

| Level | Disk samples | Orders | Spectral taps |
|---|---:|---:|---:|
| low | 2 | 3 | 1 |
| default | 4 | 4 | 9 |
| high | 8 | 8 | 9 |

Default therefore performs 36 spectral texel reconstructions per foiled
fragment, plus four ordinary-light evaluations. Coverage alpha is sampled
before the expensive loops. When coverage is exactly zero, the shader skips
both GGX and diffraction. This branch is coherent over large nonfoil regions
and is expected to help rather than fragment execution.

Quality selection is initially a renderer constant that chooses a shader
variant. Compile-time loop bounds are preferred to dynamic uniform loop bounds
because WebGL shader compilers can reliably unroll the small loops.

Performance acceptance is 60 frames per second at the demo's normal canvas
size on the development machine in the default tier. Visual correctness takes
priority over the high tier reaching 60 frames per second.

## CPU reference module

Create `foil_math.js` as a side-effect-free module containing JavaScript
versions of:

- packed-channel decoding;
- tangent projection;
- wavelength calculation;
- order weighting and normalization;
- cross-groove Gaussian evaluation;
- spectral-table interpolation;
- energy-preserving foil-intensity calibration;
- XYZ-to-linear-sRGB conversion;
- GGX distribution and masking; and
- the sRGB transfer functions.

The shader remains the production implementation. The CPU module is an
executable specification for tests and debugging. Constants shared by both
implementations are duplicated deliberately and checked by a test that parses
or enumerates their expected values. Introducing a shader preprocessor merely
to share constants is outside scope.

## Validation plan

### Unit tests

Add Node-based tests that require no WebGL context.

1. **sRGB round trip:** Decode and encode representative values including
   zero, both piecewise boundaries, 0.5, and one.
2. **XYZ matrix:** Confirm reference D65 white maps to equal linear sRGB
   components within tolerance.
3. **Control endpoints:** Confirm red zero and one decode to 3.20 and 0.55
   micrometers, and green zero and 255 are equivalent axes.
4. **Orientation seam:** Bilinearly reconstruct values near green zero and
   255 and confirm no 90-degree flip.
5. **Grating equation:** For chosen $d$, $m$, and $u$, confirm
   $\lambda_m=du/m$.
6. **Reciprocity geometry:** Swap incident and outgoing directions and confirm
   that $u$, $v$, and every order wavelength are unchanged.
7. **Order signs:** Negate the grating axis and confirm a symmetric material is
   unchanged.
8. **Order budget:** Confirm zero order, both signs of every active nonzero
   order, print transmission, and absorption sum to one.
9. **Quality normalization:** Confirm changing active order count preserves
   total diffraction energy.
10. **LUT boundaries:** Confirm 380 and 780 nm use valid endpoint texels and
    out-of-range wavelengths contribute zero.
11. **No finite failures:** Sweep random valid vectors and controls and assert
    that every CPU result is finite.

### Shader validation

Run:

```sh
glslangValidator -S vert vert-shader.glsl
glslangValidator -S frag frag-shader.glsl
node --check libwebgl.js
node --check webgl-demo.js
git diff --check
```

Runtime shader compilation and link errors must include the shader URL and
compiler log.

### Numerical BRDF tests

A CPU Monte Carlo test samples the outgoing hemisphere for several fixed
incident directions. It numerically integrates each BRDF component. Because
the diffraction BRDF uses an approximate projected-coordinate Jacobian, the
test has two thresholds:

- the ordinary Lambert and GGX layers must not exceed their allocated energy
  by more than 2%; and
- the complete foil approximation must not exceed incident energy by more
  than 10% before calibration.

If diffraction exceeds the second threshold, fix its normalization. Do not
hide the error with an output clamp.

### Visual tests

Use constant control maps before testing artwork-dependent maps:

1. **No foil:** Alpha zero must match the ordinary printed card pixel for
   pixel under identical lighting.
2. **Uniform foil:** Constant spacing, orientation, disorder, and coverage
   must produce straight spectral bands.
3. **Order isolation:** A debug define that enables one order at a time must
   show the expected $1/m$ wavelength relation.
4. **Light radius:** Increasing disk radius must broaden and soften the
   response without changing grating orientation.
5. **Disorder:** Increasing blue must broaden and desaturate the spectrum
   continuously, without suddenly making it white.
6. **Orientation:** Rotating green must rotate the diffraction response with
   the artwork UV frame.
7. **Ordinary reflection:** The neutral highlight must follow the reflection
   direction and broaden with GGX roughness.
8. **Artwork retention:** Printed detail must remain visible under full foil
   coverage according to `TRANSMITTED_PRINT_ENERGY`.
9. **Exposure:** Bright light must roll off smoothly without per-channel hard
   clipping.
10. **Motion:** Slow card rotation must not produce discontinuities, isolated
    RGB bands, cache-dependent assets, or temporal glitter.

### Reference comparison

Photographs must be captured or selected with known approximate light size and
position. Comparing a point-light render with a photograph made under a large
window is not a meaningful validation.

The renderer should first match qualitative invariants:

- band direction;
- band motion under card rotation;
- order overlap;
- highlight location;
- angular persistence; and
- saturation changes with source size.

Absolute brightness and precise color are calibrated only after those
invariants pass.

Measurement-based work demonstrates both the importance and difficulty of
capturing diffraction reflectance under point and environmental illumination;
see Toisoul and Ghosh,
[Practical Acquisition and Rendering of Diffraction Effects in Surface
Reflectance](https://wp.doc.ic.ac.uk/rgi/wp-content/uploads/sites/74/2017/06/acmtog-authorversion-lowres.pdf).

## Implementation sequence

Each stage must compile and keep a usable demo.

1. Add `foil_math.js` with color, GGX, order, and grating-equation tests.
2. Add the offline CIE/D65 table generator and commit `spectral_xyz.bin`.
3. Add `SpectralLut` and validate its exact binary contract.
4. Replace approximate gamma conversion with exact sRGB functions.
5. Add normal and tangent vertex attributes and CPU tangent generation.
6. Add `ShaderProgram`, `DiskLight`, and `Renderer` abstractions.
7. Render the ordinary card with Lambert print and a finite disk light.
8. Add GGX zeroth-order reflection with no diffraction.
9. Convert the packed control map to version 2 physical semantics.
10. Implement one ideal first diffraction order and compare it to CPU math.
11. Add CIE XYZ lookup and remove Zucconi6 from the physical path.
12. Add normalized multi-order efficiencies.
13. Add the cross-groove lobe and spectral period-disorder convolution.
14. Add coverage-layer composition and energy accounting.
15. Add exposure, tone mapping, and exact sRGB output.
16. Add quality variants and measure performance.
17. Run numerical, visual, and cache-reload tests.
18. Make `physical_linear` the demo default.
19. Remove `directional_legacy` only after explicit visual acceptance.

The physical path should not be built by incrementally adding more terms to
`evaluateDirectionalFoil()`. Its BRDF and light integration boundaries are
different enough that a fresh `evaluatePhysicalCardBrdf()` is clearer and
safer.

## Error handling

Initialization errors are fatal and include actionable context:

- WebGL 2 unavailable;
- shader source request failed;
- shader compile or link failed;
- missing required attribute or uniform;
- malformed spectral table;
- control/artwork dimension mismatch;
- unknown foil kind; or
- non-orthogonal disk-light basis.

Asynchronous image failures must include their URL. Texture placeholders keep
the GL state valid but do not convert a failed load into success.

The render loop must stop after a fatal initialization error rather than emit
the same exception every animation frame.

## Risks and mitigations

### A physical equation can still look wrong

The grating equation fixes order locations, not their intensities. Mitigation:
keep efficiency behind one replaceable function, validate energy, and plan an
RCWA or measured LUT.

### Multi-order output may become pale

Several wavelengths can reach the same direction in different orders.
Physical overlap really can desaturate the result, but equal order weights
would exaggerate it. Mitigation: use normalized decaying efficiencies and
order-isolation debug views.

### Area-light sampling may show multiple copies

Too few deterministic disk samples appear as several distinct rainbows;
testing confirmed that increasing four samples to eight merely increases the
number of copies. The implementation therefore applies the continuous disk
convolution described in the disk-light section to diffraction, while keeping
the deterministic points for print and GGX reflection.

### Packed 8-bit fields may band

Logarithmic spacing decoding improves relative precision, but narrow coherent
responses can still reveal 8-bit steps. Mitigation: manual bilinear sampling,
finite disorder, disk integration, and a future 16-bit control format if
needed.

### Spectral colors may leave the sRGB gamut

Monochromatic XYZ values routinely convert to negative or greater-than-one
linear sRGB components. Mitigation: accumulate before gamut clipping, clamp
only the completed HDR result, and document that the display cannot reproduce
all spectral chromaticities.

### Default quality may be too expensive

The default path performs many LUT reads. Mitigation: compile quality variants,
skip zero-coverage regions, test lower spectral tap counts, and preserve order
energy when reducing active orders.

### The fixed efficiency model may not match card foil

No generic order distribution represents every groove profile. Mitigation:
state that the initial table is provisional and provide a clean upgrade path
to offline RCWA or measured spectral BRDF data.

## Future extensions

### RCWA efficiency texture

Offline rigorous coupled-wave analysis can generate

$$
\eta(m,\lambda,\theta_i,\phi_i,mathrm{polarization})
$$

for a chosen groove profile, material, and depth. The runtime shader would
replace `orderEfficiency()` with a texture lookup. Stable RCWA formulations
for general conical diffraction are described by Moharam et al.,
[Formulation for stable and efficient implementation of rigorous
coupled-wave analysis of binary gratings](https://opg.optica.org/josaa/abstract.cfm?uri=josaa-12-5-1068).

### Physical wide-angle foil

A wide-angle material can integrate a distribution of local grating vectors:

$$
f_{\mathrm{wide}}=
\int p(\theta,d)f_{\mathrm{linear}}(\theta,d)\,d\theta\,dd.
$$

Runtime quadrature over several orientations would replace the current
procedural rainbow. This is deferred until the single-orientation reference is
correct, because otherwise distribution width can conceal errors in the base
BRDF.

### Environment lighting

An HDR environment requires integrating spectral diffraction over many
incident directions. Possible approximations include importance-sampled bright
environment regions, prefiltered angular-spectral tables, or measured
diffraction BRDF representations.

### Measured materials

The most reliable realism path is to capture a real foil's angular-spectral
response and fit groove-spacing, disorder, GGX, and efficiency parameters.
The analytic model then remains interpretable while being tied to a physical
sample.

### Multipass HDR

Bloom, multiple cards, or post-processing would move tone mapping into a
fullscreen pass and render the scene into `RGBA16F`. That path must explicitly
request and validate `EXT_color_buffer_float` before framebuffer creation.

## Acceptance criteria

The design is implemented when all of the following are true:

1. The demo uses `physical_linear` by default.
2. Zero foil coverage matches the ordinary PBR card.
3. The neutral highlight is GGX zeroth-order reflection, not Phong.
4. At least four normalized diffraction orders are evaluated by default.
5. Arbitrary groove azimuth uses the vector equation with no effective-spacing
   shortcut.
6. A finite disk light visibly broadens the angular response.
7. Wavelengths are converted through the committed CIE/D65 lookup.
8. Light and material layers accumulate in linear HDR values.
9. Output uses tone mapping and exact sRGB encoding.
10. The packed version-2 texture has documented physical semantics.
11. CPU tests cover equations, energy partitions, color conversion, and edge
    cases.
12. Both shaders compile with `glslangValidator`.
13. No WebGL texture-binding or mipmap warnings occur.
14. The default quality level remains interactive.
15. Legacy directional code is retained or removed according to explicit
    visual acceptance, not silently mixed into the physical path.
