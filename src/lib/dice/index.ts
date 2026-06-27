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
import { InfinityD4 } from './infinity';
import {
	BarrelD4,
	BarrelD6,
	BarrelD8,
	BarrelD10,
	BarrelD12,
	BarrelD20,
	BarrelD00
} from './barrels';

const dice = {
	d2_coin: CoinD2,
	d4_caltrop: CaltropD4,
	d4_caltrop_base: CaltropBaseD4,
	d4_caltrop_custom: CaltropCustomD4,
	d4_truncated_tetrahedron: TruncatedTetrahedronD4,
	d6_cube: CubeD6,
	d4_crystal: CrystalD4,
	d6_crystal: CrystalD6,
	d8_crystal: CrystalD8,
	d10_crystal: CrystalD10,
	d00_crystal: CrystalD00,
	d12_crystal: CrystalD12,
	d12_dodecahedron: DodecahedronD12,
	d20_icosahedron: IcosahedronD20,
	d12_rhombic: RhombicD12,
	d6_rhombic: RhombicD6,
	d8_trapezohedron: TrapezohedronD8,
	d10_trapezohedron: TrapezohedronD10,
	d00_trapezohedron: TrapezohedronD00,
	d12_trapezohedron: TrapezohedronD12,
	d4_shard: ShardD4,
	d4_infinity: InfinityD4,
	d4_barrel: BarrelD4,
	d6_barrel: BarrelD6,
	d8_barrel: BarrelD8,
	d10_barrel: BarrelD10,
	d12_barrel: BarrelD12,
	d20_barrel: BarrelD20,
	d00_barrel: BarrelD00,
	d3_odd_prism: OddPrismD3,
	d5_odd_prism: OddPrismD5,
	d7_odd_prism: OddPrismD7,
	d6_skew: SkewD6,
	d8_truncated_octahedron: TruncatedOctahedronD8,
	d12_tetartoid: TetartoidD12,
	d24_deltoidal_icositetrahedron: DeltoidalIcositetrahedronD24,
	d24_tetrakis_hexahedron: TetrakisHexahedronD24,
	d24_pentagonal_icositetrahedron: PentagonalIcositetrahedronD24,
	d30_rhombic_triacontahedron: RhombicTriacontahedronD30,
	d60_deltoidal_hexecontahedron: DeltoidalHexecontahedronD60,
	d60_pentakis_dodecahedron: PentakisDodecahedronD60,
	d60_pentagonal_hexecontahedron: PentagonalHexecontahedronD60
} as const;

// grouping/sorting metadata for each die, keyed by die id. kept here so the
// whole taxonomy can be reviewed and edited in one place.
// TODO add "rarity": "common", "uncommon", "rare", "epic", "legendary"
const diceTags: Record<keyof typeof dice, DieTags> = {
	d2_coin: { kind: 'coin', sides: '2', rarity: 'common' },
	d4_caltrop: { kind: 'caltrop', variant: 'kite', sides: '4', rarity: 'common' },
	d4_caltrop_base: { kind: 'caltrop', variant: 'base', sides: '4', rarity: 'common' },
	d4_caltrop_custom: { kind: 'caltrop', variant: 'custom', sides: '4', rarity: 'common' },
	d4_truncated_tetrahedron: { kind: 'caltrop', variant: 'truncated', sides: '4', rarity: 'rare' },
	d6_cube: { kind: 'polyhedron', variant: 'cube', sides: '6', rarity: 'common' },
	d4_crystal: { kind: 'crystal', sides: '4', rarity: 'uncommon' },
	d6_crystal: { kind: 'crystal', sides: '6', rarity: 'uncommon' },
	d8_crystal: { kind: 'crystal', sides: '8', rarity: 'uncommon' },
	d10_crystal: { kind: 'crystal', sides: '10', rarity: 'uncommon' },
	d00_crystal: { kind: 'crystal', sides: '00', rarity: 'uncommon' },
	d12_crystal: { kind: 'crystal', sides: '12', rarity: 'uncommon' },
	d12_dodecahedron: { kind: 'polyhedron', variant: 'dodecahedron', sides: '12', rarity: 'common' },
	d20_icosahedron: { kind: 'polyhedron', variant: 'icosahedron', sides: '20', rarity: 'common' },
	d12_rhombic: { kind: 'polyhedron', variant: 'rhombic', sides: '12', rarity: 'uncommon' },
	d6_rhombic: { kind: 'trapezohedron', variant: 'rhombic', sides: '6', rarity: 'uncommon' },
	d8_trapezohedron: { kind: 'trapezohedron', sides: '8', rarity: 'common' },
	d10_trapezohedron: { kind: 'trapezohedron', sides: '10', rarity: 'common' },
	d00_trapezohedron: { kind: 'trapezohedron', sides: '00', rarity: 'common' },
	d12_trapezohedron: { kind: 'trapezohedron', sides: '12', rarity: 'common' },
	d4_shard: { kind: 'shard', sides: '4', rarity: 'uncommon' },
	d4_infinity: { kind: 'infinity', sides: '4', rarity: 'legendary' },
	d4_barrel: { kind: 'barrel', sides: '4', rarity: 'rare' },
	d6_barrel: { kind: 'barrel', sides: '6', rarity: 'rare' },
	d8_barrel: { kind: 'barrel', sides: '8', rarity: 'rare' },
	d10_barrel: { kind: 'barrel', sides: '10', rarity: 'rare' },
	d12_barrel: { kind: 'barrel', sides: '12', rarity: 'rare' },
	d20_barrel: { kind: 'barrel', sides: '20', rarity: 'rare' },
	d00_barrel: { kind: 'barrel', sides: '00', rarity: 'rare' },
	d3_odd_prism: { kind: 'odd', sides: '3', rarity: 'legendary' },
	d5_odd_prism: { kind: 'odd', sides: '5', rarity: 'legendary' },
	d7_odd_prism: { kind: 'odd', sides: '7', rarity: 'legendary' },
	d6_skew: { kind: 'skew', sides: '6', rarity: 'legendary' },
	d8_truncated_octahedron: { kind: 'polyhedron', variant: 'truncated', sides: '8', rarity: 'rare' },
	d12_tetartoid: { kind: 'skew', sides: '12', rarity: 'rare' },
	d24_deltoidal_icositetrahedron: {
		kind: 'polyhedron',
		variant: 'deltoidal',
		sides: '24',
		rarity: 'epic'
	},
	d24_tetrakis_hexahedron: { kind: 'polyhedron', variant: 'tetrakis', sides: '24', rarity: 'epic' },
	d24_pentagonal_icositetrahedron: {
		kind: 'skew',
		variant: 'pentagonal',
		sides: '24',
		rarity: 'epic'
	},
	d30_rhombic_triacontahedron: {
		kind: 'polyhedron',
		variant: 'rhombic',
		sides: '30',
		rarity: 'epic'
	},
	d60_deltoidal_hexecontahedron: {
		kind: 'polyhedron',
		variant: 'deltoidal',
		sides: '60',
		rarity: 'epic'
	},
	d60_pentakis_dodecahedron: {
		kind: 'polyhedron',
		variant: 'pentakis',
		sides: '60',
		rarity: 'epic'
	},
	d60_pentagonal_hexecontahedron: {
		kind: 'skew',
		variant: 'pentagonal',
		sides: '60',
		rarity: 'epic'
	}
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
