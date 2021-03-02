import { ModelReader } from './modelreader';

export interface ModelInfo {
    Name: string;
    AnimationFile: string;
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
    BlendTime: number;
    Flags: number;
}

export interface Sequence {
    Name: string;
    Interval: Uint32Array;
    NonLooping: boolean;
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
    MoveSpeed: number;
    Frequency: number;
    Replay: Uint32Array;
    BlendTime: number;
}

export enum TextureFlags {
    WrapWidth = 1,
    WrapHeight = 2
}

export enum TextureReplacement {
    None = 0x0,
    Skin = 0x1,
    ObjectSkin = 0x2,
    WeaponBlade = 0x3,
    WeaponHandle = 0x4,
    Environment = 0x5,
    CharHair = 0x6,
    CharFacialHair = 0x7,
    SkinExtra = 0x8,
    UISkin = 0x9,
    TaurenMane = 0xA,
    Monster1 = 0xB,
    Monster2 = 0xC,
    Monster3 = 0xD,
    ItemIcon = 0xE
}

export interface Texture {
    Image: string;
    ReplaceableId: TextureReplacement;
    Flags: TextureFlags;
}

export enum FilterMode {
    None = 0,
    Transparent = 1,
    Blend = 2,
    Additive = 3,
    AddAlpha = 4,
    Modulate = 5,
    Modulate2x = 6
}

export enum LineType {
    DontInterp = 0,
    Linear = 1,
    Hermite = 2,
    Bezier = 3
}

export interface AnimKeyframe {
    Frame: number;
    Vector: Float32Array | Int32Array;
    InTan: Float32Array | Int32Array;
    OutTan: Float32Array | Int32Array;
}

export interface AnimVector {
    Default?: number | Float32Array;
    LineType: LineType;
    GlobalSeqId: number;
    Keys: AnimKeyframe[];
}

export enum LayerShading {
    Unshaded = 0x1,
    SphereEnvMap = 0x2,
    WrapWidth = 0x4,
    WrapHeight = 0x8,
    TwoSided = 0x10,
    Unfogged = 0x20,
    NoDepthTest = 0x40,
    NoDepthSet = 0x80,
    NoFallback = 0x100,
}

export interface Layer {
    FilterMode: FilterMode;
    Shading: LayerShading;
    TextureID: AnimVector | number;
    TVertexAnimId: number;
    CoordId: number;
    Alpha: number | AnimVector;
}

export enum MaterialRenderMode {
    ConstantColor = 1,
    SortPrimsFarZ = 16,
    FullResolution = 32,
}

export interface Material {
    PriorityPlane: number;
    Layers: Layer[];
}

export interface GeosetAnimInfo {
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
}

export enum GeosetFlags {
    Unselectable = 1,
    Project2D = 0x10,
    ShaderSkin = 0x20,
}

export interface Geoset {
    Vertices: Float32Array;
    Normals: Float32Array;
    TVertices: Float32Array[];
    VertexGroup: Uint8Array;
    Faces: Uint16Array;
    Groups: number[][];
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
    BoundsRadius: number;
    Anims: GeosetAnimInfo[];
    // BoneIndices: Uint32Array;
    // BoneWeights: Float32Array;
    MaterialID: number;
    SelectionGroup: number;
    Flags: GeosetFlags;
}

export enum GeosetAnimFlags {
    DropShadow = 1,
    Color = 2
}

export interface GeosetAnim {
    GeosetId: number;
    Alpha: AnimVector | number;
    Color: AnimVector | Float32Array;
    Flags: number;
}

export enum NodeFlags {
    DontInheritTranslation = 1,
    DontInheritRotation = 2,
    DontInheritScaling = 4,
    Billboarded = 8,
    BillboardedLockX = 0x10,
    BillboardedLockY = 0x20,
    BillboardedLockZ = 0x40,

    BillboardLockMask = BillboardedLockX | BillboardedLockY | BillboardedLockZ
}

export enum NodeType {
    Helper = 0,
    Bone = 0x80,
    Light = 0x100,
    EventObject = 0x200,
    Attachment = 0x400,
    ParticleEmitter2 = 0x800,
    HitTestShape = 0x1000,
    RibbonEmitter = 0x2000
}

export interface Node {
    Name: string;
    ObjectId: number;
    Parent?: number | null;
    PivotPoint: Float32Array;
    Flags: number;

    Translation?: AnimVector;
    Rotation?: AnimVector;
    Scaling?: AnimVector;
}

export interface Bone extends Node {
    GeosetId: number;
    GeosetAnimId: number;
}

export type Helper = Node;

export interface Attachment extends Node {
    Path: string;
    AttachmentID: number;
    Visibility: AnimVector | number;
}

export interface EventObject extends Node {
    GlobalSeqId: number;
    EventTrack: Int32Array;
}

export enum HitTestShapeType {
    Box = 0,
    Cylinder = 1,
    Sphere = 2,
    Plane = 3
}

export interface HitTestShape extends Node {
    Shape: HitTestShapeType;
    Vertices: Float32Array;
    BoundsRadius: number;
}

export interface Collision {
    Vertices: Float32Array;
    TriIndices: Uint16Array;
    FacetNormals: Float32Array;
}

export enum ParticleEmitterFlags {
    Project = 0x4000,
    EmitterUsesMDL = 0x8000,
    EmitterUsesTGA = 0x10000
}

