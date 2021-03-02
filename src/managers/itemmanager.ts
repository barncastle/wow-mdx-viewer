import { DBC } from '../formats/dbc/dbc';
import { TextureVariation } from './consts';
import { Model, TextureReplacement } from '../formats/mdx/model';
import { ITextureManager } from './itexturemanager';
import * as path from 'path';

const ItemDisplayInfo = "DBFilesClient\\ItemDisplayInfo.dbc";
const Suffices = [
    "DWF", "DWM", "GNF", "GNM", "HUF", "HUM",
    "NIF", "NIM", "ORF", "ORM", "SCF", "SCM",
    "TAF", "TAM", "TRF", "TRM"
];

export class ItemManager implements ITextureManager {
    private itemDisplayInfo: DBC;
    private modelMap: Map<string, Set<number>>;

    public load(): void {
        this.itemDisplayInfo = DBC.Load(ItemDisplayInfo);
        this.modelMap = this.getModelMap();
    }

    public exists(filename: string): boolean {
        return this.modelMap.has(this.normalize(filename));
    }

    public getTextures(model: Model): TextureVariation[] {
        const map = new Map<string, TextureVariation>();
        const filename = this.normalize(model.Filename);
        const directory = path.dirname(model.Filename);
        const modelIds = this.modelMap.get(filename);

        // get all variations for all modelIds
        for (let i = 0; i < this.itemDisplayInfo.rowCount; i++) {
            if (modelIds.has(this.itemDisplayInfo.int(i, 0))) {
                const entry = new TextureVariation();

                // determine left or right texture slot
                const index = Number(this.normalize(this.itemDisplayInfo.string(i, 2)) === filename);
                const texture = this.itemDisplayInfo.string(i, 3 + index);

                if (texture)
                    entry.set(TextureReplacement.ObjectSkin, path.join(directory, texture + '.blp'));

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

        for (let i = 0; i < this.itemDisplayInfo.rowCount; i++) {
            for (let j = 0; j < 2; j++) {
                const modelname = this.itemDisplayInfo.string(i, 1 + j);
                if (!modelname)
                    continue;

                const model = this.normalize(modelname); // model filepath

                const array = map.get(model) || new Set<number>();
                array.add(this.itemDisplayInfo.int(i, 0)); // modelId
                map.set(model, array);
            }
        }

        return map;
    }

    private normalize(filename: string): string {
        filename = path.parse(filename).name.toUpperCase();

        // strip any race-gender sufficies
        const suffix = filename.split('_').pop();
        if (Suffices.includes(suffix))
            filename = filename.substr(0, filename.length - suffix.length - 1);

        return filename.toUpperCase() + '.MDX';
    }
}