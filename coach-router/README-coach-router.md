# Coach Router — deployment runbook

One Cloudflare Worker, one public phone number, every Book Coach AI reachable on web, SMS and telephone.

**Do the steps in this order.** Step 1 takes days to weeks and gates SMS entirely; start it before you write or deploy anything else. Steps 2–5 can proceed in parallel with it.

| File | What it is |
|---|---|
| **`coaches.json`** | **Single source of truth.** Every coach's code, name, aliases, IDs and API key. Gitignored. Paste values here and nowhere else. |
| `coaches.example.json` | Committed blank template for the above. Field reference is in step 3 below. |
| `lib-config.mjs` | Reads `coaches.json`. Enforces the KV/secret split via an allowlist. |
| `coach-router.worker.js` | The Worker. Replaces every per-coach proxy Worker. |
| `wrangler.toml` | Bindings and non-secret vars. Secrets appear only as commented commands. |
| `seed-coaches.mjs` | Validates `coaches.json` → writes the non-secret fields to KV. |
| `sync-secrets.mjs` | `coaches.json` → Worker secrets. Also generates `.dev.vars`. |
| `verify-voiceflow.mjs` | Proves each project/version/key triple resolves on the live runtime. |
| `TEST-CHECKLIST.md` | Pre-launch acceptance tests. |

**Where a value lives.** One paste point, two destinations, and the split is enforced in code rather than by discipline:

```
                    ┌──> seed-coaches.mjs  ──> KV          non-secret fields only
   coaches.json ────┤                                      (allowlisted in lib-config.mjs)
   (gitignored)     └──> sync-secrets.mjs  ──> Worker secrets   API keys only
```

`coaches.json` is never deployed and never read by the Worker. At runtime the Worker reads non-secret config from KV and keys from Worker secrets — unchanged. Adding a coach is: add one object to the `coaches` array, run `npm run push`.

---

## Step 1 — A2P 10DLC registration (start first, blocks SMS)

US application-to-person SMS is filtered or outright blocked by carriers without brand and campaign registration. This is the long pole. Nothing below makes SMS work if this is not approved.

1. In Twilio Console → **Messaging → Regulatory Compliance → A2P 10DLC**, register the **Brand** for Leadership Books: legal business name exactly as registered, EIN, address, website, and an authorised contact.
2. Register a **Campaign**. Use case is **Conversational / Customer Care** (not Marketing — this is an inbound-initiated coaching conversation). You will be asked for:
   - Campaign description — describe it as: subscribers text a numeric access code to reach an AI coaching assistant modelled on a specific author, then converse with it.
   - **Two sample messages.** Use real ones from this router, e.g.
     `Welcome to the Leadership Books coach line. Reply with a coach code to begin: 1042 — <Author Name>`
     `You're now connected with <Author Name>. What's on your mind? (Reply MENU to switch coaches.)`
   - Opt-in description and proof. Inbound-initiated ("the subscriber texts us first") plus wherever the number is published to subscribers — screenshot the page.
   - Confirmation that **STOP / HELP** are handled. They are: the Worker clears the session silently on STOP and lets Twilio's Advanced Opt-Out send the compliance reply; HELP returns the coach menu.
3. Create a **Messaging Service**, attach the campaign to it, and add the public number to its sender pool.
4. Wait for approval. Track status in Console. Do **not** load-test SMS before approval — filtered traffic can count against the campaign.

> **DONE — 2026-08-21.** The brand and campaign are already registered and approved on the **parent** Leadership Books account, and the existing number is attached there. This step is complete; it is the reason step 6 uses the parent account rather than a subaccount. Nothing here needs redoing unless a second number is ever added.

---

## Step 2 — Voiceflow changes, per coach

The coaches were written for a web widget with native buttons and a rule of never exposing raw URLs. That rule is unworkable on SMS and actively harmful on voice. Every project needs all four of these before it is routed to a phone.

