import * as fs from 'fs';
import { inflate } from 'pako';
import { MpqEncryptionTable } from './encryption';
import { MPQFileHeader, MPQBlockTableEntry, MPQHashTableEntry } from './structs';
import implode from 'implode-decoder';

const x0b = 0x0Bn;
const x11111111 = 0x11111111n;
const x15 = 0x15n;
const x3 = 0x3n;
const x400 = 0x400n;
const x5 = 0x5n;
const xFF = 0xFFn;
const xFFFFFFFF = 0xFFFFFFFFn;

enum MpqHashType {
    TableOffset = 0,
    HashA = 1,
    HashB = 2,
    Table = 3,
}

enum MpqCompressionType {
    Huffman = 0x01,
    Zlib = 0x02,
    PkWare = 0x08,
    BZip2 = 0x10,
}

enum MpqFlags {
    Implode = 0x00000100,
    Compressed = 0x00000200,
    Encrypted = 0x00010000,
    EncryptionFix = 0x00020000,
    SingleUnit = 0x01000000,
    Crc = 0x04000000,
    Exists = 0x80000000,
}

enum MpqFormatVersion {
    Version1 = 0,
    Version2 = 1,
    Version3 = 2,
    Version4 = 3,
}

export class MpqFile {
    private _header: MPQFileHeader | null = null;
    private _fd: number | null = null;
    private hashTable: Map<string, MPQHashTableEntry>;
    private blockTable: MPQBlockTableEntry[];
    private fileName: string;

    constructor(fileName: string) {
        this.fileName = fileName;
    }

    get header(): MPQFileHeader {
        return this._header ?? (this._header = this.readHeader());
    }

    get fd(): number {
        return this._fd ?? (this._fd = fs.openSync(this.fileName, 'r'));
    }

    read(offset: number, byteCount: number): Buffer {
        const outputBuf = Buffer.allocUnsafe(byteCount);
        fs.readSync(this.fd, outputBuf, 0, byteCount, offset)
        return outputBuf;
    }

    close(): void {
        fs.closeSync(this._fd);
        this._fd = null;
    }

    private readHeader(): MPQFileHeader {
        const headerBuf = this.read(0, 32);
        const header = new MPQFileHeader(headerBuf);

        if (header.magic != 'MPQ\x1a')
            throw new Error('Only MPQ.magic 0x1a is supported');
        if (header.formatVersion !== MpqFormatVersion.Version1)
            throw new Error('Only MPQ.format 0x00 is supported');

        const hashTableSize = header.hashTableEntries * 16;
        const hashTableBuf = this.read(header.hashTableOffset, hashTableSize);
        this.decrypt(hashTableBuf, this.hash(`(hash table)`, MpqHashType.Table));

        const blockTableSize = header.blockTableEntries * 16;
        const blockTableBuf = this.read(header.blockTableOffset, blockTableSize);
        this.decrypt(blockTableBuf, this.hash(`(block table)`, MpqHashType.Table));

        const blockTable: MPQBlockTableEntry[] = [];
        for (let i = 0; i < header.blockTableEntries; i++)
            blockTable.push(new MPQBlockTableEntry(blockTableBuf, i * 16));

        this.blockTable = blockTable;

        const hashTable: Map<string, MPQHashTableEntry> = new Map();
        for (let i = 0; i < header.hashTableEntries; i++) {
            const entry = new MPQHashTableEntry(hashTableBuf, i * 16);
            const hashKey = `${entry.hashB}.${entry.hashA}`;
            hashTable.set(hashKey, entry);
        }

        this.hashTable = hashTable;
        return header;
    }

    private getFileEntry(fileName: string): MPQHashTableEntry | undefined {
        this.header;
        const hashA = this.hash(fileName, MpqHashType.HashA);
        const hashB = this.hash(fileName, MpqHashType.HashB);
        const hashKey = `${hashB}.${hashA}`;
        return this.hashTable.get(hashKey);
    }

    public exists(fileName: string): boolean {
        return this.getFileEntry(fileName) != null;
    }

