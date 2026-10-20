import { Point, RectPoints } from '../BasicTypes';
import { FlipCorner, FlipDirection } from './Flip';

/** A flat sheet folded across the perpendicular bisector of (width, grabY)
 * and the dragged point. Corner is retained for programmatic flip compatibility.
 */
export class FlipCalculation {
    private readonly pageWidth: number;
    private readonly pageHeight: number;
    private readonly grabY: number;
    private position: Point;
    private rect: RectPoints;
    private angle = 0;
    private normal: Point;
    private midpoint: Point;
    private foldedArea: Point[] = [];
    private flippingArea: Point[] = [];
    private crease: Point[] = [];

    constructor(
        private direction: FlipDirection,
        private corner: FlipCorner,
        pageWidth: string,
        pageHeight: string,
        grabY?: number
    ) {
        this.pageWidth = Number(pageWidth);
        this.pageHeight = Number(pageHeight);
        this.grabY = Math.max(0, Math.min(this.pageHeight,
            grabY ?? (corner === FlipCorner.TOP ? 0 : this.pageHeight)));
    }

    public calc(localPos: Point): boolean {
        if (!Number.isFinite(localPos.x) || !Number.isFinite(localPos.y) ||
            this.pageWidth <= 0 || this.pageHeight <= 0) return false;

        const w = this.pageWidth;
        const h = this.pageHeight;
        const g = this.grabY;
        // A crease cannot cut through the bound spine. The feasible drag region
        // is the intersection of disks centred on its two endpoints, with radii
        // equal to their distances from the original grab point.
        const x = Math.max(-w, Math.min(w, localPos.x));
        const slack = Math.max(0, w * w - x * x);
        const topRadius = Math.sqrt(slack + g * g);
        const bottomRadius = Math.sqrt(slack + (h - g) * (h - g));
        const minY = Math.max(-topRadius, h - bottomRadius);
        const maxY = Math.min(topRadius, h + bottomRadius);
        const y = Math.max(minY, Math.min(maxY, localPos.y));
        this.position = { x, y };

        const dx = w - x;
        const dy = g - y;
        const length = Math.hypot(dx, dy);
        // At rest the fold has zero area and its limiting crease is the edge.
        this.normal = length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
        this.midpoint = { x: (w + x) / 2, y: (g + y) / 2 };

        const page = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
        this.crease = [];
        this.foldedArea = this.clipFoldedHalf(page);
        this.flippingArea = this.foldedArea.map(p => this.reflect(p));

        // Reverse the back face's horizontal texture coordinates before
        // reflection. Their composition is a rotation, matching both renderers.
        this.rect = {
            topLeft: this.reflect({ x: w, y: 0 }),
            topRight: this.reflect({ x: 0, y: 0 }),
            bottomLeft: this.reflect({ x: w, y: h }),
            bottomRight: this.reflect({ x: 0, y: h }),
        };
        this.angle = Math.atan2(2 * this.normal.x * this.normal.y,
            2 * this.normal.x * this.normal.x - 1);
        this.crease.sort((a, b) => a.y - b.y || a.x - b.x);
        return true;
    }

    private signedDistance(p: Point): number {
        return (p.x - this.midpoint.x) * this.normal.x +
            (p.y - this.midpoint.y) * this.normal.y;
    }

    private reflect(p: Point): Point {
        const distance = 2 * this.signedDistance(p);
        return { x: p.x - distance * this.normal.x, y: p.y - distance * this.normal.y };
    }

    /** Clip the page rectangle against the grab-side half plane. */
    private clipFoldedHalf(page: Point[]): Point[] {
        const result: Point[] = [];
        const addCrease = (p: Point): void => {
            if (!this.crease.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-7)) {
                this.crease.push(p);
            }
        };
        for (let i = 0; i < page.length; i++) {
            const a = page[i];
            const b = page[(i + 1) % page.length];
            const da = this.signedDistance(a);
            const db = this.signedDistance(b);
            if (Math.abs(da) < 1e-7) addCrease(a);
            if (da >= 0) result.push(a);
            if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
                const t = da / (da - db);
                const intersection = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
                result.push(intersection);
                addCrease(intersection);
            }
        }
        // Keep CSS/canvas clipping valid for the zero-area resting fold.
        while (result.length < 3) result.push({ x: this.pageWidth, y: this.grabY });
        return result;
    }

    public getFlippingClipArea(): Point[] { return this.flippingArea; }
    public getBottomClipArea(): Point[] { return this.foldedArea; }
    public getAngle(): number { return this.direction === FlipDirection.FORWARD ? this.angle : -this.angle; }
    public getRect(): RectPoints { return this.rect; }
    public getPosition(): Point { return this.position; }
    public getGrabY(): number { return this.grabY; }
    public getActiveCorner(): Point {
        return this.direction === FlipDirection.FORWARD ? this.rect.topLeft : this.rect.topRight;
    }
    public getDirection(): FlipDirection { return this.direction; }
    public getFlippingProgress(): number {
        return ((this.pageWidth - this.position.x) / (2 * this.pageWidth)) * 100;
    }
    public getCorner(): FlipCorner { return this.corner; }
    public getBottomPagePosition(): Point {
        return { x: this.direction === FlipDirection.BACK ? this.pageWidth : 0, y: 0 };
    }
    public getShadowStartPoint(): Point { return this.crease[0] ?? this.midpoint; }
    public getShadowAngle(): number {
        const first = this.getShadowStartPoint();
        const last = this.crease[this.crease.length - 1] ?? { x: first.x, y: first.y + 1 };
        const angle = Math.atan2(last.y - first.y, last.x - first.x);
        return this.direction === FlipDirection.FORWARD ? angle : Math.PI - angle;
    }
}