**2.1 — Add a `channel` variable.** Create a project variable `channel` with a default of `web`. The Worker sets it to `sms` or `voice` at launch and again on every turn. Also add `coach_code`, `coach_name` and `user_phone` — the Worker sets these too and they are useful in transcripts.

**2.2 — Add a channel-rules block to the global prompt.** Paste this near the formatting rules:

```
CHANNEL RULES
The variable {channel} tells you how this person is reaching you. Obey the matching rule absolutely; it overrides any other formatting instruction.

If {channel} is "web":
- Unchanged from today. Use native buttons for every resource or referral link.
- Never use Markdown links. Never write a raw URL in your reply text.

If {channel} is "sms":
- Keep replies under about 300 characters. This is a text message, not a page.
- Plain text only. No Markdown, no asterisks, no headings, no buttons — none of it renders.
- Ask one question and stop. Do not stack a teaching point and a question and a resource in one message.
- If a resource link is genuinely the next right step, put the bare URL on its own line, by itself, after your sentence. One link maximum.

If {channel} is "voice":
- You are being spoken aloud. Never say a URL, a web address, an email address, or a spelled-out word.
- Never write an all-capital word — it will be read out letter by letter.
- No Markdown, symbols, bullet characters, or emoji.
- If a resource would help, say its name only and offer: "I can text you the link if you'd like."
- Keep each turn to two or three sentences. The caller cannot skim; they can only wait.
```

**2.3 — Make the Crisis Care Guide reachable from the SMS and voice entry paths**, not only from the web routing state. Someone in crisis is more likely to phone than type. In Instructions, add crisis routing to the top-level intent recognition so it fires on the very first turn regardless of channel, not just from inside a coaching playbook. On voice, the crisis path should offer a warm handoff — "stay with me and I'll connect you" — rather than reading out a number or a link.

> The Worker has its own crisis safety net for the one gap the playbook can't cover: a person who texts or calls **before** picking a coach, who would otherwise be handed a code menu. Once a coach is pinned, the Voiceflow playbook owns the response. The Worker's copy is overridable via the `CRISIS_SMS_TEXT` / `CRISIS_VOICE_TEXT` vars if Leadership Books wants approved wording.

**2.4 — Leave the card/button setup exactly as it is.** The Worker's trace flattener degrades cards to `Label:` + bare URL for SMS, and strips them entirely for voice. The Resource and Referral Concierge needs no change.

**2.5 — Record the right version ID.** For each coach note whether you are pointing at `production` (published) or a **draft version ID** (pre-publish demo). These are different IDs and mixing them produces `version does not exist`. Put whichever you're using in the registry's `versionID`.

---

## Step 3 — KV setup

```bash
npx wrangler kv namespace create COACH_KV
npx wrangler kv namespace create COACH_KV --preview
```

Paste both returned IDs into `wrangler.toml` (`id` and `preview_id`).

Create your config file and fill it in — this is the only place any of it gets typed:

```bash
cp coaches.example.json coaches.json
```

One object per author in the `coaches` array. Add, reorder, duplicate or renumber them freely — nothing else in the repo needs to know:

```json
{
  "shared": {
    "twilioAccountSid": "",
    "twilioAuthToken": "",
    "heygenApiKey": "",
    "publicTwilioNumber": "",
    "allowedOrigin": "",
    "ghlApiToken": "pit-...",
    "ghlLocationId": "...",
    "config": { "entitlementMode": "off", "archiveRetentionDays": 30 }
  },
  "coaches": [
    {
      "code": "1042",
      "name": "Author Display Name",
      "aliases": ["first last", "last", "nickname last"],
      "projectID": "xxxxxxxxxxxxxxxxxxxxxxxx",
      "versionID": "production",
      "vfKey": "VF.DM.xxxxxxxx",
      "voiceMode": "inline",
      "ttsVoice": "Polly.Matthew-Neural",
      "ghlTag": "lastname-coach-active"
    }
  ]
}
```

