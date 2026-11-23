# Art wanted next

Briefs ready to paste to the artist. Everything is a transparent PNG with no background, shadows, ground, guide lines or text. Match the approved rounded, painterly Bronze Age style, with soft, even light from above (the game mirrors right-facing art to face left, so strong light from one side would look wrong).

Sizes are given against a grown-up villager, who is 77 px tall in a 96 px frame.

---

## 1. Villagers with empty hands, and villagers carrying

Today every villager is painted holding something (a basket, a jar, a satchel), so nobody can put anything down. Each character needs **three sheets**, all in the five-direction layout of `_reference/walk_template_5dir.png` (384 × 480 px: 4 frames across, 96 px cells; rows S, SE, E, NE, N; feet at x = 48, y = 89–90; everyone faces right):

1. **`<character>_walk.png`, empty-handed.** Arms swing naturally, opposite the legs. Nothing in the hands. Satchels, belts and jewellery that are worn stay; anything held goes.
2. **`<character>_carry.png`, carrying.** The same walk, but both forearms held forward at waist-to-chest height, hands together, as if holding a basket or jar in front. **No object in the hands**: the game draws whatever they're carrying (see brief 2). Keep the hands at the same spot in every frame of a row, about 24 px above the feet line. In the N (back) row the hands are hidden by the body.
3. **`<character>_stoop.png`, putting down and picking up.** Four frames per row: standing, bending at hips and knees, hands at the ground, and halfway back up (the game plays it forward to pick something up and backward to put it down). Same five rows. Hands empty.

Characters: `farmer`, `farmer-woman`, `crafter`, `crafter-man`, `child`, `girl`, `elder`, `elder-woman`, `leader`, `leader-man`, `priest`, `priest-man`, `merchant`, `merchant-woman`. (The farmer and crafter pairs matter most: they're most of the village.)

---

## 2. Containers, full and empty

Single objects, each on its own 64 × 64 px canvas, centred, with the bottom of the object at y = 58. Draw each in two states, **full** and **empty**, as a pair of files with the same size and position so one can replace the other:

| Object | Size | Full | Empty |
| --- | --- | --- | --- |
| Carrying basket (wicker, two handles) | about a third of a person's height | heaped with barley ears / with fish / with berries and greens (three full versions) | bare wicker, inside visible |
| Water jar (clay, carried in front or on the head) | a third of a person | water glinting at the mouth, darker wet clay at the lip | dry, dark opening |
| Well bucket (wooden staves, rope handle) | a quarter of a person | water at the brim, a drip down the side | dry wood inside |
| Storage jar (big pithos, stands outside houses and at the granary) | two thirds of a person | lid tied on, a little grain spilled at the foot | lid off and leaning against it |
| Wood bundle (sticks tied with cord) | a third of a person | one state only | — |

Name them like `prop_basket-grain_bronze_full.png` and `prop_basket_bronze_empty.png`, `prop_water-jar_bronze_full.png` and `prop_water-jar_bronze_empty.png`, and so on.

---

## 3. Work

Each work animation is one sheet of 4 frames across (a loop) and **2 rows**: SE (three-quarter front, facing right) and NE (three-quarter back, facing right); the game mirrors them for the other two diagonals. 96 px cells, feet at x = 48, y = 89–90, a grown-up 77 px tall. Drawn on the empty-handed body of each character in brief 1, holding the tool for the work; tools are part of these sheets.

| File | The loop |
| --- | --- |
| `<character>_reap.png` | Harvesting barley with a **sickle**: bend, grasp a handful of stalks, cut, straighten and lay it aside. (A sickle, not a scythe: scythes came much later than the Bronze Age.) |
| `<character>_draw-water.png` | At the well, hauling the rope hand over hand (the game draws the bucket and rope). |
| `<character>_fish.png` | Standing at the bank holding a rod, with a small twitch and a strike (the game draws the line and float). A second loop, casting a hand net, would be lovely. |
| `<character>_hunt.png` | Drawing a short bow and loosing (frames: nock, draw, hold, loose). |
| `<character>_chop.png` | Felling with a bronze axe: raise, swing, strike, recover. |
| `<character>_hoe.png` | Breaking ground with a hoe or digging stick, for spring sowing. |
| `<character>_hammer.png` | At the furnace or on a building: hammering. |

Start with the farmer pair (reap, hoe), then fishers, then the rest.

---

## 4. More trees

The woods have only two broadleaf trees, two pines and a fruit tree, so a forest repeats itself. More kinds, each in the same format as the broadleaf trees (one tree on a 1 × 1 tile, the foot of the trunk at the middle of the tile, `_spring`, summer (no suffix), `_autumn` and `_winter` versions of the same tree at the same size and place):

| File name | Tree | Size (in grown-ups) |
| --- | --- | --- |
| `nat_oak_any_1x1_v01`, `v02` | Broad, spreading oak, rough bark | 5–6 |
| `nat_birch_any_1x1_v01`, `v02` | Slender birch, white trunk, small leaves, yellow in autumn | 4–5 |
| `nat_willow_any_1x1_v01` | Willow with hanging branches (grows by the water) | 4 |
| `nat_alder_any_1x1_v01` | Alder, dark and narrow (by the water) | 4 |
| `nat_hazel_any_1x1_v01` | Hazel thicket, many thin stems | 2 |
| `nat_old-tree_any_1x1_v01` | An old, hollow, half-dead giant | 6 |
| `nat_young-tree_any_1x1_v01` | A sapling a few years old | 1.5–2 |
| `nat_snag_any_1x1_v01` | A dead standing trunk, no leaves (one version for all seasons) | 3 |

The game already varies every tree's size and shade a little and mirrors half of them, so each new tree goes a long way.
