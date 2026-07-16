// Turntable-style camera auto-rotate: orbit around the look-at target on the
// camera's current up axis (so a tilted view keeps spinning about that tilt).
// Used by the die-engine viewport (builder) and the main-thread SceneRenderer (export).
import { Vector3, type PerspectiveCamera } from 'three';

/** Full revolution every 30s — same pace as three's OrbitControls default. */
export const AUTO_ROTATE_RAD_PER_SEC = (2 * Math.PI) / 30;

const _axis = new Vector3();
const _offset = new Vector3();

/** Rotate the camera around its current up through `target` by `angleRad`. */
export function applyCameraAutoRotate(
	camera: PerspectiveCamera,
	target: Vector3,
	angleRad: number
): void {
	_axis.copy(camera.up).normalize();
	_offset.copy(camera.position).sub(target);
	_offset.applyAxisAngle(_axis, angleRad);
	camera.position.copy(target).add(_offset);
	camera.lookAt(target);
}
