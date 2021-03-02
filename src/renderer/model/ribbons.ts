import { getShader } from '../../util';
import { RendererData, RibbonEmitterWrapper } from './rendererData';
import { ModelInterp } from './modelInterp';
import { FilterMode, Layer, LayerShading, Material } from '../../formats/mdx/model';
import { mat4, vec3 } from 'gl-matrix';

const DEFAULT_ALPHA_DISCARD = 1 / 255;

const vertexShader = `
    attribute vec3 aVertexPosition;
    attribute vec2 aTextureCoord;

    uniform mat4 uMVMatrix;
    uniform mat4 uPMatrix;

    varying vec2 vTextureCoord;

    void main(void) {
        vec4 position = vec4(aVertexPosition, 1.0);
        gl_Position = uPMatrix * uMVMatrix * position;
        vTextureCoord = aTextureCoord;
    }
`;

const fragmentShader = `
    precision mediump float;

    varying vec2 vTextureCoord;

    uniform sampler2D uSampler;
    uniform bool uHasTexture;
    uniform float uDiscardAlphaLevel;
    uniform float uLayerAlpha;
    uniform vec4 uColor;

    void main(void) {
        vec2 coords = vec2(vTextureCoord.s, vTextureCoord.t);

        if (uHasTexture) {
            gl_FragColor = texture2D(uSampler, coords) * uColor;
        } else {
            gl_FragColor = uColor;
        }

        gl_FragColor[3] *= uLayerAlpha;
        
        if (gl_FragColor[3] < uDiscardAlphaLevel) {
            discard;
        }
    }
`;

export class RibbonsController {
    private interp: ModelInterp;
    private rendererData: RendererData;
    private emitters: RibbonEmitterWrapper[];
    private gl: WebGLRenderingContext;
    private shaderProgram: WebGLProgram;
    private shaderProgramLocations: any = {}; // eslint-disable-line
    private enabled = true;

    constructor(interp: ModelInterp, rendererData: RendererData, enabled = true) {
        this.interp = interp;
        this.rendererData = rendererData;
        this.enabled = enabled;
        this.emitters = [];

        if (rendererData.model.RibbonEmitters.length) {
            for (const ribbonEmitter of rendererData.model.RibbonEmitters) {
                const emitter: RibbonEmitterWrapper = {
                    timer: 0,
                    edgeCycle: 1000 / Math.max(ribbonEmitter.EdgesPerSec, 1), // in ms, min 1 sec
                    edgeLifeTime: 1000 * Math.max(ribbonEmitter.LifeSpan, 0.25), // in ms, min 0.25 sec
                    props: ribbonEmitter,
                    current: -1,
                    maxCapacity: 0,
                    lifeTimes: [],
                    vertices: null,
                    vertexBuffer: null,
                    texCoords: null,
                    texCoordBuffer: null,
                    indicies: null,
                    indexBuffer: null
                } as RibbonEmitterWrapper;

                emitter.maxCapacity = Math.ceil(
                    Math.ceil(emitter.props.EdgesPerSec) *
                    Math.max(emitter.props.LifeSpan, 0.25))
                    + 2;

                this.emitters.push(emitter);
            }
        }
    }

    public initGL(glContext: WebGLRenderingContext): void {
        this.gl = glContext;
        this.initShaders();

        for (let i = 0; i < this.emitters.length; i++)
            this.createEmitterBuffers(this.emitters[i]);
    }

    public setEnabled(value: boolean): void {
        if (value) {
            this.enabled = true;
        } else {
            this.enabled = false;
            this.reset();
        }
    }

    public reset(): void {
        for (const emitter of this.emitters) {
            emitter.lifeTimes = [];
        }
    }

    public dispose(): void {
        for (let i = 0; i < this.emitters.length; i++) {
            this.gl.deleteBuffer(this.emitters[i].vertexBuffer);
            this.gl.deleteBuffer(this.emitters[i].texCoordBuffer);
            this.gl.deleteBuffer(this.emitters[i].indexBuffer);
        }

        this.gl.deleteProgram(this.shaderProgram);
    }

    public update(delta: number): void {
        for (const emitter of this.emitters) {
            this.updateEmitter(emitter, delta);
        }
    }

    public render(mvMatrix: mat4, pMatrix: mat4): void {
        this.gl.useProgram(this.shaderProgram);

        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);

