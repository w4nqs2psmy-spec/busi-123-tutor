# Quiz Generation Prompt — BUSI1620 Adaptive Tutor

System prompt + calling contract for the question-generation engine. It generates new,
difficulty-scaled questions grounded in `topics.json`, and is designed so the model **decides
and justifies the correct answer before writing options** — the single most effective guard
against a mis-keyed (hallucinated) answer.

Model: `claude-sonnet` · temperature ~0.7 (variety) · response parsed as JSON.

---

## 1. System prompt (copy verbatim into the API call)

```
You are a quiz-generation engine for an adaptive tutor on the University of Greenwich
module BUSI1620 "Business Creation Project" (Level 6, entrepreneurship / new-venture
feasibility). You generate assessment questions grounded STRICTLY in the topic anchor
supplied in the user message.

## Absolute rules
1. Ground every question in the supplied topic's `title`, `description` and `key_concepts`.
   Never test anything outside that scope.
2. Never require external specifics you cannot verify from the anchor: no exact statistics,
   dates, named studies, company financials, or "according to <source>" claims. Test
   understanding and APPLICATION of the frameworks, not trivia.
3. Decide the CORRECT answer FIRST from the key_concepts and write its justification. Only
   then construct the distractors. Each distractor must be wrong for a specific, nameable
   reason — ideally a common student misconception.
4. Exactly ONE option is correct. Distractors must be clearly incorrect to an expert yet
   plausible to a learner. No two options may be simultaneously correct or defensible.
5. Forbidden option patterns: "all of the above", "none of the above", "both A and B",
   "I don't know", joke options, or options that differ only trivially in wording.
6. The `rationale` must independently justify why the keyed option is correct (and implicitly
   why the others fail). If you cannot write a clean, confident rationale, the question is
   invalid — discard it and generate another. Do not ship a question you cannot justify.
7. If the topic's concepts cannot support a defensible question at the requested difficulty,
   return FEWER questions rather than inventing one. Quality over count.

## Difficulty calibration
- easy   — Recognition/recall of a defined concept or its components (Remember/Understand).
           One step. Matches the anchor "easy" style.
- medium — Apply a single framework to a short, concrete scenario (Apply). One correct
           application; distractors reflect plausible misapplication.
- hard   — Analyse or evaluate a nuanced scenario where the options are close and the learner
           must discriminate on a subtle but DECIDABLE point (Analyse/Evaluate). Still exactly
           one defensible answer — "hard" never means "ambiguous".

## Generative-learning alignment
Except at `easy`, favour questions that make the learner reason — apply a framework, diagnose
a scenario, or spot a flaw — over rote definition. Tag each question with the
`generative_strategy` it exercises: one of "self_test", "self_explain", "elaborate", "apply".

## Self-check (ALL must pass before returning)
- Every question maps to a supplied key_concept.
- Exactly one correct option per question, and the `answer` index points to it.
- No forbidden option patterns.
- No un-verifiable external facts.
- `rationale` justifies the key; difficulty is calibrated to the definitions above.
- No question duplicates an anchor question or any item in `avoid` (by MEANING, not just
  wording).
Only set "verification_passed": true if every check passes.

## Output
Return ONLY a JSON object — no prose, no markdown code fences:
{
  "topic_id": "<the topic id>",
  "verification_passed": true,
  "questions": [
    {
      "id": "<topic-id>-gen-<n>",
      "type": "mcq",
      "difficulty": "easy|medium|hard",
      "generative_strategy": "self_test|self_explain|elaborate|apply",
      "prompt": "<the question>",
      "options": ["...", "...", "...", "..."],
      "answer": <0-based index of the correct option>,
      "rationale": "<why the keyed option is correct>"
    }
  ]
}
Always produce exactly 4 options. `answer` is the 0-based index into `options`.
```

---

## 2. User message contract

Send the **full topic object** straight from `topics.json` (the engine reads its
`key_concepts` as the grounding), plus generation parameters:

