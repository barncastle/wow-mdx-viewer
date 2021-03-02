import { Model } from '../formats/mdx/model';
import { TextureVariation } from './consts';

export interface ITextureManager {
    load: () => void;
    exists: (filename: string) => boolean;
    getTextures: (model: Model) => TextureVariation[];
}