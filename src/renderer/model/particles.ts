import {
    ParticleEmitter2BlendMode, ParticleEmitter2Flags,
    ParticleEmitter2EmitterType, ParticleEmitter2Type,
    ParticleEmitter2
} from '../../formats/mdx/model';
import { vec3, vec4 } from 'gl-matrix';
import { ModelInterp } from './modelInterp';
import { mat4 } from 'gl-matrix';
import { getShader, chance, uniform, getColumn, rand } from '../../util';
import { RendererData, Particle, ParticleEmitterWrapper } from './rendererData';
import { lerp } from './interp';

const firstColor = vec4.create();
const secondColor = vec4.create();
const color = vec4.create();
const tailPos = vec3.create();
const tailCross = vec3.create();
const deltaPos = vec3.create();
const startVelocity = vec3.create();

const vertexShader = `
    attribute vec3 aVertexPosition;
    attribute vec2 aTextureCoord;
    attribute vec4 aColor;

    uniform mat4 uMVMatrix;
    uniform mat4 uPMatrix;

    varying vec2 vTextureCoord;
    varying vec4 vColor;

    void main(void) {
        vec4 position = vec4(aVertexPosition, 1.0);
        gl_Position = uPMatrix * uMVMatrix * position;
        vTextureCoord = aTextureCoord;
        vColor = aColor;
    }
`;

const fragmentShader = `
    precision mediump float;

    varying vec2 vTextureCoord;
    varying vec4 vColor;

    uniform sampler2D uSampler;
    uniform bool uHasTexture;
    uniform float uDiscardAlphaLevel;

    void main(void) {
        vec2 coords = vec2(vTextureCoord.s, vTextureCoord.t);

        if (uHasTexture) {
            gl_FragColor = texture2D(uSampler, coords) * vColor;
        } else {
            gl_FragColor = vColor;
        }

        if (gl_FragColor[3] < uDiscardAlphaLevel) {
            discard;
        }
    }
`;

const DISCARD_ALPHA_KEY_LEVEL = 0.83;
const DEFAULT_ALPHA_DISCARD = 1 / 255;

export class ParticlesController {
    private gl: WebGLRenderingContext;
    private shaderProgram: WebGLProgram;
    private shaderProgramLocations: any = {}; // eslint-disable-line
    private particleStorage: Particle[] = [];
    private interp: ModelInterp;
    private rendererData: RendererData;
    private emitters: ParticleEmitterWrapper[];
    private particleBaseVectors: vec3[];
    private enabled = true;

    constructor(interp: ModelInterp, rendererData: RendererData, enabled = true) {
        this.interp = interp;
        this.rendererData = rendererData;
        this.enabled = enabled;
        this.emitters = [];

        if (rendererData.model.ParticleEmitters2.length) {
            this.particleBaseVectors = [
                vec3.create(),
                vec3.create(),
                vec3.create(),
                vec3.create()
            ];

            for (const particleEmitter of rendererData.model.ParticleEmitters2) {
                const emitter = this.initEmitter(particleEmitter);

                if (emitter.props.EmitterType !== ParticleEmitter2EmitterType.Spline)
                    this.emitters.push(emitter);
                else
                    console.error("Spline emitters are not implemented");
            }
        }
    }

