import {
    Model, Node, AnimVector, NodeFlags, Layer, LayerShading,
    FilterMode, TextureFlags, TVertexAnim, TextureReplacement
} from '../../formats/mdx/model';
import { vec3, quat, mat3, mat4 } from 'gl-matrix';
import { mat4fromRotationOrigin, getShader } from '../../util';
import { ModelInterp } from './modelInterp';
import { ParticlesController } from './particles';
import { RendererData, NodeWrapper } from './rendererData';
import { RibbonsController } from './ribbons';
import { BLP } from '../../formats/blp/blp';

const MAX_NODES = 0x140; // max 0.10.0 amount
const DEFAULT_ALPHA_DISCARD = 1 / 255;

const vertexShaderHardwareSkinning = `
    attribute vec3 aVertexPosition;
    attribute vec2 aTextureCoord;
    attribute vec4 aGroup;

    uniform vec4 uColor;
    uniform float uLayerAlpha;

    uniform mat4 uMVMatrix;
    uniform mat4 uPMatrix;
    uniform mat4 uNodesMatrices[${MAX_NODES}];

    varying vec2 vTextureCoord;
    varying vec4 vColor;

    void main(void) {
        vec4 position = vec4(aVertexPosition, 1.0);
        int count = 1;
        vec4 sum = uNodesMatrices[int(aGroup[0])] * position;

        if (aGroup[1] < ${MAX_NODES}.) {
            sum += uNodesMatrices[int(aGroup[1])] * position;
            count += 1;
        }
        if (aGroup[2] < ${MAX_NODES}.) {
            sum += uNodesMatrices[int(aGroup[2])] * position;
            count += 1;
        }
        if (aGroup[3] < ${MAX_NODES}.) {
            sum += uNodesMatrices[int(aGroup[3])] * position;
            count += 1;
        }

        sum.xyz /= float(count);
        sum.w = 1.;
        position = sum;

        gl_Position = uPMatrix * uMVMatrix * position;
        vTextureCoord = aTextureCoord;
        vColor = uColor * vec4(1., 1., 1., uLayerAlpha);
    }
`;

const fragmentShader = `
    precision mediump float;

    varying vec2 vTextureCoord;
    varying vec4 vColor;

    uniform sampler2D uSampler;
    uniform float uDiscardAlphaLevel;    
    uniform mat3 uTVextexAnim;
    uniform bool uOverrideAlpha;
    uniform bool uHasTexture;

    void main(void) {
        vec2 texCoord = (uTVextexAnim * vec3(vTextureCoord.s, vTextureCoord.t, 1.)).st;

        if (uHasTexture) {
            gl_FragColor = texture2D(uSampler, texCoord) * vColor;
        } else {
            gl_FragColor = vec4(texCoord, 0, 1) * vColor;
        }

        if(uOverrideAlpha) {
            gl_FragColor.a = vColor.a;
        }

        if (gl_FragColor.a < uDiscardAlphaLevel) {
            discard;
        }
    }
`;

const translation = vec3.create();
const rotation = quat.create();
const scaling = vec3.create();

const defaultTranslation = vec3.fromValues(0, 0, 0);
const defaultRotation = quat.fromValues(0, 0, 0, 1);
const defaultScaling = vec3.fromValues(1, 1, 1);
const defaultColour = vec3.fromValues(1, 1, 1);

const tempParentRotationQuat: quat = quat.create();
const tempParentRotationMat: mat4 = mat4.create();
const tempCameraMat: mat4 = mat4.create();
const tempTransformedPivotPoint: vec3 = vec3.create();
const tempAxis: vec3 = vec3.create();
const tempLockQuat: quat = quat.create();
const tempLockMat: mat4 = mat4.create();
const tempXAxis: vec3 = vec3.create();
const tempCameraVec: vec3 = vec3.create();
const tempCross0: vec3 = vec3.create();
const tempCross1: vec3 = vec3.create();

const identifyMat3: mat3 = mat3.create();
const texCoordMat4: mat4 = mat4.create();
const texCoordMat3: mat3 = mat3.create();

