# What we're building — in plain English

A non-technical walkthrough of the subscriber access work. Written 2026-08-26.

The same plan in technical form: [`01-plan-and-decisions.md`](01-plan-and-decisions.md) (the
reasoning and the decisions) and [`02-phase-record.md`](02-phase-record.md) (the task-by-task checklist).

---

## The big idea

Right now anyone who knows a 4-digit code can talk to any coach. We're changing it so the router
checks Course360 to see who is actually subscribed, and each person only ever reaches the author
they paid for.

Once that check exists, the coach menu isn't needed — it disappears on its own.

---

## Phase 1 — Start recording the conversations

Today nothing is written down anywhere. Voiceflow remembers roughly where a conversation got to,
but not what was actually said. Voiceflow's memory is the only copy that exists — and it isn't
really a copy, it's the original.

That's worth fixing on its own. It also has to happen before anything else, because later we want
to delete someone's conversation 30 days after they cancel, and you can't safely delete something
you never kept a copy of. Recording only works going forward, so the sooner it starts, the more
you have.

First I check whether Voiceflow can do the recording itself, or whether the router has to keep its
own copy. Quick test, then build whichever it turns out to be.

One thing I'm careful about: phone calls run on a stopwatch. Twilio hangs up if the router takes
longer than 15 seconds to answer, and we already use 8 of those waiting for the coach to think. So
the recording happens *after* the caller has been answered, never while they're waiting. Nobody
notices it.

## Phase 2 — Build the list of who's allowed in

Every 5 minutes the router asks Course360: *who currently has the Micheal Stickler tag?* It writes
that list down. Tag added, they appear. Tag removed, they're gone.

That's deliberately the whole mechanism. The router never tries to understand billing — refunds,
failed cards, cancellations, someone removing access by hand. It just mirrors whatever Course360
says *right now*. So if you later want "access until the end of the month they paid for", you set
that in Course360 and the router follows along without anyone changing the code.

Two safety features worth knowing about:

**Access expires unless renewed.** Everyone's access is a pass that has to be renewed every couple
of days. If the connection to Course360 breaks, nobody gets renewed and access fades out. That
sounds like the wrong way round — but the alternative is worse. If it failed the other way,
cancelled members would keep free access indefinitely and nothing would tell you. This way it's
obvious within hours.

**The "don't cut everyone off" rule.** If a single check would remove more than half your
subscribers at once, the router refuses and raises a flag instead. A garbled reply from Course360
should never be able to shut off your whole book.

Nothing is enforced in this phase. The router builds the list and does nothing with it yet.

## Phase 3 — Connect each person's phone to their account

This is the problem found when looking at the actual data: **Course360 knows your members by
email, not phone number.** The test contact has no phone number on it at all. But a text or a call
only tells us a phone number. Right now there's no way to connect the two.

The fix: inside the members area, where they're already logged in, they see something like
*"Text ABC123 to +1 854 254 5009 to activate your coach."* They text it once and the router now
knows that handset belongs to that member. They never need a code again.

Better than handing everyone the author's 4-digit code, because the code is theirs alone, expires
in 15 minutes, texting it proves they actually hold that phone, and a forwarded welcome email is
useless to anyone else.

Requires a small block pasted into the members page — that gets written as part of this phase.

## Phase 4 — Turn it on, and remove the menu

The visible change, and the one to be careful with.

**What goes away:** the coach list. No more "reply with a code". No more reading every author's
name out loud to phone callers. And no more reaching a coach you didn't pay for — even if you know
the code, even if you say the author's name out loud.

**What gets better:** subscribers who call go *straight* to their coach. No greeting, no code, no
"say the author's name" — the phone just answers as their coach. That also quietly fixes the
problem where the system needed three tries to understand a caller's code, because there's nothing
left to mishear.

**How we avoid a disaster:** there's a three-position switch — **off**, **watch**, **on**. We run
**watch** for a few days first: it checks everyone but lets everyone through, just noting who
*would* have been blocked. If some members are missing from Course360, or never connected their
phone, you find out from that list instead of from complaints. Then we flip to **on**, and
flipping back is instant.

Two things keep working regardless: replying STOP, and the safety response if someone texts in
crisis. That one runs *before* the access check, so a person in trouble gets help whether or not
they're a paying subscriber.

## Phase 5 — The website

The coach pages have the same hole — anyone who knows a code can talk to that coach. The
protection there now only stops ordinary web browsers; it doesn't stop someone deliberately poking
at it. This closes it the same way, through the members area login.

It's bundled with the existing job of pointing the web pages at the new router, which hasn't
started yet. Cleaner to do both at once than to fix it twice.

## Phase 6 — What happens when someone cancels

Access stops and any live conversation ends. Their conversation is kept for 30 days — a number you
can change without redeploying anything.

**Inside those 30 days:** if they resubscribe, everything comes back exactly where they left it.
Their coach still remembers them.

**At 30 days:** the conversation is saved to a copy first, then deleted from Voiceflow. If you
want, it can text your phone at 15 days and 5 days beforehand so you have a chance to grab
anything by hand.

## Phase 7 — Make sure you'd know if it broke

The important one: an alert if the connection to Course360 stops working. Because access expires
unless renewed, a broken connection means everyone's access slowly fades — so you want to know
within hours, not when a subscriber emails you. It's set to warn while there's still time to fix
it before anyone is affected.

Also: a warning when Voiceflow credits are running low. That's a hard stop — when they're gone the
coaches simply stop replying, and you can't top up mid-month.

---

## Decisions needed along the way

None of these block Phase 1.

| Question | Why it matters |
|---|---|
| Can Course360 remove the tag automatically when someone cancels? | If not, the router reads the subscription records directly instead. |
| Where on the members page should the activation code go, and what should it say? | It's the only way most members can connect their phone. |
| What should the message say when someone who isn't subscribed texts or calls? | It must not list the other coaches. |
| Which phone number should get the reminder texts before a conversation is deleted? | Only needed if you want the reminders. |
| If someone's phone is already linked to a different account — reconnect it, or refuse? | Happens with a new handset, or a shared household. |
| What is the real web address the coach pages are served from? | Needed before the website phase. |

---

## Where things stand

Phase 0 (the plumbing — connecting the router to Course360, no visible change) is **done and
live** as of 2026-08-25. The tag is in place, the connection is configured, and the access check
is switched **off**, so nothing behaves differently for anyone yet.

Phase 1 is next.
