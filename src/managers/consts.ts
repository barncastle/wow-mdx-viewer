import { TextureReplacement } from '../formats/mdx/model';

export enum Regions {
    Skin = 0,
    SkinExtra = 1,
    CharHair = 2,
    Pelvis = 3,
    Torso = 4,
    FaceLower = 5,
    FaceUpper = 6,
    FacialHairLower = 7,
    FacialHairUpper = 8,
    ScalpLower = 9,
    ScalpUpper = 0xA
}

export class CharVariation {
    public raceId: number;
    public genderId: number;
    public skin: string[];
    public pelvis: string[];
    public torso: string[];
    public extra: string[];
    public faceLower: string[][];
    public faceUpper: string[][];
    public hair: string[][];
    public scalpLower: string[][];
    public scalpUpper: string[][];
    public facialHairLower: string[][];
    public facialHairUpper: string[][];

    constructor(raceId: number, genderId: number) {
        this.raceId = raceId;
        this.genderId = genderId;

        this.skin = [];
        this.pelvis = [];
        this.torso = [];
        this.extra = [];
        this.faceLower = [];
        this.faceUpper = [];
        this.hair = [];
        this.scalpLower = [];
        this.scalpUpper = [];
        this.facialHairLower = [];
        this.facialHairUpper = [];
    }

    public setTexture(array: string[][], variation: number, color: number, texture: string): void {
        if (typeof array[variation] === 'undefined')
            array[variation] = [];

        array[variation][color] = texture;
    }

    public getTexture(array: string[][], variation: number, color: number): string | null {
        return array[variation] ? array[variation][color] : null;
    }
}

export class TextureVariation {
    private textures: string[];

    constructor() {
        this.textures = new Array(0xF);
    }

    public set(type: TextureReplacement, filename: string): void {
        this.textures[type] = filename;
    }

    public get(type: TextureReplacement): string {
        return this.textures[type];
    }

    public toString = (): string => this.textures.join('').toUpperCase();
}