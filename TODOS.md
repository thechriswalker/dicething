- Fix "Print positioning" for each die model and adjust die/blanks/platforms to all sit on one plane orient correctly and site where they need to (i.e. pointy edges down and floating, except for the coin / platforms.)

- On Export page have the approximate total volume (does my volume calc work for non-convex shapes - nope - will need to fix that...) 
  - add helper text on "approx" to say "without legends"
  - will need a special case for the coin or anything non-convex.

- Mononoki as another builtin font? (more builtin fonts?) 

- D4 Infinity (cuboid + semicircle side)

- Font cache view 
  - manage and delete loaded fonts
  - pick from loaded fonts to change symbols
  - font cache size and purging

- Legend Layout Presets per Die

  Have an option on the dice parameters - switch legend layout auto changes to custom if you change one, but otherwise changes the layout under the hood
layouts attached to the dice models: `Array<{ name: string, mapping: Array<Legend> }>` so the array is "index = face index, value = default legend"

  - D6 - normal / pips
  - D20 - normal / spindown
  - D12 - normal / Go first (A/B/C/D)

