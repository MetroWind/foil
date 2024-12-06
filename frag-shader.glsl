#version 300 es
// -*- mode: c; -*-
precision highp float;

// Passed in from the vertex shader.
in vec2 v_texcoord;

// The texture.
uniform sampler2D u_texture;

out vec4 outColor;

void main()
{
    outColor = texture(u_texture, v_texcoord);
}
