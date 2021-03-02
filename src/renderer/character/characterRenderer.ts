import { ModelRenderer } from "../model/modelRenderer";
import { TextureComposer } from "./textureComposer";
import * as path from 'path';
import { CharacterManager } from "../../managers/charactermanager";
import { Regions } from "../../managers/consts";

const TexRegions = [
    [0x00, 0xA0, 0x80, 0x20], // face upper
    [0x00, 0xC0, 0x80, 0x40], // face lower
    [0x80, 0x00, 0x80, 0x40], // torso upper
    [0x80, 0x40, 0x80, 0x20], // torso lower
    [0x80, 0x60, 0x80, 0x40], // leg upper
    [0x80, 0xA0, 0x80, 0x40], // leg lower
];

const RelYTexCoord = 0xA0;
const DefaultGeosets = [0, 101, 201, 301, 401, 501, 702, 801, 901, 1001, 1101, 1201, 1301, 1401, 1501];

export class CharacterRenderer {
    public readonly model: string;

    private _skinColor = 0;
    private _faceType = 0;
    private _hairStyle = 0;
    private _hairColor = 0;
    private _facialHairStyle = 0;
    private _facialHairColor = 0;

    private readonly renderer: ModelRenderer;
    private readonly faceComposer: TextureComposer;
    private readonly textureUpdate: Set<Regions>;
    private readonly prevRegionMap: Map<Regions, string>;

    constructor(modelRenderer: ModelRenderer) {
        this.renderer = modelRenderer;
        this.faceComposer = new TextureComposer(0x80, 0x60);
        this.model = this.normalizePath(this.renderer.model.Filename);
        this.prevRegionMap = new Map<Regions, string>();

        this.textureUpdate = new Set<Regions>([
            Regions.CharHair,
            Regions.FaceLower,
            Regions.FaceUpper,
            Regions.FacialHairLower,
            Regions.FacialHairUpper,
            Regions.ScalpLower,
            Regions.ScalpUpper,
            Regions.Skin
        ]);

        this.updateGeosets();
    }

    //#region Props    
    public get skinColor(): number { return this._skinColor; }

    public set skinColor(value: number) {
        this._skinColor = value;
        this.textureUpdate.add(Regions.Skin);
        this.textureUpdate.add(Regions.FaceUpper);
        this.textureUpdate.add(Regions.FaceLower);
        this.updateTextures();
    }

    public get faceType(): number { return this._faceType; }

    public set faceType(value: number) {
        this._faceType = value;
        this.textureUpdate.add(Regions.FaceUpper);
        this.textureUpdate.add(Regions.FaceLower);
        this.updateTextures();
        this.updateGeosets();
    }

    public get hairStyle(): number { return this._hairStyle; }

    public set hairStyle(value: number) {
        this._hairStyle = value;
        this.textureUpdate.add(Regions.CharHair);
        this.textureUpdate.add(Regions.ScalpLower);
        this.textureUpdate.add(Regions.ScalpUpper);
        this.updateTextures();
        this.updateGeosets();
    }

    public get hairColor(): number { return this._hairColor; }

    public set hairColor(value: number) {
        this._hairColor = value;
        this.textureUpdate.add(Regions.CharHair);
        this.textureUpdate.add(Regions.ScalpLower);
        this.textureUpdate.add(Regions.ScalpUpper);
        this.updateTextures();
    }

    public get facialHairStyle(): number { return this._facialHairStyle; }

    public set facialHairStyle(value: number) {
        this._facialHairStyle = value;
        this.textureUpdate.add(Regions.FacialHairLower);
        this.textureUpdate.add(Regions.FacialHairUpper);
        this.updateTextures();
        this.updateGeosets();
    }

    public get facialHairColor(): number { return this._facialHairColor; }

    public set facialHairColor(value: number) {
        this._facialHairColor = value;
        this.textureUpdate.add(Regions.FacialHairLower);
        this.textureUpdate.add(Regions.FacialHairUpper);
        this.updateTextures();
    }

    //#endregion

    public updateGeosets(): void {
        const wanted = [
            ...DefaultGeosets,
            ...CharacterManager.getInstance().getFacialHairGeosets(this),
            ...CharacterManager.getInstance().getHairGeosets(this)
        ];

        for (let i = 0; i < this.renderer.model.Geosets.length; i++) {
            const group = this.renderer.model.Geosets[i].SelectionGroup;
            this.renderer.enableGeosets(wanted.includes(group), group);
        }
    }

    public updateTextures(): void {
        if (this.textureUpdate.size === 0)
            return;

        const textureMap = CharacterManager.getInstance().getTextureRegions(this);

        if (this.textureUpdate.has(Regions.Skin)) {
            this.renderer.setTexture("Skin", textureMap.get(Regions.Skin), 0);
            this.renderer.setTexture("SkinExtra", textureMap.get(Regions.SkinExtra), 0);
            this.renderer.combineTexture("Skin", textureMap.get(Regions.Pelvis), TexRegions[4][0], TexRegions[4][1]);
            this.renderer.combineTexture("Skin", textureMap.get(Regions.Torso), TexRegions[2][0], TexRegions[2][1]);
        }

        if (this.textureUpdate.has(Regions.CharHair))
            this.renderer.setTexture("CharHair", textureMap.get(Regions.CharHair), 0);

        for (const value in Regions) {
            const key = Regions[value as keyof typeof Regions];
            if (!this.textureUpdate.has(key))
                continue;

            // update face components
            if (key >= Regions.FaceLower) {
                const layer = key - Regions.FaceLower;
                const texRegion = TexRegions[key & 1]; // 0: faceupper, 1: facelower

                if (textureMap.get(key)) {
                    this.faceComposer.setLayer(
                        textureMap.get(key),
                        texRegion[0],
                        texRegion[1] - RelYTexCoord,
                        layer
                    );
                } else {
                    this.faceComposer.removeLayer(layer);
                }
            }
        }

        this.faceComposer.render(this.renderer, "Skin", TexRegions[0][0], TexRegions[0][1]);
        this.textureUpdate.clear();
    }

    private normalizePath(filename: string) {
        return path.parse(filename).name.toUpperCase();
    }
}