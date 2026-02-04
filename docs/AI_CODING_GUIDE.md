# How to Build This Project With AI Coding Assistants

This guide explains how to use the implementation spec with **Cursor** and **Claude Code** to build the community-governed Bluesky feed generator without the AI going off the rails.

---

## The Problem With Dropping a 2,500-Line Spec Into an AI

AI coding assistants have limited context windows. If you paste the entire implementation spec as a system prompt, the model spends most of its "thinking budget" just holding onto those rules, leaving less capacity for actually writing good code. Worse, in long conversations the model starts forgetting rules from the beginning — which is exactly where the critical non-negotiables live.

The solution: **split the spec into layers that load only when relevant, and structure the work into phases so each conversation stays focused.**

---

## What's In This Package

```
community-feed/
├── CLAUDE.md                    # Claude Code reads this automatically at session start
├── AGENTS.md                    # Cross-compatible (Cursor, Codex, Gemini, etc.)
├── TASKING.md                   # Phase-by-phase task breakdown — the work plan
├── docs/
│   └── IMPLEMENTATION_SPEC.md   # Full 2,500-line technical specification
├── .cursor/
│   └── rules/
│       ├── critical-rules.mdc   # Always loaded — 10 non-negotiable rules + code style
│       ├── ingestion.mdc        # Loads when editing src/ingestion/** files
│       ├── scoring.mdc          # Loads when editing src/scoring/** files
│       ├── feed-serving.mdc     # Loads when editing src/feed/** files
│       ├── governance.mdc       # Loads when editing src/governance/** files
│       ├── database.mdc         # Loads when editing src/db/** files
│       ├── transparency.mdc     # Loads when editing src/transparency/** files
│       └── frontend.mdc         # Loads when editing web/** files
└── .claude/
    └── skills/
        └── community-feed/
            └── SKILL.md         # Claude Code skill for deep spec access
```

---

## Using With Cursor

### Setup
1. Open the project folder in Cursor
2. Cursor automatically detects `.cursor/rules/*.mdc` files
3. You can verify active rules in the Agent sidebar

### How the Rules Work

**Always-on rules** (`critical-rules.mdc`) load into every conversation. These are the 10 non-negotiable rules plus code style guidelines. They're ~40 lines — small enough to always be in context without wasting tokens.

**Auto-attached rules** load only when you're editing files that match their glob pattern. When you open `src/scoring/pipeline.ts`, Cursor automatically loads `scoring.mdc` with the scoring-specific patterns. When you switch to `src/feed/routes/feed-skeleton.ts`, it swaps in `feed-serving.mdc`. This means the AI always has the right context for what you're currently working on, without carrying irrelevant rules.

### Workflow

1. **Start each phase in a new chat**. Long Cursor conversations lose context. The TASKING.md file tells you which phase to work on.

2. **Reference the full spec when needed**. In Cursor chat, type:
   ```
   @docs/IMPLEMENTATION_SPEC.md
   ```
   Cursor will include the file as context. For specific sections, you can say:
   ```
   Read §8 (Scoring Pipeline) of @docs/IMPLEMENTATION_SPEC.md and implement the recency scoring component
   ```

3. **Use Plan Mode first**. Before coding, ask Cursor to plan:
   ```
   Read TASKING.md Phase 3. Plan the implementation of the scoring pipeline.
   Don't write code yet — just outline what you'll build and in what order.
   ```
   Then approve the plan, then ask it to execute.

4. **One task per chat**. If you're implementing the Jetstream client and it's getting complex, don't also ask it to build the scoring pipeline in the same conversation. Start a new chat.

5. **Pin files for context**. When working on a specific layer, pin the relevant test fixtures and type files so the AI has them in context:
   ```
   @src/scoring/score.types.ts @tests/fixtures/sample-posts.json
   Now implement the engagement scoring component
   ```

### If Cursor Goes Off Track
- Say: "Stop. Re-read @.cursor/rules/critical-rules.mdc and the current task in @TASKING.md"
- If it's inventing database columns not in the spec: "The schema is defined in @docs/IMPLEMENTATION_SPEC.md §6. Use exactly those columns."
- If it's overcomplicating: "Follow the code pattern in the spec exactly. Don't add features not in TASKING.md."

---

## Using With Claude Code