| Field | Notes |
|---|---|
| `code` | The access code a subscriber texts or keys in. Becomes the KV key `coach:<code>`, and the Worker secret name `VF_KEY_<code>` is derived from it — so change it here and everything follows. Digits only: it has to be enterable on a phone keypad. |
| `name` | Shown in the SMS menu and **spoken aloud** by Polly. Spell it the way it should sound. No `&` `<` `>` `"` `'` — they break TwiML. |
| `aliases` | Array of spoken variants, fed to Twilio's speech recognizer as hints so saying the name routes as well as keying the code. Include first+last, last alone, nicknames, `doctor X` / `pastor X` if used, and likely mis-hearings. |
| `projectID` | Voiceflow project ID. |
| `versionID` | `production` once published, or a **draft version ID** to demo pre-publish. Draft / main-environment / published IDs look identical and are not interchangeable — this is the #1 cause of `version does not exist`. Verify with step 3.1. |
| `vfKey` | **Secret.** Voiceflow Dialog API key. Becomes the Worker secret `VF_KEY_<code>`. |
| `voiceMode` | `inline` = the Worker runs the call (no extra number, ~2–3s per turn, no barge-in). `dial` = bridge to this coach's hidden Twilio number attached natively to its Voiceflow agent (best quality, costs a number plus phone credits). Prototype on `inline`; flip before an author hears it. |
| `ttsVoice` | Amazon Polly voice for `inline` mode, e.g. `Polly.Matthew-Neural`, `Polly.Joanna-Neural`. |
| `dialNumber` | Add only when `voiceMode` is `dial`. E.164. |
| `heygenAvatarID` | Add only when HeyGen is in use. Without it the web avatar simply doesn't start; SMS and voice are unaffected. |
| `heygenVoiceID` | Optional HeyGen voice override. |
| `ghlTag` | The GoHighLevel (Course360) tag that means "actively subscribed to this author". One tag per author. Lowercased automatically — GHL stores tags lowercase, so a capitalised tag would silently match nothing. No spaces or commas: the contacts/search filter cannot match them. **Omit it and nobody can ever be entitled to this coach** (fails closed). |

Omit any field you don't need — `versionID` defaults to `production`, `voiceMode` to `inline`, `aliases` to empty, `ghlTag` to unset (which means no entitlement for that coach). A minimum viable entry is `code`, `name`, `projectID`, `vfKey`.

### `shared` — values used by every coach

| Field | Notes |
|---|---|
| `twilioAccountSid` / `twilioAuthToken` | **Secret.** Validate inbound signatures and authenticate outbound REST calls. |
| `heygenApiKey` | **Secret.** Optional; leave blank while HeyGen is inactive. |
| `healthToken` | **Secret.** Gates the per-coach detail on `GET /health`. Fails closed — unset means nobody gets detail. |
| `ghlApiToken` | **Secret.** GoHighLevel (Course360) Private Integration Token, `pit-…`. Read only by the cron reconcile, never on the request path. |
| `ghlLocationId` | The GHL sub-account. Not a credential. Mirrored into `wrangler.toml` as `GHL_LOCATION_ID`, which is what the Worker actually reads. |
| `publicTwilioNumber` / `allowedOrigin` | Mirrored into `wrangler.toml` as vars. `node sync-secrets.mjs --check` reports drift. |
| `config` | Runtime knobs, written to the KV key `config`. See below. |

### `shared.config` — runtime knobs

These go to KV rather than `wrangler.toml`, so changing one is `npm run push` and live within 60s — **no redeploy**. That matters because there is no staging: every deploy is immediately live to anyone texting or calling.

