# Coach Router — pre-launch test checklist

Run against a deployed Worker with at least **two** coaches in KV, one `inline` and one `dial`. Use a real handset, not the Twilio Console simulator — the simulator does not exercise carrier filtering, speech recognition, or `<Dial>`.

Record pass/fail and the actual observed text; several of these fail *quietly*.

---

## 0 — Preflight

- [ ] `GET /health` returns `ok: true`, 200.
- [ ] Every coach shows `keyResolved: true`.
- [ ] Every `dial`-mode coach shows `dialNumberSet: true`.
- [ ] `twilioValidation` reads `"enabled"`, **not** `"DISABLED"`.
- [ ] A2P campaign status is **approved** in Twilio Console.
- [ ] `POST /twilio/sms` with a bogus `X-Twilio-Signature` header returns **403** and no TwiML.
- [ ] `POST /api/vf-interact` from an origin not in `ALLOWED_ORIGIN` returns **403**.

---

## 1 — SMS: right code

- [ ] From a number with no session, text a valid code (e.g. `1042`).
- [ ] Reply is that coach's launch greeting, in that author's voice.
- [ ] Reply contains **no** markdown: no `*`, `**`, `#`, `[label](url)`.
- [ ] Reply is under 900 characters.
- [ ] Reply ends with the `(Reply MENU to switch coaches.)` hint.
- [ ] Send a follow-up message; the coach answers in context, not as a new conversation.
- [ ] Text the coach's **name** instead of the code from a fresh number — routes to the same coach.
- [ ] Ask for a resource. Any link arrives as a bare URL on its own line, no markdown link syntax.

## 2 — SMS: wrong code

- [ ] Text `9999` (not in the registry) from a fresh number → coach menu, not an error.
- [ ] Text gibberish (`asdfgh`) from a fresh number → coach menu.
- [ ] Menu lists **every** coach in KV with code and name.
- [ ] Text `HELP` → menu plus the STOP/MENU instructions.

## 3 — SMS: switching

- [ ] With coach A pinned, text `MENU` → session cleared, menu returned.
- [ ] With coach A pinned, text `SWITCH` → same.
- [ ] With coach A pinned, text `RESET` → same.
- [ ] With coach A pinned, text **coach B's code directly** (no MENU first) → switches to B and returns B's greeting.
- [ ] After switching to B, a follow-up message is answered by B, not A.

## 4 — SMS: STOP

- [ ] With a session active, text `STOP` → the router itself sends **nothing**.
- [ ] Twilio's own Advanced Opt-Out compliance reply arrives (exactly one message total, not two).
- [ ] Text `START` to opt back in, then a code → conversation resumes cleanly.
- [ ] Repeat for `UNSUBSCRIBE`, `CANCEL`, `QUIT`.

## 5 — Session expiry

- [ ] Delete the session key manually to simulate the 12-hour timeout:
      `npx wrangler kv key delete "sess:sms:+1XXXXXXXXXX" --binding=COACH_KV --remote`
- [ ] Text an ordinary message (not a code) → coach menu, not a crash and not a stale coach.
- [ ] Text a code → new session, greeting returns.
- [ ] Confirm the sliding TTL works: send messages ~1 min apart for several turns and verify the session key's TTL is refreshed each time, not counting down from first contact.

## 6 — Voice: routing

- [ ] Call the public number → greeting plays, asks for name or four-digit code.
- [ ] Key a valid code on the keypad → routes to that coach.
- [ ] **Say** the author's name instead → routes to the same coach. (Speech hints are built from `aliases`; if this fails, the alias list is too thin.)
- [ ] Say a nickname or title in `aliases` (e.g. "Doctor Smith") → routes.
- [ ] Key an invalid code → **re-prompts**, does not hang up.
- [ ] Key an invalid code a second time → re-prompts again with a different line.
- [ ] Third failure → reads the coach list aloud, then a graceful goodbye. Codes are read digit by digit ("1 0 4 2"), not as "one thousand forty-two".
- [ ] Say nothing at all at the greeting → re-prompts rather than hanging in silence.

## 7 — Voice: `inline` mode

- [ ] Routes to an `inline` coach and speaks its greeting.
- [ ] Hold a 4–5 turn conversation. Each turn is answered in the author's voice.
- [ ] Turns are 2–3 sentences, not paragraphs (this is a Voiceflow prompt issue if it fails, not the Worker).
- [ ] Stay silent for one turn → "I'm still here whenever you're ready."
- [ ] Stay silent twice → graceful goodbye, call ends. No infinite loop.
- [ ] Press `0` mid-conversation → returns to the coach menu.
- [ ] Kill the session key mid-call, then speak → call redirects to the greeting rather than erroring.

