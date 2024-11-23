# DiceThing

Inspired by dicemaker, but annoyed that I cannot help with the code as it is not open source.

This is a tool to help making custom dice.

## Features

- use your own fonts
- import
- auto-google fonts?
- customise glyphs and placements/rotation, with good defaults
- import logos from images
- different dice shapes
- D4 ~tetrahedron, truncated~ (nope, no caltrops), crystal, roller
- D6 cube, rhomboid
- D8 octahedron, truncated
- D10 / D100
- D12 dodecahedron, rhombic
- D20E
- exporter as STL, group STL
- fin supports?
- adjust each face, copy settings across faces
- inset depth for symbols

## How

I expect I will need to learn about 3D graphics...
But I expect I will need WebGL to render the scene.
DOM around it for all the controls though.

I will need an intermediate representation to describe everything,
and then have pluggable exporters.

three.js handles enough of what I want.
It has a "FontLoader" and "TextGeometry" and there is a JS lib to convert fonts to "typeface.json" spec.
We can crunch a font to just 10 characters: `1234567890.`

## MVP

### Phase 1

- Show a d6/rhombic with variable size edges and variable angle (angle 90 = cube).
- Have a custom font engraved with the numbers.
- Choose depth of engraving
- Export STL

No User controls necessary at this stage. Just render the preview and button to export.

### phase 2

- Allow building a font library (specific characters to build).
- Template each number 0-20, 6dot, 9dot, double0, place on dice
- UI to allow font switching
- UI for controlling dimensional parameters.E

### phase 3

- Customising of each face (move/rescale symbols)
- Select and apply customisations to sets of faces.
- Save/Load as a file we can re-load in a fresh instance (i.e. keep fonts embedded as well)

### phase 4

- Custom image/icon loading

### current progress.

- Classes to represent Dice, Faces and the Symbols
- Draw Dice to the scene, highlight faces (edges and symbols)
- replace dice in scene from JSON config
- Engrave symbols into faces
- Update Symbols on the fly
- Load a font and convert to a symbol set (fonts don't "just work" - some break)

### next tasks

- change symbols to "just" shapes.
- symbol set editor to load a font and create a symbol set, saving to localstorage.
- load from local storage
- switch symbol sets from "presets" or "custom" saved sets.
- make presets from a couple of fonts.

- **design the UI** first iteration, allowing customisation of the faces.

### UI

how to apply the UI overlay.

Svelte.

What state do we have for our application:

We implicitly have a "DiceSetConfig"

- The Name of the DiceSet we are working on
- The Die in that set
- The SymbolSet in use

Then we have the UI context

- Which Die is selected (and therefore loaded on the "scene")
- That "DieConfig", (name, props)
- Which face is currently selected

And the die has a "LegendConfig" based on the face that is selected - template, transform.

@TODO - give SymbolSets and DiceSetConfig's UUIDs as well as names

Then we might have an overlay/modal for:

- Saving the current set (localstorage / to file) - to file especially in Wails/Tauri.
- Listing/Loading a set from localstorage
- Drop from localStorage
- Load from file.
- Managing SymbolSets
  - Load / Save from file/localStorage
  - Drop from localStorage
  - Create from font
- Export Set to STL or GLTF/B
