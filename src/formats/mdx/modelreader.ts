import {
    Model, Sequence, Material, Layer, Texture, Geoset, GeosetAnimInfo, GeosetAnim, Node,
    Bone, Helper, Attachment, EventObject, HitTestShape, HitTestShapeType, ParticleEmitter2,
    Camera, Light, TVertexAnim, RibbonEmitter, ParticleEmitter, TextureReplacement
} from './model';
import { Reader, AnimVectorType } from '../reader'

const NAME_LENGTH = 0x50;
const FILE_NAME_LENGTH = 0x104;

export class ModelReader {

    public read(filename: string, arrayBuffer: Buffer): Model {
        const reader = new Reader(arrayBuffer);

        if (reader.keyword() !== 'MDLX') {
            throw new Error('Not a mdx model');
        }

        const model: Model = {
            Filename: filename,
            Version: 1300,
            Info: {
                Name: '',
                AnimationFile: '',
                MinimumExtent: null,
                MaximumExtent: null,
                BoundsRadius: 0,
                BlendTime: 150,
                Flags: 0
            },
            Collision: {
                Vertices: null,
                TriIndices: null,
                FacetNormals: null
            },
            Sequences: [],
            GlobalSequences: [],
            Textures: [],
            Materials: [],
            TextureAnims: [],
            Geosets: [],
            GeosetAnims: [],
            Bones: [],
            Helpers: [],
            Attachments: [],
            EventObjects: [],
            ParticleEmitters: [],
            ParticleEmitters2: [],
            Cameras: [],
            Lights: [],
            RibbonEmitters: [],
            HitTestShapes: [],
            PivotPoints: [],
            Nodes: []
        };

        let previous = '';
        while (reader.pos < reader.length) {
            const keyword = reader.keyword();
            const size = reader.int32();

            if (keyword in this.Parsers) {
                this.Parsers[keyword](model, reader, size, this);
                previous = keyword;
            } else {
                throw new Error('Unknown group ' + keyword + ' after ' + previous);
            }
        }

        for (let i = 0; i < model.Nodes.length; i++) {
            if (model.Nodes[i] && model.PivotPoints[model.Nodes[i].ObjectId]) {
                model.Nodes[i].PivotPoint = model.PivotPoints[model.Nodes[i].ObjectId];
            }
        }

        return model;
    }

    private parseNode(model: Model, node: Node, reader: Reader): void {
        const startPos = reader.pos;
        const size = reader.int32();

        node.Name = reader.str(NAME_LENGTH);
        node.ObjectId = reader.int32();
        node.Parent = reader.int32();
        node.Flags = reader.uint32();

        if (node.ObjectId === -1)
            node.ObjectId = null;
        if (node.Parent === -1)
            node.Parent = null;

        while (reader.pos < startPos + size) {
            const keyword = reader.keyword();
            switch (keyword) {
                case "KGTR": node.Translation = reader.animVector(AnimVectorType.FLOAT3); break;
                case "KGRT": node.Rotation = reader.animVector(AnimVectorType.FLOAT4); break;
                case "KGSC": node.Scaling = reader.animVector(AnimVectorType.FLOAT3); break;
                default: throw new Error('Incorrect node chunk data ' + keyword);
            }
        }

        model.Nodes[node.ObjectId] = node;
    }

    private Parsers: { [key: string]: (model: Model, reader: Reader, size: number, $this: ModelReader) => void } = {
        VERS: this.parseVersion,
        MODL: this.parseModelInfo,
        SEQS: this.parseSequences,
        GLBS: this.parseGlobalSequences,
        MTLS: this.parseMaterials,
        TEXS: this.parseTextures,
        TXAN: this.parseTextureAnims,
        GEOS: this.parseGeosets,
        GEOA: this.parseGeosetAnims,
        BONE: this.parseBones,
        LITE: this.parseLights,
        HELP: this.parseHelpers,
        ATCH: this.parseAttachments,
        PIVT: this.parsePivotPoints,
        PREM: this.parseParticleEmitters,
        CAMS: this.parseCameras,
        EVTS: this.parseEventObjects,
        PRE2: this.parseParticleEmitters2,
        HTST: this.parseHitTestShapes,
        RIBB: this.parseRibbonEmitters,
        CLID: this.parseCollision
    };

