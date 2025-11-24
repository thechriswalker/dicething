import { Quaternion, Vector3, type BufferGeometry, type Object3D, type Camera as Vector } from "three";

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