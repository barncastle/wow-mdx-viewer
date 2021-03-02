import { FileManager } from '../../managers/filemanager';
import { Reader } from '../reader'

export interface BLPImage {
    width: number;
    height: number;
    encoding: BLPColorEncoding;
    alphaBits: number;
    mipmaps: BLPMipMap[];
    data: ArrayBuffer;
}

enum BLPColorEncoding {
    JPEG = 0,
    PALETTE = 1,
    DXT = 2,
    ARGB8888 = 3,
    ARGB8888_dup = 4,
}

interface BLPMipMap {
    offset: number;
    size: number;
}

enum DXT {
    DXT1 = 0x1,
    DXT3 = 0x2,
    DXT5 = 0x4,
}

enum BLPPixelFormat {
    DXT1 = 0,
    DXT3 = 1,
    ARGB8888 = 2,
    ARGB1555 = 3,
    ARGB4444 = 4,
    RGB565 = 5,
    A8 = 6,
    DXT5 = 7,
    UNSPECIFIED = 8,
    ARGB2565 = 9,
    BC5 = 11, // DXGI_FORMAT_BC5_UNORM 
}

export class BLP {

    public readonly filename: string;
    public readonly info: BLPImage;
    private readonly reader: Reader;

    private alphaDepth: number;
    private format: BLPPixelFormat;
    private palette: number[];

    public constructor(filename: string, arrayBuffer: Buffer) {
        this.filename = filename;
        this.reader = new Reader(arrayBuffer);
        this.palette = [];

        this.info = {
            width: 0,
            height: 0,
            encoding: BLPColorEncoding.PALETTE,
            alphaBits: 0,
            mipmaps: [],
            data: arrayBuffer,
        } as BLPImage;

        const type = this.reader.keyword();
        if (type !== 'BLP2')
            throw new Error('Not a blp image - ' + type);

        if (this.reader.uint32() !== 1)
            throw new Error("Invalid version");

        this.info.encoding = this.reader.uint8();
        this.alphaDepth = this.reader.uint8();
        this.format = this.reader.uint8();
        this.reader.uint8(); // mipsType

        this.info.width = this.reader.uint32();
        this.info.height = this.reader.uint32();

        const mipOffsets = this.reader.uint32Array(16);
        const mipSizes = this.reader.uint32Array(16);

        for (let i = 0; i < mipOffsets.length; i++) {
            if (mipOffsets[i] != 0) {
                this.info.mipmaps.push({
                    offset: mipOffsets[i],
                    size: mipSizes[i]
                });
            }
        }

        if (this.info.encoding === BLPColorEncoding.PALETTE) {
            this.palette = Array.from(this.reader.uint8Array(256 * 4));
        }
    }

    public static Load(filename: string): BLP | null {
        const file = FileManager.getInstance().getFile(filename);
        return file ? new BLP(filename, file) : null;
    }

    public getImageData(mipmapLevel: number): ImageData {
        const mipmap = this.info.mipmaps[mipmapLevel];
        const width = Math.max(this.info.width / (1 << mipmapLevel), 1);
        const height = Math.max(this.info.height / (1 << mipmapLevel), 1);
        const imageData = new ImageData(width, height);

        this.reader.pos = mipmap.offset;
        const raw = this.reader.uint8Array(mipmap.size);

        switch (this.info.encoding) {
            case BLPColorEncoding.PALETTE:
                return this.getUncompressed(raw, imageData);
            case BLPColorEncoding.DXT:
                return this.getCompressed(raw, imageData);
            case BLPColorEncoding.ARGB8888:
            case BLPColorEncoding.ARGB8888_dup:
                return this.getBGRA(raw, imageData);
            default:
                throw 'Unsupported BLP2 encoding';
        }
    }

    private getUncompressed(raw: Uint8Array, imageData: ImageData): ImageData {
        const size = imageData.width * imageData.height;
        const valPerAlphaBit = 0xFF / ((1 << Math.max(this.alphaDepth, 1)) - 1);

        for (let i = 0; i < size; i++) {
            const paletteIndex = raw[i] * 4;
            imageData.data[i * 4] = this.palette[paletteIndex + 2];
            imageData.data[i * 4 + 1] = this.palette[paletteIndex + 1];
            imageData.data[i * 4 + 2] = this.palette[paletteIndex];
            imageData.data[i * 4 + 3] = this.getAlpha(raw, i) * valPerAlphaBit;
        }

        return imageData;
    }