| Knob | Default | Notes |
|---|---|---|
| `entitlementMode` | `off` | `off` ignores entitlement (current behaviour). `warn` checks and logs what *would* have been denied, but admits anyway. `enforce` denies. Roll out `off` → `warn` → `enforce`. |
| `leaseHours` | `48` | How long a subscriber's entitlement stays valid without the reconcile renewing it. If the GHL sync breaks, access **decays** after this rather than persisting — the failure is loud instead of silent. |
| `archiveRetentionDays` | `30` | How long a churned subscriber's conversation is kept before deletion. Resubscribe inside the window and it resumes; after it, they start fresh. |
| `archiveReminderDays` | `[15, 5]` | Days-before-deletion to send a reminder. Must all be **less than** `archiveRetentionDays` — a reminder at or beyond retention can never fire, and the seeder rejects it. `[]` disables. |
| `archiveAutoDelete` | `true` | Master switch for the destructive half of the archive sweep. |

Anything not named above is dropped, the same way `KV_FIELDS` allowlists the per-coach fields.

The seeder catches the mistakes hand-edited JSON invites: invalid syntax (reported with the offending line), a duplicate `code` that would silently overwrite another coach in KV, `aliases` given as a string instead of an array, a name containing TwiML-breaking punctuation, and a non-numeric code.

Then:

```bash
node seed-coaches.mjs                        # dry run — validates, writes nothing
node seed-coaches.mjs --write                # writes coach:<CODE> entries to KV
node seed-coaches.mjs --list                 # show what's currently in KV
node seed-coaches.mjs --write --preview      # same, into the PREVIEW namespace
```

The script refuses to write while any value is a `TODO_` placeholder, and builds each KV value from an allowlist — so a key sitting in `coaches.json` cannot reach KV even if a new field is added later. It warns on a non-numeric code (unkeyable on a phone), a missing key, and — when HeyGen is in use — a missing avatar ID.

Seed the **preview** namespace too if you intend to use `wrangler dev` — it reads `preview_id`, not `id`, and would otherwise find no coaches at all.

**3.1 — Verify the version IDs against the live runtime.** Nothing in this repo can tell a draft version ID from a published one; they are the same shape. Only Voiceflow can, and it will tell you at the worst possible moment. Once `vfKey` is filled in:

```bash
node verify-voiceflow.mjs --dry      # show what would be called, spend nothing
node verify-voiceflow.mjs            # one launch per coach, prints the greeting
node verify-voiceflow.mjs --from-kv  # verify what is actually IN KV, not the local file
```

It mirrors the Worker exactly — same runtime host, headers, launch action and config — so a pass means the Worker's first turn will work. It also prints the opening line each coach returns, which catches the subtler failure: a valid key and version pointing at *the wrong author*. Each coach costs one billable Voiceflow request.

`--version <id>` tries a candidate without editing anything, which is how you find out which of the three IDs is the live one. `Unable to resolve production version alias` means the project has **never been published** — the draft version ID is then the only one that works.

> **A draft version ID has no staging.** Pointing at the draft means every edit you make on the Voiceflow canvas is instantly live to anyone texting, calling, or on the web — there is no publish step between your work-in-progress and a subscriber. Fine while it's only you testing. Publish and switch that coach to `production` before real subscribers arrive, and remember the switch is a `coaches.json` edit **plus** `npm run seed` — the Worker reads `versionID` from KV, not from the file.

