import { FileManager } from './filemanager';
import { DBC } from '../formats/dbc/dbc';
import { TextureVariation, CharVariation, Regions } from './consts';
import { Model, TextureReplacement } from '../formats/mdx/model';
import { ITextureManager } from './itexturemanager';
import { CharacterRenderer } from '../renderer/character/characterRenderer';
import * as path from 'path';

const CharHairGeosets = "DBFilesClient\\CharHairGeosets.dbc";
const CharFacialHairStyles = "DBFilesClient\\CharacterFacialHairStyles.dbc";
const CharSections = "DBFilesClient\\CharSections.dbc";
const CharTextureVariationsV2 = "DBFilesClient\\CharTextureVariationsV2.dbc";

const Genders = ["MALE", "FEMALE"];
const Races = ["", "HUMAN", "ORC", "DWARF", "NIGHTELF", "SCOURGE", "TAUREN", "GNOME", "TROLL"];
const EmptyMap = [0];

interface StyleOptions {
    numSkinColor: number;
    numFaceType: number;
    numHairColor: number;
    numHairType: number;
    numFacialHairType: number;
    numFacialHairColor: number;
}

export class CharacterManager implements ITextureManager {
    private static instance: CharacterManager;

    private modelMap: Map<string, CharVariation>;
    private hairMap: Map<string, number[][]>;
    private facialHairMap: Map<string, number[][]>;
    private nakedByDefault: boolean;

    // eslint-disable-next-line
    private constructor() { }

    static getInstance(): CharacterManager {
        return this.instance ?? (this.instance = new this());
    }

    public load(): void {
        this.modelMap = this.getModelMap();
        this.hairMap = this.getHairMap();
        this.facialHairMap = this.getFacialHairMap();
    }

    public exists(filename: string): boolean {
        return this.modelMap.has(this.normalizePath(filename));
    }

    public getTextures(model: Model): TextureVariation[] {
        const map = [];
        const filename = this.normalizePath(model.Filename);
        const variations = this.modelMap.get(filename);

        for (let i = 0; i < variations.skin.length; i++) {
            const entry = new TextureVariation();
            entry.set(TextureReplacement.Skin, variations.skin[i]);
            entry.set(TextureReplacement.SkinExtra, variations.extra[i]);
            entry.set(TextureReplacement.CharHair, variations.getTexture(variations.hair, 0, 0));
            map.push(entry);
        }

        return map;
    }

    public getStyleOptions(character: CharacterRenderer): StyleOptions {
        const variations = this.modelMap.get(character.model);
        const facialHair = this.facialHairMap.get(character.model)

        return {
            numSkinColor: variations.skin.length - 1,
            numFaceType: variations.faceLower.length - 1,
            numHairColor: variations.hair[character.hairStyle]?.length - 1 ?? 0,
            numHairType: variations.hair.length - 1,
            numFacialHairType: facialHair.length - 1,
            numFacialHairColor: facialHair[character.facialHairStyle]?.length - 1 ?? 0
        } as StyleOptions;
    }

    public getHairGeosets(character: CharacterRenderer): number[] {
        const map = this.hairMap.get(character.model);
        return map ? map[character.hairStyle] : EmptyMap;
    }

    public getFacialHairGeosets(character: CharacterRenderer): number[] {
        const map = this.facialHairMap.get(character.model)
        return map ? map[character.facialHairStyle] : EmptyMap;
    }

    public getTextureRegions(character: CharacterRenderer): Map<Regions, string> {
        const regionMap = new Map<Regions, string>();
        const variations = this.modelMap.get(character.model);

        regionMap.set(Regions.Skin, variations.skin[character.skinColor]);
        regionMap.set(Regions.SkinExtra, variations.extra[character.skinColor]);

        if (this.nakedByDefault) {
            regionMap.set(Regions.Pelvis, variations.pelvis[character.skinColor]);
            regionMap.set(Regions.Torso, variations.torso[character.skinColor]);
        }

        regionMap.set(Regions.FaceLower, variations.getTexture(
            variations.faceLower, character.faceType, character.skinColor));
        regionMap.set(Regions.FaceUpper, variations.getTexture(
            variations.faceUpper, character.faceType, character.skinColor));

        //if (facialhair[0] % 100 || facialhair[1] % 100 || facialhair[2] % 100) {
        regionMap.set(Regions.FacialHairLower, variations.getTexture(
            variations.facialHairLower, character.facialHairStyle, character.facialHairColor));
        regionMap.set(Regions.FacialHairUpper, variations.getTexture(
            variations.facialHairUpper, character.facialHairStyle, character.facialHairColor));
        //}

        //if (hairgeoset[0] || hairgeoset[1]) {
        regionMap.set(Regions.CharHair, variations.getTexture(
            variations.hair, character.hairStyle, character.hairColor));
        regionMap.set(Regions.ScalpLower, variations.getTexture(
            variations.scalpLower, character.hairStyle, character.hairColor));
        regionMap.set(Regions.ScalpUpper, variations.getTexture(
            variations.scalpUpper, character.hairStyle, character.hairColor));
        //}

        return regionMap;
    }

