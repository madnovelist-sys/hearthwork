# Hearthwork: game design

A settlement grows into a village, a town, a city and a metropolis, but only while you work. You are its unseen patron, the Hearthkeeper; the goals you reach earn you the power to shape its story.

The art direction lives in its own document (the Art Design Document). This file records the game design and the decisions made so far.

## Pillars

1. **Your work is the sun.** City time moves only while a focus session runs. When you stop, night falls and the city sleeps. Nothing decays, nobody dies, while you're away.
2. **Alive, not managed.** The city builds itself and lives its own lives. Your powers are nudges.
3. **Every person has a story.** Named people with families, traits, dreams, memories and graves. The Chronicle tells it.
4. **Calm while working, rich while resting.** Nothing interrupts a session. Breaks are when you read what happened and act.
5. **Kind to the worker.** Forgiving goals, no fragile streaks, no punishment for missed days.

## Decisions

| Question | Decision |
| --- | --- |
| Pace | 1 focus hour = 1 city year (360 days; a day is 10 focus seconds, a season 15 minutes). Adjustable later if it feels off. |
| Measuring work | The player chooses when founding (and can change it in Settings): **time worked** or **words written**. Either way a start/stop timer runs the city's clock. With words, Sparks and the daily goal come from the word count entered after each session, and the word field only appears in that mode. Word-count app integrations come later. |
| Platform | Desktop app first (Mac now; Windows next), built with Tauri so Android and iOS can follow from the same code. |
| Eras | Bronze to modern, following the timescale with randomness. Ages are named for the discovery or event that starts them (Age of Bronze, Age of Sail…). Art is organized into seven visual eras. An era lasts at least 42–58 years (it differs by city). Discoveries come at random intervals, about five years apart on average whatever the city's size: sometimes two in a year, sometimes nothing new for fifteen. |
| Weirdness | A slider, 0–4: Historical, Folklore, Uncanny, Mythic, Fantastical. |
| Darkness | A slider, 0–100: Gentle, Balanced, Grim. Changes avoidable deaths and how the Chronicle tells hard things. No gore at any setting. |

## A companion while you work (Mac app)

- **Menu-bar clock**: the session timer shows in the Mac menu bar, with Start/Stop there. Closing the window keeps Hearthwork running in the menu bar; the Dock icon or the menu brings it back. Stopping from the menu bar brings the window up for the end-of-session summary.
- **Pause when away**: if there's no keyboard or mouse input for a while (default 15 minutes; Settings), the session pauses at the moment you left, and on return you're asked whether to count the time away (you might have been reading or writing by hand). Time is only counted up to shortly after the last input, so nothing has to be taken back.
- **Notifications**: optional (off by default) notifications for Sparks and the daily goal, only when the window isn't in front. A paused-while-away notice is always sent if notifications are allowed.

## Goals and rewards

| Tier | Default | Reward |
| --- | --- | --- |
| Every focus minute | — | City time moves forward |
| Spark | every 20 minutes, or every 250 words when tracking words | 1 Spark, kept to spend (3 call someone special to the village), plus 1 Favor |
| Daily goal | 60 minutes, or 1,000 words when tracking words | +5 Favor (later: a Fortune, one of three rare opportunities) |
| Weekly goal | 5 goal days in 7 | Later: a Wonder or a Golden Age |

## Acts (spent with Favor)

