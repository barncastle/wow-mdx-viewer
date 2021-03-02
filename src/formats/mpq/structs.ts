export class MPQFileHeader {
  public magic: string;
  public headerSize: number;
  public archiveSize: number;
  public formatVersion: number;
  public sectorSizeShift: number;
  public hashTableOffset: number;
  public blockTableOffset: number;
  public hashTableEntries: number;
  public blockTableEntries: number;

  constructor(data: Buffer) {
    this.magic = data.toString('utf8', 0, 4);
    this.headerSize = data.readUInt32LE(4);
    this.archiveSize = data.readUInt32LE(8);
    this.formatVersion = data.readUInt16LE(12);
    this.sectorSizeShift = data.readUInt16LE(14);
    this.hashTableOffset = data.readUInt32LE(16);
    this.blockTableOffset = data.readUInt32LE(20);
    this.hashTableEntries = data.readUInt32LE(24);
    this.blockTableEntries = data.readUInt32LE(28);
  }
}

export class MPQHashTableEntry {
  public hashA: number;
  public hashB: number;
  public locale: number;
  public platform: number;
  public blockTableIndex: number;

  constructor(data: Buffer, pos: number) {
    this.hashA = data.readUInt32LE(0 + pos);
    this.hashB = data.readUInt32LE(4 + pos);
    this.locale = data.readUInt16LE(8 + pos);
    this.platform = data.readUInt16LE(10 + pos);
    this.blockTableIndex = data.readUInt32LE(12 + pos);
  }
}

export class MPQBlockTableEntry {
  public offset: number;
  public archivedSize: number;
  public size: number;
  public flags: number;

  constructor(data: Buffer, pos: number) {
    this.offset = data.readUInt32LE(0 + pos);
    this.archivedSize = data.readUInt32LE(4 + pos);
    this.size = data.readUInt32LE(8 + pos);
    this.flags = data.readUInt32LE(12 + pos);
  }
}