    private getHairMap(): Map<string, number[][]> {
        const map = new Map<string, number[][]>();
        const variations = DBC.Load(CharHairGeosets);

        for (let i = 0; i < variations.rowCount; i++) {
            const raceId = variations.int(i, 1);
            const genderId = variations.int(i, 2);
            const variation = variations.int(i, 3);

            const key = Races[raceId] + Genders[genderId];
            const entry = map.get(key) || [];
            entry[variation] = [variations.int(i, 4), variations.int(i, 5)]; // [hair, scalp]
            map.set(key, entry);
        }

        return map;
    }

    private getFacialHairMap(): Map<string, number[][]> {
        const map = new Map<string, number[][]>();
        const variations = DBC.Load(CharFacialHairStyles);
        const alpha = variations.fieldCount === 6;

        for (let i = 0; i < variations.rowCount; i++) {
            const raceId = variations.int(i, 0);
            const genderId = variations.int(i, 1);
            const variation = variations.int(i, 2);

            const key = Races[raceId] + Genders[genderId];
            const entry = map.get(key) || [];

            if (alpha) {
                entry[variation] = [
                    100 + variations.int(i, 3), // beard
                    300 + variations.int(i, 4), // moustache
                    200 + variations.int(i, 5)  // sideburn
                ];
            } else {
                entry[variation] = [
                    100 + variations.int(i, 6), // beard
                    300 + variations.int(i, 8), // moustache
                    200 + variations.int(i, 7)  // sideburn
                ];
            }

            map.set(key, entry);
        }

        return map;
    }

    private getModelMap(): Map<string, CharVariation> {
        if (FileManager.getInstance().exists(CharTextureVariationsV2)) {
            this.nakedByDefault = false;
            return this.getAlphaModelMap();
        }
        else {
            this.nakedByDefault = true;
            return this.getBetaModelMap();
        }
    }

    private getAlphaModelMap(): Map<string, CharVariation> {
        const map = new Map<string, CharVariation>();
        const variations = DBC.Load(CharTextureVariationsV2);

        for (let i = 0; i < variations.rowCount; i++) {
            if (variations.int(i, 6) === 1) // isnpc
                continue;

            const raceId = variations.int(i, 1);
            const genderId = variations.int(i, 2);
            const variation = variations.int(i, 4);
            const color = variations.int(i, 5);
            const texture = this.normalizeTexture(variations.string(i, 7));

            const key = Races[raceId] + Genders[genderId];
            const entry = map.get(key) || new CharVariation(raceId, genderId);

            switch (variations.int(i, 3)) { // section id
                case 0x0: entry.skin[color] = texture; break;
                case 0x1: entry.pelvis[color] = texture; break;
                case 0x2: entry.torso[color] = texture; break;
                case 0x3: entry.extra[color] = texture; break;
                case 0x4: entry.setTexture(entry.faceLower, variation, color, texture); break;
                case 0x5: entry.setTexture(entry.faceUpper, variation, color, texture); break;
                case 0x6: entry.setTexture(entry.hair, variation, color, texture); break;
                case 0x7: entry.setTexture(entry.scalpLower, variation, color, texture); break;
                case 0x8: entry.setTexture(entry.scalpUpper, variation, color, texture); break;
                case 0x9: entry.setTexture(entry.facialHairLower, variation, color, texture); break;
                case 0xA: entry.setTexture(entry.facialHairUpper, variation, color, texture); break;
            }

            map.set(key, entry);
        }

        return map;
    }

    private getBetaModelMap(): Map<string, CharVariation> {
        const map = new Map<string, CharVariation>();
        const variations = DBC.Load(CharSections);

        for (let i = 0; i < variations.rowCount; i++) {
            if (variations.int(i, 9) === 1) // isnpc
                continue;

            const raceId = variations.int(i, 1);
            const genderId = variations.int(i, 2);
            const variation = variations.int(i, 4);
            const color = variations.int(i, 5);

            const key = Races[raceId] + Genders[genderId];
            const entry = map.get(key) || new CharVariation(raceId, genderId);

            switch (variations.int(i, 3)) { // section id
                case 0x0:
                    entry.skin[color] = this.normalizeTexture(variations.string(i, 6));
                    entry.extra[color] = this.normalizeTexture(variations.string(i, 7));
                    break;
                case 0x1:
                    entry.setTexture(entry.faceLower, variation, color, this.normalizeTexture(variations.string(i, 6)));
                    entry.setTexture(entry.faceUpper, variation, color, this.normalizeTexture(variations.string(i, 7)));
                    break;
                case 0x2:
                    entry.setTexture(entry.facialHairLower, variation, color, this.normalizeTexture(variations.string(i, 6)));
                    entry.setTexture(entry.facialHairUpper, variation, color, this.normalizeTexture(variations.string(i, 7)));
                    break;
                case 0x3:
                    entry.setTexture(entry.hair, variation, color, this.normalizeTexture(variations.string(i, 6)));
                    entry.setTexture(entry.scalpLower, variation, color, this.normalizeTexture(variations.string(i, 7)));
                    entry.setTexture(entry.scalpUpper, variation, color, this.normalizeTexture(variations.string(i, 8)));
                    break;
                case 0x4:
                    entry.pelvis[color] = this.normalizeTexture(variations.string(i, 6));
                    entry.torso[color] = this.normalizeTexture(variations.string(i, 7));
                    break;
            }

            map.set(key, entry);
        }

        return map;
    }

    private normalizePath(filename: string) {
        return path.parse(filename).name.toUpperCase();
    }

    private normalizeTexture(filename: string) {
        return filename?.toUpperCase().replace(".TGA", ".BLP")
    }
}