    private parseVersion(model: Model, reader: Reader): void {
        model.Version = reader.int32();

        if (model.Version < 1300 || model.Version > 1500)
            throw new Error("Invalid version " + model.Version);
    }

    private parseModelInfo(model: Model, reader: Reader): void {
        model.Info.Name = reader.str(NAME_LENGTH);
        model.Info.AnimationFile = reader.str(FILE_NAME_LENGTH);
        reader.extent(model.Info);
        model.Info.BlendTime = reader.int32();
        model.Info.Flags = reader.uint8();
    }

    private parseSequences(model: Model, reader: Reader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const sequence: Sequence = {} as Sequence;

            sequence.Name = reader.str(NAME_LENGTH);
            sequence.Interval = reader.uint32Array(2);
            sequence.MoveSpeed = reader.float();
            sequence.NonLooping = reader.int32() > 0;
            reader.extent(sequence);
            sequence.Frequency = reader.float();
            sequence.Replay = reader.uint32Array(2);
            sequence.BlendTime = reader.int32();

            model.Sequences.push(sequence);
        }
    }

    private parseMaterials(model: Model, reader: Reader): void {
        const count = reader.int32();
        reader.int32(); // unused

        for (let i = 0; i < count; i++) {
            const material: Material = { Layers: [] } as Material;

            reader.int32(); // material size inclusive
            material.PriorityPlane = reader.int32();

            const layersCount = reader.int32();

            for (let i = 0; i < layersCount; i++) {
                const startPos = reader.pos;
                const size = reader.int32();
                const layer: Layer = {} as Layer;

                layer.FilterMode = reader.int32();
                layer.Shading = reader.int32();
                layer.TextureID = reader.int32();
                layer.TVertexAnimId = reader.int32();
                layer.CoordId = reader.int32();
                layer.Alpha = reader.float();

                if (layer.TVertexAnimId === -1)
                    layer.TVertexAnimId = null;

                while (reader.pos < startPos + size) {
                    const keyword = reader.keyword();
                    switch (keyword) {
                        case "KMTA": layer.Alpha = reader.animVector(AnimVectorType.FLOAT1, layer.Alpha); break;
                        case "KMTF": layer.TextureID = reader.animVector(AnimVectorType.INT1, layer.TextureID); break;
                        default: throw new Error('Unknown layer chunk data ' + keyword);
                    }
                }

                material.Layers.push(layer);
            }

            model.Materials.push(material);
        }
    }

    private parseTextures(model: Model, reader: Reader, size: number) {
        const startPos = reader.pos;

        while (reader.pos < startPos + size) {
            const texture: Texture = {} as Texture;

            texture.ReplaceableId = reader.int32();
            texture.Image = reader.str(FILE_NAME_LENGTH);
            texture.Flags = reader.int32();

            if (!texture.Image)
                texture.Image = TextureReplacement[texture.ReplaceableId].toString();

            model.Textures.push(texture);
        }
    }

    private parseGeosets(model: Model, reader: Reader, _size: number, $this: ModelReader) {
        if (model.Version === 1500)
            $this.parseGeosetsNew(model, reader);
        else
            $this.parseGeosetsOld(model, reader);
    }

    private parseGeosetsOld(model: Model, reader: Reader) {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const geoset: Geoset = {} as Geoset;

            geoset.TVertices = [];
            geoset.Groups = [];
            geoset.Anims = [];

            reader.int32(); // geoset size

            reader.expectKeyword('VRTX', 'Incorrect geosets format');
            geoset.Vertices = reader.floatArray(reader.int32() * 3);

            reader.expectKeyword('NRMS', 'Incorrect geosets format');
            geoset.Normals = reader.floatArray(reader.int32() * 3);

            if (reader.hasKeyword("UVAS")) {
                const textureChunkCount = reader.int32();
                const tverticeGroupCount = geoset.Vertices.length / 3 * 2;

                for (let i = 0; i < textureChunkCount; i++) {
                    geoset.TVertices.push(reader.floatArray(tverticeGroupCount));
                }
            }

            reader.expectKeyword('PTYP', 'Incorrect geosets format');
            const primitiveCount = reader.int32();
            for (let i = 0; i < primitiveCount; i++) {
                if (reader.uint8() !== 4) {
                    throw new Error('Incorrect geosets format');
                }
            }

            reader.expectKeyword('PCNT', 'Incorrect geosets format');
            reader.int32Array(reader.int32()); // faceGroups

            reader.expectKeyword('PVTX', 'Incorrect geosets format');
            geoset.Faces = reader.uint16Array(reader.int32());

            reader.expectKeyword('GNDX', 'Incorrect geosets format');
            geoset.VertexGroup = reader.uint8Array(reader.int32());

            reader.expectKeyword('MTGC', 'Incorrect geosets format');
            const groupsCount = reader.int32();
            for (let i = 0; i < groupsCount; i++) {
                geoset.Groups[i] = new Array(reader.int32());
            }

            reader.expectKeyword('MATS', 'Incorrect geosets format');
            const totalGroupsCount = reader.int32();
            let groupIndex = 0, groupCounter = 0;
            for (let i = 0; i < totalGroupsCount; i++) {
                if (groupIndex >= geoset.Groups[groupCounter].length) {
                    groupIndex = 0;
                    groupCounter++;
                }
                geoset.Groups[groupCounter][groupIndex++] = reader.int32();
            }

            reader.expectKeyword('BIDX', 'Incorrect geosets format');
            reader.uint32Array(reader.int32()); // BoneIndices

            reader.expectKeyword('BWGT', 'Incorrect geosets format');
            reader.uint32Array(reader.int32()); // BoneWeights

            geoset.MaterialID = reader.int32();
            geoset.SelectionGroup = reader.int32();
            geoset.Flags = reader.int32();
            reader.extent(geoset);

            const geosetAnimCount = reader.int32();
            for (let i = 0; i < geosetAnimCount; i++) {
                const geosetAnim: GeosetAnimInfo = {} as GeosetAnimInfo;
                reader.extent(geosetAnim);
                geoset.Anims.push(geosetAnim);
            }

            model.Geosets.push(geoset);
        }
    }

    private parseGeosetsNew(model: Model, reader: Reader) {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const geoset: Geoset = {} as Geoset;

            geoset.TVertices = [];
            geoset.Groups = [];
            geoset.Anims = [];

            geoset.MaterialID = reader.int32();
            reader.floatArray(3); // boundsCenter
            geoset.BoundsRadius = reader.float();
            geoset.SelectionGroup = reader.int32();
            reader.int32(); // geoset index
            geoset.Flags = reader.int32();

            reader.expectKeyword('PVTX', 'Incorrect geosets format');
            const vertexCount = reader.int32();
            reader.expectKeyword('PTYP', 'Incorrect geosets format');
            reader.int32(); // primitiveTypeCount
            reader.expectKeyword('PVTX', 'Incorrect geosets format');
            reader.int32(); // primitiveVertexCount
            reader.pos += 8; // padding

            // create containers
            geoset.Vertices = new Float32Array(vertexCount * 3);
            geoset.Normals = new Float32Array(vertexCount * 3);
            geoset.VertexGroup = new Uint8Array(vertexCount);
            geoset.TVertices = [new Float32Array(vertexCount * 2)];

            model.Geosets.push(geoset);
        }

        for (let i = 0; i < count; i++) {
            const geoset = model.Geosets[i];
            const vertexCount = geoset.Vertices.length / 3;
            const boneLookup: string[] = [];

            for (let j = 0; j < vertexCount; j++) {
                geoset.Vertices.set(reader.floatArray(3), j * 3);
                reader.uint32(); // BoneWeights
                const boneIndicies = reader.uint8Array(4).join(','); // easier equality comparison
                geoset.Normals.set(reader.floatArray(3), j * 3);
                geoset.TVertices[0].set(reader.floatArray(2), j * 2);
                reader.pos += 8; // unused TVertex

                // calculate vertex group index
                let index = boneLookup.indexOf(boneIndicies);
                if (index === -1) {
                    index = boneLookup.length;
                    boneLookup.push(boneIndicies)
                }
                geoset.VertexGroup[j] = index;
            }

            // convert group names back to group index arrays
            // e.g. "0,1,0,0" => [0,1] NOT [0,1,0,0]
            geoset.Groups = boneLookup.map(b => b.replace(/(,0)+$/, '').split(',').map(Number))

            reader.int32(); // primative type
            reader.int32(); // unknown

            const numPrimVertices = reader.uint16();
            reader.uint16(); // minVertex
            reader.uint16(); // maxVertex
            reader.uint16(); // padding

            geoset.Faces = reader.uint16Array(numPrimVertices);

            if (numPrimVertices % 8)
                reader.pos += 2 * (8 - numPrimVertices % 8); // padding            
        }
    }

    private parseGeosetAnims(model: Model, reader: Reader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const animStartPos = reader.pos;
            const animSize = reader.int32();

            const geosetAnim: GeosetAnim = {} as GeosetAnim;

            geosetAnim.GeosetId = reader.int32();
            geosetAnim.Alpha = reader.float();
            geosetAnim.Color = reader.floatArray(3);
            geosetAnim.Flags = reader.int32();

            if (geosetAnim.GeosetId === -1)
                geosetAnim.GeosetId = null;

            while (reader.pos < animStartPos + animSize) {
                const keyword = reader.keyword();
                switch (keyword) {
                    case "KGAO": geosetAnim.Alpha = reader.animVector(AnimVectorType.FLOAT1, geosetAnim.Alpha); break;
                    case "KGAC": geosetAnim.Color = reader.animVector(AnimVectorType.FLOAT3, geosetAnim.Color); break;
                    default: throw new Error('Incorrect GeosetAnim chunk data ' + keyword);
                }
            }

            model.GeosetAnims.push(geosetAnim);
        }
    }

    private parseBones(model: Model, reader: Reader, _size: number, $this: ModelReader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const bone: Bone = {} as Bone;

            $this.parseNode(model, bone, reader);

            bone.GeosetId = reader.int32();
            bone.GeosetAnimId = reader.int32();

            if (bone.GeosetId === -1)
                bone.GeosetId = null;
            if (bone.GeosetAnimId === -1)
                bone.GeosetAnimId = null;

            model.Bones.push(bone);
        }
    }

    private parseHelpers(model: Model, reader: Reader, _size: number, $this: ModelReader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const helper: Helper = {} as Helper;
            $this.parseNode(model, helper, reader);
            model.Helpers.push(helper);
        }
    }

    private parseAttachments(model: Model, reader: Reader, _size: number, $this: ModelReader): void {
        const count = reader.int32();
        reader.int32(); // unused

        for (let i = 0; i < count; i++) {
            const attachment: Attachment = {} as Attachment;

            reader.int32(); // attachmentSize
            $this.parseNode(model, attachment, reader);
            attachment.AttachmentID = reader.int32();
            reader.uint8(); // padding
            attachment.Path = reader.str(FILE_NAME_LENGTH);
            attachment.Visibility = 1;

            if (reader.hasKeyword("KVIS"))
                attachment.Visibility = reader.animVector(AnimVectorType.FLOAT1);

            model.Attachments.push(attachment);
        }
    }

    private parsePivotPoints(model: Model, reader: Reader, size: number): void {
        const pointsCount = size / 12;
        for (let i = 0; i < pointsCount; i++) {
            model.PivotPoints[i] = reader.floatArray(3);
        }
    }

    private parseEventObjects(model: Model, reader: Reader, _size: number, $this: ModelReader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            reader.int32(); // size

            const eventObject: EventObject = {} as EventObject;
            $this.parseNode(model, eventObject, reader);

            if (reader.hasKeyword("KEVT")) {
                const eventTrackCount = reader.int32();
                eventObject.GlobalSeqId = reader.int32();
                eventObject.EventTrack = reader.int32Array(eventTrackCount);
            }

            model.EventObjects.push(eventObject);
        }
    }

    private parseHitTestShapes(model: Model, reader: Reader, _size: number, $this: ModelReader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            reader.int32(); // size

            const hitTestShape: HitTestShape = {} as HitTestShape;
            $this.parseNode(model, hitTestShape, reader);
            hitTestShape.Shape = reader.uint8();

            switch (hitTestShape.Shape) {
                case HitTestShapeType.Box: hitTestShape.Vertices = reader.floatArray(6); break;
                case HitTestShapeType.Cylinder: hitTestShape.Vertices = reader.floatArray(5); break;
                case HitTestShapeType.Sphere: hitTestShape.Vertices = reader.floatArray(4); break;
                case HitTestShapeType.Plane: hitTestShape.Vertices = reader.floatArray(2); break;
            }

            model.HitTestShapes.push(hitTestShape);
        }
    }

    private parseCollision(model: Model, reader: Reader): void {

        reader.expectKeyword('VRTX', 'Incorrect collision chunk data');
        model.Collision.Vertices = reader.floatArray(reader.int32() * 3);

        reader.expectKeyword('TRI ', 'Incorrect collision chunk data');
        model.Collision.TriIndices = reader.uint16Array(reader.int32());

        reader.expectKeyword('NRMS', 'Incorrect collision chunk data');
        model.Collision.FacetNormals = reader.floatArray(reader.int32() * 3);
    }

    private parseGlobalSequences(model: Model, reader: Reader, size: number): void {
        model.GlobalSequences = Array.from(reader.int32Array(size / 4));
    }

    private parseParticleEmitters(model: Model, reader: Reader, _size: number, $this: ModelReader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const emitterStart = reader.pos;
            const emitterSize = reader.int32();

            const emitter: ParticleEmitter = {} as ParticleEmitter;
            $this.parseNode(model, emitter, reader);

            emitter.EmissionRate = reader.float();
            emitter.Gravity = reader.float();
            emitter.Longitude = reader.float();
            emitter.Latitude = reader.float();
            emitter.Path = reader.str(FILE_NAME_LENGTH);
            emitter.LifeSpan = reader.float();
            emitter.InitVelocity = reader.float();
            emitter.Visibility = 1;

            while (reader.pos < emitterStart + emitterSize) {
                const keyword = reader.keyword();
                switch (keyword) {
                    case "KVIS": emitter.Visibility = reader.animVector(AnimVectorType.FLOAT1); break;
                    case "KPEE": emitter.EmissionRate = reader.animVector(AnimVectorType.FLOAT1, emitter.EmissionRate); break;
                    case "KPEG": emitter.Gravity = reader.animVector(AnimVectorType.FLOAT1, emitter.Gravity); break;
                    case "KPLN": emitter.Longitude = reader.animVector(AnimVectorType.FLOAT1, emitter.Longitude); break;
                    case "KPLT": emitter.Latitude = reader.animVector(AnimVectorType.FLOAT1, emitter.Latitude); break;
                    case "KPEL": emitter.LifeSpan = reader.animVector(AnimVectorType.FLOAT1, emitter.LifeSpan); break;
                    case "KPES": emitter.InitVelocity = reader.animVector(AnimVectorType.FLOAT1, emitter.InitVelocity); break;
                    default:
                        throw new Error('Incorrect particle emitter chunk data ' + keyword);
                }
            }

            model.ParticleEmitters.push(emitter);
        }
    }

    private parseParticleEmitters2(model: Model, reader: Reader, _size: number, $this: ModelReader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const emitterStart = reader.pos;
            const emitterSize = reader.int32();

            const emitter: ParticleEmitter2 = {} as ParticleEmitter2;
            $this.parseNode(model, emitter, reader);

            emitter.SegmentColor = [];
            emitter.Splines = [];
            emitter.FollowScale = new Float32Array(2);
            emitter.FollowSpeed = new Float32Array(2);

            reader.int32(); // emitter content size
            emitter.EmitterType = reader.int32();
            emitter.Speed = reader.float();
            emitter.Variation = reader.float();
            emitter.Latitude = reader.float();
            emitter.Longitude = reader.float();
            emitter.Gravity = reader.float();
            emitter.ZSource = reader.float();
            emitter.LifeSpan = reader.float();
            emitter.EmissionRate = reader.float();
            emitter.Length = reader.float();
            emitter.Width = reader.float();
            emitter.Rows = reader.int32();
            emitter.Columns = reader.int32();
            emitter.ParticleType = reader.int32() + 1;
            emitter.TailLength = reader.float();
            emitter.MiddleTime = reader.float();
            emitter.SegmentColor[0] = reader.floatArray(3); // start
            emitter.SegmentColor[1] = reader.floatArray(3); // middle
            emitter.SegmentColor[2] = reader.floatArray(3); // end
            emitter.Alpha = reader.uint8Array(3); // start, middle, end

            for (const part of ['ParticleScaling', 'LifeSpanUVAnim', 'DecayUVAnim', 'TailUVAnim', 'TailDecayUVAnim']) {
                emitter[part] = reader.floatArray(3); // start, middle, end
            }

            emitter.BlendMode = reader.int32();
            emitter.TextureID = reader.int32();
            emitter.PriorityPlane = reader.int32();
            emitter.ReplaceableId = reader.int32();
            emitter.GeometryModel = reader.str(FILE_NAME_LENGTH);
            emitter.RecursionModel = reader.str(FILE_NAME_LENGTH);
            emitter.TwinkleFps = reader.float();
            emitter.TwinkleOnOff = reader.float();
            emitter.TwinkleScale = reader.floatArray(2); // min/max
            emitter.IvelScale = reader.float();
            emitter.Tumble = reader.floatArray(6); // x min/max, y min/max, z min/max
            emitter.Drag = reader.float();
            emitter.Spin = reader.float();
            emitter.WindVector = reader.floatArray(3);
            emitter.WindTime = reader.float();

            for (let j = 0; j < 2; j++) {
                emitter.FollowSpeed[j] = reader.float();
                emitter.FollowScale[j] = reader.float();
            }

            const splineCount = reader.int32();
            for (let j = 0; j < splineCount; j++)
                emitter.Splines[j] = reader.floatArray(3);

            emitter.Squirt = reader.int32() > 0;
            emitter.Visibility = 1;

            if (emitter.TextureID === -1)
                emitter.TextureID = null;

            while (reader.pos < emitterStart + emitterSize) {
                const keyword = reader.keyword();
                switch (keyword) {
                    case "KP2S": emitter.Speed = reader.animVector(AnimVectorType.FLOAT1, emitter.Speed); break;
                    case "KP2R": emitter.Variation = reader.animVector(AnimVectorType.FLOAT1, emitter.Variation); break;
                    case "KP2G": emitter.Gravity = reader.animVector(AnimVectorType.FLOAT1, emitter.Gravity); break;
                    case "KP2W": emitter.Width = reader.animVector(AnimVectorType.FLOAT1, emitter.Width); break;
                    case "KP2N": emitter.Length = reader.animVector(AnimVectorType.FLOAT1, emitter.Length); break;
                    case "KVIS": emitter.Visibility = reader.animVector(AnimVectorType.FLOAT1); break;
                    case "KP2E": emitter.EmissionRate = reader.animVector(AnimVectorType.FLOAT1, emitter.EmissionRate); break;
                    case "KP2L": emitter.Latitude = reader.animVector(AnimVectorType.FLOAT1, emitter.Latitude); break;
                    case "KPLN": emitter.Longitude = reader.animVector(AnimVectorType.FLOAT1, emitter.Longitude); break;
                    case "KLIF": emitter.LifeSpan = reader.animVector(AnimVectorType.FLOAT1, emitter.LifeSpan); break;
                    case "KP2Z": emitter.ZSource = reader.animVector(AnimVectorType.FLOAT1, emitter.ZSource); break;
                    default: throw new Error('Incorrect particle emitter2 chunk data ' + keyword);
                }
            }

            model.ParticleEmitters2.push(emitter);
        }
    }

    private parseCameras(model: Model, reader: Reader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const cameraStart = reader.pos;
            const cameraSize = reader.int32();

            const camera: Camera = {} as Camera;
            camera.Name = reader.str(NAME_LENGTH);
            camera.Pivot = reader.floatArray(3);
            camera.FieldOfView = reader.float();
            camera.FarClip = reader.float();
            camera.NearClip = reader.float();
            camera.TargetPosition = reader.floatArray(3);
            camera.Visibility = 1;

            while (reader.pos < cameraStart + cameraSize) {
                const keyword = reader.keyword();
                switch (keyword) {
                    case "KVIS": camera.Visibility = reader.animVector(AnimVectorType.FLOAT1); break;
                    case "KCTR": camera.Translation = reader.animVector(AnimVectorType.FLOAT3); break;
                    case "KTTR": camera.TargetTranslation = reader.animVector(AnimVectorType.FLOAT3); break;
                    case "KCRL": camera.Rotation = reader.animVector(AnimVectorType.FLOAT1); break;
                    default: throw new Error('Incorrect camera chunk data ' + keyword);
                }
            }

            model.Cameras.push(camera);
        }
    }

    private parseLights(model: Model, reader: Reader, _size: number, $this: ModelReader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const lightStart = reader.pos;
            const lightSize = reader.int32();

            const light: Light = {} as Light;
            $this.parseNode(model, light, reader);
            light.LightType = reader.int32();
            light.AttenuationStart = reader.float();
            light.AttenuationEnd = reader.float();
            light.Color = reader.floatArray(3); // BGR
            light.Intensity = reader.float();
            light.AmbColor = reader.floatArray(3); // BGR
            light.AmbIntensity = reader.float();
            light.Visibility = 1;

            while (reader.pos < lightStart + lightSize) {
                const keyword = reader.keyword();
                switch (keyword) {
                    case "KLAS": light.AttenuationStart = reader.animVector(AnimVectorType.INT1, light.AttenuationStart); break;
                    case "KLAE": light.AttenuationEnd = reader.animVector(AnimVectorType.INT1, light.AttenuationEnd); break;
                    case "KLAC": light.Color = reader.animVector(AnimVectorType.FLOAT3, light.Color); break;
                    case "KLAI": light.Intensity = reader.animVector(AnimVectorType.FLOAT1, light.Intensity); break;
                    case "KLBC": light.AmbColor = reader.animVector(AnimVectorType.FLOAT3, light.AmbColor); break;
                    case "KLBI": light.AmbIntensity = reader.animVector(AnimVectorType.FLOAT1, light.AmbIntensity); break;
                    case "KVIS": light.Visibility = reader.animVector(AnimVectorType.FLOAT1); break;
                    default: throw new Error('Incorrect light chunk data ' + keyword);
                }
            }

            model.Lights.push(light);
        }
    }

    private parseTextureAnims(model: Model, reader: Reader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const animStart = reader.pos;
            const animSize = reader.int32();

            const anim: TVertexAnim = {} as TVertexAnim;

            while (reader.pos < animStart + animSize) {
                const keyword = reader.keyword();
                switch (keyword) {
                    case "KTAT": anim.Translation = reader.animVector(AnimVectorType.FLOAT3); break;
                    case "KTAR": anim.Rotation = reader.animVector(AnimVectorType.FLOAT4); break;
                    case "KTAS": anim.Scaling = reader.animVector(AnimVectorType.FLOAT3); break;
                    default: throw new Error('Incorrect light chunk data ' + keyword);
                }
            }

            model.TextureAnims.push(anim);
        }
    }

    private parseRibbonEmitters(model: Model, reader: Reader, _size: number, $this: ModelReader): void {
        const count = reader.int32();

        for (let i = 0; i < count; i++) {
            const emitterStart = reader.pos;
            const emitterSize = reader.int32();

            const emitter: RibbonEmitter = {} as RibbonEmitter;
            $this.parseNode(model, emitter, reader);
            reader.int32(); // emitter size
            emitter.HeightAbove = reader.float();
            emitter.HeightBelow = reader.float();
            emitter.Alpha = reader.float();
            emitter.Color = reader.floatArray(3); // BGR
            emitter.LifeSpan = reader.float();
            emitter.TextureSlot = reader.int32();
            emitter.EdgesPerSec = reader.int32();
            emitter.Rows = reader.int32();
            emitter.Columns = reader.int32();
            emitter.MaterialID = reader.int32();
            emitter.Gravity = reader.float();
            emitter.Visibility = 1;

            while (reader.pos < emitterStart + emitterSize) {
                const keyword = reader.keyword();

                switch (keyword) {
                    case "KVIS": emitter.Visibility = reader.animVector(AnimVectorType.FLOAT1); break;
                    case "KRHA": emitter.HeightAbove = reader.animVector(AnimVectorType.FLOAT1, emitter.HeightAbove); break;
                    case "KRHB": emitter.HeightBelow = reader.animVector(AnimVectorType.FLOAT1, emitter.HeightBelow); break;
                    case "KRAL": emitter.Alpha = reader.animVector(AnimVectorType.FLOAT1, emitter.Alpha); break;
                    case "KRTX": emitter.TextureSlot = reader.animVector(AnimVectorType.INT1, emitter.TextureSlot); break;
                    case "KRCO": emitter.Color = reader.animVector(AnimVectorType.FLOAT3, emitter.Color); break;
                    default: throw new Error('Incorrect ribbon emitter chunk data ' + keyword);
                }
            }

            model.RibbonEmitters.push(emitter);
        }
    }
}