        this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);

        for (const emitter of this.emitters) {
            if (emitter.lifeTimes.length < 2) {
                continue;
            }

            const color = this.interp.animColorVal(emitter.props.Color);
            const alpha = this.interp.animVectorVal(emitter.props.Alpha);
            this.gl.uniform4f(this.shaderProgramLocations.colorUniform, color[0], color[1], color[2], alpha);

            this.setGeneralBuffers(emitter);
            const materialID: number = emitter.props.MaterialID;
            const material: Material = this.rendererData.model.Materials[materialID];
            for (let j = 0; j < material.Layers.length; j++) {
                this.setLayerProps(material.Layers[j],
                    this.rendererData.materialLayerTextureID[materialID][j],
                    this.rendererData.materialLayerAlpha[materialID][j]);
                this.renderEmitter(emitter);
            }
        }

        this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
    }

    private initShaders(): void {
        const vertex = getShader(this.gl, vertexShader, this.gl.VERTEX_SHADER);
        const fragment = getShader(this.gl, fragmentShader, this.gl.FRAGMENT_SHADER);

        this.shaderProgram = this.gl.createProgram();
        this.gl.attachShader(this.shaderProgram, vertex);
        this.gl.attachShader(this.shaderProgram, fragment);
        this.gl.linkProgram(this.shaderProgram);

        if (!this.gl.getProgramParameter(this.shaderProgram, this.gl.LINK_STATUS)) {
            alert('Could not initialise shaders');
        }

        this.gl.useProgram(this.shaderProgram);

        this.shaderProgramLocations.vertexPositionAttribute = this.gl.getAttribLocation(this.shaderProgram, 'aVertexPosition');
        this.shaderProgramLocations.textureCoordAttribute = this.gl.getAttribLocation(this.shaderProgram, 'aTextureCoord');

        this.shaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(this.shaderProgram, 'uPMatrix');
        this.shaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(this.shaderProgram, 'uMVMatrix');
        this.shaderProgramLocations.samplerUniform = this.gl.getUniformLocation(this.shaderProgram, 'uSampler');
        this.shaderProgramLocations.replaceableColorUniform = this.gl.getUniformLocation(this.shaderProgram, 'uReplaceableColor');
        this.shaderProgramLocations.hasTextureUniform = this.gl.getUniformLocation(this.shaderProgram, 'uHasTexture');
        this.shaderProgramLocations.discardAlphaLevelUniform = this.gl.getUniformLocation(this.shaderProgram, 'uDiscardAlphaLevel');
        this.shaderProgramLocations.layerAlphaUniform = this.gl.getUniformLocation(this.shaderProgram, 'uLayerAlpha');
        this.shaderProgramLocations.colorUniform = this.gl.getUniformLocation(this.shaderProgram, 'uColor');
    }

    private createEmitterBuffers(emitter: RibbonEmitterWrapper): void {
        const size = emitter.maxCapacity;
        const vertices = new Float32Array(size * 2 * 3);  // 2 vertices * xyz
        const texCoords = new Float32Array(size * 2 * 2); // 2 vertices * xy
        const indicies = new Uint16Array(size * 4);

        for (let i = 0; i < indicies.length; i++)
            indicies[i] = (i % (2 * size)) & 0xFFFF;

        if (emitter.vertices)
            vertices.set(emitter.vertices);

        emitter.vertices = vertices;
        emitter.texCoords = texCoords;
        emitter.indicies = indicies;
        emitter.vertexBuffer = this.gl.createBuffer();
        emitter.texCoordBuffer = this.gl.createBuffer();
        emitter.indexBuffer = this.gl.createBuffer();
    }

    private updateEmitter(emitter: RibbonEmitterWrapper, delta: number): void {
        const visibility = this.interp.animVectorVal(emitter.props.Visibility);
        const now = Date.now();

        if (visibility > 0 && this.enabled) {
            if ((emitter.timer -= delta) <= 0) {
                emitter.timer += emitter.edgeCycle;
                emitter.current = (emitter.current + 1) % emitter.maxCapacity;
                emitter.lifeTimes[emitter.current] = now;
                this.createVertices(emitter);
            }
        }

        if (emitter.lifeTimes.length) {
            while (emitter.lifeTimes[0] + emitter.edgeLifeTime <= now) {
                emitter.lifeTimes.shift();

                for (let i = 0; i + 6 + 5 < emitter.vertices.length; i += 6) {
                    emitter.vertices[i] = emitter.vertices[i + 6];
                    emitter.vertices[i + 1] = emitter.vertices[i + 7];
                    emitter.vertices[i + 2] = emitter.vertices[i + 8];
                    emitter.vertices[i + 3] = emitter.vertices[i + 9];
                    emitter.vertices[i + 4] = emitter.vertices[i + 10];
                    emitter.vertices[i + 5] = emitter.vertices[i + 11];
                }

                if (--emitter.current < 0)
                    break;
            }
        }

        if (emitter.lifeTimes.length) {
            this.updateEmitterBuffers(emitter, now, delta);
        }
    }

    private createVertices(emitter: RibbonEmitterWrapper): void {
        const first: vec3 = vec3.clone(<vec3>emitter.props.PivotPoint);
        const second: vec3 = vec3.clone(<vec3>emitter.props.PivotPoint);

        first[2] += this.interp.animVectorVal(emitter.props.HeightAbove);
        second[2] -= this.interp.animVectorVal(emitter.props.HeightBelow);

        const emitterMatrix: mat4 = this.rendererData.nodes[emitter.props.ObjectId].matrix;
        vec3.transformMat4(first, first, emitterMatrix);
        vec3.transformMat4(second, second, emitterMatrix);

        emitter.vertices[emitter.current * 6] = first[0];
        emitter.vertices[emitter.current * 6 + 1] = first[1];
        emitter.vertices[emitter.current * 6 + 2] = first[2];
        emitter.vertices[emitter.current * 6 + 3] = second[0];
        emitter.vertices[emitter.current * 6 + 4] = second[1];
        emitter.vertices[emitter.current * 6 + 5] = second[2];
    }

    private updateEmitterBuffers(emitter: RibbonEmitterWrapper, now: number, delta: number): void {
        for (let i = 0; i < emitter.lifeTimes.length; i++) {
            const textureSlot = this.interp.animVectorVal(emitter.props.TextureSlot);
            const gravity = (emitter.props.Gravity / 1000) * delta;

            const texCoordX = textureSlot % emitter.props.Columns;
            const texCoordY = Math.floor(textureSlot / emitter.props.Rows);
            const cellWidth = 1 / emitter.props.Columns;
            const cellHeight = 1 / emitter.props.Rows;

            let relativePos = (now - emitter.lifeTimes[i]) / emitter.edgeLifeTime;
            relativePos = texCoordX * cellWidth + relativePos * cellWidth;

            // apply tex movement
            emitter.texCoords[i * 4] = relativePos;
            emitter.texCoords[i * 4 + 1] = texCoordY * cellHeight;
            emitter.texCoords[i * 4 + 2] = relativePos;
            emitter.texCoords[i * 4 + 3] = (1 + texCoordY) * cellHeight;

            // apply gravity to z pos
            emitter.vertices[i * 6 + 2] += gravity;
            emitter.vertices[i * 6 + 5] += gravity;
        }
    }

    private setLayerProps(layer: Layer, textureID: number, alpha: number): void {
        const texture = this.rendererData.model.Textures[textureID];

        if (layer.Shading & LayerShading.TwoSided) {
            this.gl.disable(this.gl.CULL_FACE);
        } else {
            this.gl.enable(this.gl.CULL_FACE);
        }

        this.gl.uniform1f(this.shaderProgramLocations.layerAlphaUniform, alpha);

        if (layer.FilterMode === FilterMode.None) {
            const discard = alpha < 1e-6 ? 1. : 0.;
            this.gl.disable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, discard);
            this.gl.blendFunc(this.gl.ONE, this.gl.ZERO);
            this.gl.depthMask(true);
        } else if (layer.FilterMode === FilterMode.Transparent) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0.75);
            this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.depthMask(true);
        } else if (layer.FilterMode === FilterMode.Blend) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DEFAULT_ALPHA_DISCARD);
            this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.depthMask(false);
        } else if (layer.FilterMode === FilterMode.Additive) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DEFAULT_ALPHA_DISCARD);
            this.gl.blendFuncSeparate(this.gl.ONE, this.gl.ONE, this.gl.ZERO, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (layer.FilterMode === FilterMode.AddAlpha) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DEFAULT_ALPHA_DISCARD);
            this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE, this.gl.ZERO, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (layer.FilterMode === FilterMode.Modulate) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DEFAULT_ALPHA_DISCARD);
            this.gl.blendFuncSeparate(this.gl.DST_COLOR, this.gl.ZERO, this.gl.DST_ALPHA, this.gl.ZERO);
            this.gl.depthMask(false);
        } else if (layer.FilterMode === FilterMode.Modulate2x) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DEFAULT_ALPHA_DISCARD);
            this.gl.blendFuncSeparate(this.gl.DST_COLOR, this.gl.SRC_COLOR, this.gl.DST_ALPHA, this.gl.SRC_ALPHA);
            this.gl.depthMask(false);
        }

        if (texture.Image) {
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[texture.Image]);
            this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
            this.gl.uniform1i(this.shaderProgramLocations.hasTextureUniform, 1);
        }

        if (layer.Shading & LayerShading.NoDepthTest) {
            this.gl.disable(this.gl.DEPTH_TEST);
        }
        if (layer.Shading & LayerShading.NoDepthSet) {
            this.gl.depthMask(false);
        }
    }

    private setGeneralBuffers(emitter: RibbonEmitterWrapper): void {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.texCoordBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.texCoords, this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.vertices, this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.indexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.indicies, this.gl.STATIC_DRAW);
    }

    private renderEmitter(emitter: RibbonEmitterWrapper): void {
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, emitter.lifeTimes.length * 2);
    }
}