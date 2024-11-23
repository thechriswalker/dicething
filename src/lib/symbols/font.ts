import { FontLoader } from "three/examples/jsm/Addons.js";

import alice from "./fonts/alice_in_wonderland.json";
import germania from "./fonts/germania_one_restricted.json";

const fontLoader = new FontLoader();

export const fonts = {
  alice: {
    name: "Alice in Wonderland",
    font: fontLoader.parse(alice),
  },
  germania: {
    name: "Germania One",
    font: fontLoader.parse(germania),
  },
} as const;

export const defaultFont = fontLoader.parse(alice);
