# Art

What's wanted next, with briefs ready to paste to the artist, is in [BRIEFS.md](BRIEFS.md).

Put art from ChatGPT here, exactly as it was made: full size, transparent background. **Don't resize, crop or trim it.** `npm run art` does that, and writes game-ready sprites plus a manifest to `public/art/`. The game finds them by name.

Images made against a footprint template line up exactly. Others work too: the art step finds where the building stands from its outline. Check what it found with `npm run art -- --check some-folder`, which saves each image with its footprint drawn on. When an image isn't drawn in true 2:1 isometric (ChatGPT sometimes draws one side flatter), give it hand measurements in a sidecar file (below).

## Names

`<kind>_<subject>_<era>_<W>x<H>_v<NN>[_<state>].png`, lowercase.

| Example | What it is |
| --- | --- |
| `buildings/bronze/bld_home_bronze_1x1_v01.png` | Bronze era mudbrick home, first variant |
| `buildings/bronze/bld_home_bronze_1x1_v01_winter.png` | The same home with snow |
| `nature/nat_broadleaf_any_1x1_v01_autumn.png` | A broadleaf tree in autumn |
| `landmarks/lmk_hearth_bronze_1x1_v01.png` | The Hearth, a one-of-a-kind landmark |

Any number of variants (`v01`, `v02`, …) of anything are used at random. States the game looks for: `winter` for buildings; `spring`, `autumn` and `winter` for trees, bushes, reeds, wildflowers and rocks; `sprouts`, `growing`, `ripe`, `harvested` and `winter-fallow` for barley fields. A state goes with the variant of the same number, so `_v02_winter` must be the snowy version of `_v02`.

## Asset names the game uses today

| Game thing | File name start |
| --- | --- |
| Hide tent (families with nowhere to live yet) | `bld_hide-tent_bronze_1x1` |
| Lean-to (one person with nowhere to live yet) | `bld_lean-to_bronze_1x1` |
| Round hut | `bld_round-hut_bronze_1x1` |
| Mudbrick home (any number of variants) | `bld_home_bronze_1x1` |
| Family house (2×2, built by big families) | `bld_house-large_bronze_2x2` |
| Gathering hall (3×3) | `bld_longhouse_bronze_3x3` |
| Granary (2×2) | `bld_granary_bronze_2x2` |
| Potter's kiln (2×2) | `bld_kiln_bronze_2x2` |
| Bronze furnace | `bld_furnace_bronze_1x1` |
| Stone circle (2×2) | `bld_shrine_bronze_2x2` |
| Well | `bld_well_bronze_1x1` |
| Fishing dock | `bld_dock_bronze_1x1` |
| Market stall | `bld_stall_bronze_1x1` |
| Burial ground (3×3) | `bld_burial_bronze_3x3` |
| The Hearth (in `landmarks/`); `_embers` is the fire banked for the night, shown while you rest after dark | `lmk_hearth_bronze_1x1` |
| Places of the dead, by the village's custom (in `landmarks/`): a pyre ground (2×2), a sky platform (2×2), a family tomb (2×2), a river landing | `lmk_pyre-ground_bronze_2x2`, `lmk_sky-platform_bronze_2x2`, `lmk_tomb_bronze_2x2`, `lmk_river-landing_bronze_1x1` |
| Sacred places found near the village (in `landmarks/`): standing stones (2×2), a sacred grove (2×2), a spring, a barrow (2×2), a cairn, a great old tree | `lmk_standing-stones_any_2x2`, `lmk_sacred-grove_any_2x2`, `lmk_spring_any_1x1`, `lmk_barrow_any_2x2`, `lmk_cairn_any_1x1`, `lmk_great-tree_any_1x1` |
| Trees, berry bushes, rocks and stumps | `nat_broadleaf_any_1x1`, `nat_pine_any_1x1`, `nat_fruit-tree_any_1x1`, `nat_berry-bush_any_1x1`, `nat_rock_any_1x1`, `nat_stump_any_1x1` |
| Barley field (2×2), in each stage of its year | `nat_barley_any_2x2` (`_sprouts`, `_growing`, `_ripe`, `_harvested`, `_winter-fallow`) |
| Props by people's doors (in `props/`): a woodshed by a woodcutter's home, a drying rack by a fisher's (and some gatherers') | `prop_woodpile-shelter_bronze_1x1`, `prop_drying-rack_bronze_1x1` |
| Scenery: wildflowers in the meadows, reeds along the water and in the marsh, fallen logs and dead wood in the forest, logs stacked where trees were felled | `nat_wildflowers_any_1x1`, `nat_reeds_any_1x1`, `nat_fallen-log_any_1x1`, `nat_deadwood_any_1x1`, `nat_log-pile_any_1x1` |
| Animal pen (2×2) | `bld_pen_bronze_2x2` |
| Two-storey house (towns) | `bld_townhouse_bronze_1x1` |
| Alehouse (2×2) | `bld_alehouse_bronze_2x2` |
| Healer's hut | `bld_healer-hut_bronze_1x1` |
| House of scribes (2×2) | `bld_scribe-house_bronze_2x2` |
| Temple (3×3, a stepped earthen temple in the Bronze era) | `bld_temple_bronze_3x3` |
| Guildhall (2×2) | `bld_guildhall_bronze_2x2` |

