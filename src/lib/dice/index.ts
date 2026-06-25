import type { DieTags } from '$lib/interfaces/dice';
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
import { CaltropBaseD4, CaltropCustomD4, CaltropD4 } from './caltrop';
import { CoinD2 } from './coin';
import { TruncatedTetrahedronD4 } from './truncated_tetrahedron';
import { TruncatedOctahedronD8 } from './truncated_octahedron';
import { DeltoidalIcositetrahedronD24 } from './deltoidal_icositetrahedron';
import { TetrakisHexahedronD24 } from './tetrakis_hexahedron';
import { PentagonalIcositetrahedronD24 } from './pentagonal_icositetrahedron';
import { RhombicTriacontahedronD30 } from './rhombic_triacontahedron';
import { DeltoidalHexecontahedronD60 } from './deltoidal_hexecontahedron';
import { PentakisDodecahedronD60 } from './pentakis_dodecahedron';
import { PentagonalHexecontahedronD60 } from './pentagonal_hexecontahedron';
import { SkewD6 } from './skew_d6';
import { TetartoidD12 } from './tetartoid';
import { OddPrismD3, OddPrismD5, OddPrismD7 } from './odd_prism';

const dice = {
	coin_d2: CoinD2,
	caltrop_d4: CaltropD4,
	caltrop_base_d4: CaltropBaseD4,
	caltrop_custom_d4: CaltropCustomD4,
	truncated_tetrahedron_d4: TruncatedTetrahedronD4,
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
	shard_d4: ShardD4,
	odd_prism_d3: OddPrismD3,
	odd_prism_d5: OddPrismD5,
	odd_prism_d7: OddPrismD7,
	skew_d6: SkewD6,
	truncated_octahedron_d8: TruncatedOctahedronD8,
	tetartoid_d12: TetartoidD12,
	deltoidal_icositetrahedron_d24: DeltoidalIcositetrahedronD24,
	tetrakis_hexahedron_d24: TetrakisHexahedronD24,
	pentagonal_icositetrahedron_d24: PentagonalIcositetrahedronD24,
	rhombic_triacontahedron_d30: RhombicTriacontahedronD30,
	deltoidal_hexecontahedron_d60: DeltoidalHexecontahedronD60,
	pentakis_dodecahedron_d60: PentakisDodecahedronD60,
	pentagonal_hexecontahedron_d60: PentagonalHexecontahedronD60
} as const;

// grouping/sorting metadata for each die, keyed by die id. kept here so the
// whole taxonomy can be reviewed and edited in one place.
const diceTags: Record<keyof typeof dice, DieTags> = {
	coin_d2: { kind: 'coin', sides: '2' },
	caltrop_d4: { kind: 'caltrop', variant: 'kite', sides: '4' },
	caltrop_base_d4: { kind: 'caltrop', variant: 'base', sides: '4' },
	caltrop_custom_d4: { kind: 'caltrop', variant: 'custom', sides: '4' },
	truncated_tetrahedron_d4: { kind: 'caltrop', variant: 'truncated', sides: '4' },
	cube_d6: { kind: 'polyhedron', variant: 'cube', sides: '6' },
	crystal_d4: { kind: 'crystal', sides: '4' },
	crystal_d6: { kind: 'crystal', sides: '6' },
	crystal_d8: { kind: 'crystal', sides: '8' },
	crystal_d10: { kind: 'crystal', sides: '10' },
	crystal_d00: { kind: 'crystal', sides: '00' },
	crystal_d12: { kind: 'crystal', sides: '12' },
	dodecahedron_d12: { kind: 'polyhedron', variant: 'dodecahedron', sides: '12' },
	icosahedron_d20: { kind: 'polyhedron', variant: 'icosahedron', sides: '20' },
	rhombic_d12: { kind: 'polyhedron', variant: 'rhombic', sides: '12' },
	rhombic_d6: { kind: 'trapezohedron', variant: 'rhombic', sides: '6' },
	trapezohedron_d8: { kind: 'trapezohedron', sides: '8' },
	trapezohedron_d10: { kind: 'trapezohedron', sides: '10' },
	trapezohedron_d00: { kind: 'trapezohedron', sides: '00' },
	trapezohedron_d12: { kind: 'trapezohedron', sides: '12' },
	shard_d4: { kind: 'shard', sides: '4' },
	odd_prism_d3: { kind: 'odd', sides: '3' },
	odd_prism_d5: { kind: 'odd', sides: '5' },
	odd_prism_d7: { kind: 'odd', sides: '7' },
	skew_d6: { kind: 'skew', sides: '6' },
	truncated_octahedron_d8: { kind: 'polyhedron', variant: 'truncated', sides: '8' },
	tetartoid_d12: { kind: 'skew', sides: '12' },
	deltoidal_icositetrahedron_d24: { kind: 'polyhedron', variant: 'deltoidal', sides: '24' },
	tetrakis_hexahedron_d24: { kind: 'polyhedron', variant: 'tetrakis', sides: '24' },
	pentagonal_icositetrahedron_d24: { kind: 'skew', variant: 'pentagonal', sides: '24' },
	rhombic_triacontahedron_d30: { kind: 'polyhedron', variant: 'rhombic', sides: '30' },
	deltoidal_hexecontahedron_d60: { kind: 'polyheron', variant: 'deltoidal', sides: '60' },
	pentakis_dodecahedron_d60: { kind: 'polyhedron', variant: 'pentakis', sides: '60' },
	pentagonal_hexecontahedron_d60: { kind: 'skew', variant: 'pentagonal', sides: '60' }
};

Object.entries(dice).forEach(([k, v]) => {
	if (k !== v.id) {
		throw new Error('bad naming for dice map: ' + k + ' != ' + v.id);
	}
	const tags = diceTags[k as keyof typeof dice];
	if (!tags) {
		throw new Error('missing tags for dice: ' + k);
	}
	v.tags = tags;
});

export default dice;
