#version 300 es
// -*- mode: c; -*-
in vec4 a_position;
in vec2 a_texcoord;

uniform mat4 u_projection;
uniform mat4 u_view;

// a varying to pass the texture coordinates to the fragment shader
out vec2 v_texcoord;

void main()
{
    // Multiply the position by the matrix.
    gl_Position = u_projection * u_view * a_position;

    // Pass the texcoord to the fragment shader.
    v_texcoord = a_texcoord;
}