The town wall (palisade, later stone) and bridges are drawn by the game for now, since they bend to fit the town and the river.

## Later eras

Every building above can also be drawn for a later era: swap `bronze` for `iron`, `stone-timber`, `sail-dome`, `steam`, `electric` or `glass` (for example `bld_home_iron_1x1_v01.png`). Each building keeps the era it was built in, and old ones are rebuilt in the new style over the years. When a city enters an era there's no art for yet, it keeps using the most recent era that has some, so nothing ever looks out of place.

## Trees

Trees stand with the foot of the trunk at the middle of their tile. Each season of a tree should keep the same tree at the same size and place, so the tree doesn't jump when the season turns. Spring, autumn and winter versions fall back to the summer one (or to `v01`'s) when missing.

A winter (or other) version painted on a different canvas from its summer one is lined up with it by hand in its sidecar, so it stands in the same place at the same size.

The broadleaf woods can hold several kinds of tree: `nat_broadleaf`, `nat_oak`, `nat_birch`, `nat_hazel`, `nat_young-tree`, `nat_old-tree` and `nat_snag` mixed through them, and `nat_willow` and `nat_alder` near the water (the mix is `BROADLEAVES` in `src/render/sprites.ts`). Any kind with art in `nature/` is used. Each new kind is sized by its sidecar (`tilePx` sets its height against the people); `nat_broadleaf` itself is scaled up in the game. The batch 23 drafts of the other kinds, with sidecars ready, wait in `_drafts/trees/` for a painted version (see BRIEFS.md); moving them into `nature/` puts them in the woods.

Small things (bushes, flowers, reeds, rocks, logs, the props by the doors) stand the same way, at the middle of their tile, and are sized by hand in their sidecars against the people: a person is about a fifth of a tile tall, a berry bush a little taller, a stump a little shorter, wildflowers about knee height. Scenery is placed by the game, a little off-centre and sometimes mirrored, so it never lines up on the grid.

A barley field is drawn as one 2×2 sprite that changes with the year: sprouts and then green barley in spring, ripening through summer, cut one field at a time in autumn, and stubble (under snow, when there is some) in winter.

## Ground

The ground is painted from flat, seamless squares in `terrain/`, named `ter_<surface>.png`: `grass_spring`, `grass_summer`, `grass_autumn`, `grass_snow`, `dirt`, `soil_plowed`, `sand`, `rock`, `water_shallow` and `water_deep`. They're laid over the map pinned to the ground and squashed to the view's slant, so paint them top-down, with no shading toward any edge. The game blends the seasons' grasses, wears dirt paths into the grass where people walk, lays snow over everything when it snows, and smooths the edges where two kinds of ground meet. Winter grass, marsh, ice and the hearth's square are recoloured from the nearest texture until they get their own.

## Size against the people

Buildings don't need to be painted to any particular scale: the game draws each kind at a set height in grown-ups (see `HEIGHT` in `src/render/layout.ts`: a hut 2.6, a home 2.3, a kiln 2.2, a granary 2.9, a hall 3.8, a temple 5), standing within its plot. Trees are drawn larger than painted, plants and props as sized in their sidecars.

## Cut-out art

