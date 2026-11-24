# Art wanted next

Briefs ready to paste to the artist. Everything is a transparent PNG with no background, shadows, ground, guide lines or text. Match the approved rounded, painterly Bronze Age style, with soft, even light from above (the game mirrors right-facing art to face left, so strong light from one side would look wrong).

Sizes are given against a grown-up villager, who is 77 px tall in a 96 px frame.

**In the game already (batches 16, 23 and 24):** five-direction walk sheets for all fifteen villagers; painted carry sheets for everyone but the priests; painted stoop sheets for the farmers, crafters, children and elders; the farmers' reap and hoe loops; a draw-water loop; all the containers; and all ten new kinds of tree. What's below is what's still missing or needs painting properly.

---

## 1. Carrying and bending, the last few

Same five-direction layout as before (384 × 480 px: 4 frames across, 96 px cells; rows S, SE, E, NE, N; feet at x = 48, y = 89–90; a grown-up 77 px tall; everyone faces right), drawn like the farmers' and crafters' batch 24 sheets:

- **`priest_carry.png`, `priest-man_carry.png`**: the walk, both forearms held forward at waist-to-chest height, hands together, nothing in them.
- **`leader_stoop.png`, `leader-man_stoop.png`, `merchant_stoop.png`, `merchant-woman_stoop.png`, `priest_stoop.png`, `priest-man_stoop.png`**: standing, bending at hips and knees, hands at the ground in front of the feet, halfway back up.
- **`leader_walk.png`** whole and empty-handed, the same figure as her carry sheet at the same size (77 px tall, feet at y = 89–90), on a transparent background. Batch 24's was smaller, higher in the frame and on a pale backdrop.
- **`merchant_walk.png`** whole and empty-handed, the same man as his carry sheet (red cloak, patterned turban, satchel). Batch 24's was a different man.

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

## 3. Free time: sitting, talking, playing

Villagers now stop to chat, gather round the hearth and play, but the art is walking art: people talking just stand, people by the fire crouch in the "bending" pose, and children play tag in their walk. These sheets would bring it to life. Same 96 px cells, feet at x = 48, y = 89–90, everyone facing right, nothing held unless it says so.

| File | Rows | The frames |
| --- | --- | --- |
| `<character>_sit.png` | SE, NE (384 × 192) | Sitting on the ground, knees up or cross-legged, the figure's seat at the feet line. Four frames of a gentle loop: still; hands held out to warm at a fire in front; resting chin on hand; turning to look at a neighbour. |
| `<character>_talk.png` | SE, NE (384 × 192) | Standing, chatting with someone in front: listening; nodding; talking with one hand raised; laughing. Played slowly, taking turns with the other person. |
| `<character>_idle.png` | S, SE, E, NE, N (384 × 480) | Standing about, with weight shifting: still; shifting to the other foot; a look round; hands clasped behind the back. Breaks up groups of people standing still. |
| `child_run.png`, `girl_run.png` | S, SE, E, NE, N (384 × 480) | Running (four frames, both feet off the ground in one), for tag and chasing games. Arms pumping, hair flying. |
| `child_play.png`, `girl_play.png` | SE, NE (384 × 192) | Playing on the spot: jumping with arms up; clapping a rhyme; crouching to toss knucklebones (little bones on the ground in front); arms out as if holding hands in a ring dance. |

Characters for `sit`, `talk` and `idle`, in order of need: `farmer`, `farmer-woman`, `elder`, `elder-woman`, `crafter`, `crafter-man`, then the rest. Children need `run` and `play` first.

---

## 4. Animals walking

Animals now glide and sway along, but have no walking pose. Each animal needs a walk cycle, in the same 96 px frames as their standing art (feet at x = 48, y = 88), facing right:

| File | Size | Frames |
| --- | --- | --- |
| `ani_<kind>_bronze_walk_96.png` | 384 × 192 | Four frames of a walk; top row three-quarter front (SE), bottom row three-quarter back (NE, rump toward us). |
| `ani_<kind>_bronze_walk_64.png` | 256 × 128 | The same at 64 px (feet at x = 32, y = 59). |
| `ani_<kind>_bronze_graze_96.png` | 384 × 96 | Goats, sheep and deer only: head down, cropping grass, four frames (a step forward in one). |
| `ani_<kind>_bronze_run_96.png` | 384 × 192 | Dogs (bounding along beside their people) and deer (fleeing, a springing bound), SE and NE rows. |

Kinds: `goat`, `sheep`, `dog`, `cat`, `deer`, and `duck` (a waddle on the bank; ducks swim already). Keep each animal's coat, size and look exactly as in their standing paintings, so they don't change when they set off.

---

## 5. Shorelines

The river and lake edges are drawn by the game as soft-edged shallows over the grass, which looks thin. Wanted, in the format of the ground textures (`terrain/ter_<surface>.png`: flat, seamless squares at least 512 px, painted straight down from above, no shading toward any edge, no objects that stand up):

| File | What |
| --- | --- |
| `ter_bank_mud.png` | Wet, dark, trodden mud at the water's edge, a few footprints and bird tracks. |
| `ter_bank_pebbles.png` | A pebbly, sandy shore: rounded stones in greys and browns, sand between. |
| `ter_water_edge.png` | Very shallow, clear water over sand and pebbles: the bottom showing through, light ripples. Laid between the bank and the open water. |

And scattered along the banks, small things in the same format as the reeds and rocks (`nat_reeds_any_1x1_v01`, `nat_rock_any_1x1_v01`): one thing on its own transparent canvas, standing on its base, with `_spring`, `_autumn` and `_winter` versions where it changes with the seasons:

| File | What |
| --- | --- |
| `nat_shore-stones_any_1x1_v01` to `v03` | A few half-sunk stones with wet bases. |
| `nat_driftwood_any_1x1_v01` | A pale, smooth branch washed up. |
| `nat_lily-pads_any_1x1_v01` | Lily pads, a flower or two in summer (lies flat on the water). |
| `nat_rushes_any_1x1_v01` | A low clump of rushes, shorter than the reeds, for wet ground. |

---

## 6. Paths and roads

The paths people wear are drawn as darker earth blended into the grass. Wanted, as ground textures (same format as above):

| File | What |
| --- | --- |
| `ter_path_dirt.png` | A trodden footpath: packed brown earth, small stones, footprints, a few flattened grass blades. |
| `ter_path_ruts.png` | A cart track: packed earth with two faint ruts and a grassy middle (lies along the texture's diagonal, so it reads as a lane on the map). |
| `ter_path_stone.png` | Laid flat stones with earth and moss between, for the main ways of a town. |
| `ter_yard.png` | Swept, beaten earth for yards and the ground round doors, lighter than the paths. |

---

## 7. Rounder buildings

Homes and workshops are painted as crisp boxes, so a street of them reads as a grid even though they stand anywhere. Bronze Age mudbrick and wattle-and-daub buildings had softened, rounded corners and slightly uneven walls. New versions of the homes in the same format as the current ones (`bld_home_bronze_1x1_v04` onward, `bld_house-large_bronze_2x2_v03` onward), with:

- **Rounded corners** where the walls meet, and a rounded, slightly bulging plinth at the foot of the walls (no sharp-cornered slab under the building).
- **Uneven lines**: walls not quite straight, the roof's eaves wavy, the ridge a little sagging.
- **A door a grown-up can walk through**: the doorway about a third of the building's height for a 1 × 1 home (the game sizes buildings so the door fits a person; a door painted much smaller makes the whole house bigger).
- The ground at the foot of the walls soft and irregular, blending away (the game adds its own shadow).
