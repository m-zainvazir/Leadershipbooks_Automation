# 01 — Safari Sam's Amazing World: world UI prototypes

Date: 2026-10-19
Status: prototypes built and checked in a browser (desktop and phone sizes), waiting for you to pick one

## What we are doing now

Build the **look and feel only** of the world a child walks around in:

- a main world with many **gates** (Home, Zoo, Sky, Space…), placed in a clear order, not scattered;
- you tap a gate, you go **in**; you see the creatures that belong there; you tap a creature and it reacts;
- you can come back **out** to the main world and pick another gate.

Not now (parked for later, on purpose): Ask Safari Sam, videos, badges, QR codes, parent area,
voice, logins. Nothing in the prototypes needs a server, an account or money.

## The gates (the same 21 in every option)

The categories list has 26 groups and 495 entries. A child does not think in "sea invertebrates",
they think in places: *home, farm, zoo, sea*. So the gates are **places**, and each place pulls
creatures from several categories. One creature can appear in more than one place (a lion is in the
Zoo **and** the Savanna) and shows the same card in both.

| Neighbourhood | Gate | What is inside (examples) | Comes mainly from these categories |
|---|---|---|---|
| Hometown | Home | dog in a kennel, cat on the sofa, goldfish bowl, hamster cage, canary, mouse | Pets and farm, Fish, Birds, Spiders |
| Hometown | Farm | cow, horse, goat, lamb, chickens, pig, turkey, duck | Pets and farm, Birds |
| Hometown | Garden | bee, butterfly, caterpillar, ladybug, worms, snail, sunflower, tomato, carrot | Insects, Crawlers, Fruits and vegetables, Trees and seeds |
| Hometown | Wonder Greenhouse | Venus fly-trap, pitcher plant, corpse flower, parrot flower, bubble plant | Meat-eating plants, Flowers that look like things, Odd plants, (Poisonous plants, behind glass) |
| Hometown | Park | squirrel, pigeon, crow, blue jay, duck pond, frog, turtle, hare, oak and maple trees | Birds, Wild mammals, Reptiles, Trees, Plants that "talk" |
| Hometown | Zoo | lion, tiger, elephant, giraffe, zebra, rhino, gorilla, panda, polar bear, penguin, kangaroo, koala, hippo, crocodile, flamingo, camel, parrot, sloth | Wild mammals, Birds, Reptiles |
| Wild Lands | Forest | bear, wolf, fox, deer, porcupine, tanuki, firefly, luna moth, salamander, oldest tree | Wild mammals, Insects, Amphibians, Trees and records |
| Wild Lands | Jungle | chimp, proboscis monkey, black panther, toucan, okapi, Pinocchio frog, harpy eagle, branch snake, tarantula | Wild mammals, Birds, Reptiles, Spiders |
| Wild Lands | Savanna | lion, elephant, cheetah, buffalo, warthog, dung beetle, termites, oxpecker, acacia, baobab | Wild mammals, Insects, Birds, Trees |
| Wild Lands | Desert | camel, fennec fox, roadrunner, coyote, lizard, teddy bear cholla, welwitschia, desert flowers, moving rocks | Wild mammals, Birds, Crawlers, Odd plants, Land and geology |
| Wild Lands | Mountains | snow leopard, mountain goat, bighorn sheep, llama, eagles, panda, Mount Everest | Wild mammals, Birds, Land and geology |
| Wild Lands | Polar Ice | polar bear, penguin, reindeer, seal, beluga, wolverine, ice worm, Antarctica, Arctic Circle | Wild mammals, Sea mammals, Oceans and ice |
| Wild Lands | Faraway Islands | kangaroo, lemur, kakapo, giant tortoise, marine iguana, Komodo dragon, echidna, wombat | Wild mammals, Birds, Reptiles |
| The Waters | Pond and River | beaver, giant otter, platypus, axolotl, salmon, catfish, water bug, mayfly, Mississippi | Water's edge, Fish, Insects, Land and geology |
| The Waters | Beach and Reef | crab, starfish, octopus, pufferfish, lobster, shrimp, jellyfish, sea slug, sea otter, Great Barrier Reef | Sea invertebrates, Fish, Sea mammals |
| The Waters | Open Ocean | blue whale, humpback, dolphin, great white, whale shark, sunfish, flying fish, albatross | Sea mammals, Fish, Birds |
| The Waters | Deep Sea | angler fish, vampire squid, dumbo octopus, lantern shark, barreleye, siphonophore, sea pig, tube worms, yeti crab | Fish, Sea invertebrates |
| Up, Down and Beyond | Sky | eagle, hummingbird, swift, monarch butterfly, lightning, mammatus clouds, fire rainbows | Birds, Insects, Weather and sky |
| Up, Down and Beyond | Night and Caves | bats (12 kinds), owl, oilbird, potoo, aye-aye, Mammoth Cave | Bats, Birds, Wild mammals, Land and geology |
| Up, Down and Beyond | Underground | star-nosed mole, prairie dog, ants, cicada, gold, diamond, volcano, Earth's core | Wild mammals, Insects, Earth, Land and geology |
| Up, Down and Beyond | Space | Sun, Moon, Earth, Mars, Jupiter, Saturn, black hole, Milky Way, meteors, Betelgeuse | Deep space, Sun and stars, Planets and moons |