## 8 — Voice: `dial` mode

- [ ] Routes to a `dial` coach: "Connecting you with <name> now," then the coach answers via Voiceflow's native telephony.
- [ ] Barge-in works — interrupting the coach mid-sentence stops it. (This is the tell that you really are on the Voiceflow leg and not still inline.)
- [ ] Turn latency is noticeably shorter than `inline`.
- [ ] The transcript in Voiceflow shows the **original caller's** number, not the router's number.
- [ ] Set a `dial` coach's `dialNumber` to an unreachable number → caller hears the "wasn't able to reach your coach" fallback, not a Twilio error tone.
- [ ] Blank out a `dial` coach's `dialNumber` in KV → caller hears the "not available by phone just yet" message; `/health` flags it.

## 9 — Crisis: SMS

- [ ] From a **fresh** number with no coach pinned, text crisis phrasing (e.g. "I don't want to be here anymore") → the crisis response with 988, **not** the coach menu. This is the Worker's safety net.
- [ ] With a coach pinned, text the same phrasing → the coach's own Crisis Care Guide responds in the author's voice. Verify it actually fires and does not get treated as ordinary coaching.
- [ ] Crisis reply contains no markdown and no clickable-link syntax.
- [ ] Test a phrase that is *not* a crisis but shares vocabulary ("this project is killing me", "I'm dying to know") → routes normally as ordinary coaching, no false positive.

## 10 — Crisis: voice

- [ ] Call and speak crisis phrasing **at the code prompt**, before choosing a coach → crisis response, not a menu re-prompt.
- [ ] With `CRISIS_TRANSFER_NUMBER` set → warm handoff, the caller is dialled through, not read a URL.
- [ ] With it unset → 988 is spoken as digits ("9 8 8"), clearly, and repeated once.
- [ ] Once a coach is pinned, crisis phrasing mid-conversation reaches that coach's Crisis Care Guide, and on voice it **offers a handoff rather than a link**.

## 11 — Cross-channel continuity

- [ ] From one handset, text a code and have a short exchange — mention something specific and memorable ("my daughter's name is Ruth").
- [ ] From the **same** handset, call the number and route to the **same** coach.
- [ ] `inline` mode: the coach recalls the SMS context. Both channels use `phone:<E.164>`, so this must hold. If it fails, the userID is not being shared.
- [ ] `dial` mode: **verify, don't assume.** Voiceflow's native telephony mints its own session identity once the legs are bridged. If continuity does not hold here, that is expected behaviour, not a Worker bug — record the result and decide per coach whether continuity or voice quality wins.
- [ ] Reverse the order: call first, then text. Same expectations.

## 12 — No URL is ever spoken aloud

The single most important voice test. Run it on **both** modes.

- [ ] Ask an `inline` coach for a book, a course, and the author's speaking info — anything that triggers the Resource or Referral Concierge.
- [ ] Listen to the full reply. **No** `http`, `www`, `dot com`, `slash`, or email address is spoken.
- [ ] The coach names the resource and offers: "I can text you that link if you'd like."
- [ ] Say "text me the link" → an SMS arrives at the calling number with the label and URL; the call continues.
- [ ] No all-caps word is read out letter by letter (the known "coach spells words out loud" bug). Listen specifically for acronyms and for `LORD` vs `Lord`.
- [ ] Repeat all of the above on a `dial` coach. Failures there are fixed in the **Voiceflow global prompt's channel rules**, not in the Worker — the Worker is out of the loop once bridged.

---

## 13 — Web regression (the pages must not break)

- [ ] Each repointed coach page loads its HeyGen avatar with the right avatar and voice.
- [ ] Chat holds a conversation through `/api/vf-interact`.
- [ ] Resource and Referral cards still render as **real clickable buttons**, not text and not markdown.
- [ ] `channel` is `web` on that session — web formatting is unchanged from before the migration.
- [ ] Old per-coach proxy Workers are deleted **only after** every page passes.

## 14 — Cost sanity

- [ ] Run one 20-message SMS session and one 10-minute `dial` call, then read the actual charges off Twilio and the credit draw off Voiceflow.
- [ ] Compare against the targets (~$0.30–0.40 and ~$1.00). Investigate anything more than ~2× off before opening to subscribers.
- [ ] Voiceflow usage alarm is configured well below the workspace cap. Agents stop responding when credits run out, with no mid-cycle top-up.
