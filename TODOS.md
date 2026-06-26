- Fix "Print positioning" for each die model and adjust die/blanks/platforms to all sit on one plane orient correctly and site where they need to (i.e. pointy edges down and floating, except for the coin / platforms.)

- On Export page have the approximate total volume (does my volume calc work for non-convex shapes - nope - will need to fix that...) 
  - add helper text on "approx" to say "without legends"
  - will need a special case for the coin or anything non-convex.

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


- Dice Box Creation! This might be a separate builder!
  there is an awesome dice box called EDDC.
  It prints with an in-place hinge and could easily be tweaked for different sizes (parameterised) I may need to programmatically recreate it, but I could probably get cursor to decompose the STL and build it.
  Then we can use a Dice Set as source, and size the box around it perfectly (with configurable tolerance) - this means custom "insets" to hold edge die "just so". the inset could be built in or removable (top and bottom pieces.)
  Magnet sizes could be customiseable AND optionally enclosed (pause and print over).
  Font and back could have custom engraving (although the engraving didn't work so well on my printer) - recommend using a slicer to "color in" pieces before printing so top/bottom is smooth.

  we might have to use CSG for the insets, that could get complicated really quickly... insets should be bottom 1/4 top 1/4.

  So dice arrangement automatic or provide rows/cols tweaks, square/hex grid, and dice ordering options. Then box is created around them.
  