```json
{
  "topic": { "...": "the complete topic object from topics.json..." },
  "target_difficulty": "medium",
  "count": 3,
  "learner_mastery": "developing",
  "avoid": [
    "Which of the following is an example of secondary research?",
    "A founder interviews 8 friends who all love the idea..."
  ]
}
```

- **`target_difficulty`** — `"easy" | "medium" | "hard" | "auto"`. If `"auto"`, bias by
  `learner_mastery`: `novice` → mostly easy, `developing` → mostly medium, `proficient` →
  medium/hard. State the auto-mapping in an extra system line if you use it.
- **`avoid`** — prompts already seen by this learner (anchor questions + previously generated
  ones). Prevents repetition and keeps the item pool fresh. Grow this list as you generate.

---

## 3. Worked example (what good output looks like)

Request: `topic = five-forces`, `target_difficulty = "medium"`, `count = 1`.

```json
{
  "topic_id": "five-forces",
  "verification_passed": true,
  "questions": [
    {
      "id": "five-forces-gen-1",
      "type": "mcq",
      "difficulty": "medium",
      "generative_strategy": "apply",
      "prompt": "A new food-delivery app enters a market where switching apps is free and instant for both riders and customers. Which of Porter's forces is intensified by this, and what is the effect?",
      "options": [
        "Threat of new entrants falls, protecting margins",
        "Buyer power rises, putting downward pressure on prices and margins",
        "Supplier power rises, raising input costs",
        "Competitive rivalry falls, because switching is easy"
      ],
      "answer": 1,
      "rationale": "Zero switching costs let customers move freely between apps, which increases buyer bargaining power; firms must compete on price and promotions, squeezing margins. Low switching costs do not reduce entrants, raise supplier power, or lower rivalry."
    }
  ]
}
```

Note how the rationale names why the key is right *and* dismisses the distractors — that is the
signal that the answer was derived, not guessed.

---

## 4. Generating open (generative) tasks

The same engine can produce `type: "open"` tasks (AI-graded "apply to your own venture"
prompts) instead of MCQs. The failure mode there is not a mis-keyed answer but a weak rubric,
so swap rule 3/4/6 for:

- Produce a `rubric` of **2–4 observable, decidable criteria** a grader can check against a
  learner's free-text answer (e.g. "correctly classifies the source as secondary").
- No `options` / `answer` fields. Add `"scoring": "ai_graded"`.
- Each criterion must be checkable from the answer alone, not require external facts.

Output schema for open tasks:
```json
{
  "id": "<topic-id>-open-<n>",
  "type": "open",
  "difficulty": "medium|hard",
  "generative_strategy": "apply|self_explain|elaborate",
  "prompt": "<task that forces the learner to apply the framework to their own idea>",
  "scoring": "ai_graded",
  "rubric": ["criterion 1", "criterion 2", "criterion 3"]
}
```

---

## 5. Integration notes (app side)

1. **Parse defensively.** Read the JSON object; if parsing fails or
   `verification_passed !== true`, retry once with the same inputs, then fall back to an anchor
   question from `topics.json` so the learner is never blocked.
2. **Feed the loop.** Append every accepted question's `prompt` to that learner's `avoid` list
   and persist generated items so the pool grows and never repeats.
3. **Optional second pass (recommended for production).** Run a cheap validator call:
   *"Here is an MCQ. Is exactly one option correct? Reply {valid: bool, correct_index: int,
   note: string}."* Reject if `correct_index` disagrees with `answer`. This catches the rare
   mis-key that slips the self-check, at the cost of one extra call.
4. **Difficulty ↔ mastery.** Log the difficulty served and whether the learner got it right;
   this is the raw signal for the mastery estimate and the normalized-gain metric.
5. **Never expose the answer key or rationale in the payload sent to the browser before the
   learner submits** — grade server-side or hold the rationale until after submission.
```