    private getCompressed(raw: Uint8Array, imageData: ImageData): ImageData {
        const flags = this.alphaDepth > 1 ? (this.format === BLPPixelFormat.DXT5 ? DXT.DXT5 : DXT.DXT3) : DXT.DXT1;
        const blockSize = flags === DXT.DXT1 ? 8 : 16;
        const block = new Array(4 * 16);
        let pos = 0;

        for (let y = 0; y < imageData.height; y += 4) {
            for (let x = 0; x < imageData.width; x += 4) {

                if (raw.length === pos)
                    continue;

                const colours = [];
                const colourIndex = flags === DXT.DXT1 ? pos : pos + 8;
                const a = this.decompressColour(raw, colourIndex, 0, colours, 0);
                const b = this.decompressColour(raw, colourIndex, 2, colours, 4);

                for (let i = 0; i < 3; i++) {
                    const c = colours[i];
                    const d = colours[i + 4];

                    if (flags === DXT.DXT1 && a <= b) {
                        colours[i + 8] = (c + d) / 2;
                        colours[i + 12] = 0;
                    } else {
                        colours[i + 8] = (2 * c + d) / 3;
                        colours[i + 12] = (c + 2 * d) / 3;
                    }
                }

                colours[8 + 3] = 0xFF;
                colours[12 + 3] = (flags === DXT.DXT1 && a <= b) ? 0 : 0xFF;

                const index = [];
                for (let i = 0; i < 4; i++) {
                    const packed = raw[colourIndex + 4 + i];
                    index[i * 4] = packed & 0x3;
                    index[1 + i * 4] = (packed >> 2) & 0x3;
                    index[2 + i * 4] = (packed >> 4) & 0x3;
                    index[3 + i * 4] = (packed >> 6) & 0x3;
                }

                for (let i = 0; i < 16; i++) {
                    const ofs = index[i] * 4;
                    block[4 * i] = colours[ofs];
                    block[4 * i + 1] = colours[ofs + 1];
                    block[4 * i + 2] = colours[ofs + 2];
                    block[4 * i + 3] = colours[ofs + 3];
                }

                // DXT3 unpack
                if (flags === DXT.DXT3) {
                    for (let i = 0; i < 8; i++) {
                        const low = (raw[pos + i] & 0x0F);
                        const high = (raw[pos + i] & 0xF0);

                        block[8 * i + 3] = (low | (low << 4));
                        block[8 * i + 7] = (high | (high >> 4));
                    }
                }

                // DXT5 unpack
                if (flags === DXT.DXT5) {
                    const a0 = raw[pos];
                    const a1 = raw[pos + 1];

                    const colours = [];
                    colours[0] = a0;
                    colours[1] = a1;
                    colours[6] = 0;
                    colours[7] = 255;

                    const roll = a0 <= a1 ? 5 : 7;
                    for (let i = 1; i < roll; i++)
                        colours[i + 1] = (((roll - i) * a0 + i * a1) / roll) | 0;

                    const indices = [];
                    let blockPos = 2;
                    let indicesPos = 0;

                    for (let i = 0; i < 2; i++) {
                        let value = 0;

                        for (let j = 0; j < 3; j++)
                            value |= (raw[pos + blockPos++] << 8 * j);

                        for (let j = 0; j < 8; j++)
                            indices[indicesPos++] = (value >> 3 * j) & 0x07;
                    }

                    for (let i = 0; i < 16; i++)
                        block[4 * i + 3] = colours[indices[i]];
                }

                // copy to result data
                let blockPos = 0;
                for (let pY = 0; pY < 4; pY++) {
                    for (let pX = 0; pX < 4; pX++) {
                        const sX = x + pX;
                        const sY = y + pY;

                        if (sX < imageData.width && sY < imageData.height) {
                            const pixel = 4 * (imageData.width * sY + sX);
                            for (let i = 0; i < 4; i++)
                                imageData.data[pixel + i] = block[blockPos + i];
                        }

                        blockPos += 4;
                    }
                }

                pos += blockSize;
            }
        }

        return imageData;
    }

    private getBGRA(raw: Uint8Array, imageData: ImageData): ImageData {
        const size = raw.length / 4;

        // remap to RGBA
        for (let i = 0; i < size; i++) {
            const paletteIndex = i * 4;
            imageData[i * 4] = raw[paletteIndex + 2];
            imageData[i * 4 + 1] = raw[paletteIndex + 1];
            imageData[i * 4 + 2] = raw[paletteIndex];
            imageData[i * 4 + 3] = raw[paletteIndex + 3];
        }

        return imageData;
    }

    private getAlpha(data: Uint8Array, index: number): number {
        if (this.alphaDepth === 0)
            return 1; // result is multiplied by 0xFF

        const byte = data[Math.floor(index * this.alphaDepth / 8)];
        const valsPerByte = 8 / this.alphaDepth;
        return (byte >> (valsPerByte - index % valsPerByte - 1)) & ((1 << this.alphaDepth) - 1);
    }

    private decompressColour(data: Uint8Array, index: number, offset: number, buffer: number[], bufferOffset: number): number {
        const value = data[index + offset] | (data[index + 1 + offset] << 8);
        const r = (value >> 11) & 0x1F;
        const g = (value >> 5) & 0x3F;
        const b = value & 0x1F;

        buffer[bufferOffset] = (r << 3) | (r >> 2);
        buffer[bufferOffset + 1] = (g << 2) | (g >> 4);
        buffer[bufferOffset + 2] = (b << 3) | (b >> 2);
        buffer[bufferOffset + 3] = 255;

        return value;
    }
}

