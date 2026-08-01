# Mastery Model & Learning Gain — BUSI1620 Adaptive Tutor

How the tutor turns answers into a per-topic mastery estimate (novice → developing →
proficient), how it picks the next difficulty, and how it produces the **measurable
improvement** evidence the brief asks for.

Two distinct systems, deliberately kept separate:

| System | Purpose | Basis | Updates |
|---|---|---|---|
| **Mastery estimate** (Elo-style) | Real-time adaptivity + live "how am I doing" display | Difficulty-weighted, per answer | Continuously |
| **Learning gain** (Hake's *g*) | Defensible pre→post improvement claim | Matched, fixed pre/post assessments | At two fixed checkpoints |

Keeping them apart matters: you adapt off a fast, drifting estimate, but you *report improvement*
off stable, comparable assessments — otherwise the "improvement" is just the adaptivity moving
the goalposts.

---

## 1. Mastery estimate (Elo-style, difficulty-weighted)

Raw % correct can't tell "3 easy right" from "3 hard right". An Elo update handles that
naturally: it rewards the *surprising* outcome. Getting a hard item right when you're rated low
moves you a lot; getting an easy item right when you're already high moves you barely at all.

### Parameters

```js
const ITEM_RATING = { easy: 1200, medium: 1500, hard: 1800 }; // difficulty on the Elo scale
const SCALE = 400;      // standard Elo logistic scale
const K = 40;           // learning rate: 32–48 is sensible for short sequences.
const MEDIUM = 1500;    // reference item for expressing mastery as a probability
```

### Update (run once per answered item)

```js
// learnerRating is stored PER (learner, topic). Prior = 1500 before any evidence.
function updateMastery(learnerRating, difficulty, correct) {
  const itemRating = ITEM_RATING[difficulty];
  const expected = 1 / (1 + Math.pow(10, (itemRating - learnerRating) / SCALE));
  const outcome  = correct ? 1 : 0;
  return learnerRating + K * (outcome - expected);
}
```

### Express mastery as a 0–1 probability + band

`masteryProbability` = expected success against a representative (medium) item. Intuitive,
bounded, and directly comparable over time.

```js
function masteryProbability(learnerRating) {
  return 1 / (1 + Math.pow(10, (MEDIUM - learnerRating) / SCALE));
}

function masteryBand(p, attempts) {
  if (attempts < 4) return "provisional"; // confidence gate: don't label on thin evidence
  if (p < 0.40) return "novice";
  if (p < 0.70) return "developing";
  return "proficient";
}
```

The **confidence gate** stops a lucky first hard answer from promoting someone to "proficient".
Below ~4 attempts the band is `provisional`; adaptivity still runs on the underlying rating.

---

## 2. Choosing the next difficulty (desirable difficulty)

Serve items where the learner's predicted success sits in a productive **0.6–0.8** window —
challenging but not demoralising. This is what you pass to the quiz generator as
`target_difficulty`.

```js
function nextDifficulty(learnerRating) {
  const pHard   = 1 / (1 + Math.pow(10, (ITEM_RATING.hard   - learnerRating) / SCALE));
  const pMedium = 1 / (1 + Math.pow(10, (ITEM_RATING.medium - learnerRating) / SCALE));
  if (pHard   >= 0.6) return "hard";
  if (pMedium >= 0.6) return "medium";
  return "easy";
}
```

Mapping mastery band → generator input, for the `quiz-generation-prompt.md` contract:
`novice → easy`, `developing → medium`, `proficient → hard` (or call `nextDifficulty` directly
for finer control).

---

## 3. Worked example (real numbers)

Learner starts a topic at **1500** (no evidence yet).

**Answer 1 — hard item, correct.**
- expected = 1 / (1 + 10^((1800 − 1500)/400)) = **0.151**
- new rating = 1500 + 40 × (1 − 0.151) ≈ **1534**
- masteryProbability(1534) ≈ **0.55** → *developing* (still `provisional`, only 1 attempt)

A big jump: succeeding on a hard item when rated low is strong evidence.

**Answer 2 — medium item, incorrect.**
- expected = 1 / (1 + 10^((1500 − 1534)/400)) = **0.549**
- new rating = 1534 + 40 × (0 − 0.549) ≈ **1512**
- masteryProbability(1512) ≈ **0.52** → *developing*

Missing an item you were expected to get (~55%) pulls the estimate down, but modestly — one miss
isn't decisive. This self-correcting behaviour is exactly what you want.

---

## 4. Learning gain (Hake's normalized gain) — the "measurable improvement" metric

Computed from **two matched, fixed assessments**, not from the drifting Elo estimate:

- **Pre** — the baseline diagnostic (the anchor `diagnostic_questions` from `topics.json`).
- **Post** — a parallel form of equivalent difficulty mix, generated later via
  `quiz-generation-prompt.md` (different items, same blueprint).

Score each as **proportion correct**. Then, per topic:

```js
// Individual normalized gain
function normalizedGain(pre, post) {
  if (pre >= 1) return null;           // undefined when there's no headroom; exclude
  return (post - pre) / (1 - pre);     // Hake's g, range typically 0..1 (can go negative)
}
```

**Cohort headline** (Hake's convention — use class-average pre/post, not the mean of individual
g's, for the primary figure):

```js
function cohortNormalizedGain(preScores, postScores) {
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  const preBar = avg(preScores), postBar = avg(postScores);
  return (postBar - preBar) / (1 - preBar);
}
```

**Interpretation bands** (Hake 1998): *g* > 0.7 high · 0.3–0.7 medium · < 0.3 low.

**Example.** Cohort pre-average 45%, post-average 68%:
*g* = (0.68 − 0.45) / (1 − 0.45) = 0.23 / 0.55 ≈ **0.42 → medium gain.** That single, defensible
number is your headline result for the demo.

Report alongside it: the **distribution** of individual *g* (so improvement isn't hidden by an
average), and how many learners crossed a band (e.g. novice → developing).

### Methodological guards
- **Matched difficulty.** Post form must mirror the pre form's easy/medium/hard mix, or the gain
  is confounded. The generator makes this easy — request the same blueprint.
- **Ceiling.** Exclude learners with pre ≈ 1.0 from *g* (no room to improve; `null`).
- **Timing.** Fix the two checkpoints (e.g. pre at onboarding, post after N sessions or T days).
  Don't let post drift, or it's not a clean pre/post.
- **Same items forbidden.** Post must be parallel items, never a re-run of the exact pre items.

---

## 5. Metrics that evidence the brief

Target: *30+ active learners, measurable improvement, personalised AI that drives retention.*

**Improvement**
- Cohort normalized gain *g* per topic + overall (headline).
- Distribution of individual *g*; band-crossings (novice→developing→proficient counts).
- Mean masteryProbability trajectory over time.

**Personalisation working**
- Served-difficulty adapts with mastery (show difficulty rising as rating rises).
- Post-adaptation success rate sits in the ~0.6–0.8 target window.

**Retention / engagement**
- Active learners (distinct learners with ≥1 session in the window) — the 30+ target.
- Return rate (learners with sessions on ≥2 distinct days); session count; streak length.
- Correlate retention with mastery gain — the story is "personalised difficulty → learners stay
  → learners improve".

---

## 6. Data model additions

```
learner_topic_mastery
  learner_id, topic_id
  rating            float   default 1500
  attempts          int     default 0
  mastery_prob      float   -- cached masteryProbability(rating)
  band              text    -- provisional|novice|developing|proficient
  updated_at        timestamptz

attempts                     -- one row per answered item (the raw signal)
  id, learner_id, topic_id
  item_id, difficulty        -- easy|medium|hard
  correct                    bool
  rating_before, rating_after
  created_at

assessment_snapshots         -- fixed pre/post checkpoints for gain
  learner_id, topic_id
  kind                       -- 'baseline' | 'post'
  score                      float  -- proportion correct
  item_count                 int
  taken_at
```

`normalizedGain` reads `baseline` and `post` rows; the mastery model reads/writes
`learner_topic_mastery` and appends to `attempts`.

---

## 7. Implementation order

1. `updateMastery` + `masteryProbability` + persist to `learner_topic_mastery` and `attempts`.
2. `nextDifficulty` → wire into the `target_difficulty` field of the quiz generator.
3. `masteryBand` + confidence gate → learner dashboard.
4. Baseline snapshot at onboarding (score the anchor diagnostic).
5. Post snapshot at the fixed checkpoint (parallel generated form) → `normalizedGain` +
   `cohortNormalizedGain` → instructor/aggregate view.

Steps 1–3 make the tutor adaptive; 4–5 produce the measurable-improvement evidence.