**3.2 — Adding a coach later needs no redeploy.** Add an object to the `coaches` array in `coaches.json`, then `npm run push` (seeds KV and pushes that coach's secret). Live within 60 seconds — the Worker caches the registry in-isolate for that long.

---

## Step 4 — Secrets

The keys are already in `coaches.json` from step 3. One command pushes all of them:

```bash
node sync-secrets.mjs            # dry run — names and lengths only, no values
node sync-secrets.mjs --write    # pushes everything in one `wrangler secret bulk` call
```

That sets `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `HEYGEN_API_KEY`, and one `VF_KEY_<CODE>` per coach — the names the Worker expects, derived from the codes so they cannot be typo'd apart. Secret values never appear in a command line (they travel in a temp file that is deleted in a `finally`), and the script only ever prints names and character counts.

`wrangler secret put` needs an already-deployed Worker, so on a first-time setup run step 5 and then come back to this. For local work before any deploy:

```bash
node sync-secrets.mjs --dev-vars   # generates .dev.vars for `wrangler dev`
```

Two non-secret vars are read from `wrangler.toml`, not from `coaches.json` — `ALLOWED_ORIGIN` and `PUBLIC_TWILIO_NUMBER`. `coaches.json` keeps a copy so there is one place to look; this checks the two haven't drifted:

```bash
node sync-secrets.mjs --check
```

The Voiceflow and HeyGen keys never appear in KV, in a registry value, or in git.

---

## Step 5 — Deploy and verify

```bash
npx wrangler deploy
curl -s https://coach-router.<your-subdomain>.workers.dev/health | jq
```

`/health` lists every coach with `keyResolved`, `dialNumberSet`, `heygenAvatarIDSet`, and returns **503** with a `problems` array if anything is wrong. Do not proceed until it returns `ok: true`. It also reports `twilioValidation: "DISABLED"` if a signature bypass has been left on — that must never appear in production.

**The HeyGen check is conditional.** `HEYGEN_API_KEY` is only required when at least one coach has a `heygenAvatarID` — a coach cannot start an avatar without one, so with none configured a missing key is the expected state rather than a fault. `/health` says which way it read that, in a `heygen` field, so a skipped check is visible instead of silent. `POST /api/heygen-token` still fails loudly with a 500 if the key is genuinely needed and absent.

Grab the `https://coach-router.<subdomain>.workers.dev` URL from the tail of the `wrangler deploy` output — you need it again for the Twilio webhooks in step 6 and the web pages in step 8.

---

## Step 6 — Twilio account and number webhooks

> **DECIDED 2026-08-21 — no subaccount. The parent account is used.**
>
> The original plan put the coach number in its own subaccount so GHL/LeadConnector could never import it and rewrite its webhooks. Two constraints ruled that out:
>
> - **The A2P brand and campaign are already approved on the parent account.** A subaccount number would likely need its own registration — weeks of delay, for isolation alone.
> - **No further numbers can be purchased.** A subaccount needs its own number, and the existing number cannot move into one without a purchase or a support-assisted transfer.
>
> So the existing (previously unused) number on the parent account becomes the public coach line. The webhook-rewrite risk is handled by **keeping Twilio disconnected from GHL** instead of by account isolation — same protection, no new number, A2P registration preserved.
>
> **If anyone ever reconnects Twilio to GHL, re-check this number's webhooks immediately.** That is now the single point of failure this step used to design away. `node sync-secrets.mjs --verify-twilio` reports which kind of account the credentials belong to.

1. Use the **parent** account's SID and auth token for the secrets in Step 4 — the account that owns the number. A token from any other account fails signature validation on every request.
2. Do **not** add this number to GHL → Settings → Phone Numbers, and leave the Twilio integration disconnected in GHL.
3. On the number's configuration page:

| Setting | Value |
|---|---|
| A message comes in → Webhook | `https://coach-router.<subdomain>.workers.dev/twilio/sms` — **HTTP POST** |
| A call comes in → Webhook | `https://coach-router.<subdomain>.workers.dev/twilio/voice` — **HTTP POST** |

5. Enable **Advanced Opt-Out** on the Messaging Service so Twilio sends the STOP/HELP compliance replies. The Worker deliberately stays silent on STOP so the subscriber does not get two messages.

> **The Messaging Service overrides the number-level SMS webhook.** A 10DLC number must belong to a Messaging Service, and inbound routing then follows the **Service's** Integration setting — the per-number "A message comes in" field is ignored unless that Integration is *Defer to sender's webhook*. So set **Messaging → Services → (your service) → Integration → Send a webhook** to `/twilio/sms`, or set it to defer and configure the number. Setting only the number-level field and finding texts go nowhere is the standard way to lose an afternoon here.
>
> Voice is unaffected — `/twilio/voice` is always configured on the number itself.

**Before you touch the console**, the whole flow can be tested against the deployed Worker with no phone, no real SMS and no A2P dependency:

```bash
node simulate-twilio.mjs suite      # signed webhooks for every SMS + voice path
node simulate-twilio.mjs sms --body "1042"
node simulate-twilio.mjs voice-route --digits 1042
node simulate-twilio.mjs sms --no-signature    # must be 403
```

It signs requests exactly as Twilio does, so a pass means the Worker's logic is sound and anything that then fails on a real text is a Twilio-side routing problem — which halves the search space. Replies come back as TwiML and are never delivered to a handset. The one exception is the "text me the link" path, which calls Twilio's REST API and *does* send a real message.

If `/twilio/*` starts returning 403 after moving to a custom domain, set `PUBLIC_BASE_URL` in `wrangler.toml` to the exact base URL Twilio dials. Twilio signs the URL it requested; a scheme or host rewrite in front of the Worker breaks the HMAC.

---

## Step 7 — Per-coach dial numbers (only for `voiceMode: "dial"`)

> **NOT AVAILABLE — 2026-08-21.** `dial` mode requires one hidden number per coach, and no further numbers can be purchased. **Every coach runs `inline`.** Keep this step for the day that constraint lifts.
>
> What `inline`-only costs, so it's on the record:
>
> - **~2–3 seconds of dead air per turn**, and **no barge-in** — the caller cannot interrupt and must wait for each reply to finish.
> - **Polly speaks, not the Voiceflow voice.** If a coach's Voiceflow project uses a standard Amazon Polly voice, set the identical voice in that coach's `ttsVoice` and the two match exactly, for free. If it uses a cloned or premium voice of the author, Polly will sound like a different person — and `inline` being the only mode means there is no longer a `dial` fallback that fixes this. The remaining option is an audio relay: set `tts: true` on the interact config, have the Worker host the returned audio and `<Play>` it. That adds Voiceflow TTS billing and more latency to an already slow path; not built.
> - On the other hand `inline` is the mode that **guarantees cross-channel continuity** — the Worker sets the `phone:<E.164>` userID itself, so text-then-call resumes the same Voiceflow session. In `dial` mode that was never guaranteed.

Per coach:

1. Buy a second Twilio number **in the same account**. Do not publish it anywhere; it exists only as a bridge target.
2. In Voiceflow, attach that number natively to the coach's agent (Voiceflow's own telephony integration). Voiceflow then owns STT, TTS, barge-in, latency, recording and transcripts for that coach.
3. Call the hidden number directly and confirm the coach answers in its own voice.
4. Set `"voiceMode": "dial"` and `"dialNumber": "+1…"` on that coach and re-run `node seed-coaches.mjs --write`. Live within a minute; no redeploy.

