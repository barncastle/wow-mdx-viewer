import {
    Sequence, Model, GeosetAnim,
    Node, RibbonEmitter, ParticleEmitter2
} from '../../formats/mdx/model';
import { vec3, quat, mat4 } from 'gl-matrix';

export interface NodeWrapper {
    node: Node;
    matrix: mat4;
    children: NodeWrapper[];
}

export interface RendererData {
    model: Model;
    frame: number;
    animation: number;
    animationInfo: Sequence;
    globalSequencesFrames: number[];

    rootNode: NodeWrapper;
    nodes: NodeWrapper[];

    // geoset-to-anim map
    geosetAnims: GeosetAnim[];
    geosetAlpha: number[];
    geosetColor: vec3[];
    materialLayerTextureID: number[][];
    materialLayerAlpha: number[][];
    cameraPos: vec3;
    cameraQuat: quat;
    textures: { [key: string]: WebGLTexture };
}

export interface RibbonEmitterWrapper {
    timer: number;
    edgeCycle: number;
    edgeLifeTime: number;
    props: RibbonEmitter;
    current: number;
    maxCapacity: number;
    lifeTimes: number[];

    vertices: Float32Array;
    vertexBuffer: WebGLBuffer;
    texCoords: Float32Array;
    texCoordBuffer: WebGLBuffer;
    indicies: Uint16Array;
    indexBuffer: WebGLBuffer;
}

export interface Particle {
    emitter: ParticleEmitterWrapper;
    pos: vec3;
    speed: vec3;
    angle: number;
    gravity: number;
    lifeSpan: number;
    maxAge: number;
}

export interface ParticleEmitterWrapper {
    emission: number;
    velUpdate: number;
    squirtFrame: number;
    particles: Particle[];
    props: ParticleEmitter2;
    capacity: number;
    baseCapacity: number;
    type: number; // head or tail or both
    inheritVelocity: vec3;
    prevPosition: vec3;
    followProps: number[];
    followVector: vec3;

    tailVertices: Float32Array;
    tailVertexBuffer: WebGLBuffer;
    headVertices: Float32Array;
    headVertexBuffer: WebGLBuffer;

    tailTexCoords: Float32Array;
    tailTexCoordBuffer: WebGLBuffer;
    headTexCoords: Float32Array;
    headTexCoordBuffer: WebGLBuffer;

    colors: Float32Array;
    colorBuffer: WebGLBuffer;

    indices: Uint16Array;
    indexBuffer: WebGLBuffer;
}