import * as path from 'path';
import * as fs from 'fs';
import { MpqFile } from '../formats/mpq/mpq';
import { TextureVariation } from './consts';
import { CreatureManager } from './creaturemanager';
import { CharacterManager } from './charactermanager';
import { ItemManager } from './itemmanager';
import { ITextureManager } from './itexturemanager';
import { Model } from '../formats/mdx/model';

const LISTFILE = '(listfile)';
const ARCHIVES = ["dbc.MPQ", "texture.MPQ", "model.MPQ", "patch.MPQ"];

interface TreeNode {
    text: string;
    nodes: TreeNode[];
    selectable: boolean;
    tags: string[]
}

export class FileManager {
    private static instance: FileManager;
    private directory: string;
    private listfile: string[];
    private patchArchive: string;
    private archives: Map<string, MpqFile> = new Map();
    private readonly textureManagers: ITextureManager[];

    private constructor() {
        this.textureManagers = [
            CharacterManager.getInstance(),
            new CreatureManager(),
            new ItemManager()
        ];
    }

    static getInstance(): FileManager {
        return this.instance ?? (this.instance = new this());
    }

    public setDirectory(directory: string): boolean {
        this.close();

        if (!directory.toLowerCase().endsWith('data'))
            directory = path.join(directory, 'Data');

        this.directory = directory;
        this.patchArchive = path.join(directory, "patch.MPQ");

        if (!fs.existsSync(this.patchArchive))
            this.patchArchive = null;

        this.getListFile();
        this.loadManagers();

        return this.listfile.length > 0;
    }

    public exists(filename: string): boolean {
        const needle = filename.toLowerCase();
        return this.listfile.some((e) => e.toLowerCase() === needle);
    }

    public getFile(filename: string): Buffer | null {
        if (!filename)
            return null;

        let res: Buffer | null = null;

        const archives = this.getArchives(filename);
        for (let i = 0; i < archives.length; i++) {
            const archive = this.loadArchive(archives[i]);
            if (archive.exists(filename)) {
                res = archive.extract(filename);
            }
        }

        if (res)
            console.log("Loaded " + filename);
        else
            console.warn("Failed loading " + filename)

        return res;
    }

    public getFileNames(regex: RegExp): string[] {
        return this.listfile.filter(regex.test.bind(regex));
    }

    public getTextures(model: Model): TextureVariation[] {
        const manager = this.textureManagers.find(m => m.exists(model.Filename));
        return manager?.getTextures(model) ?? [];
    }

    public getModelTreeView(): TreeNode[] {
        const result: TreeNode[] = [];
        const level = { result };
        const collator = new Intl.Collator('en');

        this.getFileNames(/.*\.mdx$/i)
            .sort(collator.compare)
            .forEach(path => {
                const parts = path.split('\\');
                parts.reduce((r, name, i) => {
                    if (!r[name]) {
                        r[name] = { result: [] };

                        const node = {
                            text: name,
                            nodes: r[name].result,
                            selectable: false,
                            tags: []
                        } as TreeNode;

                        // file node
                        if (i === parts.length - 1) {
                            node.selectable = true;
                            node.tags.push(path);
                        }

                        r.result.push(node);
                    }

                    return r[name];
                }, level)
            })

        return result;
    }

    public close(): void {
        this.archives.forEach(a => a.close());
        this.archives.clear();
    }

    private getListFile(): void {
        this.listfile = [];

        ARCHIVES.forEach(a => {
            const filepath = path.join(this.directory, a);

            if (fs.existsSync(filepath)) {
                const archive = new MpqFile(filepath);
                if (archive.exists(LISTFILE)) {
                    const contents = archive.extract(LISTFILE)
                        .toString('utf-8')
                        .split('\r\n');

                    this.listfile = this.listfile.concat(contents);
                }
                archive.close();
            }
        })
    }

    private getArchives(filename: string): string[] {
        const res = [];

        if (!filename)
            return res;

        if (this.patchArchive)
            res.push(this.patchArchive);

        const ext = path.extname(filename).toLowerCase();
        switch (ext) {
            case ".dbc": res.push(path.join(this.directory, "dbc.MPQ")); break;
            case ".blp": res.push(path.join(this.directory, "texture.MPQ")); break;
            case ".mdx": res.push(path.join(this.directory, "model.MPQ")); break;
        }

        return res;
    }

    private loadArchive(filename: string): MpqFile {
        if (!this.archives.has(filename)) {
            const archive = new MpqFile(filename);
            if (archive)
                this.archives.set(filename, archive);
        }

        return this.archives.get(filename);
    }

    private loadManagers(): void {
        for (const manager of this.textureManagers)
            manager.load();
    }
}