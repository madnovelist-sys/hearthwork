# Art for Gemini

Work for Gemini, alongside ChatGPT's list in [BRIEFS.md](BRIEFS.md); the two don't overlap. Gemini is strongest at **editing a picture you give it** while keeping everything else the same, so most of this is edits of the game's existing art.

## How to run a session

1. Start a new Gemini chat. Attach these style references from `art/_reference/`: `ref_style-anchor.png` (the village), `ref_costumes_bronze.png` (the people) and one or two finished buildings, such as `art/buildings/bronze/bld_round-hut_bronze_1x1_v01_winter.png` (a winter version done right).
2. Paste the **style guide** below as your first message.
3. For each job, attach the file it names and paste its prompt. One picture per request.
4. Download each result at full size and name it exactly as the job says. Send me the files in a zip, as with ChatGPT's batches.

**Backgrounds:** Gemini can't make a transparent background, so everything comes on **flat magenta (#FF00FF)**, which the game's art build removes cleanly (it also copes with plain white or bright green). If a result comes back on a gradient, a floor, a shadow or a scene, ask again: "Same picture, but on a perfectly flat, solid #FF00FF background, nothing else." Never accept a white background for snowy art: the snow would be cut away with it.

**Size and framing:** square images are fine at whatever size Gemini makes them. For edits, the result must keep the original's framing (same position and size on the canvas), so the build can line it up with the original automatically.

---

## Style guide (paste this first)

> You're making game art for **Hearthwork**, a cosy city-builder set in a **Bronze Age** village (around 2000–1200 BC, Europe and the Near East). Every picture must match the attached references exactly in style. The rules:
>
> **Look.** Soft, painterly digital illustration with rounded, slightly chunky forms, like a hand-painted miniature diorama. Gentle visible brushwork and soft texture. No black ink outlines: edges come from colour and shading. Not pixel art, not a 3D render, not photographic, not flat vector.
>
> **Camera.** Isometric, looking down at about 30 degrees: a square patch of ground appears as a diamond twice as wide as it is tall. Buildings show two walls, the front-left wall (with the door) and the right wall, exactly as in the references.
>
> **Light.** Soft, warm, even daylight from above and a little in front. Gentle shading, no strong cast shadows, no dramatic light from one side (the game mirrors pictures left to right, so one-sided light would look wrong).
>
> **Palette.** Warm and golden. Straw thatch #C9A55C to #E2B85A; ochre mudbrick #C9A27A; terracotta-red bands #B8603E with cream zigzag patterns; timber #8A5A3B; stone #B9AFA0; grass #7FA65A; snow #E8EEF2 with soft blue-grey shade.
>
> **The world.** Bronze Age materials only: mudbrick, wattle and daub, reed thatch tied with rope, timber posts, clay pots painted with zigzags, wicker, wool, linen, leather and bronze. No iron, no glass, no castles, no medieval or fantasy elements, no modern objects.
>
> **Every picture.** One subject, centred, nothing cut off, with a generous empty margin all round. A **perfectly flat, solid magenta #FF00FF background**: no gradient, no floor, no ground shadow, no vignette, no scenery. No text, labels, frames, guide lines or watermarks.
>
> Reply "Ready" and wait for the first job.

---

## Job A: Winter versions of the square buildings (do these first)

Only the round huts, tents and lean-tos have snow; nine buildings stay summery all winter. For each, attach the building's file from `art/buildings/bronze/` and paste:

> Edit this picture to show the same building in deep winter. **Keep the building exactly as it is**: the same shape, size, position on the canvas, angle, walls, door, windows, patterns, pots and woodpile. Only add winter: thick, soft, rounded snow lying on the roof and following the thatch (a little overhanging at the eaves); a few short icicles at the eaves; snow drifted against the foot of the walls and on the pots, logs and ledges; a light frost on the timber. The walls stay their warm colours. Put it on a perfectly flat, solid magenta #FF00FF background, keeping the same canvas size and framing.