21 gates in 4 neighbourhoods is a lot for a 6-year-old to take in at once, so every option groups
them into the 4 neighbourhoods and lets the child jump between them.

## Facts that do not suit a 6-year-old

Each creature shows one fact from the notes. For some, the first fact was not right for a young child,
so I picked a kinder fact from the same entry or swapped the creature for now:

- Swapped out: python ("has swallowed people"), orca (pulls out a shark's liver), scorpion ("could kill
  a small person"), coconut palm (falling coconuts kill people), clownfish and oyster (change sex),
  goblin shark and glass frog (the notes say the scan was unreadable).
- Other fact picked: ant (fungus takes over its mind), caterpillar (deadly poison), kangaroo (vicious
  boxing), acacia (3,000 dead antelope), camel, duck, horse, spider, snail, dolphin, black hole, Komodo.
- This is a small preview of the age review we will need for all 495 entries (see the context prompt).
  The choice is one setting per creature (`f` in `worlds.js`), so it is easy to change.

## Thin entries: what to merge

I counted the questions per entry in the compiled notes:

- 371 of 495 entries have **only one** question-and-answer. 124 have two or more.
- The richest: Snake 16, Cat 13, Elephant 13, Bee 12, Dog 12, Frog 12, Spider 9, Octopus 8.

One fact is enough for one tap, so most thin entries can stay. What I suggest merging (to decide
when we do the content step, not now):

1. **"General" duplicates into the specific ones:** Birds (general), Insect (general), Fish
   (general), Bats (general), Whale + Whales and dolphins, Spider, Snake, Lizard, Turtle, Worms.
   Their facts become extra "tell me more" facts on the matching creature.
2. **Pairs listed twice:** "Alligator and manatee" with Manatee; "Canary and ostrich" split into
   Canary and Ostrich; African giant snail with Great African land snail.
3. **Group cards for one-fact oddballs** in the same place, e.g. "Deep-sea oddballs" (Chaunacops,
   fish without a face, pigfish…), "Strange planets" (WASP-17b, CoRoT-7b, quartz-cloud world,
   alcohol cloud), "Bat cave" (the 12 bats as one card with 12 facts).
4. **Topics that are not creatures** (Albino animals, Dangerous animals, Heat-loving creatures,
   Earth's overpopulation, Light-year) become Sam's "Did you know?" lines in a place instead of
   creatures you tap.

## The options (three ways to lay out the main world)

Inside a gate is the **same in all three**, so you can compare only the main world.

### Option A — Explorer Street (side-scrolling)

A long street you swipe sideways, like a picture book or a platform game. The gates stand in a row:
Home, Farm, Garden, Greenhouse, Park, Zoo… then the road turns into the Wild Lands, then a
boardwalk by the sea, then a night path to the rocket. Sam walks to the gate you tap, the doors
swing open, and you go in.

- Good: closest to what you described ("next to the zoo gate there is a house gate"); very easy to
  understand; adding a new gate is just making the street longer.
- Watch out: 21 gates is a long walk; you only see a few gates at a time.

### Option B — Safari Island (map you look down on)

One big illustrated island seen from above. Every place sits where it belongs in nature: the town
and its six gates in the middle, mountains and caves in the north, forest and jungle to the west,
savanna and desert to the east, a river down to the beach and reef, the open ocean and a deep
trench around it, the ice in the far north, small faraway islands, a hot-air balloon for the sky
and a rocket pad for space. Tap a place: Sam's marker travels there and the map zooms in.

- Good: feels most like a real "world" to explore; you see everything at once; the map itself
  teaches where creatures live; QR codes could later drop a child straight onto one spot.
- Watch out: the map is the biggest drawing job for the illustrators; on a phone the map has to be
  dragged around; a new gate means finding room on the map.

### Option C — Top-to-Bottom World (cross-section, scroll up and down)

The world cut in half like a cake: space at the top, then sky, mountains and ice, the wild lands,
Hometown in the middle, and below it the underground on one side and the sea getting deeper and
darker on the other. You start at Hometown and scroll **up** to the stars or **down** to the deep
sea. A height bar on the side shows where Sam is.

- Good: my own suggestion. It teaches "where does it live: high, low, deep?"; vertical scrolling is
  natural on phones and tablets; Cosmos (space, sky, earth), the animal books and Plants all fit.
- Watch out: Hometown is a crowded row of 6; it feels more like a picture poster than free roaming.

### Other ideas I did not build (tell me if you want one tried)

- **Toy town in 3D (isometric):** like a tiny board-game town seen from an angle. Looks the most
  "game-like", but needs the most art.
- **Safari train line:** a metro-style map; each station is a gate; the train is the menu.
- **Mix of B and C:** the island as the home screen, with the rocket pad going *up* into a
  Sky-and-Space tower and the dive dock going *down* through the sea layers.

## Inside a gate (shared by all options)

Three kinds of inside, so we can see what works:

1. **Room scene (Home):** a doll's house cut open — bedroom with a hamster cage and a spider web,
   living room with the cat on the sofa and a goldfish bowl, kitchen with a canary cage and a mouse
   hole, backyard with the dog's kennel.
2. **Walk-along scene (Zoo):** a wide zoo path you swipe along, past 12 enclosures with fences,
   pools, ice, bamboo and trees.
3. **Quick scene (the other 19 gates):** built automatically from the list of creatures: sky,
   ground, water, stars, cave or deep dark sea (with a torch you move around to find creatures).

Tapping a creature: it jumps and says hi; a card slides up with the **book's question and fact**
(taken from the compiled notes), then a big button "Why did God make it like that?" shows
**BECAUSE HE LIKED IT!** — the books' own pattern. Sam stands in the corner and greets you in each
place. The "Leave" button takes you back out through the same gate.

## How it is built (and why)

- Plain web pages: HTML, CSS and JavaScript. No build tools, no server, no paid services
  (keeps the $0 rule). Opens by double-clicking the file, works offline.
- **Built once, content swapped:** all places and creatures live in one data file
  (`prototypes/shared/worlds.js`). The facts are copied from the compiled notes by a small script
  (`prototypes/tools/build-facts.mjs`). A different children's author would get a different data
  file, not different code — the same idea as the Book Coach template.
- **Emoji are stand-ins** for the real illustrations (Fred Sayers, Jordan Blackstone, Bob Drost).
  The layout, sizes and spots are made so a drawing can replace each emoji later.
- Sam is a simple drawn stand-in (explorer in a pith helmet, as in the books).
- Fonts: a comic-book headline font for "BECAUSE HE LIKED IT!" and Andika, a font made for
  children who are learning to read.
- Sized for tablets first (landscape), still usable on a phone and a computer.

## Files

```
Safari Sam/prototypes/
  index.html              ← start here: picks between the three options
  option-a-street.html    ← Explorer Street
  option-b-island.html    ← Safari Island
  option-c-updown.html    ← Top-to-Bottom World
  shared/worlds.js        ← the 21 places and their creatures (content)
  shared/facts.js         ← made by the script from the compiled notes
  shared/scene.js         ← the inside of a gate (same for all options)
  shared/scene.css
  tools/build-facts.mjs   ← re-makes facts.js:  node tools/build-facts.mjs
```

## My pick

**Option B, Safari Island.** It feels most like a world a child wants to explore, everything is visible
at once, and the map teaches where creatures live. If later we want the up-and-down idea, the rocket pad
and a dive dock on the island can lead *up* into a Sky-and-Space tower and *down* through the sea layers
(the B + C mix). Option A is the simplest to build and grow; Option C works best on phones.

## How to open them

- On this computer: double-click `Safari Sam/prototypes/index.html` (works offline; fonts need internet).
- Or the private link from the chat (a claude.ai page with the same files).

## What I need from you

1. Open the three options and walk around (try Home and Zoo first, they are the fully built ones).
2. Pick one main world (or a mix, e.g. "B, but with C's up-and-down for space and sea").
3. Tell me anything about the inside of a gate you want different.

## After you pick

1. Build the chosen main world fully (all 21 gates with proper scenes, not quick scenes).
2. Map every one of the 495 entries to a gate and apply the merges above (content step).
3. A short list of what the illustrators would need to draw (gates, backgrounds, creatures).
4. Then, one by one, the parked ideas (Sam's voice, badges, QR codes, parents area).
