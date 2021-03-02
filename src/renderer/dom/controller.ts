import { vec3, mat4, quat } from 'gl-matrix';
import { ModelRenderer } from '../model/modelRenderer';
import { ModelInfo } from '../../formats/mdx/model';
import { vec3RotateZ } from '../../util';

const MAX_THETA = Math.PI / 2 * 0.98;

export class Controller {
    public cameraDistance = 10;
    public cameraTargetZ = 2;
    public cameraTheta = Math.PI / 4;
    public cameraPhi = 0;
    public disabled = false;

    private readonly canvas: HTMLCanvasElement;
    private cameraBasePos: vec3 = vec3.create();
    private cameraPos: vec3 = vec3.create();
    private cameraTarget: vec3 = vec3.create();
    private cameraUp: vec3 = vec3.fromValues(0, 0, 1);
    private cameraQuat: quat = quat.create();

    private cameraPosProjected: vec3 = vec3.create();
    private verticalQuat: quat = quat.create();
    private fromCameraBaseVec: vec3 = vec3.fromValues(1, 0, 0);
    private pMatrix = mat4.create();
    private mvMatrix = mat4.create();

    public constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.initCameraMove(this);
    }

    public drawScene(modelRenderer: ModelRenderer): void {

        const gl = modelRenderer.gl;
        this.clearScene(gl);

        mat4.perspective(this.pMatrix, Math.PI / 4, this.canvas.width / this.canvas.height, 0.1, 10000.0);

        vec3.set(
            this.cameraBasePos,
            Math.cos(this.cameraTheta) * Math.cos(this.cameraPhi) * this.cameraDistance,
            Math.cos(this.cameraTheta) * Math.sin(this.cameraPhi) * this.cameraDistance,
            Math.sin(this.cameraTheta) * this.cameraDistance
        );
        this.cameraTarget[2] = this.cameraTargetZ;

        vec3RotateZ(this.cameraPos, this.cameraBasePos, window['angle'] || 0);
        mat4.lookAt(this.mvMatrix, this.cameraPos, this.cameraTarget, this.cameraUp);

        this.calcCameraQuat();

        modelRenderer.setCamera(this.cameraPos, this.cameraQuat);
        modelRenderer.render(this.mvMatrix, this.pMatrix);
    }

    public clearScene(gl: WebGLRenderingContext): void {
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.depthMask(true);
        gl.clearColor(0.11, 0.20, 0.39, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    private initCameraMove($this: Controller) {
        let down = false;
        let downX: number, downY: number;
        let key: string | null;

        function pointerDown(event: MouseEvent) {
            if (!$this.disabled && event.target === $this.canvas) {
                down = true;
                [downX, downY] = [event.pageX, event.pageY];
            }
        }

        function pointerMove(event: MouseEvent) {
            if ($this.disabled || !down) {
                return;
            }

            $this.cameraPhi += -1 * (event.pageX - downX) * 0.01;
            $this.cameraTheta += (event.pageY - downY) * 0.01;
            $this.cameraTheta = Math.max(Math.min($this.cameraTheta, MAX_THETA), -MAX_THETA);

            downX = event.pageX;
            downY = event.pageY;
        }

        function pointerUp() {
            if (!$this.disabled)
                down = false;
        }

        function wheel(event: WheelEvent) {
            if ($this.disabled)
                return;
            else if (key === "Shift")
                $this.updateCameraZ($this.cameraTargetZ - (event.deltaY / 100));
            else
                $this.updateCameraDistance($this.cameraDistance + (event.deltaY / 100));
        }

        function keyChange(event: KeyboardEvent) {
            if ($this.disabled)
                return;
            else if (event.type === "keydown")
                key = event.key;
            else if (event.type === "keyup")
                key = null;
        }

        document.addEventListener('mousedown', pointerDown);
        document.addEventListener('mousemove', pointerMove);
        document.addEventListener('mouseup', pointerUp);
        document.addEventListener('wheel', wheel);
        document.addEventListener('keydown', keyChange);
        document.addEventListener('keyup', keyChange);
    }

    public centerCamera(info: ModelInfo): void {
        const extents: vec3 = vec3.create();
        vec3.subtract(extents, info.MaximumExtent, info.MinimumExtent);
        const distance = Math.ceil(Math.max(extents[0], extents[1], extents[2]));

        // arbitary math to loosely center model
        this.updateCameraDistance(distance);
        this.updateCameraZ(Math.floor(distance / 4));
    }

    private updateCameraDistance(value: number): void {
        this.cameraDistance = Math.max(0, Math.min(value, 200));
        (<HTMLInputElement>document.getElementById('distance')).value = this.cameraDistance.toString();
    }

    private updateCameraZ(value: number): void {
        this.cameraTargetZ = Math.max(-20, Math.min(value, 20));
        (document.getElementById('targetZ') as HTMLInputElement).value = this.cameraTargetZ.toString();
    }

    private calcCameraQuat(): void {
        vec3.set(this.cameraPosProjected, this.cameraPos[0], this.cameraPos[1], 0);
        vec3.subtract(this.cameraPos, this.cameraPos, this.cameraTarget);
        vec3.normalize(this.cameraPosProjected, this.cameraPosProjected);
        vec3.normalize(this.cameraPos, this.cameraPos);

        quat.rotationTo(this.cameraQuat, this.fromCameraBaseVec, this.cameraPosProjected);
        quat.rotationTo(this.verticalQuat, this.cameraPosProjected, this.cameraPos);
        quat.mul(this.cameraQuat, this.verticalQuat, this.cameraQuat);
    }
}