import { CubeD6 } from './cube';
import { CrystalD6, CrystalD8, CrystalD00, CrystalD10, CrystalD12, CrystalD4 } from './crystals';
import { DodecahedronD12 } from './dodecahedron';
import { IcosahedronD20 } from './icosahedron';
import { RhombicD12 } from './rhombic_dodecahedron';
import {
	RhombicD6,
	TrapezohedronD00,
	TrapezohedronD10,
	TrapezohedronD12,
	TrapezohedronD8
} from './trapezohedrons';
import { ShardD4 } from './shards';
import { CaltropD4 } from './caltrop';

const dice = {
	caltrop_d4: CaltropD4,
	cube_d6: CubeD6,
	crystal_d4: CrystalD4,
	crystal_d6: CrystalD6,
	crystal_d8: CrystalD8,
	crystal_d10: CrystalD10,
	crystal_d00: CrystalD00,
	crystal_d12: CrystalD12,
	dodecahedron_d12: DodecahedronD12,
	icosahedron_d20: IcosahedronD20,
	rhombic_d12: RhombicD12,
	rhombic_d6: RhombicD6,
	trapezohedron_d8: TrapezohedronD8,
	trapezohedron_d10: TrapezohedronD10,
	trapezohedron_d00: TrapezohedronD00,
	trapezohedron_d12: TrapezohedronD12,
	shard_d4: ShardD4
} as const;

Object.entries(dice).forEach(([k, v]) => {
	if (k !== v.id) {
		throw new Error('bad naming for dice map: ' + k + ' != ' + v.id);
	}
});

export default dice;