Plants, rocks, props and places cut out of a white background (`nature/`, `props/`, `landmarks/`) are cleaned up by `npm run art`: the white blended into their edge pixels is taken out, pale haze at the edge is cleared, and soft see-through edges are made crisp. Winter versions keep their white edges (that's snow).

## Night lights and smoke

To make windows glow at night or a chimney smoke, or to set the footprint by hand, add a JSON file with the same name next to the image, with points in the image's own pixels:

```json
{ "lights": [[300, 700], [645, 605]], "smoke": [[512, 210]], "anchorPx": [603, 1142], "tilePx": 395 }
```

`anchorPx` is the base's lowest corner and `tilePx` is how many pixels wide one tile is. Homes without `lights` get a glow at the door. The Hearth's `smoke` point is where its living smoke rises from, and its painted fire flickers while you work.

Use the full-size image, not a pre-shrunk copy: sidecar points are in the full-size image's pixels.

## Trying art before committing it

In the game, **Settings → Art test scene** lets you drop in an image, see it on the real grid next to other buildings (by day and night, summer and winter, and at 48 px), and use it in your city right away. Art used that way stays on that computer until the file is added here.

`_reference/` holds the style anchor, the era style sheets, the footprint templates, the revised art design document, and the Bronze Age costume sheet (`ref_costumes_bronze.png`, with its notes in `ref_costumes_bronze.json`).

## People

Villagers are painted sheets in `people/96/<role>_<sheet>.png`, four frames across in 96 px cells, everyone facing right with their feet at (48, 89–90) and a grown-up 77 px tall:

| Sheet | Rows | What it's for |
| --- | --- | --- |
| `walk` | S, SE, E, NE, N | Walking empty-handed. |
| `carry` | S, SE, E, NE, N | Walking with both hands held out in front; the game draws what's in them (`items/`). |
| `stoop` | S, SE, E, NE, N | Standing, bending, hands at the ground, halfway up: putting something down or picking it up, and bending to gather. |
| `reap`, `hoe` | SE, NE | Work loops: cutting barley with a sickle at harvest; hoeing in spring and early summer. |
| `draw-water` | SE, NE | Hauling the well rope while the bucket goes down and comes up. |

The rows are S (facing you), SE (three-quarter front), E (side), NE (three-quarter back) and N (back); facing left is the right-facing row mirrored, so people face eight ways. Walking along a street shows a three-quarter view; straight across the screen, the side; straight up or down, the back or front. The build cleans each sheet (the white matte some were cut out with, and slivers of neighbouring figures) and makes 64 and 32 px copies; the game uses the smallest that's sharp at the current zoom, and takes a step for every few pixels walked so feet don't slide.

| Who | Woman or girl | Man or boy |
| --- | --- | --- |
| The leader | `leader` | `leader-man` |
| Founder of a living faith | `priest` | `priest-man` |
| Runs a market stall | `merchant-woman` | `merchant` |
| 60 or older | `elder-woman` | `elder` |
| Under 12 | `girl` | `child` |
| Potters and smiths | `crafter` | `crafter-man` |
| Everyone else | `farmer-woman` | `farmer` |

The `guard` waits for the town to have a watch. A villager without a `stoop` sheet dips a little to the ground instead; one without a work loop stands at the work.

Where the hands are in each `carry` sheet is measured in `src/render/citizens.ts` (`CARRY`): a new carry sheet whose hands sit somewhere else needs its own line there.

Notes on the current sheets (batches 16 and 23):

- The farmers' (both) walk, carry, stoop, reap and hoe sheets are painted throughout; so are the leader's and the merchant's carry sheets.
- The leader's and the merchant's walk sheets were cut off down one side, so they walk in their carry sheets (hands folded in front), copied as `leader_walk.png` and `merchant_walk.png`. The cut-off sheets are in `_drafts/people/`.
- The priest's first step in the SE, E and NE rows was cut off too, and is the other contact step instead; the farmer's last hoe frame was cut off, and swings back through the second.
- The other carry sheets have forearms added to the walk, and the other stoop sheets squash the walk rather than bend it: they pass at a distance (what's carried covers the hands), but want painting properly.
- The fishing, net, hunting, chopping and hammering loops in `_drafts/people/` are tools laid over walking frames, so they aren't used.
- `draw-water` is painted on a man in a blue tunic rather than the crafter's apron, so it's only used for `crafter-man`.

Skin is the person's own, one of the costume sheet's seven tones: the game finds each sheet's painted skin (the face by its hue, hands and legs by their close colour) and shifts it to the person's tone, keeping the painting's warm light.

Each person's card shows them a size bigger, facing you, with their family's mark. Until the sheets load, the code-drawn figures after the costume sheet stand in. The old four-direction sheets are in `_retired/people-4dir/`.

## Things people carry

`items/<era>/prop_<thing>_<era>[_full|_empty].png`: single objects on 64 px canvases, standing at y = 58. Baskets (`basket` empty; `basket-grain`, `basket-fish`, `basket-berries` full), the `water-jar` and `well-bucket` (full and empty), the big `storage-jar` (full with its lid tied on; empty with the lid off) and the `wood-bundle`. The game sizes each against a grown-up (a basket or water jar about a third of their height, a storage jar about two thirds) from its empty version, so filling a basket doesn't shrink it.

## Animals

`animals/<era>/ani_<kind>_<era>_<state>_<size>.png`: goats, sheep, dogs, cats, deer and ducks, each standing (`idle`), breathing (`ambient`, four frames across) and, for ducks, `swimming`, in 64 and 96 px frames with the feet at (32, 59) and (48, 88). They face right and are mirrored to face left; walking, they bob (there's no painted gait yet). Coats vary a little from animal to animal (a darker or paler dog or goat, a grey or dark cat, the odd black sheep).