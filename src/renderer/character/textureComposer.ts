import { BLP } from '../../formats/blp/blp';
import { ModelRenderer } from '../model/modelRenderer';

interface ImageLayer {
    image: BLP;
    dx: number;
    dy: number;
    render: boolean;
}

export class TextureComposer {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;
    private layers: ImageLayer[];
    private needsUpdate: boolean;

    constructor(width: number, height: number) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.context = this.canvas.getContext('2d');
        this.layers = [];
    }

    public setLayer(filename: string, dx: number, dy: number, layer: number): void {
        // update existing layer
        if (this.layers[layer]?.image.filename === filename) {
            this.needsUpdate = true;
            this.layers[layer].dx = dx;
            this.layers[layer].dy = dy;
            this.layers[layer].render = true;
            return;
        }

        // load image and assign layer
        const image = BLP.Load(filename);
        if (image) {
            this.needsUpdate = true;
            this.layers[layer] = {
                image: image,
                dx: dx,
                dy: dy,
                render: true
            } as ImageLayer;
        }
    }

    public removeLayer(layer: number): void {
        if (this.layers[layer]) {
            this.needsUpdate = true;
            this.layers[layer].render = false;
        }
    }

    public render(renderer: ModelRenderer, base: string, dx: number, dy: number): void {
        if (!this.needsUpdate)
            return;

        this.needsUpdate = false;
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const images = this.layers.filter(l => l.render).map(l => {
            createImageBitmap(l.image.getImageData(0))
                .then(s => this.context.drawImage(s, l.dx, l.dy));
        });

        Promise.all(images).then(() => {
            const data = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height);
            renderer.combineTexture(base, data, dx, dy);
        });
    }
}