| Attach | Save the result as |
| --- | --- |
| `bld_home_bronze_1x1_v01.png` | `bld_home_bronze_1x1_v01_winter.png` |
| `bld_home_bronze_1x1_v02.png` | `bld_home_bronze_1x1_v02_winter.png` |
| `bld_home_bronze_1x1_v03.png` | `bld_home_bronze_1x1_v03_winter.png` |
| `bld_house-large_bronze_2x2_v01.png` | `bld_house-large_bronze_2x2_v01_winter.png` |
| `bld_house-large_bronze_2x2_v02.png` | `bld_house-large_bronze_2x2_v02_winter.png` |
| `bld_longhouse_bronze_3x3_v01.png` | `bld_longhouse_bronze_3x3_v01_winter.png` |
| `bld_granary_bronze_2x2_v01.png` | `bld_granary_bronze_2x2_v01_winter.png` |
| `bld_kiln_bronze_2x2_v01.png` | `bld_kiln_bronze_2x2_v01_winter.png` (the kiln's fire still glows in its mouth) |
| `bld_well_bronze_1x1_v01.png` | `bld_well_bronze_1x1_v01_winter.png` (the bucket must stay hanging exactly where it is: the game animates it) |

**Check before saving:** lay the result over the original. If the building has moved, grown, shrunk or changed shape, ask again: "Keep the building exactly where and how it was; only add snow."

---

## Job B: Things for scenes

The game will soon act out what the Chronicle and the village's customs describe: baking bread on hot stones, painting the doorposts, the midsummer fires and so on. These are the objects for those scenes, each on its own.

Paste this before the first one, then send each item's line on its own:

> Next, single objects for the same game, in the same style, each on its own on a flat magenta #FF00FF background, shown from the same isometric angle (from above and in front), centred, with its base at the bottom. Sizes are given against a grown-up villager.

**Small things, held or set down** (save them as `prop_<name>_bronze.png`):

| Save as | Ask for |
| --- | --- |
| `prop_bread-stones_bronze.png` | A ring of flat hearth stones round a few glowing embers, with three round flatbreads baking on the stones. Knee high, about as wide as a person. |
| `prop_frame-drum_bronze.png` | A round frame drum: a wooden hoop with a stretched hide, painted with a red spiral, a little beater beside it. Hand-sized. |
| `prop_lamp_bronze.png` | A small clay oil lamp, lit, a warm flame and glow. Palm-sized. |
| `prop_garland_bronze.png` | A garland of spring flowers and green leaves, for hanging on a well. Arm's length. |
| `prop_paint-pot_bronze.png` | A small clay pot of red-ochre paint with a fibre brush resting in it. Hand-sized. |
| `prop_holed-stone_bronze.png` | A smooth river stone with a natural hole through it, hung on a cord. Hand-sized. |
| `prop_mead-jar_bronze.png` | A painted clay jar of mead with two small cups beside it. Knee high. |
| `prop_bundle_bronze.png` | A traveller's bundle: a rolled blanket and a sack tied together with cord. Carried on the back. |
| `prop_harvest-mask_bronze.png` | A harvest mask woven from straw and barley ears, with ribbons. Head-sized. |

**Bigger things that stand on the ground** (save them as `prop_<name>_bronze_1x1_v01.png`):

| Save as | Ask for |
| --- | --- |
| `prop_bonfire_bronze_1x1_v01.png` | A midsummer bonfire: logs stacked in a tall cone, burning high with bright flames and sparks. Twice a person's height. |
| `prop_bonfire-unlit_bronze_1x1_v01.png` | The same stack of logs, not yet lit. |
| `prop_smoking-rack_bronze_1x1_v01.png` | A fish-smoking rack: a timber A-frame hung with split fish over a low, smouldering alder-wood fire, with a little smoke. Head high. |
| `prop_loom_bronze_1x1_v01.png` | A warp-weighted loom leaning against a frame, half-woven cloth with a red spiral pattern, clay loom weights hanging at the bottom. A little taller than a person. |
| `prop_bier_bronze_1x1_v01.png` | A funeral bier: a litter of two poles with a body wrapped in a pale linen shroud, flowers laid on it. Respectful and quiet. Body length. |
| `prop_midsummer-pole_bronze_1x1_v01.png` | A tall pole hung with green boughs, flowers and coloured ribbons. Three times a person's height. |

---

## Job C (a trial): a villager in winter clothes

To see whether Gemini can keep a character exactly the same while changing their clothes. Attach `art/_reference/chr_farmer-woman_bronze_idle_v01_master.png` and paste:

> Edit this picture: the same woman, in the same pose and the same place on the canvas, with exactly the same face, hair, skin and proportions, now dressed for winter: a thick brown wool cloak with a hood (hood down, resting on her shoulders), wrapped round her, and wool leg wraps. Everything else stays as it is. Flat magenta #FF00FF background.

Save it as `chr_farmer-woman_bronze_winter_v01_master.png`. If it keeps her identity well, winter clothes for the walking sheets can come next (from Gemini or ChatGPT, whichever does it better).