export interface ParticleEmitter extends Node {
    EmissionRate: AnimVector | number;
    Gravity: AnimVector | number;
    Longitude: AnimVector | number;
    Latitude: AnimVector | number;
    Path: string;
    LifeSpan: AnimVector | number;
    InitVelocity: AnimVector | number;
    Visibility: AnimVector | number;
}

export enum ParticleEmitter2EmitterType {
    Base = 0,
    Plane = 1,
    Sphere = 2,
    Spline = 3
}

export enum ParticleEmitter2Flags {
    Unshaded = 0x8000,
    SortPrimsFarZ = 0x10000,
    LineEmitter = 0x20000,
    Unfogged = 0x40000,
    ModelSpace = 0x80000,
    InheritScale = 0x100000,
    InstantVelocity = 0x200000,
    ZeroXKill = 0x400000,
    ZVelocityOnly = 0x800000,
    Tumbler = 0x1000000,
    TailGrows = 0x2000000,
    Extrude = 0x4000000,
    XYQuad = 0x8000000,
    Project = 0x10000000,
    Follow = 0x20000000,
}

export enum ParticleEmitter2BlendMode {
    Blend = 0,
    Additive = 1,
    Modulate = 2,
    Modulate2x = 3,
    AlphaKey = 4
}

export enum ParticleEmitter2Type {
    Head = 1,
    Tail = 2,
    Both = Head | Tail
}

export interface ParticleEmitter2 extends Node {
    EmitterType: ParticleEmitter2EmitterType;
    Speed: AnimVector | number;
    Variation: AnimVector | number;
    Latitude: AnimVector | number;
    Longitude: AnimVector | number;
    Gravity: AnimVector | number;
    ZSource: AnimVector | number;
    Visibility: AnimVector | number;
    Squirt: boolean;
    LifeSpan: AnimVector | number;
    EmissionRate: AnimVector | number;
    Length: AnimVector | number;
    Width: AnimVector | number;
    Rows: number;
    Columns: number;
    ParticleType: number;
    BlendMode: ParticleEmitter2BlendMode;
    TailLength: number;
    MiddleTime: number;
    SegmentColor: Float32Array[];
    Alpha: Uint8Array;
    ParticleScaling: Float32Array;
    LifeSpanUVAnim: Uint32Array;
    DecayUVAnim: Uint32Array;
    TailUVAnim: Uint32Array;
    TailDecayUVAnim: Uint32Array;
    TextureID: number;
    ReplaceableId: number;
    PriorityPlane: number;
    GeometryModel: string;
    RecursionModel: string;
    TwinkleFps: number;
    TwinkleOnOff: number;
    TwinkleScale: Float32Array;
    IvelScale: number;
    Tumble: Float32Array;
    Drag: number;
    Spin: number;
    WindVector: Float32Array;
    WindTime: number;
    FollowSpeed: Float32Array;
    FollowScale: Float32Array;
    Splines: Float32Array[];
}

export interface Camera {
    Name: string;
    Pivot: Float32Array;
    FieldOfView: number;
    NearClip: number;
    FarClip: number;
    TargetPosition: Float32Array;
    TargetTranslation?: AnimVector;
    Translation?: AnimVector;
    Rotation?: AnimVector;
    Visibility?: AnimVector | number;
}

export enum LightType {
    Omnidirectional = 0,
    Directional = 1,
    Ambient = 2
}

export interface Light extends Node {
    LightType: LightType;

    AttenuationStart: AnimVector | number;
    AttenuationEnd: AnimVector | number;

    Color: AnimVector | Float32Array;
    Intensity: AnimVector | number;
    AmbIntensity: AnimVector | number;
    AmbColor: AnimVector | Float32Array;

    Visibility?: AnimVector | number;
}

export interface RibbonEmitter extends Node {
    HeightAbove: AnimVector | number;
    HeightBelow: AnimVector | number;
    Alpha: AnimVector | number;
    Color: AnimVector | Float32Array;
    LifeSpan: number;
    TextureSlot: AnimVector | number;
    EdgesPerSec: number;
    Rows: number;
    Columns: number;
    MaterialID: number;
    Gravity: number;

    Visibility?: AnimVector | number;
}

export interface TVertexAnim {
    Translation?: AnimVector;
    Rotation?: AnimVector;
    Scaling?: AnimVector;
}

export interface Model {
    Filename: string;
    Version: number;
    Info: ModelInfo;
    Sequences: Sequence[];
    Textures: Texture[];
    Materials: Material[];
    Geosets: Geoset[];
    GeosetAnims: GeosetAnim[];
    Bones: Bone[];
    Helpers: Helper[];
    Attachments: Attachment[];
    Nodes: Node[];
    PivotPoints: Float32Array[];
    EventObjects: EventObject[];
    HitTestShapes: HitTestShape[];
    Collision: Collision;
    GlobalSequences: number[];
    ParticleEmitters: ParticleEmitter[];
    ParticleEmitters2: ParticleEmitter2[];
    Cameras: Camera[];
    Lights: Light[];
    RibbonEmitters: RibbonEmitter[];
    TextureAnims: TVertexAnim[];
}

export function ReadModel(filename: string, arrayBuffer: Buffer): Model {
    return new ModelReader().read(filename, arrayBuffer);
}