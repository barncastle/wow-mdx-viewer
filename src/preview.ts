import { Model, ReadModel, TextureReplacement } from './formats/mdx/model';
import { TextureVariation } from './managers/consts';
import { ModelRenderer, RenderFlags } from './renderer/model/modelRenderer';
import { Controller } from './renderer/dom/controller';
import { AnimationFrame } from './renderer/dom/animationframe';
import { FileManager } from './managers/filemanager';
import { remote } from 'electron';
import { CharacterManager } from './managers/charactermanager';
import { CharacterRenderer } from './renderer/character/characterRenderer';

let controller: Controller;
let animationFrame: AnimationFrame;
let model: Model;
let variations: TextureVariation[];
let modelRenderer: ModelRenderer;
let characterRenderer: CharacterRenderer;
let canvas: HTMLCanvasElement;
let gl: WebGLRenderingContext;

function init() {
    canvas = document.getElementById('canvas') as HTMLCanvasElement;
    controller = new Controller(canvas);
    animationFrame = new AnimationFrame(60, updateModel);

    try {
        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext;
        window.dispatchEvent(new Event('resize')); // force canvas redraw
        controller.clearScene(gl);
    } catch (err) {
        alert(err);
        return;
    }

    initControls();

    function updateModel(timestamp: number) {
        modelRenderer.update(timestamp / 1.6);
        controller.drawScene(modelRenderer);
    }
}

function initControls() {
    const sequence = <HTMLSelectElement>document.getElementById('sequence');
    sequence.addEventListener('input', () => modelRenderer.setSequence(parseInt(sequence.value, 10)));

    const variation = <HTMLSelectElement>document.getElementById('variation');
    variation.addEventListener('input', () => setTextures(parseInt(variation.value), true));

    const inputZ = <HTMLInputElement>document.getElementById('targetZ');
    inputZ.addEventListener('input', () => controller.cameraTargetZ = parseInt(inputZ.value, 10));

    const inputDistance = <HTMLInputElement>document.getElementById('distance');
    inputDistance.addEventListener('input', () => controller.cameraDistance = parseInt(inputDistance.value, 10));

    const particles = <HTMLInputElement>document.getElementById('particles');
    particles.addEventListener('change', () => modelRenderer.enableParticles(particles.checked));

    const ribbons = <HTMLInputElement>document.getElementById('ribbons');
    ribbons.addEventListener('change', () => modelRenderer.enableRibbons(ribbons.checked));

    const directory = <HTMLButtonElement>document.getElementById("directory");
    const directorylabel = <HTMLInputElement>document.getElementById("directory-label");
    directory.addEventListener('click', () => {
        const directory: string[] = remote
            .require("electron").dialog
            .showOpenDialogSync(remote.getCurrentWindow(), {
                properties: ['openDirectory']
            });

        if (directory && directory[0]) {
            setDirectory(directory[0]);
            directorylabel.value = directory[0];
        }
    });

    initCharControls();
}

function initCharControls() {
    const elements = document.querySelectorAll('#charcontrols input[type="number"]');
    const typeControl = ['facetype', 'hairtype', 'facialtype'];

    for (const element of elements) {
        element.addEventListener('change', () => {
            if (!characterRenderer)
                return;

            const max = parseInt(element.getAttribute('max'));
            const value = parseInt((<HTMLInputElement>element).value);
            const char = characterRenderer;

            if (value >= 0 && value <= max) {
                switch (element.id) {
                    case "skincolor": char.skinColor = value; break;
                    case "facetype": char.faceType = value; break;
                    case "haircolor": char.hairColor = value; break;
                    case "hairtype": char.hairStyle = value; break;
                    case "facialhairtype": char.facialHairStyle = value; break;
                    case "facialhaircolor": char.facialHairColor = value; break;
                }

                if (typeControl.includes(element.id))
                    setCharacterStyles(false);
            }
        });
    }
}

function setDirectory(directory: string) {
    if (FileManager.getInstance().setDirectory(directory)) {
        animationFrame.stop();
        modelRenderer?.dispose();
        controller.clearScene(gl);

        document.dispatchEvent(new CustomEvent("treeview", {
            detail: FileManager.getInstance().getModelTreeView()
        }));
    }
}

function setModel(filename: string) {
    const file = FileManager.getInstance().getFile(filename);
    const flags = modelRenderer?.flags ?? RenderFlags.Default;

    if (file) {
        try {
            model = ReadModel(filename, file);
        } catch (err) {
            console.error(err);
            return;
        }

        modelRenderer?.dispose();
        modelRenderer = new ModelRenderer(model, flags);
        modelRenderer.initGL(gl);

        if (CharacterManager.getInstance().exists(filename)) {
            characterRenderer = new CharacterRenderer(modelRenderer);
        } else {
            characterRenderer = null;
        }

        setAnimationList();
        setVariationList();
        setTextures(0, false);
        setCharacterStyles(true);
        animationFrame.start();
        controller.centerCamera(model.Info);
    }
}

function setAnimationList() {
    const list: string[] = model.Sequences.map(seq => seq.Name);
    if (list.length === 0)
        list.push('None');

    const encode = (html: string) => html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sequence = document.getElementById('sequence') as HTMLSelectElement;
    sequence.innerHTML = list.map((item, index) => `<option value="${index}">${encode(item)}</option>`).join('');
}

function setVariationList() {

    variations = FileManager.getInstance().getTextures(model);

    const list: string[] = variations.map((_, i) => 'Skin ' + (i + 1));
    if (list.length === 0)
        list.push('Skin 1');

    const select = document.getElementById('variation') as HTMLSelectElement;
    select.innerHTML = list.map((item, index) => `<option value="${index}">${item}</option>`).join('');
}

function setTextures(index: number, update: boolean) {
    for (const texture of model.Textures) {
        if (texture.Image) {
            if (texture.ReplaceableId === TextureReplacement.Skin && characterRenderer) {
                characterRenderer.skinColor = index;
            } else if (texture.ReplaceableId) { // dynamic
                const image = variations[index]?.get(texture.ReplaceableId);
                modelRenderer.setTexture(texture.Image, image ?? texture.Image, texture.Flags);
            } else if (!update) {
                modelRenderer.setTexture(texture.Image, texture.Image, texture.Flags); // static
            }
        }
    }
}

function setCharacterStyles(reset: boolean) {
    let styles = {};
    if (characterRenderer) {
        styles = CharacterManager.getInstance().getStyleOptions(characterRenderer);
    }

    document.dispatchEvent(new CustomEvent("characterstyles", {
        detail: { styles: styles, reset: reset }
    }));
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('selectmodel', (event: CustomEvent) => setModel(event.detail));
document.addEventListener('overlay', (event: CustomEvent) => controller.disabled = event.detail);