### Setup
1. Navigate to the project directory
2. Claude Code automatically reads `CLAUDE.md` on session start
3. The skill in `.claude/skills/community-feed/` is available for deep dives
4. You can also run `/init` to let Claude enhance the CLAUDE.md (but review its changes)

### How It Works

**CLAUDE.md** is loaded automatically at session start. It's ~100 lines: architecture overview, critical rules, project structure pointers. Every conversation with Claude Code starts with this context.

**The skill** (`.claude/skills/community-feed/SKILL.md`) provides a navigation index to the full spec. Claude loads it on-demand when it needs detailed implementation patterns. It tells Claude exactly which section of the spec to read for each type of work.

**Progressive disclosure**: Claude reads CLAUDE.md (overview) → invokes the skill (navigation) → reads the relevant spec section (details). This way the full 2,500 lines never load at once.

### Workflow

1. **Start each phase explicitly**:
   ```
   Read TASKING.md. We're starting Phase 2 (Ingestion).
   Read the matching sections of docs/IMPLEMENTATION_SPEC.md.
   Then implement the tasks in order.
   ```

2. **Let Claude navigate the spec itself**. The skill teaches Claude how to extract specific sections:
   ```
   I need to implement the cursor strategy for feed pagination.
   Read the relevant section of the implementation spec.
   ```

3. **Use the `#` key for memory**. If Claude learns something important during development (like a gotcha with Jetstream event ordering), press `#` and tell it to remember. It'll add it to CLAUDE.md.

4. **One phase per session**. Use `/clear` between phases to reset context.

### If Claude Code Goes Off Track
- Say: "Re-read CLAUDE.md, especially the critical rules section"
- Use `#` to add a correction: "# Remember: never hard delete, always soft delete with deleted=TRUE flag"
- For schema disagreements: "Read docs/IMPLEMENTATION_SPEC.md §6 and use that exact schema"

---

## Using AGENTS.md (Any Tool)

`AGENTS.md` is a cross-compatible standard supported by Cursor, Codex, Gemini CLI, VSCode, and others. It's included in this package as a universal fallback. If you use a tool other than Cursor or Claude Code, it reads AGENTS.md automatically.

For Claude Code specifically, which still prefers its own format, we include both files. They contain the same critical information. If you want to use only AGENTS.md:
```bash
# Make Claude Code read AGENTS.md instead
echo 'See @AGENTS.md' > CLAUDE.md
```

---

## General Best Practices (Any Tool)

### One Phase, One Conversation
The single most important rule. AI agents lose coherence over long conversations. Each phase in TASKING.md is designed to be completable in one focused session. When you finish a phase, commit your code, start a new conversation, and begin the next phase.

### Read Before Write
Every phase in TASKING.md lists which spec sections to read. The AI should read those sections BEFORE writing any code. If you notice it jumping straight to code without reading the spec, stop it:
```
Don't write code yet. First read docs/IMPLEMENTATION_SPEC.md §7 (Data Ingestion).
Then tell me your plan. Then implement.
```

### Test Each Piece
Don't let the AI write all the event handlers, then test. Write one handler, test it, then the next. The verification steps in TASKING.md are there for a reason.

### The Spec Is the Source of Truth
If the AI suggests a different database schema, API contract, or scoring formula — the spec wins. The spec was designed holistically; changing one piece cascades through others. If something in the spec seems wrong, flag it for human review rather than letting the AI improvise.

### Keep the Critical Rules Visible
The 10 non-negotiable rules in CLAUDE.md / AGENTS.md / critical-rules.mdc are the guardrails. They prevent the three most common failure modes:
- **Silent data loss** (rules 3, 4, 10 — deletions, cursor persistence, soft delete)
- **Unexplainable feed** (rules 1, 2 — score decomposition, epoch tagging)
- **Performance death** (rule 5 — no external APIs in hot path)

If you had to pick just ONE rule to enforce, it's rule 1: store score decomposition. Everything that makes this project novel — transparency, governance impact measurement, counterfactual comparison — depends on having every score component stored separately.

---

## Recommended Model Configuration

### Cursor
- **Agent Mode** for implementation tasks (reads files, writes code, runs tests)
- **Claude Sonnet** for most coding tasks (fast, accurate)
- **Claude Opus** for complex architectural decisions or debugging subtle issues
- Enable "Auto run" for test commands

### Claude Code
- Default model is fine for most phases
- Use `/model` to switch if a specific task needs more capability
- Enable auto-approve for file reads to speed up spec navigation
