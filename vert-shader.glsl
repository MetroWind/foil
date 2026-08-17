#version 300 es
// -*- mode: c; -*-

in vec4 a_position;
in vec3 a_normal;
in vec4 a_tangent;
in vec2 a_texcoord;

uniform mat4 u_projection;
uniform mat4 u_model_view;
uniform mat3 u_normal_matrix;

out vec2 v_texcoord;
out vec3 v_view_position;
out vec3 v_view_normal;
out vec3 v_view_tangent;
out vec3 v_view_bitangent;

// Normalize interpolant inputs without allowing malformed geometry to inject
// NaNs into every fragment covered by a primitive.
vec3 safeNormalize(vec3 value, vec3 fallback)
{
    float length_squared = dot(value, value);
    return length_squared < 0.00001
         ? fallback
         : value * inversesqrt(length_squared);
}

// Construct a fallback tangent perpendicular to the supplied normal.
vec3 orthogonalVector(vec3 normal)
{
    vec3 reference = abs(normal.z) < 0.999
                   ? vec3(0.0, 0.0, 1.0)
                   : vec3(0.0, 1.0, 0.0);
    return safeNormalize(cross(reference, normal), vec3(1.0, 0.0, 0.0));
}

void main()
{
    vec4 view_position = u_model_view * a_position;
    vec3 normal = safeNormalize(
        u_normal_matrix * a_normal, vec3(0.0, 0.0, 1.0));
    vec3 tangent = mat3(u_model_view) * a_tangent.xyz;

    // Re-orthogonalization suppresses interpolation and transform error before
    // constructing the UV-aligned bitangent used by the grating orientation.
    tangent = safeNormalize(
        tangent - normal * dot(normal, tangent), orthogonalVector(normal));

    gl_Position = u_projection * view_position;
    v_texcoord = a_texcoord;
    v_view_position = view_position.xyz;
    v_view_normal = normal;
    v_view_tangent = tangent;
    v_view_bitangent = a_tangent.w * safeNormalize(
        cross(normal, tangent), orthogonalVector(normal));
}
