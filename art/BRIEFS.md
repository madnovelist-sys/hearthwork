# Art wanted next

Briefs ready to paste to the artist. Everything is a transparent PNG with no background, shadows, ground, guide lines or text. Match the approved rounded, painterly Bronze Age style, with soft, even light from above (the game mirrors right-facing art to face left, so strong light from one side would look wrong).

Sizes are given against a grown-up villager, who is 77 px tall in a 96 px frame.

**In the game already (batches 16 and 23):** five-direction walk sheets for all fifteen villagers; the farmers' walk, carry, stoop, reap and hoe sheets; the leader's and merchant's carry sheets; a draw-water loop; all the containers. What's below is what's still missing or needs painting properly.

---

## 1. Carrying and bending, painted properly

The farmers' `carry` and `stoop` sheets are just right. For the other villagers, the carry sheets have forearms laid over the walk, and the stoop sheets squash the walk rather than bend it. Please paint them the way the farmers' are, in the same five-direction layout (384 × 480 px: 4 frames across, 96 px cells; rows S, SE, E, NE, N; feet at x = 48, y = 89–90; everyone faces right):

- **`<character>_carry.png`**: the walk, with both forearms held forward at waist-to-chest height, hands together, as if holding a basket or jar in front, with **nothing in the hands**. Keep the hands at the same spot in every frame of a row. In the N (back) row the hands are hidden by the body.
- **`<character>_stoop.png`**: standing, bending at hips and knees, hands at the ground in front of the feet, and halfway back up. Same five rows. Hands empty.

Characters, in order of need: `crafter`, `crafter-man`, `elder`, `elder-woman`, `girl`, `child`, `merchant-woman`, `leader-man`, `priest`, `priest-man`, and a `stoop` for `leader` and `merchant` (drawn on their carry sheets' figures).

Also wanted:

- **`leader_walk.png` and `merchant_walk.png`** drawn whole: the ones in batch 23 were cut off down one side, so for now they walk in their carry sheets, hands folded in front.
- **`crafter-man_walk.png` empty-handed**: he carries a pot in every frame.

---

## 2. Work

Each work loop is one sheet of 4 frames across and **2 rows**: SE (three-quarter front, facing right) and NE (three-quarter back, facing right), 384 × 192 px; the game mirrors them for the other diagonals. Feet at x = 48, y = 89–90. The body is painted in the pose for the work, holding the tool (the fishing, net, bow, axe and hammer loops in batch 23 were tools laid over walking frames, so they aren't used).

| File | The loop |
| --- | --- |
| `farmer_draw-water.png`, `farmer-woman_draw-water.png` | At the well, hauling the rope hand over hand (the game draws the bucket and rope). The one in batch 23 is lovely, but in a blue tunic, so it's only used for the crafter; most of the water is fetched by farmers. |
| `farmer_fish.png`, `farmer-woman_fish.png` | Standing at the bank holding a rod, with a small twitch and a strike (the game draws the line and float). Fishers wear the farmer's clothes. |
| `farmer_hunt.png` | Drawing a short bow and loosing (nock, draw, hold, loose), for the winter hunt. |
| `farmer_chop.png` | Felling with a bronze axe: raise, swing, strike, recover. |
| `crafter-man_hammer.png`, `crafter_hammer.png` | At the furnace or on a building: hammering. |

---

## 3. More trees, painted like the broadleaf trees

The batch 23 trees (oak, birch, willow, alder, hazel, old tree, young tree, snag) are in `art/_drafts/trees/`, and the game is ready for them (willows and alders by the water, the rest mixed through the woods), but beside the painted broadleaf trees they look flat: canopies of even leaf-dabs with no branches showing through, straight stick trunks, and winter branches drawn as straight lines. Please repaint them to match `nat_broadleaf_any_1x1_v01`: modelled bark and roots, branches that fork and thin, clumps of leaves catching the light, and the same tree in every season (`_spring`, summer with no suffix, `_autumn`, `_winter`, the snag in one version for all seasons), one tree on a 256 px canvas with the foot of the trunk at (128, 228).

| File name | Tree | Height (in grown-ups) |
| --- | --- | --- |
| `nat_oak_any_1x1_v01`, `v02` | Broad, spreading oak, rough bark | 4–4.5 |
| `nat_birch_any_1x1_v01`, `v02` | Slender birch, white trunk, small leaves, yellow in autumn | 3.5–4 |
| `nat_willow_any_1x1_v01` | Willow with hanging branches (grows by the water) | 3.5 |
| `nat_alder_any_1x1_v01` | Alder, dark and narrow (by the water) | 3.5 |
| `nat_hazel_any_1x1_v01` | Hazel thicket, many thin stems | 1.5 |
| `nat_old-tree_any_1x1_v01` | An old, hollow, half-dead giant | 4.5 |
| `nat_young-tree_any_1x1_v01` | A sapling a few years old | 1.5–2 |
| `nat_snag_any_1x1_v01` | A dead standing trunk, no leaves | 3 |

The game varies every tree's size and shade a little and mirrors half of them, so each new tree goes a long way.
