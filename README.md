# DiceThing

DiceThing is a tool for creating custom dice models suitable for printing.

My instance at [dicething.org](https://dicething.org)

It is highly inspired by [DiceMaker](https://ankhe.itch.io/dicemaker) which is a fantastic tool, but not open source, so we cannot build on it and make improvements or add features.

Half-way through building this I found [DiceGen](https://dicegen.com/) which is also similar but opinionated in different ways. I haven't looked through the code for that one much (it is open source :heart:) and I think the font-handling is superior. I have spent a lot of time on improving that and the SVG import functionality so hopefully, this project is up to scratch in that regard.

This project also aims to be completely web-based, for a zero-install experience. Web technologies are quite capable of handling the 3D modelling required for this.

## Screenshots

<details><summary>Main Dice Builder</summary>

![Builder Screenshot](images/dicething-dice-builder.png)

</details>

<details><summary>Dice Shape Picker</summary>

![Shape Picker Screenshot](images/dicething-shape-picker.png)

</details>

<details><summary>Legend Set Editor - Bad Glyphs</summary>

![Legend Set Editor Bad Glyphs Screenshot](images/dicething-legends-broken-glyphs.png)

</details>

<details><summary>Legend Set Editor - SVG Import</summary>

![Legend Set Editor SVG Import Screenshot](images/dicething-legends-svg.png)

</details>

<details><summary>Exporting a Set</summary>

![Export](images/dicething-export.png)

</details>

<details><summary>Whirlwind Tour Video (...soon)</summary>
when I get a chance...
</details>

## Features

- Many dice shapes available, and customisable
- Custom legends
  - Can be created from fonts, or SVGs
- A few font based legends included (fonts all free for commercial use)
- Legend placement on faces (scale/rotate/position/engraving depth)
- Save / Load dice sets
- Save sets in JSON with all data needed to recreate in another browser.
- Export sets or individual dice as STLs
- Blank generation alongside each die
- Platform generation alongside each die

I have some other features in mind that I might add (Z-Stretch compensation, Auto-Supporting, Bumpers), but those will be later.

## Getting Started

This is a SvelteKit project and I use Bun as the runtime but others may work.

Basics:

```
bun install
bun run dev
```

A full static build can be produced with:

```
bun run build
```

## Notes

I originally started this with three.js and a CSG library. But the renders were slow and the resultant STL files were broken in subtle ways.

In the end, I wrote a custom engraving algorithm that works in 2D and then wires up the engravings to form a 3D model. This is much faster and produces better results.

But only visually...

There were still problems with the exported STLs, and I have discovered that this is almost always due to the fonts. The font conversion to paths is not always "clean", and sometimes paths overlap. This doesn't cause a rendering problem on screen, but the meshes get complicated and sometime appear non-manifold. Careful handling of the fonts before legend creation helps.

After much work, the geometry on the engraving still wasn't correct, and I flipped from three.js's earcut `ShapeGeometry` triangulation to `libtess` a more forgiving algorithm that works better with holes and non-convex shapes. This work also helped fix a lot of the font issues I was seeing and font-loading now works on many fonts that it previously failed on. The more I test the more edge-case I find that can be fixed.

## Features

I should probably do a direct comparison with DiceMaker, but I haven't yet.

DiceMaker features I know of, that DiceThing doesn't have: 
 - different edge chamfers/bumpers
 - fin supports
 - per-dice custom names
 - image import/tracing for legends

So if you need those features, DiceThing probably isn't for you. However it can do a bunch of cool things:

- [x] Parameterised Dice Shapes
  - [x] Classic 7 (caltrop d4, cube d6, octahderon d8, trapezohedron d10/d%, dodecahedron d12, icosahedron d20)
  - [x] Crystals (d4, d6, d8, d10/d%, d12)
  - [x] Rhombics (d6, d12)
  - [x] Shards (d4,d6, d8, d10/d%, d12)
  - [x] Barrels (d4,d6, d8, d10/d%, d12) (these are the triangle faced ones)
  - [x] Caltrop D4 (as 12 faces both on tips and edges, and with only 4 faces)
    - [x] With 12 faces on tips
    - [x] With 12 faces on edges
    - [x] With 4 faces (for custom stuff)
    - [x] Truncated (legends on tips)
  - [x] Coin D2 - a short cylinder
    - [x] Regular Polygon / Circle (polygon with 96 segments is basically a circle...)
    - [x] Custom SVG Path definition
  - [x] Skewed dice
    - [x] D6 and D12 polyhedrals can be "skewed" (left or right handed) and remain
          fair.
  - [x] Odd dice - D3, D5, D7 on a prism with numbers on the ends.
  - [x] High numbers - D24s, D30s, D60s
- [x] Legends 
  - [x] A number of built in legend fonts.
  - [x] Create from an uploaded TTF/OTF
  - [x] SVG import for a legend
    - [x] Basic import
    - [x] Complex per-path settings import.
  - [x] Mix and match symbols into a custom set
- [x] Engraving
  - [x] auto-fit legends by default
  - [x] customisable scale/rotation/translation
  - [x] per-face engraving depth
  - [x] per-face legend override
- [x] Set builder
  - [x] Format paint one face config to others
  - [x] "Explode" view to see all faces side-by-side
  - [x] "Landing" warning if your shape can rest in an invalid position (e.g. truncated dice, or dice with caps)
- [x] Export
  - [x] As JSON to share
  - [x] As STL/3MF
    - [x] Dice
    - [x] Auto-Blank generation with configurable inset
    - [x] Auto-Platform generation (parameterised)
    - [x] Export as one file or zip with file-per-group, or file-per-object
- [x] Dice Box Creation
  - [x] Import a set and have a box built for that set
  - [x] Edit box layout and dice position/rotation
  - [x] Magnet bores, open (press-in) and closed (pause and insert)
  - [x] Optional hinges (vs magnets only)

On the roadmap:

- Bevelled engraving (bevel the inner base of legend engraving)
- Print Orientations - correct orientation for easier printing.
- Alternate Legend ordering configurations (i.e. standard / spindown / etc...)

### Fonts and Font Handling

Most issues come from font problems when converted to SVG paths for engraving.

Similar issue when importing SVGs.

There are significant code paths to help reduce this issue, but please let me know if you find any fonts / svgs that should work but don't.

### AI Usage

Some of the code here was produced by LLMs. I actually built the majority before I started using them, which turned out to be a blessing because I learnt so much and feel that the code, build flow and interface design is all exatly how I want it. However, the project stagnated a bit and use LLMs has let me iterate much more quickly and focus on some of the more tricky features (like the SVG imports and font-fixing) that I was stuggling to find the time to work on myself. I doubt I would have go this to such a usable state with them. On the other hand, I would not descibe this project as vibe-coded. I have heavily guided the LLM, not just released it on the codebase.

## Contributing

I started this project because I was unhappy I could not contibute to DiceMaker to add new shapes or features. I want you to be able to add features to this software, so not only is open source and MIT licensed, but it you have worthwhile contributions I'd be happy to accept them. Please reach out / open an issue first however, I may be working on something similar or want to implement the feature myself. If not though, I will say and I will welcome thoughtful PRs. Please keep slop and time-wasting to a minimum, nobody wants that.