Twilio permits the inbound caller's number as `<Dial callerId>` when forwarding, so the caller's identity carries into the Voiceflow transcript. Carriers sometimes deliver an unusable `From` on blocked or anonymous calls, so the Worker falls back to `PUBLIC_TWILIO_NUMBER` when `From` isn't valid E.164.

> **Verify on a live call:** once the legs are bridged, the Worker is out of the loop and Voiceflow's native telephony mints its own session identity for that call. The `phone:<E.164>` userID shared between SMS and voice is guaranteed in `inline` mode; in `dial` mode it depends on whether Voiceflow keys the session off the passed caller ID. Test cross-channel continuity (text, then call) against a `dial`-mode coach before promising subscribers a continuous conversation. If it doesn't hold and continuity matters more than voice quality for that coach, `inline` is the mode that delivers it.

---

## Step 8 — Repoint the existing web pages

Each coach page currently talks to its own proxy Worker. Two edits per page, then the old Workers get deleted.

1. Change `PROXY_BASE` to the router:

```js
const PROXY_BASE = 'https://coach-router.<subdomain>.workers.dev';
const COACH_CODE = '1042';   // NEW — must match the KV registry key
```

2. Add `code` to both request bodies:

```js
// POST /api/heygen-token
body: JSON.stringify({ code: COACH_CODE })
// -> { token, avatarID, voiceID }   avatar and voice IDs now come from KV,
//    so they no longer need to be baked into the page or its wrangler.toml.

// POST /api/vf-interact
body: JSON.stringify({
  code: COACH_CODE,
  userID,                        // keep whatever the page already persists
  action: { type: 'text', payload: userText },
  variables: { /* optional */ }
})
// -> { userID, traces }   `traces` is the same raw array as before, so the
//    page's existing card / open_url button rendering is unchanged.
```