Built: **Bless** (1), **Name** a year or a baby (1), **Create a Settler** (3), **Send on a Quest** (3), **Inspire** (4: someone gets an idea that won't let go; knowledge gathers faster and the next discovery likely comes from their trade), **Whisper a Law** (5, +2 for each trait that makes the leader dislike it), **Raise a Prophet** (8). Acts that bring people or send them away wait for dawn (the next session start).

**Calling someone (3 Sparks)**: at any time, spend Sparks to call one of three people to the village. Each is a different story (a sealed jar, a runaway bride, a chief without a village, a foundling, a deserter, a widow whose husband may yet come home…), and each comes back years later in the Chronicle with real consequences. A story is told once, until they've all been told.

(Petitions, and the Old Stone where they were left, were removed: there was never a reason not to answer them. The hearth is the one gathering place.)

**Fortunes** (daily goal reward): three rare opportunities, pick one: a master crafter, a traveling healer, a treasure map, a bumper harvest, a master builder, a great feast, or (in a village) a free Raise a Prophet.

Planned: Matchmake, Inspire, Call a Festival, Commission, Avert Calamity, Found a Colony.

## Growth stages

| Stage | Population | Notes |
| --- | --- | --- |
| Settlement | 1–49 | Tents, round huts, mudbrick homes, fields, a well, a dock |
| Village | 50–249 | Market stalls, gathering hall, homes upgraded to mudbrick |
| Town | 250–1,999 | A charter and coat of arms (and a chance to rename), a paved square, a palisade with gates, two-storey houses, alehouses, healers, scribes, temples, guilds and guildhalls, a bridge to the far bank. The map widens from 64 to 128 tiles. |
| City | 2,000–9,999 | The map widens to 192 tiles, a second and third bridge, a bigger square. Planned: districts, factions, wonders |
| Metropolis | 10,000+ | The map widens to 256 tiles. Planned: crowd simulation at scale |

## What's simulated now (Phase 1)

- People with traits, trades, dreams, orientation, family trees and memories.
- Courtship, weddings (including same-sex couples), pregnancy, births and twins, coming of age, adoption of orphans.
- Illness, injuries at work, old age, childbirth, hunger and cold, all scaled by Darkness.
- Restless people leave on quests and return with plunder, knowledge, spouses, followers, relics or injuries, or never come back (and sometimes come back decades later).
- A self-planning settlement: homes, fields, workshops and civic buildings placed by need; footpaths worn by daily walking become the road network.
- Seasons with harvest swings, lean winters, and emigration after long hunger.
- Omens scaled by Weirdness. Everyday moments between the big events.
- Years named after their most memorable event.

### The living world

- **Day and night** follow your own clock by default (night when it's night where you are), or the city's own days (one every 15 minutes of work). People go indoors after dark and windows glow. Pausing no longer means night: when you rest, **time stands still**: people freeze mid-step, smoke hangs in the air, and the colors soften.
- **The woods run out**: each tree holds about 60 units of wood and leaves a stump when cut; woodcutters fell the nearest grown trees and walk farther as the woods thin; saplings spread from grown trees and take five years to grow. The Chronicle notices when the near woods thin and when they're gone (and when they come back).
- **Animals**: animal pens with herds of goats and sheep tended by herders (milk, cheese and wool), growing each spring, culled in hunger (never below a breeding few), raided by wolves in grim winters. Dogs and cats join families, follow their people about, grow old and die; a dog may keep vigil on its owner's grave, or pull a child from the river. Deer live in the woods in proportion to the trees, thinned by hunting. Ducks on the river, flocks of birds overhead.
- **Heirlooms**: named things with histories: swords and torcs brought home from quests, relics, masterworks made by long-practised potters and smiths, wedding keepsakes, and the keepsakes your own settlers bring. When their keepers die they pass to the eldest child (or spouse, grandchild, sibling), are sometimes buried with them, are lost with those who die far away, and come back with those who return. With no heir left, they hang in the gathering place.
- **Stopping time**: an optional time of day (e.g. 6:00 pm) at which a running session ends by itself.

### Village life (Phase 2)

- **Leadership**: in a settlement, people bring their quarrels to whoever they respect (the Eldest); in a village, ambitious people claim the chief's seat, sometimes contested, and a chief who grows unpopular can be challenged and unseated.
- **Laws**: leaders pass and repeal laws that match their personalities: Share the Harvest, Open Gates, the Fever Huts, Feast Days, Work from Dawn, No Blades at the Fire, the Elders' Voice, the Tithe to the Stone. Each has real effects, and people like or dislike each by their traits.
- **Faith**: omens, relics, plagues survived and answered prayers stir people; a pious, charismatic person founds a faith with two tenets. Faiths spread through families (young faiths with extra zeal), are passed to children, keep a holy day, split when they grow large, and fade if no one keeps them.
- **Plague**: arrives more often in crowded villages, spreads by contact, is slowed by the Fever Huts and healers, and burns out. Deadliness follows Darkness.
- **Fire**: thatch catches, especially in dry summers and around kilns; it spreads to neighbors (less with a well), leaves charred shells that are later cleared, and burned-out families get a tent.
- **Businesses**: kilns, forges and market stalls open under names (*The Red Kiln*, *Mira's Pots*) and pass to heirs.
- **Family houses**: big families (six or more under one roof) build a 2×2 family house.
- **Family tree** view for anyone.

### Arrivals and sacred places

- **People come on their own** a few times a year: more when the village is fed, housed, healthy and happy, fewer or none in hard times (a young settlement draws people even through a lean year). They come for what's here: work at the kiln or the furnace, fish from the dock, pasture, building work, the market, the healers. Open Gates brings more.
- **Sacred places**: people who range out (gatherers, herders, woodcutters, fishers, the restless and curious) sometimes find something in the country around the village: standing stones, an old grove, a spring, a barrow, a cairn, a vast old tree. Over the years they grow sacred: offerings and weddings, a spring that heals, holy places that stir faith, and faiths that honor the land, the ancestors or the river take them as their own. Pious people take comfort in them.
- **Nothing before its time**: discoveries that build on others wait for them (printing needs writing, banking needs coin, steam needs iron), and the Chronicle doesn't mention beer, money, wagons or iron before they exist.

### Saving

- Saved automatically every 30 seconds, with a backup from each of the last 7 days.
- **Save to a file / Open a village file**: in the Mac app through the system's own dialogs.
- **Start a new village**: the current one is kept, and you can go back to it (from Settings, or from the founding screen).

### Towns and ages (Phase 3, first part)

- **The map grows with the settlement**: each seed has one whole world (256 tiles across), and the map is a window onto its middle that widens at each stage, so the land beyond is always the same land. Cities founded before this carry their own river on past the old edge.
- **Knowledge and discoveries**: everyone learns a little by living; crafters, elders, curious and clever people, markets and scribes add more. Every so often (at random, about five years apart on average) someone makes a discovery (named in the Chronicle and on their card): the potter's wheel, the plough, barley beer (alehouses), healing herbs (healers' huts), writing (scribes), lime mortar, the aqueduct, the heavy plough, the printing press, the steam engine… 52 in all, with real effects on food, crafts, wood, building speed, health and childbirth.
- **Ages**: a great discovery starts an age named for it (the Age of the Wheel, the Age of Writing, the Age of Iron). The next era's great discoveries open once an era is well along, so which age opens an era (Iron, Law or Coin) depends on the city. At most two ages per era.
- **Side ages**, when the sliders allow: the Age of Plague after a deadly plague, the Age of Ash after a great fire (Darkness), the Age of Omens after omen upon omen, the Age of the Comet (Weirdness). They tint the world a little and pass after 12–20 years.
- **Era looks**: every building remembers the era it was built in; in a new era, old buildings are slowly rebuilt in the new way. Until there's art for an era, the most recent era's art is used.
- **Ceremonies**: a new age or a charter is marked by a card at the next break (never during work).
- **Towns** draw merchant caravans, journeymen, scholars and pilgrims as well as families. Guilds form when a trade has enough members, choose masters, raise halls, and make their members a little better at the work. Faiths with many followers raise temples.
- **Plagues** in big towns now burn out (they used to linger for years once a town passed several hundred people).

## Roadmap

1. **First Fire** (done): timer, goals, Sparks, Favor, four Acts, the Bronze settlement to village, Chronicle, saving, the art test scene. Plus the menu-bar clock and pausing when away.
2. **Village life** (done): leadership and laws, emergent religion, petitions, plague and fire, businesses, Fortunes, family trees.
3. **Town and city**: towns, the growing map, discoveries and ages (done). Next: districts, crime and trials, factions, neighbors, trade and war, Wonders.
4. **Metropolis**: crowd simulation, later eras, performance work, ambient sound.
5. **Polish and integrations**: Windows, Android and iOS, word-count integrations, sync between devices, optional AI-written chronicles.
