# Live test with a colleague — no terminal needed

Everything here is done in a browser or on a phone. Where a step would normally need a command,
message Claude instead and it will be run for you.

**The phone number under test: +1 854 254 5009**

---

## Before you start (2 minutes, browser only)

**Tab 1 — the logs.** Cloudflare dashboard → **Workers & Pages → coach-router → Logs**.
Leave it open. Every text and call appears here within a second or two. Logs are kept for a few
days, so you can also come back to them later.

**Tab 2 — the coach lesson.** The Course360 lesson with Michael's coach in it.

**Tab 3 — the health page** (optional but handy):
`https://coach-router.bookcoachai.workers.dev/health`
Should say `"ok": true`. For the fuller view, add `?token=` and paste the value of
`shared.healthToken` from `coaches.json`.

---

## Step 1 — Does a real text even reach us?

**This is the one genuinely unknown thing.** Everything else has been tested another way; this
cannot be, because it depends on Twilio's own routing.

**Colleague:** text the word `hello` to **+1 854 254 5009**.

| What happens | What it means |
|---|---|
| They get a reply about subscriptions | ✅ Working. The reply is meant to look like that — their phone isn't linked yet. |
| No reply, and **nothing appears in the Logs tab** | ❌ Twilio isn't forwarding the message. See the fix below. |
| No reply, but something **does** appear in Logs | Send Claude what the log line says. |

**If nothing reaches us**, it's a Twilio setting, not the code. A 10DLC number belongs to a
Messaging Service, and inbound texts follow the *Service's* setting — the per-number field is
ignored. In Twilio: **Messaging → Services → (your service) → Integration → Send a webhook**, set to

```
https://coach-router.bookcoachai.workers.dev/twilio/sms
```

method **POST**. Then check **Monitor → Logs → Messaging** to see the attempt.

Nothing further works until this step passes.

---

## Step 2 — Link their phone

1. **You:** in the lesson (Tab 2), press **Get my activation code**. A 6-character code appears.
2. **You:** send those 6 characters to your colleague — WhatsApp, email, however.
3. **Colleague:** text the code to **+1 854 254 5009**, within 15 minutes.

**Expected:** Michael's greeting comes straight back to them.

**Confirm it worked, no terminal:** reload the lesson (Tab 2). The box should now show
**Phone linked** with *"… from •••• 1234"* — the last four digits of your colleague's number.

> Worth knowing: pressing the button does **not** link anything. The link happens when the code is
> texted in. So the button staying visible before they text is correct, not a fault.

---

## Step 3 — A real conversation

**Colleague:** text a genuine question, e.g. *"I struggle to delegate."*

**Expected:** a coaching reply from Michael. No code, no menu, nothing to remember. They can keep
texting and the conversation continues.

---

## Step 4 — The phone call

**Colleague:** call **+1 854 254 5009**.

**Expected: straight into Michael.** No "welcome to the coach line", no access code, no author name
to say. That is the whole point of the change — two turns removed from every call.

Then speak a question.

- A 2–3 second pause before he answers is normal.
- On a slower answer you may hear *"Let me think about that"* and then the reply. **That is the
  system working**, not a fault — it's what stops the call being cut off.

---

## Step 5 — Prove that non-subscribers are actually turned away (optional)

Access is currently in **warn** mode: it checks everyone and writes it down, but refuses nobody. To
test real refusal, **message Claude and ask to switch enforcement on.** Then:

- **Colleague texts again** → still works. They're linked.
- **Any other phone texts or calls** → politely refused, and it must not name any coach.
- Then ask Claude to switch it back to warn.

Needs a second, unlinked phone — a colleague's other handset, or anyone willing to send one text.
If that's awkward, skip it: this has already been verified with simulated messages, and the results
are recorded in HANDOFF §10.

---

## Step 6 — The opt-out check — DO THIS LAST

**Colleague:** text `STOP`.

**Expected:** Twilio's own confirmation that they've opted out — not a message from the coach.

⚠️ **This makes Twilio block that number from all further messages.** To undo it they must text
`START` or `UNSTOP`. Don't do this in the middle of the test.

---

## When you're finished

Message Claude to unlink the colleague's number, so it isn't left counted as a subscriber.

---

## What to send back if something fails

- The step number
- What the colleague saw on their phone (a screenshot is ideal)
- Anything in the **Logs** tab from around that moment

That is enough to identify almost anything without further testing.

---

## Ongoing, once testing is done

You should never need to watch anything to know it's healthy.

**Point a free uptime monitor** (UptimeRobot, or Cloudflare's own) at:

```
https://coach-router.bookcoachai.workers.dev/health
```

Safe to poll publicly — it names no coach and reveals no codes. If it ever returns an error, you get
an email. That is the alarm; the Logs tab is for working out *why* afterwards.