    public initGL(glContext: WebGLRenderingContext): void {
        this.gl = glContext;
        this.initShaders();
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
            emitter.particles.forEach(p => p.lifeSpan = 0);
        }
    }

    public dispose(): void {
        for (const emitter of this.emitters) {
            if (emitter.indexBuffer) {
                if (emitter.type & ParticleEmitter2Type.Tail) {
                    this.gl.deleteBuffer(emitter.tailVertexBuffer);
                    this.gl.deleteBuffer(emitter.tailTexCoordBuffer);
                }
                if (emitter.type & ParticleEmitter2Type.Head) {
                    this.gl.deleteBuffer(emitter.headVertexBuffer);
                    this.gl.deleteBuffer(emitter.headTexCoordBuffer);
                }
                this.gl.deleteBuffer(emitter.colorBuffer);
                this.gl.deleteBuffer(emitter.indexBuffer);
            }
        }

        this.gl.deleteProgram(this.shaderProgram);
    }

    public update(delta: number): void {
        for (const emitter of this.emitters) {
            this.updateEmitter(emitter, delta);
        }
    }

    public render(mvMatrix: mat4, pMatrix: mat4): void {
        this.gl.enable(this.gl.CULL_FACE);
        this.gl.useProgram(this.shaderProgram);

        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);

        this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.colorAttribute);

        for (const emitter of this.emitters) {
            if (!emitter.particles.length) {
                continue;
            }

            this.setLayerProps(emitter);
            this.setGeneralBuffers(emitter);

            if (emitter.type & ParticleEmitter2Type.Tail) {
                this.renderEmitterType(emitter, ParticleEmitter2Type.Tail);
            }
            if (emitter.type & ParticleEmitter2Type.Head) {
                this.renderEmitterType(emitter, ParticleEmitter2Type.Head);
            }
        }

        this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.colorAttribute);
    }

    private initEmitter(particleEmitter: ParticleEmitter2): ParticleEmitterWrapper {

        const emitter: ParticleEmitterWrapper = {
            emission: 0,
            velUpdate: 0,
            squirtFrame: 0,
            particles: [],
            props: particleEmitter,
            capacity: 0,
            baseCapacity: 0,
            type: particleEmitter.ParticleType,
            tailVertices: null,
            tailVertexBuffer: null,
            headVertices: null,
            headVertexBuffer: null,
            tailTexCoords: null,
            tailTexCoordBuffer: null,
            headTexCoords: null,
            headTexCoordBuffer: null,
            colors: null,
            colorBuffer: null,
            indices: null,
            indexBuffer: null,
            inheritVelocity: vec3.create(),
            prevPosition: null,
            followProps: [0, 0],
            followVector: vec3.create(),
        };

        emitter.baseCapacity = Math.ceil(
            ModelInterp.maxAnimVectorVal(emitter.props.EmissionRate) *
            this.interp.animVectorVal(emitter.props.LifeSpan)
        );

        if (emitter.props.Flags & ParticleEmitter2Flags.Follow) {
            const followDiff = emitter.props.FollowSpeed[1] - emitter.props.FollowSpeed[0];
            if (followDiff > 1e-6) {
                // multiplier
                emitter.followProps[0] = emitter.props.FollowScale[1] - emitter.props.FollowScale[0];
                emitter.followProps[0] /= followDiff;
                // base
                emitter.followProps[1] = emitter.props.FollowScale[0];
                emitter.followProps[1] -= emitter.followProps[0] * emitter.props.FollowSpeed[0];
            }
        }

        return emitter;
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
        this.shaderProgramLocations.colorAttribute = this.gl.getAttribLocation(this.shaderProgram, 'aColor');

        this.shaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(this.shaderProgram, 'uPMatrix');
        this.shaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(this.shaderProgram, 'uMVMatrix');
        this.shaderProgramLocations.samplerUniform = this.gl.getUniformLocation(this.shaderProgram, 'uSampler');
        this.shaderProgramLocations.hasTextureUniform = this.gl.getUniformLocation(this.shaderProgram, 'uHasTexture');
        this.shaderProgramLocations.discardAlphaLevelUniform = this.gl.getUniformLocation(this.shaderProgram, 'uDiscardAlphaLevel');
    }

    private updateParticle(particle: Particle, delta: number): void {
        delta /= 1000;

        if ((particle.lifeSpan -= delta) <= 0) {
            return;
        }

        if (particle.lifeSpan < particle.emitter.props.WindTime) {
            vec3.scaleAndAdd(particle.speed,
                particle.speed,
                particle.emitter.props.WindVector,
                delta);
        }

        if (particle.emitter.props.Flags & ParticleEmitter2Flags.Follow) {
            vec3.add(particle.pos, particle.pos, particle.emitter.followVector);
        }

        if (particle.emitter.props.Drag) {
            vec3.scale(particle.speed, particle.speed, 1 - particle.emitter.props.Drag * delta);
        }

        particle.speed[2] -= particle.gravity * delta;

        particle.pos[0] += particle.speed[0] * delta;
        particle.pos[1] += particle.speed[1] * delta;
        particle.pos[2] += particle.speed[2] * delta;
    }

    private resizeEmitterBuffers(emitter: ParticleEmitterWrapper, size: number): void {
        if (size <= emitter.capacity) {
            return;
        }

        size = Math.max(size, emitter.baseCapacity);

        const indices = new Uint16Array(size * 6);        // 4 vertices * 2 triangles

        if (emitter.capacity) {
            indices.set(emitter.indices);
        }

        for (let i = emitter.capacity; i < size; i++) {
            indices[i * 6] = i * 4;
            indices[i * 6 + 1] = i * 4 + 1;
            indices[i * 6 + 2] = i * 4 + 2;
            indices[i * 6 + 3] = i * 4 + 2;
            indices[i * 6 + 4] = i * 4 + 1;
            indices[i * 6 + 5] = i * 4 + 3;
        }

        if (emitter.type & ParticleEmitter2Type.Tail) {
            emitter.tailVertices = new Float32Array(size * 4 * 3);  // 4 vertices * xyz
            emitter.tailTexCoords = new Float32Array(size * 4 * 2); // 4 vertices * xy
        }
        if (emitter.type & ParticleEmitter2Type.Head) {
            emitter.headVertices = new Float32Array(size * 4 * 3);  // 4 vertices * xyz
            emitter.headTexCoords = new Float32Array(size * 4 * 2); // 4 vertices * xy
        }

        emitter.indices = indices;
        emitter.colors = new Float32Array(size * 4 * 4);    // 4 vertices * rgba
        emitter.capacity = size;

        if (!emitter.indexBuffer) {
            if (emitter.type & ParticleEmitter2Type.Tail) {
                emitter.tailVertexBuffer = this.gl.createBuffer();
                emitter.tailTexCoordBuffer = this.gl.createBuffer();
            }
            if (emitter.type & ParticleEmitter2Type.Head) {
                emitter.headVertexBuffer = this.gl.createBuffer();
                emitter.headTexCoordBuffer = this.gl.createBuffer();
            }
            emitter.colorBuffer = this.gl.createBuffer();
            emitter.indexBuffer = this.gl.createBuffer();
        }
    }

    private updateEmitter(emitter: ParticleEmitterWrapper, delta: number): void {
        const mat = this.rendererData.nodes[emitter.props.ObjectId].matrix;
        const visibility = this.interp.animVectorVal(emitter.props.Visibility);
        const currPos = getColumn(mat, 3);

        if (emitter.prevPosition) {
            vec3.subtract(deltaPos, emitter.prevPosition, currPos);
            emitter.prevPosition = currPos;

            // update follow vector
            if (emitter.props.Flags & ParticleEmitter2Flags.Follow) {
                const offset = (emitter.followProps[0] * (vec3.len(currPos) / delta)) + emitter.followProps[1];
                vec3.scale(emitter.followVector, deltaPos, Math.min(offset, 1));
            }

            // update/reset instant velocity vector
            if (emitter.props.Flags & ParticleEmitter2Flags.InstantVelocity) {
                emitter.velUpdate += delta;

                if (emitter.velUpdate > 30) {
                    const scale = 1 / (30 / emitter.velUpdate) *
                        emitter.props.IvelScale *
                        (emitter.particles.length ? 1 : 0);

                    vec3.scale(emitter.inheritVelocity, deltaPos, scale);
                    emitter.velUpdate = 0;
                }
            }
        } else {
            emitter.prevPosition = currPos;
        }

        if (visibility > 0 && this.enabled) {
            if (emitter.props.Squirt && typeof emitter.props.EmissionRate !== 'number') {
                const interp = this.interp.findKeyframes(emitter.props.EmissionRate);

                if (interp && interp.left && interp.left.Frame !== emitter.squirtFrame) {
                    emitter.squirtFrame = interp.left.Frame;
                    if (interp.left.Vector[0] > 0)
                        emitter.emission += interp.left.Vector[0] * 1000;
                }
            } else {
                emitter.emission += this.interp.animVectorVal(emitter.props.EmissionRate) * delta;
            }

            while (emitter.emission >= 1000) {
                emitter.emission -= 1000;
                emitter.particles.push(
                    this.createParticle(emitter, mat)
                );
            }
        }

        this.updateParticles(emitter, delta);
    }

    private updateParticles(emitter: ParticleEmitterWrapper, delta: number): void {
        if (emitter.particles.length) {
            const updatedParticles = [];

            for (const particle of emitter.particles) {
                this.updateParticle(particle, delta);
                if (particle.lifeSpan > 0) {
                    updatedParticles.push(particle);
                } else {
                    this.particleStorage.push(particle);
                }
            }

            emitter.particles = updatedParticles;

            if (emitter.type & ParticleEmitter2Type.Head) {
                if (emitter.props.Flags & ParticleEmitter2Flags.XYQuad) {
                    vec3.set(this.particleBaseVectors[0], -1, 1, 0);
                    vec3.set(this.particleBaseVectors[1], -1, -1, 0);
                    vec3.set(this.particleBaseVectors[2], 1, 1, 0);
                    vec3.set(this.particleBaseVectors[3], 1, -1, 0);
                } else {
                    vec3.set(this.particleBaseVectors[0], 0, -1, 1);
                    vec3.set(this.particleBaseVectors[1], 0, -1, -1);
                    vec3.set(this.particleBaseVectors[2], 0, 1, 1);
                    vec3.set(this.particleBaseVectors[3], 0, 1, -1);

                    for (let i = 0; i < 4; i++) {
                        vec3.transformQuat(this.particleBaseVectors[i],
                            this.particleBaseVectors[i],
                            this.rendererData.cameraQuat);
                    }
                }
            }

            this.resizeEmitterBuffers(emitter, emitter.particles.length);

            for (let i = 0; i < emitter.particles.length; i++)
                this.updateParticleBuffers(emitter.particles[i], i);
        }
    }

    private createParticle(emitter: ParticleEmitterWrapper, emitterMatrix: mat4) {

        let particle: Particle;

        if (this.particleStorage.length) {
            particle = this.particleStorage.pop();
        } else {
            particle = {
                emitter: null,
                pos: vec3.create(),
                angle: 0,
                speed: vec3.create(),
                gravity: 0,
                lifeSpan: 0,
                maxAge: 0
            };
        }

        particle.emitter = emitter;
        particle.pos = vec3.clone(emitter.props.PivotPoint);
        particle.gravity = this.interp.animVectorVal(emitter.props.Gravity);
        particle.lifeSpan = this.interp.animVectorVal(emitter.props.LifeSpan);
        particle.maxAge = particle.lifeSpan;

        if (emitter.props.EmitterType === ParticleEmitter2EmitterType.Sphere)
            this.createSphereParticle(particle);
        else
            this.createPlaneParticle(particle);

        // apply tumble
        particle.pos[0] += uniform() * emitter.props.Tumble[1] + emitter.props.Tumble[0];
        particle.pos[1] += uniform() * emitter.props.Tumble[3] + emitter.props.Tumble[2];
        particle.pos[2] += uniform() * emitter.props.Tumble[5] + emitter.props.Tumble[4];

        // tumbler flag
        if (emitter.props.EmitterType === ParticleEmitter2EmitterType.Base) {
            if (particle.emitter.props.Flags & ParticleEmitter2Flags.Tumbler) {
                particle.pos[0] *= chance() ? 1 : -1;
                particle.pos[1] *= chance() ? 1 : -1;
                particle.pos[2] *= chance() ? 1 : -1;
            }
        }

        // apply matrix
        vec3.transformMat4(particle.pos, particle.pos, emitterMatrix);

        particle.angle = particle.speed[2];

        if (emitter.props.Flags & ParticleEmitter2Flags.LineEmitter) {
            particle.speed[0] = 0;
        }
        if (emitter.props.Flags & ParticleEmitter2Flags.ZVelocityOnly) {
            particle.speed[0] = particle.speed[1] = 0;
        }

        vec3.transformMat4(particle.speed, particle.speed, emitterMatrix);

        // minus translation of emitterMatrix
        if ((emitter.props.Flags & ParticleEmitter2Flags.ModelSpace) === 0) {
            particle.speed[0] -= emitterMatrix[12];
            particle.speed[1] -= emitterMatrix[13];
            particle.speed[2] -= emitterMatrix[14];
        }

        return particle;
    }

    private createPlaneParticle(particle: Particle): void {
        const width: number = this.interp.animVectorVal(particle.emitter.props.Width) * 0.5;
        const length: number = this.interp.animVectorVal(particle.emitter.props.Length) * 0.5;
        const zsource: number = this.interp.animVectorVal(particle.emitter.props.ZSource);
        const speedScale: number = this.interp.animVectorVal(particle.emitter.props.Speed);
        const variation: number = this.interp.animVectorVal(particle.emitter.props.Variation);
        const latitude: number = this.interp.animVectorVal(particle.emitter.props.Latitude);
        const longitude: number = this.interp.animVectorVal(particle.emitter.props.Longitude);

        // CPlaneParticleEmitter::CreateParticle
        const vary = uniform() * variation + 1;
        const velocity = speedScale * vary;
        vec3.set(particle.speed, 0, 0, velocity);

        particle.pos[0] += rand(-length, length);
        particle.pos[1] += rand(-width, width);

        if (zsource < 1e-6) {
            const polar = latitude * uniform();
            const azimuth = longitude * uniform();
            const sinPolar = Math.sin(polar);

            vec3.set(particle.speed,
                Math.cos(azimuth) * sinPolar * velocity, // x
                Math.sin(azimuth) * sinPolar * velocity, // y
                Math.cos(polar) * velocity); // z
        } else {
            vec3.subtract(startVelocity, particle.pos, vec3.fromValues(0, 0, zsource));
            vec3.normalize(startVelocity, startVelocity);
            vec3.multiply(particle.speed, particle.speed, startVelocity);
        }

        if (particle.emitter.props.Flags & ParticleEmitter2Flags.InstantVelocity) {
            vec3.scaleAndAdd(particle.speed, particle.speed, particle.emitter.inheritVelocity, vary);
        }
    }

    private createSphereParticle(particle: Particle): void {
        const width: number = this.interp.animVectorVal(particle.emitter.props.Width);
        const length: number = this.interp.animVectorVal(particle.emitter.props.Length);
        const zsource: number = this.interp.animVectorVal(particle.emitter.props.ZSource);
        const speedScale: number = this.interp.animVectorVal(particle.emitter.props.Speed);
        const variation: number = this.interp.animVectorVal(particle.emitter.props.Variation);
        const latitude: number = this.interp.animVectorVal(particle.emitter.props.Latitude);
        const longitude: number = this.interp.animVectorVal(particle.emitter.props.Longitude);

        // CSphereParticleEmitter::CreateParticle
        const radius = Math.random() * (length - width) + width;
        const polar = latitude * uniform();
        const azimuth = longitude * uniform();
        const cosPolar = Math.cos(polar);
        const emissionDir = vec3.fromValues(
            cosPolar * Math.cos(azimuth), // x
            cosPolar * Math.sin(azimuth), // y
            Math.sin(polar) // z
        );

        // not 100% sure on this but appears correct
        // - maybe the flag has a different meaning for spheres?
        if (particle.emitter.props.Flags & ParticleEmitter2Flags.InheritScale)
            vec3.set(emissionDir, emissionDir[1], emissionDir[2], emissionDir[0]);

        vec3.scaleAndAdd(particle.pos, particle.pos, emissionDir, radius);

        // prioritise zsource otherwise check for zvelonly flag
        if (zsource > 1e-6) {
            vec3.subtract(emissionDir, particle.pos, vec3.fromValues(0, 0, zsource));
            vec3.normalize(emissionDir, emissionDir);
        } else if (particle.emitter.props.Flags & ParticleEmitter2Flags.ZVelocityOnly) {
            vec3.set(emissionDir, 0, 0, 1);
        }

        // set direction
        const vary = uniform() * variation + 1;
        const velocity = speedScale * vary;
        vec3.scale(particle.speed, emissionDir, velocity);

        if (particle.emitter.props.Flags & ParticleEmitter2Flags.InstantVelocity) {
            vec3.scaleAndAdd(particle.speed, particle.speed, particle.emitter.inheritVelocity, vary);
        }
    }

    private updateParticleBuffers(particle: Particle, index: number): void {
        const emitter: ParticleEmitterWrapper = particle.emitter;
        const globalT: number = 1 - particle.lifeSpan / particle.maxAge;
        const firstHalf: boolean = globalT < emitter.props.MiddleTime;
        let t: number;

        if (firstHalf) {
            t = globalT / emitter.props.MiddleTime;
        } else {
            t = (globalT - emitter.props.MiddleTime) / (1 - emitter.props.MiddleTime);
        }

        this.updateParticleVertices(particle, index, firstHalf, t);
        this.updateParticleTexCoords(index, emitter, firstHalf, t);
        this.updateParticleColor(index, emitter, firstHalf, t);
    }

    private updateParticleVertices(particle: Particle, index: number, firstHalf: boolean, t: number) {
        const emitter: ParticleEmitterWrapper = particle.emitter;
        let firstScale: number;
        let secondScale: number;

        if (firstHalf) {
            firstScale = emitter.props.ParticleScaling[0];
            secondScale = emitter.props.ParticleScaling[1];
        } else {
            firstScale = emitter.props.ParticleScaling[1];
            secondScale = emitter.props.ParticleScaling[2];
        }

        const scale = lerp(firstScale, secondScale, t);

        if (emitter.type & ParticleEmitter2Type.Head) {
            for (let i = 0; i < 4; i++) {
                emitter.headVertices[index * 12 + i * 3] = this.particleBaseVectors[i][0] * scale;
                emitter.headVertices[index * 12 + i * 3 + 1] = this.particleBaseVectors[i][1] * scale;
                emitter.headVertices[index * 12 + i * 3 + 2] = this.particleBaseVectors[i][2] * scale;

                if (emitter.props.Flags & ParticleEmitter2Flags.XYQuad) {
                    const spin = particle.angle + (emitter.props.Spin * t);
                    const x = emitter.headVertices[index * 12 + i * 3];
                    const y = emitter.headVertices[index * 12 + i * 3 + 1];
                    emitter.headVertices[index * 12 + i * 3] = x * Math.cos(spin) - y * Math.sin(spin);
                    emitter.headVertices[index * 12 + i * 3 + 1] = x * Math.sin(spin) + y * Math.cos(spin);
                }
            }
        }

        if (emitter.type & ParticleEmitter2Type.Tail) {
            tailPos[0] = -particle.speed[0] * emitter.props.TailLength;
            tailPos[1] = -particle.speed[1] * emitter.props.TailLength;
            tailPos[2] = -particle.speed[2] * emitter.props.TailLength;

            vec3.scale(tailPos, particle.speed, -emitter.props.TailLength);

            vec3.cross(tailCross, particle.speed, this.rendererData.cameraPos);
            vec3.normalize(tailCross, tailCross);
            vec3.scale(tailCross, tailCross, scale);

            emitter.tailVertices[index * 12 + 0] = tailCross[0];
            emitter.tailVertices[index * 12 + 1] = tailCross[1];
            emitter.tailVertices[index * 12 + 2] = tailCross[2];

            emitter.tailVertices[index * 12 + 3 + 0] = -tailCross[0];
            emitter.tailVertices[index * 12 + 3 + 1] = -tailCross[1];
            emitter.tailVertices[index * 12 + 3 + 2] = -tailCross[2];

            emitter.tailVertices[index * 12 + 2 * 3 + 0] = tailCross[0] + tailPos[0];
            emitter.tailVertices[index * 12 + 2 * 3 + 1] = tailCross[1] + tailPos[1];
            emitter.tailVertices[index * 12 + 2 * 3 + 2] = tailCross[2] + tailPos[2];

            emitter.tailVertices[index * 12 + 3 * 3 + 0] = -tailCross[0] + tailPos[0];
            emitter.tailVertices[index * 12 + 3 * 3 + 1] = -tailCross[1] + tailPos[1];
            emitter.tailVertices[index * 12 + 3 * 3 + 2] = -tailCross[2] + tailPos[2];
        }

        for (let i = 0; i < 4; i++) {
            if (emitter.headVertices) {
                emitter.headVertices[index * 12 + i * 3] += particle.pos[0];
                emitter.headVertices[index * 12 + i * 3 + 1] += particle.pos[1];
                emitter.headVertices[index * 12 + i * 3 + 2] += particle.pos[2];
            }
            if (emitter.tailVertices) {
                emitter.tailVertices[index * 12 + i * 3] += particle.pos[0];
                emitter.tailVertices[index * 12 + i * 3 + 1] += particle.pos[1];
                emitter.tailVertices[index * 12 + i * 3 + 2] += particle.pos[2];
            }
        }

        if (emitter.props.Flags & ParticleEmitter2Flags.ZeroXKill)
            particle.lifeSpan = 0;
    }

    private updateParticleTexCoords(index: number, emitter: ParticleEmitterWrapper, firstHalf: boolean, t: number) {
        if (emitter.type & ParticleEmitter2Type.Head) {
            this.updateParticleTexCoordsByType(index, emitter, firstHalf, t, ParticleEmitter2Type.Head);
        }
        if (emitter.type & ParticleEmitter2Type.Tail) {
            this.updateParticleTexCoordsByType(index, emitter, firstHalf, t, ParticleEmitter2Type.Tail);
        }
    }

    private updateParticleTexCoordsByType(index: number, emitter: ParticleEmitterWrapper, firstHalf: boolean, t: number, type: ParticleEmitter2Type) {
        let uvAnim: Uint32Array;
        let texCoords: Float32Array;

        if (type === ParticleEmitter2Type.Tail) {
            uvAnim = firstHalf ? emitter.props.TailUVAnim : emitter.props.TailDecayUVAnim;
            texCoords = emitter.tailTexCoords;
        } else {
            uvAnim = firstHalf ? emitter.props.LifeSpanUVAnim : emitter.props.DecayUVAnim;
            texCoords = emitter.headTexCoords;
        }

        const frame = Math.round(lerp(uvAnim[0], uvAnim[1], t));
        const texCoordX = frame % emitter.props.Columns;
        const texCoordY = Math.floor(frame / emitter.props.Rows);
        const cellWidth = 1 / emitter.props.Columns;
        const cellHeight = 1 / emitter.props.Rows;

        texCoords[index * 8] = texCoordX * cellWidth;
        texCoords[index * 8 + 1] = texCoordY * cellHeight;

        texCoords[index * 8 + 2] = texCoordX * cellWidth;
        texCoords[index * 8 + 3] = (1 + texCoordY) * cellHeight;

        texCoords[index * 8 + 4] = (1 + texCoordX) * cellWidth;
        texCoords[index * 8 + 5] = texCoordY * cellHeight;

        texCoords[index * 8 + 6] = (1 + texCoordX) * cellWidth;
        texCoords[index * 8 + 7] = (1 + texCoordY) * cellHeight;
    }

    private updateParticleColor(index: number, emitter: ParticleEmitterWrapper, firstHalf: boolean, t: number) {
        if (firstHalf) {
            firstColor[0] = emitter.props.SegmentColor[0][0];
            firstColor[1] = emitter.props.SegmentColor[0][1];
            firstColor[2] = emitter.props.SegmentColor[0][2];
            firstColor[3] = emitter.props.Alpha[0] / 255;

            secondColor[0] = emitter.props.SegmentColor[1][0];
            secondColor[1] = emitter.props.SegmentColor[1][1];
            secondColor[2] = emitter.props.SegmentColor[1][2];
            secondColor[3] = emitter.props.Alpha[1] / 255;
        } else {
            firstColor[0] = emitter.props.SegmentColor[1][0];
            firstColor[1] = emitter.props.SegmentColor[1][1];
            firstColor[2] = emitter.props.SegmentColor[1][2];
            firstColor[3] = emitter.props.Alpha[1] / 255;

            secondColor[0] = emitter.props.SegmentColor[2][0];
            secondColor[1] = emitter.props.SegmentColor[2][1];
            secondColor[2] = emitter.props.SegmentColor[2][2];
            secondColor[3] = emitter.props.Alpha[2] / 255;
        }

        vec4.lerp(color, firstColor, secondColor, t);

        for (let i = 0; i < 4; i++) {
            emitter.colors[index * 16 + i * 4] = color[0];
            emitter.colors[index * 16 + i * 4 + 1] = color[1];
            emitter.colors[index * 16 + i * 4 + 2] = color[2];
            emitter.colors[index * 16 + i * 4 + 3] = color[3];
        }
    }

    private setLayerProps(emitter: ParticleEmitterWrapper): void {

        if (emitter.props.BlendMode === ParticleEmitter2BlendMode.Blend) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, 0.);
            this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            this.gl.depthMask(false);
        } else if (emitter.props.BlendMode === ParticleEmitter2BlendMode.Additive) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DEFAULT_ALPHA_DISCARD);
            this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE, this.gl.ZERO, this.gl.ONE);
            this.gl.depthMask(false);
        } else if (emitter.props.BlendMode === ParticleEmitter2BlendMode.Modulate) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DEFAULT_ALPHA_DISCARD);
            this.gl.blendFuncSeparate(this.gl.DST_COLOR, this.gl.ZERO, this.gl.DST_ALPHA, this.gl.ZERO);
            this.gl.depthMask(false);
        } else if (emitter.props.BlendMode === ParticleEmitter2BlendMode.Modulate2x) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DEFAULT_ALPHA_DISCARD);
            this.gl.blendFuncSeparate(this.gl.DST_COLOR, this.gl.SRC_COLOR, this.gl.DST_ALPHA, this.gl.SRC_ALPHA);
            this.gl.depthMask(false);
        } else if (emitter.props.BlendMode === ParticleEmitter2BlendMode.AlphaKey) {
            this.gl.enable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, DISCARD_ALPHA_KEY_LEVEL);
            this.gl.blendFuncSeparate(this.gl.ONE, this.gl.ZERO, this.gl.ONE, this.gl.ZERO);
            this.gl.depthMask(false);
        }

        const texture = this.rendererData.model.Textures[emitter.props.TextureID];
        if (texture.Image) {
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[texture.Image]);
            this.gl.uniform1i(this.shaderProgramLocations.samplerUniform, 0);
            this.gl.uniform1f(this.shaderProgramLocations.hasTextureUniform, 1);
        }
    }

    private setGeneralBuffers(emitter: ParticleEmitterWrapper): void {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.colorBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.colors, this.gl.DYNAMIC_DRAW);
        this.gl.vertexAttribPointer(this.shaderProgramLocations.colorAttribute, 4, this.gl.FLOAT, false, 0, 0);

        this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, emitter.indexBuffer);
        this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, emitter.indices, this.gl.DYNAMIC_DRAW);
    }

    private renderEmitterType(emitter: ParticleEmitterWrapper, type: ParticleEmitter2Type): void {
        if (type === ParticleEmitter2Type.Tail) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.tailTexCoordBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.tailTexCoords, this.gl.DYNAMIC_DRAW);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.tailVertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.tailVertices, this.gl.DYNAMIC_DRAW);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
        } else {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.headTexCoordBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.headTexCoords, this.gl.DYNAMIC_DRAW);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);

            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, emitter.headVertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, emitter.headVertices, this.gl.DYNAMIC_DRAW);
            this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
        }

        this.gl.drawElements(this.gl.TRIANGLES, emitter.particles.length * 6, this.gl.UNSIGNED_SHORT, 0);
    }
}