#version 300 es
// -*- mode: c; -*-
in vec4 a_position;
in vec2 a_texcoord;

uniform mat4 u_projection;
uniform mat4 u_view;

// Material inputs used for texture lookup and view-dependent reflections.
out vec2 v_texcoord;
out vec3 v_model_position;
out vec3 v_view_position;

void main()
{
    // Multiply the position by the matrix.
    gl_Position = u_projection * u_view * a_position;

    // Keep both stable card-space coordinates and coordinates relative to the
    // camera. The foil pattern uses the former; its reflection uses the latter.
    v_texcoord = a_texcoord;
    v_model_position = a_position.xyz;
    v_view_position = (u_view * a_position).xyz;
}