export enum RenderFlags {
    ShowParticles = 1,
    ShowRibbons = 2,
    Default = ShowParticles | ShowRibbons
}

export class ModelRenderer {

    public gl: WebGLRenderingContext;
    public flags: RenderFlags = RenderFlags.Default;
    public readonly model: Model;

    private shaderProgram: WebGLProgram;
    private shaderProgramLocations: any = {}; // eslint-disable-line
    private anisotropicExt: any; // eslint-disable-line

    private interp: ModelInterp;
    private rendererData: RendererData;
    private particlesController: ParticlesController;
    private ribbonsController: RibbonsController;

    private geosets: Map<number, boolean>;
    private vertexBuffer: WebGLBuffer[] = [];
    private texCoordBuffer: WebGLBuffer[] = [];
    private indexBuffer: WebGLBuffer[] = [];
    private groupBuffer: WebGLBuffer[] = [];

    constructor(model: Model, flags: RenderFlags = RenderFlags.Default) {
        this.model = model;
        this.flags = flags;
        this.geosets = new Map<number, boolean>();

        this.rendererData = {
            model,
            frame: 0,
            animation: null,
            animationInfo: null,
            globalSequencesFrames: [],
            rootNode: null,
            nodes: [],
            geosetAnims: [],
            geosetAlpha: [],
            geosetColor: [],
            materialLayerTextureID: [],
            materialLayerAlpha: [],
            cameraPos: vec3.create(),
            cameraQuat: quat.create(),
            textures: {}
        };

        this.rendererData.cameraPos = vec3.create();
        this.rendererData.cameraQuat = quat.create();

        this.setSequence(0);

        this.rendererData.rootNode = {
            node: {} as Node,
            matrix: mat4.create(),
            children: []
        };

        for (const node of model.Nodes) {
            this.rendererData.nodes[node.ObjectId] = {
                node,
                matrix: mat4.create(),
                children: []
            };
        }

        for (const node of model.Nodes) {
            if (node.Parent === null) {
                this.rendererData.rootNode.children.push(this.rendererData.nodes[node.ObjectId]);
            } else {
                this.rendererData.nodes[node.Parent].children.push(this.rendererData.nodes[node.ObjectId]);
            }
        }

        if (model.GlobalSequences) {
            for (let i = 0; i < model.GlobalSequences.length; i++) {
                this.rendererData.globalSequencesFrames[i] = 0;
            }
        }

        for (let i = 0; i < model.GeosetAnims.length; i++) {
            this.rendererData.geosetAnims[model.GeosetAnims[i].GeosetId] = model.GeosetAnims[i];
        }

        for (let i = 0; i < model.Materials.length; i++) {
            this.rendererData.materialLayerTextureID[i] = new Array(model.Materials[i].Layers.length);
            this.rendererData.materialLayerAlpha[i] = new Array(model.Materials[i].Layers.length);
        }

        for (let i = 0; i < model.Geosets.length; i++) {
            this.geosets.set(model.Geosets[i].SelectionGroup, true);
        }

        const showParticles = (this.flags & RenderFlags.ShowParticles) === RenderFlags.ShowParticles;
        const showRibbons = (this.flags & RenderFlags.ShowRibbons) === RenderFlags.ShowRibbons;

        this.interp = new ModelInterp(this.rendererData);
        this.particlesController = new ParticlesController(this.interp, this.rendererData, showParticles);
        this.ribbonsController = new RibbonsController(this.interp, this.rendererData, showRibbons);

        console.log(this);
    }

    public initGL(gl: WebGLRenderingContext): void {
        this.gl = gl;
        this.gl.clearColor(0.11, 0.20, 0.39, 1);
        this.gl.enable(this.gl.DEPTH_TEST);
        this.gl.depthFunc(this.gl.LEQUAL);

        this.anisotropicExt = this.gl.getExtension('EXT_texture_filter_anisotropic') ||
            this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
            this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

        this.initShaders();
        this.initBuffers();
        this.particlesController.initGL(this.gl);
        this.ribbonsController.initGL(this.gl);
    }