    public extract(fileName: string): Buffer | null {
        const header = this.header;
        const hashEntry = this.getFileEntry(fileName);

        if (hashEntry == null)
            return null;

        const blockEntry = this.blockTable[hashEntry.blockTableIndex];

        if (blockEntry == null)
            return null;
        if ((blockEntry.flags & MpqFlags.Exists) == MpqFlags.Exists)
            return null;
        if (blockEntry.archivedSize == 0)
            return Buffer.alloc(0);
        if (blockEntry.size <= 1)
            return Buffer.alloc(1);

        const isEncrypted = (blockEntry.flags & MpqFlags.Encrypted) == MpqFlags.Encrypted;
        const isEncryptionFix = (blockEntry.flags & MpqFlags.EncryptionFix) == MpqFlags.EncryptionFix;

        // TODO Should really handle these flags
        if (blockEntry.flags & MpqFlags.SingleUnit)
            throw new Error('MPQ flag:SingleUnit not supported');
        if (blockEntry.flags & MpqFlags.Crc)
            throw new Error('MPQ flag:Crc not supported');

        let decryptionKey = -1;
        if (isEncrypted) {
            decryptionKey = this.decryptionKey(fileName);
            if (isEncryptionFix) {
                const fileKey = (BigInt(decryptionKey) + BigInt(blockEntry.offset)) ^ BigInt(blockEntry.size);
                decryptionKey = Number(fileKey);
            }
        }

        const sectorSize = 512 << header.sectorSizeShift;
        const sectors = Math.ceil(blockEntry.size / sectorSize);

        const fileData = this.read(blockEntry.offset, blockEntry.archivedSize);
        if (isEncrypted)
            this.decrypt(fileData, decryptionKey - 1, 0, (sectors + 1) * 4);

        const outputBuffer = Buffer.allocUnsafe(blockEntry.size);
        for (let i = 0; i < sectors; i++) {
            const currentOffset = fileData.readUInt32LE(i * 4);
            const nextOffset = fileData.readUInt32LE(i * 4 + 4);
            const currentSectorSize = nextOffset - currentOffset;

            if (nextOffset < currentOffset)
                throw new Error('Failed to read MPQ invalid sectors detected');
            if (currentSectorSize > sectorSize)
                throw new Error('Failed to read MPQ invalid sectors detected');
            if (currentOffset > blockEntry.archivedSize)
                throw new Error('Failed to read MPQ invalid sector overflow');

            // decrypt the sector if needed
            if (isEncrypted)
                this.decrypt(fileData, decryptionKey + i, currentOffset, currentSectorSize);

            // if the sector is not compressed just copy it
            if (currentSectorSize == sectorSize) {
                fileData.copy(outputBuffer, i * sectorSize, currentOffset, currentOffset + sectorSize);
                continue;
            }

            const decompressedBytes = this.decompressSector(fileData, currentOffset, currentSectorSize);
            decompressedBytes.copy(outputBuffer, i * sectorSize, 0, decompressedBytes.length);
        }

        // since we have decrypted it in place these blocks are no longer encrypted
        blockEntry.flags = blockEntry.flags & ~MpqFlags.Encrypted;
        return outputBuffer;
    }

    public decryptionKey(str: string): number {
        let lastIndex = str.length - 1;
        for (; lastIndex >= 0; lastIndex--) {
            const ch = str.charAt(lastIndex);
            if (ch == '\\') break;
            if (ch == '/') break;
        }
        return this.hash(str.slice(lastIndex + 1), MpqHashType.Table);
    }

    public hash(str: string, type: MpqHashType): number {
        // allow the use of '/' as a path separator
        if (str.includes('/') && !str.includes('\\'))
            str = str.replace(/\//g, '\\');

        str = str.toUpperCase();

        let seed1 = BigInt(0x7FED7FED);
        let seed2 = BigInt(0xEEEEEEEE);
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            const value = MpqEncryptionTable.get((type << 8) + ch);

            if (value == null)
                throw new Error('MPQ Unable to hash character: ' + ch);

            seed1 = (value ^ (seed1 + seed2)) & xFFFFFFFF;
            seed2 = (BigInt(ch) + seed1 + seed2 + (seed2 << x5) + x3) & xFFFFFFFF;
        }

        return Number(seed1);
    }

    public decrypt(data: Buffer, key: number, offset = 0, size = data.length): void {
        let seed1 = BigInt(key);
        let seed2 = 0xEEEEEEEEn;

        const itLen = Math.floor(size / 4);
        for (let i = 0; i < itLen; i++) {
            const encValue = MpqEncryptionTable.get(Number(x400 + (seed1 & xFF)));
            if (encValue == null)
                throw new Error('MPQ Unable to decrypt char: ' + Number(x400 + (seed1 & xFF)));

            seed2 += encValue;
            seed2 &= xFFFFFFFF;

            let bufValue = BigInt(data.readUInt32LE(offset + i * 4));
            bufValue = (bufValue ^ (seed1 + seed2)) & xFFFFFFFF;

            seed1 = ((~seed1 << x15) + x11111111) | (seed1 >> x0b);
            seed1 &= xFFFFFFFF;

            seed2 = (bufValue + seed2 + (seed2 << x5) + x3) & xFFFFFFFF;
            data.writeUInt32LE(Number(bufValue), offset + i * 4);
        }
    }

    private decompressSector(sector: Buffer, offset: number, size: number): Buffer {
        const compressionType = sector[offset];

        switch (compressionType) {
            case MpqCompressionType.PkWare:
                return this.decompressPkWare(sector, offset + 1, size - 1);
            case MpqCompressionType.Zlib:
                return this.decompressZlib(sector, offset + 1, size - 1);
            default:
                throw new Error(`Mpq.Compression: ${compressionType} ${MpqCompressionType[compressionType]} not supported`);
        }
    }

    private decompressPkWare(sector: Buffer, offset: number, size: number): Buffer {
        const buf = sector.slice(offset, offset + size);
        const buffers: Buffer[] = [];
        const decode = new implode();
        let res: Buffer;
        decode.push = (buffer: Buffer): unknown => buffers.push(buffer);
        decode._transform(buf, null, () => {
            decode._flush(() => res = Buffer.concat(buffers));
        });

        return res;
    }

    private decompressZlib(sector: Buffer, offset: number, size: number): Buffer {
        const buf = sector.slice(offset, offset + size);
        return Buffer.from(inflate(buf));
    }
}