3. Add every origin that serves or embeds a coach page to `ALLOWED_ORIGIN` in `wrangler.toml`, comma-separated, then redeploy. A missing origin returns 403 with `Origin not allowed`.
4. Confirm each page loads the avatar, holds a conversation, and still renders Resource/Referral cards as clickable buttons.
5. **Only then** delete the old per-coach proxy Workers.

The GHL side is unchanged — the Custom HTML element and its `<iframe>` keep pointing at the same hosted page.

---

## Step 9 — GHL contact record and transcripts

GoHighLevel stays out of the conversational path: its inbound webhook has no synchronous JSON response, so it cannot reply to Twilio inside the request cycle a messaging webhook requires, and every turn would burn a premium workflow execution costing more than Twilio charges to carry the message. It keeps doing what it's good at — hosting the site, owning the contact record, storing transcripts.

File sessions against the contact **asynchronously**, after the fact:

1. In GHL create an **Inbound Webhook** trigger; copy its URL.
2. Add it as a Worker var, e.g. `GHL_WEBHOOK_URL`, and post the session summary with `ctx.waitUntil()` so it never sits in the response path — Twilio times a webhook out at 15 seconds and a blocked call means dead air.
3. Suggested payload: `{ phone, channel, coachCode, coachName, startedAt, endedAt, turnCount, transcriptUrl }`.
4. Build the GHL workflow to upsert the contact by phone and append a note.

> This hook is **not yet wired into the Worker** — it needs your GHL webhook URL and a decision on what belongs in the contact record. Say the word and I'll add it.

For `dial`-mode coaches the full transcript already lives in Voiceflow; send GHL the metadata plus a link rather than duplicating the text.

---

## Cost and credit guardrails

- **Voiceflow credits are a hard stop.** When the workspace allotment is exhausted, agents stop responding and there is no mid-cycle top-up. Set a usage alarm well below the cap — voice in `dial` mode burns 10 credits/minute, so a single long call costs as much as ~120 SMS turns.
- Rough targets to sanity-check against: a 20-message SMS session ≈ $0.30–0.40; a 10-minute `dial` call ≈ $1.00. Price any subscription off **call minutes, not texts**.
- Verify current rates against Twilio's and Voiceflow's own pricing pages before quoting anything — the figures in the brief are mid-2026 approximations.
- Cloudflare Workers and KV are effectively free at this volume. The registry is cached in-isolate for 60s so a turn is not a KV read.

## Known traps

- Do **not** import the bot's Twilio number into GHL/LeadConnector. It silently rewrites the webhooks.
- Mixing Voiceflow's draft version ID, main environment ID and published version ID causes `version does not exist`. They are three different things.
- Coach codes and names must avoid `&` and unusual punctuation — it breaks TwiML and Voiceflow tool names.
- A launch event is a billable Voiceflow request. A rounding error, but don't design around it being free.
- `SKIP_TWILIO_VALIDATION=true` makes every `/twilio/*` endpoint publicly callable. It exists for `wrangler dev` only, is absent from the production vars block, and `/health` reports it whenever it's on.
