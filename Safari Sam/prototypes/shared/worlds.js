/* Safari Sam's Amazing World — the content (places and creatures).
   This is the only file that changes per book or per author; the pages read it.

   Place fields
     id, name, icon        what the child sees on the gate
     hood                  which neighbourhood the gate belongs to (see HOODS)
     gate                  shape of the gate in Option A: door | arch | cave | round
     scene                 home | zoo (hand-built) or quick (built from the creature list)
     kind                  look of a quick scene: land | glass | ice | water | deep | sky | night | under | space
     sky, ground, decor    colours and background emoji for a quick scene
     greet                 what Sam says when you come in
   Creature fields
     k  name exactly as in "1. BHLI-compiled-noref.md" (used to pull the fact)
     n  name shown to the child      e  stand-in picture (emoji) until the real art
     z  'air' = flies (sits high in land scenes)     s  size (1 = normal)
     f  which of the book's facts to show (0 = first)  */

window.SAFARI = {
  hoods: [
    { id: 'town',   name: 'Hometown',          icon: '🏡', color: '#e0662e' },
    { id: 'wild',   name: 'Wild Lands',        icon: '🌄', color: '#4f8a35' },
    { id: 'water',  name: 'The Waters',        icon: '🌊', color: '#1b78b4' },
    { id: 'beyond', name: 'Up, Down & Beyond', icon: '🚀', color: '#5a46b0' }
  ],

  worlds: [
    /* ---------- Hometown ---------- */
    { id: 'home', name: 'Home', icon: '🏠', hood: 'town', gate: 'door', scene: 'home', peek: '#ffd59e',
      greet: 'This is my house! Pets live here with us. Tap one to say hello.',
      creatures: [
        { k: 'Dog', n: 'Dog', e: '🐕' },
        { k: 'Cat', n: 'Cat', e: '🐈' },
        { k: 'Siberian dwarf hamster', n: 'Hamster', e: '🐹' },
        { k: 'Fish that tells composers apart (probably goldfish)', n: 'Goldfish', e: '🐠' },
        { k: 'Canary and ostrich', n: 'Canary', e: '🐤' },
        { k: 'Mouse', n: 'Mouse', e: '🐭' },
        { k: 'Spider', n: 'Spider', e: '🕷️', f: 6 }
      ] },

    { id: 'farm', name: 'Farm', icon: '🐄', hood: 'town', gate: 'door', scene: 'quick', kind: 'land',
      sky: ['#9fd8ff', '#eaf8ff'], ground: '#9ccc65', decor: '🌾🏡🌾🚜🌾🌻', peek: '#cfe8a8',
      greet: 'Moo, baa, cluck! Farm animals help us every day.',
      creatures: [
        { k: 'Cow', n: 'Cow', e: '🐄', s: 1.2 },
        { k: 'Horse', n: 'Horse', e: '🐎', s: 1.2, f: 1 },
        { k: 'Goat', n: 'Goat', e: '🐐' },
        { k: 'Lamb', n: 'Lamb', e: '🐑' },
        { k: 'Pig', n: 'Pig', e: '🐖' },
        { k: 'Ankole-Watusi (cattle)', n: 'Watusi Cattle', e: '🐂', s: 1.2 },
        { k: 'Chicken', n: 'Chicken', e: '🐔', s: 0.8 },
        { k: 'Silkie chicken', n: 'Silkie Chicken', e: '🐓', s: 0.8 },
        { k: 'Turkey', n: 'Turkey', e: '🦃', s: 0.9 },
        { k: 'Duck', n: 'Duck', e: '🦆', s: 0.8, f: 1 }
      ] },

    { id: 'garden', name: 'Garden', icon: '🌻', hood: 'town', gate: 'arch', scene: 'quick', kind: 'land',
      sky: ['#a7e3ff', '#f2fbff'], ground: '#7cc35a', decor: '🌷🌼🌷🪴🌼🌷', peek: '#bfe8a0',
      greet: 'Shhh… look closely. Tiny creatures are everywhere in the garden!',
      creatures: [
        { k: 'Bee', n: 'Bee', e: '🐝', z: 'air', s: 0.8 },
        { k: 'Butterfly', n: 'Butterfly', e: '🦋', z: 'air', s: 0.9 },
        { k: 'Caterpillar', n: 'Caterpillar', e: '🐛', s: 0.8, f: 1 },
        { k: 'Ladybug', n: 'Ladybug', e: '🐞', s: 0.7 },
        { k: 'Worms', n: 'Worm', e: '🪱', s: 0.8 },
        { k: 'Snail', n: 'Snail', e: '🐌', s: 0.8, f: 1 },
        { k: 'Grasshopper', n: 'Grasshopper', e: '🦗', s: 0.8 },
        { k: 'Sunflower', n: 'Sunflower', e: '🌻', s: 1.3 },
        { k: 'Tomato', n: 'Tomato', e: '🍅', s: 0.9 },
        { k: 'Carrot', n: 'Carrot', e: '🥕', s: 0.9 },
        { k: 'Dandelion', n: 'Dandelion', e: '🌼', s: 0.9 }
      ] },

    { id: 'greenhouse', name: 'Wonder Greenhouse', icon: '🪴', hood: 'town', gate: 'door', scene: 'quick', kind: 'glass',
      sky: ['#d6f3e4', '#f4fff9'], ground: '#8d6e63', decor: '🪴🌿🪴🌿🪴', peek: '#c9eedb',
      greet: 'Welcome to the strangest plants in the world. Some of them eat bugs!',
      creatures: [
        { k: 'Venus fly-trap', n: 'Venus Fly-trap', e: '🪤' },
        { k: 'Pitcher plants (monkey cup)', n: 'Pitcher Plant', e: '🏺' },
        { k: 'Sundew', n: 'Sundew', e: '🌱' },
        { k: 'Corpse flower (titan arum)', n: 'Corpse Flower', e: '🥀', s: 1.3 },
        { k: 'Parrot flower', n: 'Parrot Flower', e: '🌺' },
        { k: 'Flying duck flower', n: 'Flying Duck Flower', e: '🪻' },
        { k: 'Laughing bumblebee orchid', n: 'Bumblebee Orchid', e: '🌸' },
        { k: 'Bubble plant', n: 'Bubble Plant', e: '🫧' },
        { k: 'Bleeding tooth plant', n: 'Bleeding Tooth', e: '🍄' },
        { k: 'Lithops', n: 'Living Stones', e: '🪨', s: 0.8 }
      ] },

    { id: 'park', name: 'Park', icon: '🌳', hood: 'town', gate: 'arch', scene: 'quick', kind: 'land',
      sky: ['#8fd3ff', '#e8f7ff'], ground: '#8bc34a', decor: '🌳🌲🌳⛲🌳🌲', peek: '#bde6a1',
      greet: 'The park is full of neighbours we hardly notice. Let’s meet them!',
      creatures: [
        { k: 'Squirrel', n: 'Squirrel', e: '🐿️' },
        { k: 'Pigeon', n: 'Pigeon', e: '🕊️', z: 'air' },
        { k: 'Crow', n: 'Crow', e: '🐦‍⬛', z: 'air' },
        { k: 'Blue jay', n: 'Blue Jay', e: '🐦', z: 'air' },
        { k: 'Mandarin duck', n: 'Mandarin Duck', e: '🦆' },
        { k: 'Frog', n: 'Frog', e: '🐸', s: 0.8 },
        { k: 'Turtle', n: 'Turtle', e: '🐢', s: 0.9 },
        { k: 'Brown hare', n: 'Hare', e: '🐇' },
        { k: 'Oak tree', n: 'Oak Tree', e: '🌳', s: 1.5 },
        { k: 'Maple tree', n: 'Maple Tree', e: '🍁', s: 1.1 }
      ] },

    { id: 'zoo', name: 'Zoo', icon: '🦁', hood: 'town', gate: 'arch', scene: 'zoo', peek: '#f4d27a',
      greet: 'Welcome to the zoo! Walk along the path and tap any animal.',
      creatures: [
        { k: 'Lion', n: 'Lion', e: '🦁' },
        { k: 'Tiger', n: 'Tiger', e: '🐅' },
        { k: 'Elephant', n: 'Elephant', e: '🐘' },
        { k: 'Giraffe', n: 'Giraffe', e: '🦒' },
        { k: 'Zebra', n: 'Zebra', e: '🦓' },
        { k: 'Rhino', n: 'Rhino', e: '🦏' },
        { k: 'Gorilla', n: 'Gorilla', e: '🦍' },
        { k: 'Giant panda', n: 'Giant Panda', e: '🐼' },
        { k: 'Polar bear', n: 'Polar Bear', e: '🐻‍❄️' },
        { k: 'Penguin', n: 'Penguin', e: '🐧' },
        { k: 'Kangaroo', n: 'Kangaroo', e: '🦘', f: 1 },
        { k: 'Koala', n: 'Koala', e: '🐨' },
        { k: 'Hippo', n: 'Hippo', e: '🦛' },
        { k: 'Crocodile', n: 'Crocodile', e: '🐊' },
        { k: 'Flamingo', n: 'Flamingo', e: '🦩' },
        { k: 'Camel', n: 'Camel', e: '🐫', f: 1 },
        { k: 'Parrot', n: 'Parrot', e: '🦜' },
        { k: 'Sloth', n: 'Sloth', e: '🦥' }
      ] },

    /* ---------- Wild Lands ---------- */
    { id: 'forest', name: 'Forest', icon: '🌲', hood: 'wild', gate: 'arch', scene: 'quick', kind: 'land',
      sky: ['#b7e4c7', '#eefaf1'], ground: '#4f8a3c', decor: '🌲🌲🌳🌲🌲🌳🌲', peek: '#9fd0a8',
      greet: 'Tall trees, soft moss… who is hiding in the forest?',
      creatures: [
        { k: 'Bear', n: 'Bear', e: '🐻', s: 1.3 },
        { k: 'Wolf and raven', n: 'Wolf', e: '🐺' },
        { k: 'Fox', n: 'Fox', e: '🦊' },
        { k: 'Muntjac deer', n: 'Muntjac Deer', e: '🦌' },
        { k: 'Porcupine', n: 'Porcupine', e: '🦔', s: 0.8 },
        { k: 'Raccoon dog (tanuki)', n: 'Tanuki', e: '🦝', s: 0.9 },
        { k: 'Salamander', n: 'Salamander', e: '🦎', s: 0.8 },
        { k: 'Firefly', n: 'Firefly', e: '✨', z: 'air', s: 0.8 },
        { k: 'Luna moth', n: 'Luna Moth', e: '🦋', z: 'air', s: 0.8 },
        { k: 'Oldest living tree', n: 'Oldest Tree', e: '🌲', s: 1.6 }
      ] },

    { id: 'jungle', name: 'Jungle', icon: '🌴', hood: 'wild', gate: 'arch', scene: 'quick', kind: 'land',
      sky: ['#8ed1a0', '#dff5e4'], ground: '#3f7f3a', decor: '🌴🌿🌴🌳🌴🌿🌴', peek: '#86c995',
      greet: 'It’s hot and green in the jungle. Listen… something is moving!',
      creatures: [
        { k: 'Chimpanzee', n: 'Chimpanzee', e: '🐒' },
        { k: 'Proboscis monkey', n: 'Proboscis Monkey', e: '🐵' },
        { k: 'Black panther', n: 'Black Panther', e: '🐆' },
        { k: 'Okapi', n: 'Okapi', e: '🦓' },
        { k: 'Spike-nosed tree frog', n: 'Pinocchio Frog', e: '🐸', s: 0.8 },
        { k: 'Snake', n: 'Branch Snake', e: '🐍', f: 13 },
        { k: 'Tarantula', n: 'Tarantula', e: '🕷️', s: 0.8 },
        { k: 'Toucan', n: 'Toucan', e: '🦜', z: 'air' },
        { k: 'Harpy eagle', n: 'Harpy Eagle', e: '🦅', z: 'air' }
      ] },

    { id: 'savanna', name: 'Savanna', icon: '🦒', hood: 'wild', gate: 'arch', scene: 'quick', kind: 'land',
      sky: ['#ffcf7a', '#fff2d2'], ground: '#d9b65c', decor: '🌳 ⛰️ 🌳  🌳', peek: '#f2cf86',
      greet: 'The savanna! Wide grass, big sky and the biggest animals on land.',
      creatures: [
        { k: 'Lion', n: 'Lion', e: '🦁' },
        { k: 'Elephant', n: 'Elephant', e: '🐘', s: 1.4 },
        { k: 'Cheetah', n: 'Cheetah', e: '🐆' },
        { k: 'Cape buffalo', n: 'Cape Buffalo', e: '🐃', s: 1.2 },
        { k: 'Warthog', n: 'Warthog', e: '🐗' },
        { k: 'Dung beetle', n: 'Dung Beetle', e: '🪲', s: 0.7 },
        { k: 'Termite', n: 'Termite', e: '🐜', s: 0.7 },
        { k: 'African oxpecker', n: 'Oxpecker', e: '🐦', z: 'air' },
        { k: 'Acacia tree', n: 'Acacia Tree', e: '🌳', s: 1.5, f: 2 },
        { k: 'Baobab', n: 'Baobab Tree', e: '🌳', s: 1.6 }
      ] },

    { id: 'desert', name: 'Desert', icon: '🌵', hood: 'wild', gate: 'arch', scene: 'quick', kind: 'land',
      sky: ['#ffb870', '#ffe9c7'], ground: '#e8c07a', decor: '🌵 🏜️ 🌵 🌵 🏜️', peek: '#f6c98a',
      greet: 'Phew, the desert is hot! Plants and animals here have clever tricks.',
      creatures: [
        { k: 'Camel', n: 'Camel', e: '🐫', s: 1.3, f: 1 },
        { k: 'Fennec fox', n: 'Fennec Fox', e: '🦊' },
        { k: 'Roadrunner', n: 'Roadrunner', e: '🐦' },
        { k: 'Coyote (vs. roadrunner)', n: 'Coyote', e: '🐺' },
        { k: 'Death Valley wildflowers', n: 'Desert Flowers', e: '🌼', s: 0.9 },
        { k: 'Lizard', n: 'Lizard', e: '🦎', s: 0.8 },
        { k: 'Teddy bear cholla', n: 'Teddy Bear Cactus', e: '🌵', s: 1.2 },
        { k: 'Welwitschia', n: 'Welwitschia', e: '🌿' },
        { k: 'Death Valley moving rocks', n: 'Moving Rocks', e: '🪨' }
      ] },

    { id: 'mountains', name: 'Mountains', icon: '🏔️', hood: 'wild', gate: 'cave', scene: 'quick', kind: 'land',
      sky: ['#9ec9ff', '#eaf3ff'], ground: '#a3acaf', decor: '🏔️⛰️🏔️⛰️🏔️', peek: '#c6d7ea',
      greet: 'We’re up high now! Hold on tight, these animals are great climbers.',
      creatures: [
        { k: 'Snow leopard', n: 'Snow Leopard', e: '🐆' },
        { k: 'Mountain goat', n: 'Mountain Goat', e: '🐐' },
        { k: 'Bighorn sheep', n: 'Bighorn Sheep', e: '🐏' },
        { k: 'Llama', n: 'Llama', e: '🦙' },
        { k: 'Giant panda', n: 'Giant Panda', e: '🐼' },
        { k: 'Bearded vulture', n: 'Bearded Vulture', e: '🦅', z: 'air' },
        { k: 'Eagle', n: 'Eagle', e: '🦅', z: 'air' },
        { k: 'Mount Everest', n: 'Mount Everest', e: '🏔️', s: 1.5 },
        { k: 'Tibetan Plateau', n: 'Tibetan Plateau', e: '⛰️', s: 1.2 }
      ] },

    { id: 'polar', name: 'Polar Ice', icon: '🧊', hood: 'wild', gate: 'cave', scene: 'quick', kind: 'ice',
      sky: ['#bfe3ff', '#f4fbff'], ground: '#f4f9ff', decor: '🧊 🏔️ 🧊 ❄️ 🧊', peek: '#d9efff',
      greet: 'Brrr! Welcome to the land of ice and snow.',
      creatures: [
        { k: 'Polar bear', n: 'Polar Bear', e: '🐻‍❄️', s: 1.3 },
        { k: 'Penguin', n: 'Penguin', e: '🐧' },
        { k: 'Reindeer', n: 'Reindeer', e: '🦌', s: 1.1 },
        { k: 'Seal', n: 'Seal', e: '🦭' },
        { k: 'Wolverine', n: 'Wolverine', e: '🦡' },
        { k: 'Beluga', n: 'Beluga', e: '🐳' },
        { k: 'Ice worm', n: 'Ice Worm', e: '🪱', s: 0.7 },
        { k: 'Antarctica', n: 'Antarctica', e: '🗻', s: 1.3 },
        { k: 'Arctic Circle', n: 'Arctic Circle', e: '❄️' }
      ] },

    { id: 'islands', name: 'Faraway Islands', icon: '🏝️', hood: 'wild', gate: 'arch', scene: 'quick', kind: 'land',
      sky: ['#7fdcff', '#e6fbff'], ground: '#f0d898', decor: '🌴 🏝️ 🌴 🌋 🌴', peek: '#a9e6f0',
      greet: 'We sailed a long way! Animals here live nowhere else on Earth.',
      creatures: [
        { k: 'Kangaroo', n: 'Kangaroo', e: '🦘', s: 1.2, f: 1 },
        { k: 'Echidna', n: 'Echidna', e: '🦔', s: 0.8 },
        { k: 'Ring-tailed lemur', n: 'Ring-tailed Lemur', e: '🐒' },
        { k: 'Kakapo', n: 'Kakapo', e: '🦜' },
        { k: 'Espanola giant tortoise', n: 'Giant Tortoise', e: '🐢', s: 1.2 },
        { k: 'Marine iguana', n: 'Marine Iguana', e: '🦎' },
        { k: 'Komodo dragon', n: 'Komodo Dragon', e: '🦎', s: 1.3, f: 1 },
        { k: 'Wombat', n: 'Wombat', e: '🐻', s: 0.9 }
      ] },

    /* ---------- The Waters ---------- */
    { id: 'pond', name: 'Pond & River', icon: '🦫', hood: 'water', gate: 'round', scene: 'quick', kind: 'water',
      sky: ['#8fd8c8', '#2c7a68'], ground: '#6d5a3a', decor: '🌾🪷🌾🪨🌾🪷', peek: '#7cc9b8',
      greet: 'Splash! Let’s peek under the water of the pond and the river.',
      creatures: [
        { k: 'Beaver', n: 'Beaver', e: '🦫' },
        { k: 'Giant otter', n: 'Giant Otter', e: '🦦' },
        { k: 'Platypus', n: 'Platypus', e: '🦆' },
        { k: 'Axolotl', n: 'Axolotl', e: '🦎', s: 0.8 },
        { k: 'Salmon', n: 'Salmon', e: '🐟' },
        { k: 'Catfish', n: 'Catfish', e: '🐟', s: 1.1 },
        { k: 'Giant water bug', n: 'Water Bug', e: '🪲', s: 0.7 },
        { k: 'Mayfly', n: 'Mayfly', e: '🪰', s: 0.6 },
        { k: 'Mississippi River', n: 'Mississippi River', e: '🏞️' }
      ] },

    { id: 'reef', name: 'Beach & Reef', icon: '🐠', hood: 'water', gate: 'round', scene: 'quick', kind: 'water',
      sky: ['#5fd4f0', '#0f6fa8'], ground: '#f1d9a0', decor: '🪸🪸🐚🪨🪸🪸', peek: '#6fd0ec',
      greet: 'Welcome to the reef! It’s the most colourful place in the sea.',
      creatures: [
        { k: 'Sea slug', n: 'Sea Slug', e: '🐌', f: 1 },
        { k: 'Octopus', n: 'Octopus', e: '🐙' },
        { k: 'Starfish', n: 'Starfish', e: '⭐', s: 0.8 },
        { k: 'Red crab', n: 'Red Crab', e: '🦀', s: 0.8 },
        { k: 'Pufferfish', n: 'Pufferfish', e: '🐡' },
        { k: 'Lobster', n: 'Lobster', e: '🦞' },
        { k: 'Jellyfish', n: 'Jellyfish', e: '🪼' },
        { k: 'Sea otter', n: 'Sea Otter', e: '🦦' },
        { k: 'Shrimp', n: 'Shrimp', e: '🦐', s: 0.8 },
        { k: 'Great Barrier Reef', n: 'Great Barrier Reef', e: '🪸', s: 1.3 }
      ] },

    { id: 'ocean', name: 'Open Ocean', icon: '🐋', hood: 'water', gate: 'round', scene: 'quick', kind: 'water',
      sky: ['#3aa0e0', '#0b3f7a'], ground: '', decor: '', peek: '#3d97d6',
      greet: 'Blue water as far as you can see. The biggest animal ever lives here!',
      creatures: [
        { k: 'Blue whale', n: 'Blue Whale', e: '🐋', s: 1.8 },
        { k: 'Humpback whale', n: 'Humpback Whale', e: '🐳', s: 1.4 },
        { k: 'Dolphin', n: 'Dolphin', e: '🐬', f: 1 },
        { k: 'Great white shark', n: 'Great White Shark', e: '🦈', s: 1.2 },
        { k: 'Whale shark', n: 'Whale Shark', e: '🦈', s: 1.5 },
        { k: 'Ocean sunfish', n: 'Sunfish', e: '🐟', s: 1.1 },
        { k: 'Garnai fish (flying fish)', n: 'Flying Fish', e: '🐟', s: 0.8 },
        { k: 'Giant manta ray', n: 'Manta Ray', e: '🐟', s: 1.2 },
        { k: 'Albatross (and terns)', n: 'Albatross', e: '🕊️' }
      ] },

    { id: 'deep', name: 'Deep Sea', icon: '🔦', hood: 'water', gate: 'round', scene: 'quick', kind: 'deep',
      sky: ['#0a1838', '#02040c'], ground: '', decor: '', peek: '#0e2a5a',
      greet: 'It’s very dark down here! Move your flashlight to find the creatures.',
      creatures: [
        { k: 'Angler fish', n: 'Angler Fish', e: '🐡' },
        { k: 'Vampire squid', n: 'Vampire Squid', e: '🦑' },
        { k: 'Dumbo octopus', n: 'Dumbo Octopus', e: '🐙' },
        { k: 'Lantern shark', n: 'Lantern Shark', e: '🦈', f: 1 },
        { k: 'Barreleye fish', n: 'Barreleye', e: '🐟' },
        { k: 'Siphonophore', n: 'Siphonophore', e: '🪼' },
        { k: 'Sea pig', n: 'Sea Pig', e: '🐖', s: 0.8 },
        { k: 'Yeti crab', n: 'Yeti Crab', e: '🦀', s: 0.8 },
        { k: 'Tube worms', n: 'Tube Worms', e: '🪱' },
        { k: 'Single-celled glowing organism', n: 'Glowing Sparkles', e: '✨', s: 0.8 }
      ] },

    /* ---------- Up, Down & Beyond ---------- */
    { id: 'sky', name: 'Sky', icon: '☁️', hood: 'beyond', gate: 'arch', scene: 'quick', kind: 'sky',
      sky: ['#5fbfff', '#e3f4ff'], ground: '', decor: '', peek: '#a6dcff',
      greet: 'Wheee, we’re flying! Birds, butterflies and even the weather live up here.',
      creatures: [
        { k: 'Eagle', n: 'Eagle', e: '🦅' },
        { k: 'Hummingbird', n: 'Hummingbird', e: '🐦', s: 0.7 },
        { k: 'European swift', n: 'Swift', e: '🐦', s: 0.8 },
        { k: 'Roller pigeon', n: 'Roller Pigeon', e: '🕊️', s: 0.9 },
        { k: 'Monarch butterfly', n: 'Monarch Butterfly', e: '🦋', s: 0.8 },
        { k: 'Lightning', n: 'Lightning', e: '⚡', s: 1.2 },
        { k: 'Mammatus clouds', n: 'Bubble Clouds', e: '☁️', s: 1.3 },
        { k: 'Fire rainbows', n: 'Fire Rainbow', e: '🌈', s: 1.3 },
        { k: 'Weather forecasting', n: 'Weather', e: '🌦️' }
      ] },

    { id: 'night', name: 'Night & Caves', icon: '🦇', hood: 'beyond', gate: 'cave', scene: 'quick', kind: 'night',
      sky: ['#1b1838', '#3a2e57'], ground: '#2a2238', decor: '', peek: '#3a3168',
      greet: 'Night-time in the cave. Bats wake up when we go to sleep!',
      creatures: [
        { k: 'Bats (general)', n: 'Bat', e: '🦇', z: 'air' },
        { k: 'Fruit bat', n: 'Fruit Bat', e: '🦇', z: 'air', s: 1.2 },
        { k: 'Honduran white bat', n: 'White Bat', e: '🦇', z: 'air', s: 0.8 },
        { k: 'Kitti’s hog-nosed bat', n: 'Bumblebee Bat', e: '🦇', z: 'air', s: 0.6 },
        { k: 'Owl', n: 'Owl', e: '🦉' },
        { k: 'Oilbird', n: 'Oilbird', e: '🐦' },
        { k: 'Great potoo', n: 'Great Potoo', e: '🐦' },
        { k: 'Aye-aye', n: 'Aye-aye', e: '🐒' },
        { k: 'Mammoth Cave', n: 'Mammoth Cave', e: '🕳️', s: 1.3 }
      ] },

    { id: 'underground', name: 'Underground', icon: '⛏️', hood: 'beyond', gate: 'cave', scene: 'quick', kind: 'under',
      sky: ['#8d6e4f', '#3e2a1c'], ground: '', decor: '', peek: '#9a7552',
      greet: 'Let’s dig down deep! Tunnels, treasure and the hot middle of the Earth.',
      creatures: [
        { k: 'Star-nosed mole', n: 'Star-nosed Mole', e: '🐀' },
        { k: 'Prairie dog', n: 'Prairie Dog', e: '🐿️' },
        { k: 'Ant', n: 'Ant', e: '🐜', s: 0.7, f: 1 },
        { k: 'Cicada', n: 'Cicada', e: '🦗', s: 0.8 },
        { k: 'Gold', n: 'Gold', e: '🪙', s: 0.9 },
        { k: 'Diamond', n: 'Diamond', e: '💎', s: 0.9 },
        { k: 'Tectonic plates', n: 'Tectonic Plates', e: '🧩' },
        { k: 'Volcano', n: 'Volcano', e: '🌋', s: 1.3 },
        { k: "Earth's core", n: 'Earth’s Core', e: '🔥', s: 1.2 }
      ] },

    { id: 'space', name: 'Space', icon: '🚀', hood: 'beyond', gate: 'arch', scene: 'quick', kind: 'space',
      sky: ['#0b0b2a', '#1c0f3d'], ground: '', decor: '', peek: '#1a1650',
      greet: '3… 2… 1… blast off! Look at all the wonders God put in the sky.',
      creatures: [
        { k: 'Sun', n: 'Sun', e: '☀️', s: 1.6 },
        { k: 'Moon', n: 'Moon', e: '🌕' },
        { k: 'Earth (shape, spin and speed)', n: 'Earth', e: '🌍', s: 1.2 },
        { k: 'Mars mountain', n: 'Mars', e: '🔴', s: 0.9 },
        { k: 'Jupiter', n: 'Jupiter', e: '🟠', s: 1.4 },
        { k: 'Saturn', n: 'Saturn', e: '🪐', s: 1.3 },
        { k: 'Black hole', n: 'Black Hole', e: '⚫', f: 2 },
        { k: 'Milky Way', n: 'Milky Way', e: '🌌', s: 1.2 },
        { k: 'Meteors and asteroids', n: 'Meteors', e: '☄️' },
        { k: 'Betelgeuse', n: 'Betelgeuse', e: '⭐' }
      ] }
  ]
};
