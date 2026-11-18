# Session files

A session is a folder of small files. The script reads them, checks them and
builds the replay. Text that appears in a speech bubble has a length limit,
because a bubble only holds so much; the script tells you if a line is too long.

```
.pitchme/<slug>/
  pitch.json        who is pitching what
  readme.md         the pitch itself
  brief.md          the research brief the seats read
  research.json     sources and a log of the research
  takes/<seat>.json one first read per seat (shape is in seats.md)
  debate.json       the Chair's critique and the cross-examination
  verdict.json      the Chair's write-up
  boardroom.html    the replay, written by `render`
```

## pitch.json

```json
{
  "name": "Tinyledger",
  "tagline": "Double-entry bookkeeping in a single SQLite file, for freelancers.",
  "demoUrl": "",
  "category": "Developer tools",
  "stage": "Has users",
  "founder": ""
}
```

- `name` (60 characters at most) and `tagline` (140 at most) are required.
- `demoUrl` is a full `https://` link, or empty when there is no demo.
- `category`, `stage` and `founder` are optional; leave them empty if unknown.

## research.json

```json
{
  "grounded": true,
  "sources": [
    { "title": "Page title", "url": "https://example.com/page" }
  ],
  "log": [
    "Searching: bookkeeping tools for freelancers",
    "Visiting example.com",
    "Searching: plain-text accounting pricing"
  ]
}
```

- `grounded` is `true` only if you really searched the web for this session.
- `sources` lists pages you actually read, twelve at most. Never invent one.
- `log` is four to eight short lines, each under 56 characters, starting with
  `Searching:` or `Visiting`. They show over the desks during the research
  phase of the replay.

## debate.json

```json
{
  "critique": {
    "consensus": "split",
    "uncomfortableTruth": "The one thing nobody wants to say, in a sentence.",
    "unvalidatedAssumptions": ["Something several seats assumed and nobody checked."],
    "missingVoices": ["A perspective or piece of data that was not in the room."]
  },
  "turns": [
    { "speaker": "chair", "to": "all", "text": "Spoken line." },
    { "speaker": "cfo", "to": "ceo", "text": "Spoken line." }
  ],
  "revisions": [
    { "role": "cfo", "newScore": 6.5, "reason": "The specific argument that moved them." }
  ]
}
```

- `consensus` is `genuine`, `suspicious` or `split`.
- `unvalidatedAssumptions` has one to three items; `missingVoices` up to three.
- `turns`: six to fourteen (aim for nine to twelve). `speaker` is `chair` or a
  seat; `to` is `all`, `chair` or a seat. Each `text` is spoken dialogue, 260
  characters at most. The first turn is the Chair's, and every seat appears as
  a speaker at least once.
- `revisions` lists only seats whose score actually changed, and is often
  empty. A change of more than two points is cut back to two.

## verdict.json

```json
{
  "headline": "The verdict in one sentence, as the Chair says it to the founder.",
  "summary": "Two or three sentences on why the board landed here.",
  "survival": { "oneYear": 55, "threeYear": 20, "reasoning": "One sentence." },
  "worth": { "lowUsd": 5000, "highUsd": 40000, "basis": "What the range rests on." },
  "market": {
    "size": "Market size in one line, with a figure if the brief has one.",
    "trend": "Where the market is heading, in one line.",
    "competitors": [{ "name": "Rival", "note": "Why it matters here." }]
  },
  "strengths": ["Concrete strength."],
  "risks": ["Most dangerous risk first."],
  "agree": ["A point the board agrees on."],
  "disagree": [{ "topic": "What they split on", "sides": "Who thinks what, and what it is really about." }],
  "actions": [{ "action": "A next move.", "owner": "cfo", "when": "next 2 weeks" }]
}
```

- `headline` is 260 characters at most.
- `survival` values are percentages from 0 to 100.
- `worth` is in US dollars, as plain numbers.
- `competitors`: two to five. `strengths` and `risks`: one to four each.
  `agree`: one to three. `disagree`: up to three. `actions`: one to five, and
  each `owner` is one of `ceo`, `cto`, `cfo`, `cmo`, `hr`, `user`.
- Do not include a score or a label: the script computes both.