    public enableParticles(value: boolean): void {
        if (value)
            this.flags |= RenderFlags.ShowParticles;
        else
            this.flags &= ~RenderFlags.ShowParticles;

        this.particlesController?.setEnabled(value);
    }

    public enableRibbons(value: boolean): void {
        if (value)
            this.flags |= RenderFlags.ShowRibbons;
        else
            this.flags &= ~RenderFlags.ShowRibbons;

        this.ribbonsController?.setEnabled(value);
    }

    public enableGeosets(value: boolean, ...groups: number[]): void {
        for (let i = 0; i < groups.length; i++) {
            this.geosets.set(groups[i], value);
        }
    }

    public dispose(): void {
        this.ribbonsController.dispose();
        this.particlesController.dispose();

        for (const key in Object.keys(this.rendererData.textures))
            this.gl.deleteTexture(this.rendererData.textures[key]);

        for (let i = 0; i < this.model.Geosets.length; i++) {
            this.gl.deleteBuffer(this.vertexBuffer[i]);
            this.gl.deleteBuffer(this.texCoordBuffer[i]);
            this.gl.deleteBuffer(this.indexBuffer[i]);
            this.gl.deleteBuffer(this.groupBuffer[i]);
        }

        this.gl.deleteProgram(this.shaderProgram);
    }

    public setTexture(name: string, filename: string, flags: TextureFlags): void {
        const blp = BLP.Load(filename);

        if (blp) {
            const mips = blp.info.mipmaps.map((_mipmap, i) => blp.getImageData(i));
            this.setTextureImageData(name, mips, flags);
        } else {
            // load our default image, empties are purposefully transparent
            const img = new Image();
            img.onload = () => this.setTextureImage(name, img, 0);
            img.src = filename ? 'empty.png' : 'transparent.png';
        }
    }

