# Stay in Space on Move

A [Sine](https://github.com/CosmoCreeper/Sine) mod for [Zen Browser](https://zen-browser.app).

When you move tabs to another Space with **right-click → Move to…**, Zen normally switches you to that Space as well. This mod keeps you where you are.

## Usage

- **Move to… → a Space**: the tabs move, and you stay in your current Space.
- **Shift-click a Space in Move to…**: the tabs move and you follow them (Zen's normal behaviour), for that one move.

If the tab you're looking at is one of the tabs being moved, the mod selects the next tab in your current Space. If no other tab is left, you land on Zen's empty tab, just as when you close the last tab in a Space.

It handles:

- multiple selected tabs
- split views (Zen moves the whole split)
- Glance previews
- tabs inside collapsed folders, which are never chosen as the tab to land on
- Essentials, which Zen never moves between Spaces

## Multi-window fix

With several windows open, Zen's window sync sometimes fails to place the 2nd and later tabs of a multi-tab move in the other windows. The tabs get the new Space but aren't added to its tab list, so they stay invisible. The console shows `ele is undefined` from `ZenDragAndDrop.js`. This is a Zen bug and happens without any mods.

After each move, this mod checks the other windows and puts any tabs that sync left behind into place, in the right order. It logs `[StayInSpace] repaired Zen sync glitch` when it does. Once Zen fixes the bug, this step simply finds nothing to fix.

## Install

Install it from the Sine marketplace. To install it straight from GitHub instead, enter `gauntlet36/zen-stay-in-space` in Sine's custom install box. For that route, you need to enable *"Enable installing JS from unofficial sources"* in Sine's settings.

## Notes

- This mod replaces only Zen's handler for the **Move to…** tab menu items. Dragging tabs between Spaces is unchanged.
- This mod was written with AI assistance (Claude) and tested by the author on Zen for Windows.
