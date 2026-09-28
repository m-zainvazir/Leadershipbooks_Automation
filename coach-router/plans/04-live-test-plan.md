Test number removed — everything back to zero.

## No, my side isn't complete. Two things remain.

I won't tell you it's done when it isn't:

**1. Phase 5 is only half done.** The web gate is built and works — but the coach page still calls Voiceflow **directly**, so the gate protects nothing on the page real members use. It's still holding your API key in plain source. Repointing the chat at the Worker is the missing piece, and it's mine to write.

**2. The Voiceflow credit alarm** — deliberately not built. I couldn't find an endpoint that reports remaining credits, and I'd rather leave a known gap than fake coverage.

Everything else (Phases 0, 1, 2, 3, 4, 6, 7, activation UI) is built, deployed and verified. Both gates sit in `warn`: checked and logged, nobody refused.

---

# 1. Live test with your colleague

First, **open a live log window** and leave it running — this is the single most useful thing during testing:

```
npx wrangler tail
```

Every text and call shows up here in real time. Keep it visible.

### Step 1 — Does inbound SMS even reach us? *(the real unknown)*

Colleague texts anything — say `hello` — to **+1 854 254 5009**.

- **They get a reply** (a message about subscribers) → the Twilio webhook is correctly wired. This is the §7 question finally answered.
- **Nothing comes back, and `wrangler tail` shows nothing** → the Messaging Service is swallowing it. Fix: **Messaging → Services → your service → Integration → Send a webhook** → `https://coach-router.bookcoachai.workers.dev/twilio/sms`, POST. Check **Monitor → Logs → Messaging**.

Nothing else works until this does.

### Step 2 — Activate their phone

1. You open the coach lesson, press **Get my activation code**
2. Send the 6 characters to your colleague (WhatsApp, email, however)
3. **They text the code** to +1 854 254 5009 — within 15 minutes

Expected: Michael's greeting comes straight back.

Check it landed:
```
npm run subs -- --list
```
You should see their number under `entitled` and `linked handsets`.

### Step 3 — A real conversation

Colleague texts a genuine question — *"I struggle to delegate"*. Expected: a coaching reply, no code needed ever again.

### Step 4 — The phone call *(the best bit)*

Colleague calls **+1 854 254 5009**.

Expected: **straight into Michael.** No "welcome to the coach line", no code prompt, no name to say. That's the two-turn saving.

Then speak a question. Expect a 2-3 second pause; on a slow answer you may hear *"Let me think about that"* followed by the reply — that's the hold working, not a fault.

### Step 5 — Prove enforcement actually blocks

Right now it's in `warn`, so nothing is refused. To test the real thing:

```
# edit coaches.json -> shared.config.entitlementMode: "enforce"
npm run seed
```

Wait ~30 seconds, then:
- Colleague texts again → still works (they're linked)
- **Anyone else** texts → refused, with no coach names
- Anyone else calls → refused and hung up

To revert:
```
# edit coaches.json -> "warn"
npm run seed
```

Safe to try: only your contact holds the tag, so nobody real can be locked out.

### Step 6 — STOP compliance *(do this LAST)*

Colleague texts `STOP`. Expected: Twilio's own opt-out confirmation, not ours.

**Important:** this makes Twilio block that number. To undo, they text `START` or `UNSTOP`. Don't do it mid-test.

### Afterwards

Tell me and I'll unbind their number, or:
```
npm run subs -- --list     # see what's bound
```

---

# 2. What's left on your side

**Blocking a real launch:**

1. **Tag automation in Course360** — the one thing standing between this and working. When a coach course is granted, add `bookcoach-micheal-stickler-active`; when revoked, remove it. If removal can't be automated, say so and I'll reconcile against subscription records instead.
2. **The Twilio Messaging Service webhook** — Step 1 above tells you whether it needs setting.

**Security, and it needs sequencing:**

3. **Rotate the Voiceflow API key** — but in this order, or you'll take the coach offline: *(a)* I repoint the page at the Worker, *(b)* you rotate the key in Voiceflow, *(c)* update `vfKey` in `coaches.json` and run `npm run secrets`. Don't rotate before (a).

**Worth deciding soon:**

4. **Workers Paid, $5/month.** The free 1,000 writes/day works out to roughly 50 SMS conversations a day before writes start failing — and they fail hard.
5. **Advanced Opt-Out** on the Messaging Service, so Twilio sends the STOP/HELP compliance replies (§7).
6. **Ask Voiceflow support whether remaining credits are queryable.** If yes, I'll build the alarm.

**Optional:**

7. **Publish the Voiceflow project** — right now every canvas edit is instantly live to real users, with no staging.
8. **A staff tag** (`bookcoach-staff-all`) for testing without a real subscription.

---

Want me to repoint the chat to the Worker now? It closes the exposed-key hole and completes Phase 5 — and it's better done before your colleague testing than after, since it changes how the page talks to the coach.