    public combineTexture(path: string, src: ImageData | string, dx: number, dy: number): void {
        let imageData: ImageData = src as ImageData;
        if (typeof src === 'string')
            imageData = BLP.Load(src)?.getImageData(0);

        if (imageData) {
            const texture = this.rendererData.textures[path];
            this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
            this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, dx, dy, this.gl.RGBA, this.gl.UNSIGNED_BYTE, imageData);
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        }
    }

    public setCamera(cameraPos: vec3, cameraQuat: quat): void {
        vec3.copy(this.rendererData.cameraPos, cameraPos);
        quat.copy(this.rendererData.cameraQuat, cameraQuat);
    }

    public setSequence(index: number): void {
        this.rendererData.animation = index;
        this.rendererData.animationInfo = this.model.Sequences[this.rendererData.animation];
        this.rendererData.frame = this.rendererData.animationInfo.Interval[0];

        this.particlesController?.reset();
        this.ribbonsController?.reset();
    }

    public update(delta: number): void {
        this.rendererData.frame += delta;

        if (this.rendererData.frame > this.rendererData.animationInfo.Interval[1]) {
            this.rendererData.frame = this.rendererData.animationInfo.Interval[0];
        }

        this.updateGlobalSequences(delta);
        this.updateNode(this.rendererData.rootNode);

        this.particlesController.update(delta);
        this.ribbonsController.update(delta);

        for (let i = 0; i < this.rendererData.materialLayerTextureID.length; i++) {
            for (let j = 0; j < this.rendererData.materialLayerTextureID[i].length; j++) {
                this.updateLayerTextureId(i, j);
                this.updateLayerAlpha(i, j);
            }
        }

        for (let i = 0; i < this.model.Geosets.length; i++) {
            this.rendererData.geosetAlpha[i] = this.findAlpha(i);
            this.rendererData.geosetColor[i] = this.findColor(i);
        }
    }

    public render(mvMatrix: mat4, pMatrix: mat4): void {
        this.gl.useProgram(this.shaderProgram);

        this.gl.uniformMatrix4fv(this.shaderProgramLocations.pMatrixUniform, false, pMatrix);
        this.gl.uniformMatrix4fv(this.shaderProgramLocations.mvMatrixUniform, false, mvMatrix);

        this.gl.enableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
        this.gl.enableVertexAttribArray(this.shaderProgramLocations.groupAttribute);

        for (let j = 0; j < MAX_NODES; j++) {
            if (this.rendererData.nodes[j]) {
                this.gl.uniformMatrix4fv(this.shaderProgramLocations.nodesMatricesAttributes[j], false,
                    this.rendererData.nodes[j].matrix);
            }
        }

        for (let i = 0; i < this.model.Geosets.length; i++) {
            // geoset enables
            if (!this.geosets.get(this.model.Geosets[i].SelectionGroup)) {
                continue;
            }

            // skip transparent geosets
            if (this.rendererData.geosetAlpha[i] < 1e-6) {
                continue;
            }

            this.gl.uniform4f(this.shaderProgramLocations.colorUniform,
                this.rendererData.geosetColor[i][0],
                this.rendererData.geosetColor[i][1],
                this.rendererData.geosetColor[i][2],
                this.rendererData.geosetAlpha[i]
            );

            const materialID = this.model.Geosets[i].MaterialID;
            const material = this.model.Materials[materialID];

            for (let j = 0; j < material.Layers.length; j++) {
                this.setLayerProps(material.Layers[j],
                    this.rendererData.materialLayerTextureID[materialID][j],
                    this.rendererData.materialLayerAlpha[materialID][j]);

                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[i]);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);

                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer[i]);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.textureCoordAttribute, 2, this.gl.FLOAT, false, 0, 0);

                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.groupBuffer[i]);
                this.gl.vertexAttribPointer(this.shaderProgramLocations.groupAttribute, 4, this.gl.UNSIGNED_SHORT, false, 0, 0);

                this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer[i]);
                this.gl.drawElements(this.gl.TRIANGLES, this.model.Geosets[i].Faces.length, this.gl.UNSIGNED_SHORT, 0);
            }
        }

        this.gl.disableVertexAttribArray(this.shaderProgramLocations.vertexPositionAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.textureCoordAttribute);
        this.gl.disableVertexAttribArray(this.shaderProgramLocations.groupAttribute);

        this.particlesController.render(mvMatrix, pMatrix);
        this.ribbonsController.render(mvMatrix, pMatrix);
    }

    private setTextureImage(path: string, img: HTMLImageElement, flags: TextureFlags): void {
        if (this.rendererData.textures[path])
            this.gl.deleteTexture(this.rendererData[path]);

        this.rendererData.textures[path] = this.gl.createTexture() as WebGLTexture;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[path]);

        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
        this.setTextureParameters(flags);
        this.gl.generateMipmap(this.gl.TEXTURE_2D);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    }

    private setTextureImageData(path: string, imageData: ImageData[], flags: TextureFlags): void {
        if (this.rendererData.textures[path])
            this.gl.deleteTexture(this.rendererData[path]);

        this.rendererData.textures[path] = this.gl.createTexture() as WebGLTexture;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.rendererData.textures[path]);

        for (let i = 0; i < imageData.length; i++) {
            this.gl.texImage2D(this.gl.TEXTURE_2D, i, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, imageData[i]);
        }

        this.setTextureParameters(flags);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    }

    private setTextureParameters(flags: TextureFlags) {
        if (flags & TextureFlags.WrapWidth) {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
        } else {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        }
        if (flags & TextureFlags.WrapHeight) {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
        } else {
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        }

        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);

        if (this.anisotropicExt) {
            const max = this.gl.getParameter(this.anisotropicExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
            this.gl.texParameterf(this.gl.TEXTURE_2D, this.anisotropicExt.TEXTURE_MAX_ANISOTROPY_EXT, max);
        }
    }

    private updateLayerTextureId(materialId: number, layerId: number): void {
        const textureID: AnimVector | number = this.model.Materials[materialId].Layers[layerId].TextureID;

        if (typeof textureID === 'number') {
            this.rendererData.materialLayerTextureID[materialId][layerId] = textureID;
        } else {
            this.rendererData.materialLayerTextureID[materialId][layerId] = this.interp.num(textureID);
        }
    }

    private updateLayerAlpha(materialId: number, layerId: number): void {
        const Alpha: AnimVector | number = this.model.Materials[materialId].Layers[layerId].Alpha;

        if (typeof Alpha === 'number') {
            this.rendererData.materialLayerAlpha[materialId][layerId] = Alpha;
        } else {
            this.rendererData.materialLayerAlpha[materialId][layerId] = this.interp.animVectorVal(Alpha);
        }
    }

    private initShaders(): void {
        if (this.shaderProgram) {
            return;
        }

        const vertex = getShader(this.gl, vertexShaderHardwareSkinning, this.gl.VERTEX_SHADER);
        const fragment = getShader(this.gl, fragmentShader, this.gl.FRAGMENT_SHADER);

        this.shaderProgram = this.gl.createProgram() as WebGLProgram;
        this.gl.attachShader(this.shaderProgram, vertex);
        this.gl.attachShader(this.shaderProgram, fragment);
        this.gl.linkProgram(this.shaderProgram);

        if (!this.gl.getProgramParameter(this.shaderProgram, this.gl.LINK_STATUS)) {
            alert('Could not initialise shaders');
        }

        this.gl.useProgram(this.shaderProgram);

        this.shaderProgramLocations.vertexPositionAttribute = this.gl.getAttribLocation(this.shaderProgram, 'aVertexPosition');
        this.shaderProgramLocations.textureCoordAttribute = this.gl.getAttribLocation(this.shaderProgram, 'aTextureCoord');
        this.shaderProgramLocations.groupAttribute = this.gl.getAttribLocation(this.shaderProgram, 'aGroup');

        this.shaderProgramLocations.pMatrixUniform = this.gl.getUniformLocation(this.shaderProgram, 'uPMatrix');
        this.shaderProgramLocations.mvMatrixUniform = this.gl.getUniformLocation(this.shaderProgram, 'uMVMatrix');
        this.shaderProgramLocations.samplerUniform = this.gl.getUniformLocation(this.shaderProgram, 'uSampler');
        this.shaderProgramLocations.overrideAlphaUniform = this.gl.getUniformLocation(this.shaderProgram, 'uOverrideAlpha');
        this.shaderProgramLocations.hasTextureUniform = this.gl.getUniformLocation(this.shaderProgram, 'uHasTexture');
        this.shaderProgramLocations.discardAlphaLevelUniform = this.gl.getUniformLocation(this.shaderProgram, 'uDiscardAlphaLevel');
        this.shaderProgramLocations.layerAlphaUniform = this.gl.getUniformLocation(this.shaderProgram, 'uLayerAlpha');
        this.shaderProgramLocations.tVertexAnimUniform = this.gl.getUniformLocation(this.shaderProgram, 'uTVextexAnim');
        this.shaderProgramLocations.colorUniform = this.gl.getUniformLocation(this.shaderProgram, 'uColor');

        this.shaderProgramLocations.nodesMatricesAttributes = [];
        for (let i = 0; i < MAX_NODES; i++) {
            this.shaderProgramLocations.nodesMatricesAttributes[i] =
                this.gl.getUniformLocation(this.shaderProgram, `uNodesMatrices[${i}]`);
        }
    }

    private initBuffers(): void {
        for (let i = 0; i < this.model.Geosets.length; i++) {
            this.vertexBuffer[i] = this.gl.createBuffer() as WebGLBuffer;
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer[i]);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, this.model.Geosets[i].Vertices, this.gl.STATIC_DRAW);

            this.texCoordBuffer[i] = this.gl.createBuffer() as WebGLBuffer;
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer[i]);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, this.model.Geosets[i].TVertices[0], this.gl.STATIC_DRAW);

            this.groupBuffer[i] = this.gl.createBuffer() as WebGLBuffer;
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.groupBuffer[i]);
            const buffer = new Uint16Array(this.model.Geosets[i].VertexGroup.length * 4);
            for (let j = 0; j < buffer.length; j += 4) {
                const index = j / 4;
                const group = this.model.Geosets[i].Groups[this.model.Geosets[i].VertexGroup[index]];
                buffer[j] = group[0];
                buffer[j + 1] = group.length > 1 ? group[1] : MAX_NODES;
                buffer[j + 2] = group.length > 2 ? group[2] : MAX_NODES;
                buffer[j + 3] = group.length > 3 ? group[3] : MAX_NODES;
            }
            this.gl.bufferData(this.gl.ARRAY_BUFFER, buffer, this.gl.STATIC_DRAW);

            this.indexBuffer[i] = this.gl.createBuffer() as WebGLBuffer;
            this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer[i]);
            this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, this.model.Geosets[i].Faces, this.gl.STATIC_DRAW);
        }
    }

    private updateGlobalSequences(delta: number): void {
        for (let i = 0; i < this.rendererData.globalSequencesFrames.length; i++) {
            this.rendererData.globalSequencesFrames[i] += delta;
            if (this.rendererData.globalSequencesFrames[i] > this.model.GlobalSequences[i]) {
                this.rendererData.globalSequencesFrames[i] = 0;
            }
        }
    }

    private updateNode(node: NodeWrapper): void {
        const translationRes = this.interp.vec3(translation, node.node.Translation as AnimVector);
        const rotationRes = this.interp.quat(rotation, node.node.Rotation as AnimVector);
        const scalingRes = this.interp.vec3(scaling, node.node.Scaling as AnimVector);

        if (!translationRes && !rotationRes && !scalingRes) {
            mat4.identity(node.matrix);
        } else if (translationRes && !rotationRes && !scalingRes) {
            mat4.fromTranslation(node.matrix, translationRes);
        } else if (!translationRes && rotationRes && !scalingRes) {
            mat4fromRotationOrigin(node.matrix, rotationRes, <vec3>node.node.PivotPoint);
        } else {
            mat4.fromRotationTranslationScaleOrigin(node.matrix,
                rotationRes || defaultRotation,
                translationRes || defaultTranslation,
                scalingRes || defaultScaling,
                <vec3>node.node.PivotPoint
            );
        }

        if (node.node.Parent || node.node.Parent === 0) {
            mat4.mul(node.matrix, this.rendererData.nodes[node.node.Parent].matrix, node.matrix);
        }

        if (node.node.Flags & NodeFlags.Billboarded) {
            vec3.transformMat4(tempTransformedPivotPoint, <vec3>node.node.PivotPoint, node.matrix);

            if (node.node.Parent || node.node.Parent === 0) {
                // cancel parent rotation from PivotPoint
                mat4.getRotation(tempParentRotationQuat, this.rendererData.nodes[node.node.Parent].matrix);
                quat.invert(tempParentRotationQuat, tempParentRotationQuat);
                mat4fromRotationOrigin(tempParentRotationMat, tempParentRotationQuat, tempTransformedPivotPoint);
                mat4.mul(node.matrix, tempParentRotationMat, node.matrix);
            }

            // rotate to camera
            mat4fromRotationOrigin(tempCameraMat, this.rendererData.cameraQuat, tempTransformedPivotPoint);
            mat4.mul(node.matrix, tempCameraMat, node.matrix);

        } else if (node.node.Flags & NodeFlags.BillboardLockMask) {
            vec3.transformMat4(tempTransformedPivotPoint, <vec3>node.node.PivotPoint, node.matrix);
            vec3.copy(tempAxis, <vec3>node.node.PivotPoint);

            // todo BillboardedLockX ?
            if (node.node.Flags & NodeFlags.BillboardedLockX) {
                tempAxis[0] += 1;
            } else if (node.node.Flags & NodeFlags.BillboardedLockY) {
                tempAxis[1] += 1;
            } else if (node.node.Flags & NodeFlags.BillboardedLockZ) {
                tempAxis[2] += 1;
            }

            vec3.transformMat4(tempAxis, tempAxis, node.matrix);
            vec3.sub(tempAxis, tempAxis, tempTransformedPivotPoint);

            vec3.set(tempXAxis, 1, 0, 0);
            vec3.add(tempXAxis, tempXAxis, <vec3>node.node.PivotPoint);
            vec3.transformMat4(tempXAxis, tempXAxis, node.matrix);
            vec3.sub(tempXAxis, tempXAxis, tempTransformedPivotPoint);

            vec3.set(tempCameraVec, -1, 0, 0);
            vec3.transformQuat(tempCameraVec, tempCameraVec, this.rendererData.cameraQuat);

            vec3.cross(tempCross0, tempAxis, tempCameraVec);
            vec3.cross(tempCross1, tempAxis, tempCross0);

            vec3.normalize(tempCross1, tempCross1);

            quat.rotationTo(tempLockQuat, tempXAxis, tempCross1);
            mat4fromRotationOrigin(tempLockMat, tempLockQuat, tempTransformedPivotPoint);
            mat4.mul(node.matrix, tempLockMat, node.matrix);
        }

        for (const child of node.children) {
            this.updateNode(child);
        }
    }

    private findAlpha(geosetId: number): number {
        const geosetAnim = this.rendererData.geosetAnims[geosetId];

        if (!geosetAnim || geosetAnim.Alpha === undefined) {
            return 1;
        }

        if (typeof geosetAnim.Alpha === 'number') {
            return geosetAnim.Alpha;
        }

        const interpRes = this.interp.num(geosetAnim.Alpha);
        return interpRes ?? 1;
    }

    private findColor(geosetId: number): vec3 {
        const geosetAnim = this.rendererData.geosetAnims[geosetId];

        if (!geosetAnim || geosetAnim.Color === undefined) {
            return defaultColour;
        }

        return this.interp.animColorVal(geosetAnim.Color) ?? defaultColour;
    }

    private setLayerProps(layer: Layer, textureID: number, alpha: number): void {
        const texture = this.model.Textures[textureID];

        if (layer.Shading & LayerShading.TwoSided) {
            this.gl.disable(this.gl.CULL_FACE);
        } else {
            this.gl.enable(this.gl.CULL_FACE);
        }

        this.gl.uniform1f(this.shaderProgramLocations.layerAlphaUniform, alpha);

        // HACK not sure how this works in alpha but is correct in beta
        if (texture.ReplaceableId === TextureReplacement.CharHair) {
            this.gl.uniform1i(this.shaderProgramLocations.overrideAlphaUniform, 1);
        }

        if (layer.FilterMode === FilterMode.None) {
            const discard = alpha < 1e-6 ? 1. : 0.;
            this.gl.disable(this.gl.BLEND);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.uniform1f(this.shaderProgramLocations.discardAlphaLevelUniform, discard);
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
        } else {
            this.gl.uniform1i(this.shaderProgramLocations.hasTextureUniform, 0);
        }

        if (layer.Shading & LayerShading.NoDepthTest) {
            this.gl.disable(this.gl.DEPTH_TEST);
        }
        if (layer.Shading & LayerShading.NoDepthSet) {
            this.gl.depthMask(false);
        }

        if (typeof layer.TVertexAnimId === 'number') {
            const anim: TVertexAnim = this.rendererData.model.TextureAnims[layer.TVertexAnimId];
            const translationRes = this.interp.vec3(translation, anim.Translation as AnimVector);
            const rotationRes = this.interp.quat(rotation, anim.Rotation as AnimVector);
            const scalingRes = this.interp.vec3(scaling, anim.Scaling as AnimVector);
            mat4.fromRotationTranslationScale(
                texCoordMat4,
                rotationRes || defaultRotation,
                translationRes || defaultTranslation,
                scalingRes || defaultScaling
            );
            mat3.set(
                texCoordMat3,
                texCoordMat4[0], texCoordMat4[1], 0,
                texCoordMat4[4], texCoordMat4[5], 0,
                texCoordMat4[12], texCoordMat4[13], 0
            );

            this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, texCoordMat3);
        } else {
            this.gl.uniformMatrix3fv(this.shaderProgramLocations.tVertexAnimUniform, false, identifyMat3);
        }
    }
}