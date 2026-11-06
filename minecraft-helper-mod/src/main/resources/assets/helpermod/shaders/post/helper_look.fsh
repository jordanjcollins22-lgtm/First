#version 330
#extension GL_ARB_separate_shader_objects : require

// Helper Buddies shaders: colour grading, a soft glow around bright things and a vignette.
uniform sampler2D InSampler;

layout(location = 0) in vec2 texCoord;

layout(std140) uniform SamplerInfo {
    vec2 OutSize;
    vec2 InSize;
};

layout(std140) uniform HelperLook {
    vec3 Tint;
    float Saturation;
    float Contrast;
    float Vignette;
    float Glow;
    float Lift;
};

layout(location = 0) out vec4 fragColor;

const vec3 Gray = vec3(0.299, 0.587, 0.114);

void main() {
    vec3 c = texture(InSampler, texCoord).rgb;

    // Glow: brightest bits of the neighbours bleed out a little (sun, torches, lava).
    vec2 px = 2.5 / InSize;
    vec3 bloom = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        vec2 off = vec2(cos(a), sin(a)) * px * (1.0 + float(i % 2));
        vec3 s = texture(InSampler, texCoord + off).rgb;
        bloom += max(s - 0.7, 0.0);
    }
    c += bloom / 8.0 * Glow;

    // Grade: lift the shadows, add contrast, saturation and the look's tint.
    c = c + Lift * (1.0 - c) * 0.15;
    c = (c - 0.5) * Contrast + 0.5;
    float luma = dot(c, Gray);
    c = mix(vec3(luma), c, Saturation);
    c *= Tint;

    // Vignette: corners slightly darker.
    vec2 d = texCoord - 0.5;
    c *= 1.0 - Vignette * dot(d, d) * 1.6;

    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
