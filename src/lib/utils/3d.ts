import { Camera, Matrix4, Quaternion, Vector3, type BufferGeometry, type Object3D, type Camera as Vector } from "three";

export interface Rotatable<T = void> {
    applyQuaternion(q: Quaternion): T
    rotateX(angle: number): T;
    rotateY(angle: number): T;
    rotateZ(angle: number): T;
}

function isObject3D(o: Object3D | BufferGeometry): o is Object3D {
    return (o as Object3D).isObject3D;
}

export function translate<T extends Object3D | BufferGeometry>(obj: T, v: Vector3): void {
    if (isObject3D(obj)) {
        obj.translateX(v.x).translateY(v.y).translateZ(v.z);
    } else {
        obj.translate(v.x, v.y, v.z);
    }

}


const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);

export function vectorRotate(v: Vector3, angle: number, axis: Vector3) {
    v.applyQuaternion(new Quaternion().setFromAxisAngle(axis, angle))
}

export function vectorRotateX(v: Vector3, angle: number): void {
    vectorRotate(v, angle, xAxis);
}

export function vectorRotateY(v: Vector3, angle: number): void {
    vectorRotate(v, angle, yAxis);
}

export function vectorRotateZ(v: Vector3, angle: number): void {
    vectorRotate(v, angle, zAxis);
}

export class Transform {

    private stack: Array<Quaternion | Vector3> = [];
    private matrix: Matrix4 | undefined;


    constructor() { }

    public rotate(q: Quaternion): Transform {
        this.matrix = undefined;
        this.stack.push(q.clone());
        return this;
    }

    public clone(): Transform {
        const clone = new Transform();
        clone.matrix = this.matrix;
        clone.stack = this.stack.slice();
        return clone;
    }

    public rotateByAxisAngle(axis: Vector3, angle: number): Transform {
        return this.rotate(new Quaternion().setFromAxisAngle(axis, angle));
    }

    public translate(v: Vector3): Transform {
        this.matrix = undefined;
        this.stack.push(v.clone());
        return this;
    }

    public translateBy(x: number, y: number, z: number): Transform {
        return this.translate(new Vector3(x, y, z));
    }

    public get rotation(): Quaternion {
        this.build();
        return new Quaternion().setFromRotationMatrix(this.matrix!);
    }
    public get translation(): Vector3 {
        this.build();
        return new Vector3().setFromMatrixPosition(this.matrix!);
    }


    private build() {
        if (!this.matrix) {
            this.matrix = new Matrix4().identity();
            let _m = new Matrix4();
            const t = this.stack.slice();
            let p: Quaternion | Vector3 | undefined
            while (p = t.pop()) {

                if (isQuaternion(p)) {
                    _m.makeRotationFromQuaternion(p);
                } else {
                    _m.makeTranslation(p);
                }
                this.matrix = this.matrix.multiply(_m)
            }
        }
    }

    public applyToGeometry(g: BufferGeometry) {
        this.build();
        g.applyMatrix4(this.matrix!)
    }

    public applyRotationToCamera(cam: Camera) {
        this.build();
        const rotation = this.rotation;

        cam.position.applyQuaternion(rotation)
        cam.up.applyQuaternion(rotation)
        cam.up.normalize()
    }
}

function isQuaternion(p: any): p is Quaternion {
    return p.isQuaternion === true;
}