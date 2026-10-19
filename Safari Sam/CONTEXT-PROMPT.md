# Context prompt — Leadership Books, Book Coach AI, and Safari Sam

Paste everything below the line into a new AI chat (or hand it to a teammate) to give them the full
picture before you ask your question.

---

## Who we are

We are **Leadership Books**, a book publishing company. Our authors are mostly Christian leadership,
faith and personal-growth writers. On top of publishing, we sell a digital product called
**Book Coach AI**: for each author, we build an AI coach that talks like the author and teaches from
their book. A reader buys the book and gets time with "the author" as a coach.

We have **11 authors** in the system today (codes 1001–1011), for example Micheal Stickler
(*Life Without Reservation*), Freddy Davis (*The Truth Mirage*), Rick Meyer (*Running on Faith*) and
Chuck Gallagher (*Monday Morning Ethics*).

## How Book Coach AI works today

**The coach itself**
- Each author's coach is a **Voiceflow** agent. It has a global prompt (the author's voice and rules),
  playbooks for different kinds of conversation, and a **knowledge base** made from the author's book
  text, split by chapter.
- Readers can reach the coach three ways: a **web page** (a coach page hosted on GoHighLevel, at
  `book-coach.ai/<author>`), **SMS**, and **voice calls**. One US phone number serves every author.
- A small server we wrote (a **Cloudflare Worker** called `coach-router`) sits in front of
  Voiceflow. It routes each message or call to the right author's coach and checks whether the
  person is allowed in.
- If someone in crisis writes in, they always get a 988 crisis-line response, whether or not they
  have paid.

**How someone gets access (the business side)**
1. The reader buys the **physical book on Shopify** (a book + coach bundle, about $29.95).
2. About 21 days later (when the book should have arrived), a Shopify Flow tells **GoHighLevel
   (GHL)**, our CRM, to start a **10-day free coach trial**.
3. GHL puts a **tag** on the reader's contact, e.g. `bookcoach-<author>-active`. **That tag is the
   whole link between the two systems**: GHL writes it, the Worker reads it every 15 minutes and
   gives the person a 48-hour pass that keeps renewing while the tag is there.
4. GHL sends emails on day 0, 7, 9 and 10. On day 10, if they have not paid, the tag is removed and
   access stops.
5. To keep the coach, they pay **$59/month** through a GHL funnel page (Stripe). Cancelling removes
   the tag.
6. The reader also gets a free **Course360** course (GHL's course area). One lesson in it holds the
   coach page. From there they get a 6-character **activation code**, text it to the coach number,
   and their phone is linked to their account for good.

**How we add a new author**
We have an internal tool, the **BookCoach Author Dashboard** (runs on our own computer), that walks
through a 0–16 step checklist per author: build the Voiceflow coach, build the coach page from one
shared template, create the GHL tag and $59 product, make the Course360 course, create the Shopify
bundle, write the landing-page text, test with a real $0 order, and go live. It also checks every
live author for things that have quietly broken.

**Our working rules**
- Keep running costs as close to $0 as possible; extra features are switches that start off.
- Explain things in plain, simple language.
- The design idea we keep reusing: **the code/layout is built once, and only the content changes
  per author.** That is what lets one small team support many authors.

## The new idea: Safari Sam's Amazing World

**The author.** Dr. Gerald D. Robison ("Dr. G.") is a pastor and missions trainer who has trained
over 1,200 Bible teachers in 25+ countries. He writes for every age, from adult theology to
children's picture books. (His name is spelled *Robison*. Some of our folders say "Robbin" by
mistake.)

**His children's books — the focus.** The *Because He Liked It!* series (Parrhesia Publishing):
- *101 Glimpses of God's Glory in the Animal World* (63 pages) — hosted by the character
  **Safari Sam**
- *Cosmos* (91 pages) — space, earth, oceans, weather
- *Crabby Crabs* (73 pages) — sea creatures and oddball animals
- *Elephants Recall It All* (74 pages) — animal memory, senses, deep-sea creatures
- *Plants* (80 pages) — fruit, trees, seeds, flowers, meat-eating plants
- *Worms Curl and Twirl* (84 pages) — amphibians, insects, creatures that change shape
- *Because He Liked It! Coloring Book* (21 plates)

He also has two grief picture books (*Where Did Grandpa Go?* and *Where Did Grandma Go?*) and
*The Innkeeper*, a Christmas book for families.

**Every page of the series follows the same pattern:** the question *"Why did God do that?"*, one
creature or wonder, one surprising fact, a cartoon caption spoken by the creature, and the answer
*"BECAUSE HE LIKED IT!"* Every book has a Parent's Guide with four rules: take it slowly, ask
questions, follow curiosity, and bring it to life ("God liked this, too").

**What we want to build.** Not another Book Coach and **not a chatbot for kids**, but an interactive
illustrated world for **children aged 6 and up**, hosted by Safari Sam. Ideas so far:
- **Ask Safari Sam** — children talk to Sam and get fun, age-appropriate answers.
- **Interactive Adventures** — explore jungles, oceans, space and more in colourful illustrated
  places.
- **Safari Sam Videos** — short animated clips where Sam explains discoveries.
- **Explorer Badges** — earned for finishing adventures, asking questions, making discoveries.
- **Book integration** — QR codes in the books take a child straight into the matching adventure.
- **Parent-friendly**, with strong safety for children.

**The bigger picture.** If Safari Sam works, it becomes a **new product category** for Leadership
Books: other children's authors could bring their own characters and stories to life the same way.

**Early thinking (not decided):**
- The book's "question → fact → *Because He liked it!*" pattern is already a game loop. The child
  could shout the answer back to Sam.
- The ~465 book pages could become collectible discovery cards in an Explorer's Field Journal, and
  the books map onto regions of a world map (Ocean, Savanna & Jungle, Garden, Underground, Space).
- Voice-first, because many 6-year-olds cannot type well.
- Sam answers only from the children's books. He must never reach Dr. G.'s adult books (spiritual
  warfare, demons, judgment).
- Book QR codes could unlock that book's region, so books and the app sell each other — reusing our
  Shopify → GHL tag → access system.
- Things to settle early: children's privacy law (COPPA — a child's voice counts as personal
  information, so parents must consent first), a review of book pages for what suits a 6-year-old,
  a plan for hard moments (a child talking about death or harm), permission from the illustrators
  (Fred Sayers, Jordan Blackstone, Bob Drost) to animate their art, and the cost of voice.
- A sensible first step: one small region (e.g. the Ocean, about 10 cards), Sam's voice, the
  Field Journal, one badge and one QR code — then test it with a handful of real children.

## What I want from you

[Write your question or task here.]
