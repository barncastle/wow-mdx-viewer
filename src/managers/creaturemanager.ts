import { DBC } from '../formats/dbc/dbc';
import { TextureVariation } from './consts';
import { Model, TextureReplacement } from '../formats/mdx/model';
import { ITextureManager } from './itexturemanager';
import * as path from 'path';

const CreatureModelData = "DBFilesClient\\CreatureModelData.dbc";
const CreatureDisplayInfo = "DBFilesClient\\CreatureDisplayInfo.dbc";

export class CreatureManager implements ITextureManager {
    private creatureDisplayInfo: DBC;
    private modelMap: Map<string, Set<number>>;

    public load(): void {
        this.creatureDisplayInfo = DBC.Load(CreatureDisplayInfo);
        this.modelMap = this.getModelMap();
    }

    public exists(filename: string): boolean {
        return this.modelMap.has(this.normalizePath(filename));
    }

    public getTextures(model: Model): TextureVariation[] {
        const map = new Map<string, TextureVariation>();
        const filename = this.normalizePath(model.Filename);
        const directory = path.dirname(model.Filename);
        const modelIds = this.modelMap.get(filename);

        // get all variations for all modelIds
        for (let i = 0; i < this.creatureDisplayInfo.rowCount; i++) {
            if (modelIds.has(this.creatureDisplayInfo.int(i, 1))) {
                const entry = new TextureVariation();

                // check all 3 variation fields
                for (let j = 0; j < 3; j++) {
                    const texture = this.creatureDisplayInfo.string(i, 6 + j);
                    if (texture) {
                        entry.set(TextureReplacement.Monster1 + j,
                            path.join(directory, texture + '.blp'));
                    }
                }

                // deduplicate the entries
                const key = entry.toString();
                if (!!key && !map.has(key))
                    map.set(key, entry);
            }
        }

        return Array.from(map.values());
    }

    private getModelMap(): Map<string, Set<number>> {
        const map = new Map<string, Set<number>>();
        const creatureModelData = DBC.Load(CreatureModelData);

        for (let i = 0; i < creatureModelData.rowCount; i++) {
            const model = this.normalizePath(creatureModelData.string(i, 2)); // model filepath
            if (model.startsWith("CHARACTER"))
                continue;

            const array = map.get(model) || new Set<number>();
            array.add(creatureModelData.int(i, 0)); // modelId
            map.set(model, array);
        }

        return map;
    }

    private normalizePath(filename: string) {
        return filename.toUpperCase().replace(".MDL", ".MDX");
    }
}