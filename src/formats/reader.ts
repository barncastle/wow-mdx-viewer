import { AnimVector, AnimKeyframe, LineType } from './mdx/model';

const QUAT_MULTIPLIER = 0.00000095367432;
const defaultRotation = new Float32Array([0, 0, 0, 1]);
const x0 = 0n
const x11 = 11n;
const x22 = 22n;
const x42 = 42n;
const x43 = 43n;

export enum AnimVectorType {
    INT1,
    FLOAT1,
    FLOAT3,
    FLOAT4
}

export interface ObjWithExtent {
    BoundsRadius: number;
    MinimumExtent: Float32Array;
    MaximumExtent: Float32Array;
}

const animVectorSize = {
    [AnimVectorType.INT1]: 1,
    [AnimVectorType.FLOAT1]: 1,
    [AnimVectorType.FLOAT3]: 3,
    [AnimVectorType.FLOAT4]: 4
};

export class Reader {
    public pos: number;
    public length: number;

    private readonly buffer: Buffer;

    constructor(arrayBuffer: Buffer) {
        this.buffer = arrayBuffer;
        this.pos = 0;
        this.length = arrayBuffer.byteLength;
    }

    public keyword(): string {
        const res = String.fromCharCode(
            this.buffer[this.pos],
            this.buffer[this.pos + 1],
            this.buffer[this.pos + 2],
            this.buffer[this.pos + 3]
        );

        this.pos += 4;
        return res;
    }

    public expectKeyword(keyword: string, errorText: string): void {
        const word = this.keyword();
        if (word !== keyword) {
            throw new Error(errorText + ". Expected " + keyword) + " got " + word;
        }
    }

    public hasKeyword(keyword: string): boolean {
        if (this.keyword() != keyword) {
            this.pos -= 4;
            return false;
        }

        return true;
    }

    public uint8(): number {
        return this.buffer.readUInt8(this.pos++);
    }

    public uint16(): number {
        const res = this.buffer.readUInt16LE(this.pos);
        this.pos += 2;
        return res;
    }

    public int32(): number {
        const res = this.buffer.readInt32LE(this.pos);
        this.pos += 4;
        return res;
    }

    public uint32(): number {
        const res = this.buffer.readUInt32LE(this.pos);
        this.pos += 4;
        return res;
    }

    public float(): number {
        const res = this.buffer.readFloatLE(this.pos);
        this.pos += 4;
        return res;
    }

    public uint8Array(length: number): Uint8Array {
        return Uint8Array.from({ length: length }, () => this.uint8());
    }

    public uint16Array(length: number): Uint16Array {
        return Uint16Array.from({ length: length }, () => this.uint16());
    }

    public int32Array(length: number): Int32Array {
        return Int32Array.from({ length: length }, () => this.int32());
    }

    public uint32Array(length: number): Uint32Array {
        return Uint32Array.from({ length: length }, () => this.uint32());
    }

    public floatArray(length: number): Float32Array {
        return Float32Array.from({ length: length }, () => this.float());
    }

    public str(length: number): string {
        const index = Math.min(this.buffer.indexOf(0, this.pos), this.pos + length);
        const res = this.buffer.toString('utf-8', this.pos, index);
        this.pos += length;
        return res;
    }

    public extent(obj: ObjWithExtent): void {
        obj.BoundsRadius = this.float();
        obj.MinimumExtent = this.floatArray(3);
        obj.MaximumExtent = this.floatArray(3);
    }

    public animVector(type: AnimVectorType, value: AnimVector | number | Float32Array | null = null): AnimVector {
        const res: AnimVector = { Keys: [] } as AnimVector;
        const vectorSize = animVectorSize[type];

        const keysCount = this.int32();
        res.LineType = this.int32();
        res.GlobalSeqId = this.int32();

        if (res.GlobalSeqId === -1)
            res.GlobalSeqId = null;

        for (let i = 0; i < keysCount; i++) {
            const animKeyFrame: AnimKeyframe = {} as AnimKeyframe;
            animKeyFrame.Frame = this.int32();

            switch (type) {
                case AnimVectorType.INT1:
                    animKeyFrame.Vector = this.int32Array(vectorSize);
                    break;
                case AnimVectorType.FLOAT4:
                    animKeyFrame.Vector = this.quaternion();
                    break;
                default:
                    animKeyFrame.Vector = this.floatArray(vectorSize);
                    break;
            }

            if (res.LineType === LineType.Hermite || res.LineType === LineType.Bezier) {
                switch (type) {
                    case AnimVectorType.INT1:
                        animKeyFrame.InTan = this.int32Array(vectorSize);
                        animKeyFrame.OutTan = this.int32Array(vectorSize);
                        break;
                    case AnimVectorType.FLOAT4:
                        animKeyFrame.InTan = this.quaternion();
                        animKeyFrame.OutTan = this.quaternion();
                        break;
                    default:
                        animKeyFrame.InTan = this.floatArray(vectorSize);
                        animKeyFrame.OutTan = this.floatArray(vectorSize);
                        break;
                }
            }

            res.Keys.push(animKeyFrame);
        }

        // load the static value or first frame
        if (vectorSize === 1)
            res.Default = (value ?? res.Keys[0].Vector[0]) as number;
        else
            res.Default = (value ?? res.Keys[0].Vector) as Float32Array;

        // special case for KVIS with single keys
        // presume the static value is an inversion
        if (type === AnimVectorType.FLOAT1 && res.Keys.length === 1 && value === null)
            res.Default = res.Keys[0].Vector[0] ^ 1;

        return res;
    }

    private quaternion(): Float32Array {

        const val = this.buffer.readBigInt64LE(this.pos);
        this.pos += 8;

        // shortcut to save on bigint processing
        if (val === x0)
            return defaultRotation;

        const res = new Float32Array(4);
        const x = res[0] = Number(val >> x42) * (QUAT_MULTIPLIER / 2.0);
        const y = res[1] = Number(BigInt.asIntN(64, val << x22) >> x43) * QUAT_MULTIPLIER;
        const z = res[2] = Number(BigInt.asIntN(32, val << x11) >> x11) * QUAT_MULTIPLIER;

        const len = 1.0 - (x * x + y * y + z * z);
        if (len >= QUAT_MULTIPLIER) {
            res[3] = Math.sqrt(len);
        }

        return res;
    }
}
