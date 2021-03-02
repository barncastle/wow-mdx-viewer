export class AnimationFrame {
    private requestId: number;
    private readonly fps: number;
    private readonly animate: (delta: number) => void;

    constructor(fps = 60, animate: (delta: number) => void) {
        this.requestId = 0;
        this.fps = fps;
        this.animate = animate;
    }

    start(): void {
        this.stop();

        let then = performance.now();
        const interval = 1000 / this.fps;
        const tolerance = 0.1;

        const animateLoop = (now: number) => {
            this.requestId = requestAnimationFrame(animateLoop);
            const delta = now - then;

            if (delta >= interval - tolerance) {
                then = now - (delta % interval);
                this.animate(delta);
            }
        };

        this.requestId = requestAnimationFrame(animateLoop);
    }

    stop(): void {
        cancelAnimationFrame(this.requestId);
    }
}