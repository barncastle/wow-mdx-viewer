import { vec3, quat, mat4 } from 'gl-matrix';

export function mat4fromRotationOrigin(out: mat4, rotation: quat, origin: vec3): mat4 {
    const x = rotation[0], y = rotation[1], z = rotation[2], w = rotation[3],
        x2 = x + x,
        y2 = y + y,
        z2 = z + z,

        xx = x * x2,
        xy = x * y2,
        xz = x * z2,
        yy = y * y2,
        yz = y * z2,
        zz = z * z2,
        wx = w * x2,
        wy = w * y2,
        wz = w * z2,

        ox = origin[0],
        oy = origin[1],
        oz = origin[2];

    out[0] = (1 - (yy + zz));
    out[1] = (xy + wz);
    out[2] = (xz - wy);
    out[3] = 0;
    out[4] = (xy - wz);
    out[5] = (1 - (xx + zz));
    out[6] = (yz + wx);
    out[7] = 0;
    out[8] = (xz + wy);
    out[9] = (yz - wx);
    out[10] = (1 - (xx + yy));
    out[11] = 0;
    out[12] = ox - (out[0] * ox + out[4] * oy + out[8] * oz);
    out[13] = oy - (out[1] * ox + out[5] * oy + out[9] * oz);
    out[14] = oz - (out[2] * ox + out[6] * oy + out[10] * oz);
    out[15] = 1;

    return out;
}

export function vec3RotateZ(out: vec3, a: vec3, c: number): vec3 {
    out[0] = a[0] * Math.cos(c) - a[1] * Math.sin(c);
    out[1] = a[0] * Math.sin(c) + a[1] * Math.cos(c);
    out[2] = a[2];
    return out;
}

export function rand(from: number, to: number): number {
    return from + Math.random() * (to - from);
}

export function uniform(): number {
    return rand(-1, 1);
}

export function chance(): boolean {
    return Math.random() < 0.5;
}

export function getShader(gl: WebGLRenderingContext, source: string, type: number): WebGLShader {
    const shader: WebGLShader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert(gl.getShaderInfoLog(shader));
        return null;
    }

    return shader;
}

export function getColumn(mat: mat4, column: number): vec3 {
    return vec3.fromValues(
        mat[column * 4 + 0],
        mat[column * 4 + 1],
        mat[column * 4 + 2]);
}

// eslint-disable-next-line
export function strFormat(text: string, ...args: any[]): string {
    return text.replace(/{(\d+)}/g, (match, number: number) =>
        args[number] ?? match);
}

export function blitImages(...imgs: ImageData[]): ImageData {
    const src = new ImageData(
        new Uint8ClampedArray(imgs[0].data),
        imgs[0].width,
        imgs[0].height
    );

    for (let i = 0; i < src.data.length; i += 4) {
        for (let p = 1; p < imgs.length; p++) {
            // rgba
            src[i + 0] = ((src[i + 3] * (src[i + 0] - imgs[p][i + 0]) - imgs[p][i + 0] + 255) >> 8) + imgs[p][i + 0];
            src[i + 1] = ((src[i + 3] * (src[i + 1] - imgs[p][i + 1]) - imgs[p][i + 1] + 255) >> 8) + imgs[p][i + 1];
            src[i + 2] = ((src[i + 3] * (src[i + 2] - imgs[p][i + 2]) - imgs[p][i + 2] + 255) >> 8) + imgs[p][i + 2];
            src[i + 3] = (src[i + 3] + imgs[p][i + 3]) & 0xFF;
        }
    }

    return src;
}