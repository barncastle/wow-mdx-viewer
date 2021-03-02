import { FileManager } from "../../managers/filemanager";

export class DBC {
    public readonly rowCount: number;
    public readonly fieldCount: number;
    public readonly rowSize: number;

    private readonly recordData: Buffer;
    private readonly stringData: Buffer;

    constructor(buffer: Buffer) {
        this.rowCount = buffer.readUInt32LE(4);
        this.fieldCount = buffer.readUInt32LE(8);
        this.rowSize = buffer.readUInt32LE(12);

        this.recordData = Buffer.alloc(this.rowCount * this.rowSize);
        this.stringData = Buffer.alloc(buffer.readUInt32LE(16));

        buffer.copy(this.recordData, 0, 20, 20 + this.recordData.length);
        buffer.copy(this.stringData, 0, 20 + this.recordData.length, buffer.length);
    }

    public static Load(filename: string): DBC | null {
        const file = FileManager.getInstance().getFile(filename);
        return file ? new DBC(file) : null;
    }

    public string(index: number, offset: number): string {
        const start = this.int(index, offset);
        const end = this.stringData.indexOf(0, start);
        return this.stringData.toString('utf-8', start, end);
    }

    public int(index: number, offset: number): number {
        const ptr = (index * this.rowSize) + (offset * 4);
        return this.recordData.readInt32LE(ptr);
    }

    public float(index: number, offset: number): number {
        const ptr = (index * this.rowSize) + (offset * 4);
        return this.recordData.readFloatLE(ptr);
    }

    public bool(index: number, offset: number): boolean {
        return this.int(index, offset) !== 0;
    }
}