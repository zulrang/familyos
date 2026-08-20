# Code Design Principles

A shared standard for humans and agents in this codebase. Targets: fast review, low mock/patch, easy modification — without losing modularity, separation of concerns, or OCP.

**Domain assumption:** these defaults were written for backend services and domain logic, and they bind frontend code in this codebase too — see "Frontend application" for how each translates to components, hooks, and UI state. Only data/ML pipelines and performance kernels (batch dataflow, cache/layout constraints) get "starting hypothesis" latitude, and this codebase has neither.

**OCP interpretation:** open/closed applies at *proven* axes of variation. Do not manufacture extension points for hypothetical variation. This is why #9 (locality over DRY) and OCP don't conflict — both wait for variation to prove itself before adding an abstraction or extension seam.

## Scope and sorting

The tie-breaker depends on what the unit is.

**Logic-bearing units** (decisions, transforms, domain rules):
> Can the unit be understood, exercised, and changed without instantiating its collaborators?

**Coordination units** (a coordinator's job *is* the collaboration, so the question above can't apply):
> Are the temporal guarantees expressible as keys/receipts, and is the residual distributed state only partial-failure recovery — not domain state?

When two principles conflict on a specific unit, the relevant question above decides.

**Relationship to targets:** the property is the primary shared lever on the three targets, not identical to them. Optimizing it moves all three; it does not guarantee them. Naming, diff size, and review tooling are independent contributors. Treat the property as necessary, not sufficient.

**God-object corollary:** the property constrains the *interface* to collaborators, not their existence. A unit with zero collaborators but high internal complexity has inlined the collaborator, not eliminated it, and fails the "understood" clause. Splitting a coordinator into testable logic units is the goal; collapsing collaborators into one opaque module is the loophole.

## Two tiers

- **Defaults** apply unless there is a stated reason not to.
- **Contingent calls** apply only when their trigger holds. Marked `[CONTINGENT: <trigger>]`. Applied outside the trigger they invert their intended effect. Do not treat a contingent call as a default.

**Deviation convention:** overriding a default requires a greppable marker stating the reason (e.g. `// DESIGN-DEVIATION: <reason>`). This makes "stated reason not to" auditable by both a reviewer and an agent.

A principle that fits most modules can be wrong for the one in front of you. Verify against that module.

## Defaults

### 1. Domain-accurate names
Name by domain concept, not mechanism or layer.
Reason: names are the only interface read before the code. A correct name removes the human's translation step and aligns an agent's priors. A wrong name costs every reader on every pass.

### 2. Contracts machine-checkable and co-located
Parse at boundaries into types; do not validate-and-pass primitives. Keep schemas next to the code they constrain.
Reason: the compiler is the only spec both audiences trust and the only one an agent can verify without asking a human.
Acceptable machinery: declarative schemas defined at a fixed, greppable site (pydantic models, zod schemas, serde/derive, bean validation annotations). The declaration is static and findable. What's banned is the runtime *auto-discovery* of those schemas (see #5), not the declarative style itself.

### 3. Boundaries enforced in CI
Module boundaries fail the build when crossed (import-linter / dependency-cruiser / ArchUnit).
Reason: a human feels friction crossing a boundary; an agent feels none. An unenforced boundary is documentation, not architecture.
Agent: grep for the boundary config before proposing a cross-module import. Comply before CI runs, not after it fails.

### 4. Tests assert behavior, not interaction structure
Assert observable inputs, outputs, and resulting state. Do not assert the internal sequence of calls between a unit and its collaborators.
Reason: tests coupled to call structure fail on every refactor without a behavior change, blocking the refactor and training readers to ignore failures.
Permitted exception — assert the call when the call *is* the observable contract: idempotency ("effect ran once"), a dangerous effect *not* invoked, a message published only after commit, an audit event emitted. Use a spy for these (see taxonomy), and keep them rare.

### 5. Explicit over magic
No runtime auto-discovery, convention-scanning, or registration that hides the call graph.
Reason: both audiences navigate by static reference. Anything ungreppable forces an agent to guess and a human to run the program to find callers.
Permitted: explicit manual wiring at one composition root, and declarative schemas/annotations whose definition site is fixed and greppable (per #2). The line is *static and locatable* (allowed) vs *resolved by scanning at runtime* (banned). One greppable root that wires real adapters or fakes is the intended shape.
Framework carve-out: conventions owned and documented by the framework (Next.js file routing, `page.tsx`/`layout.tsx`/`route.ts`, React context resolution) are permitted — they are locatable via the framework's docs and uniform across every codebase using it. The ban is on *app-authored* magic: our own registries, plugin scanners, or convention-loading that a reader can't resolve statically.

### 6. Illegal states unrepresentable
Validate at construction; encode invariants in types.
Reason: removes the bad state from the test surface (can't test what can't compile) and the review surface (reviewer skips guards the compiler enforces).

### 7. Functional core, imperative shell
Pure decision logic in the center, effects at a thin edge.
Reason: the core tests with zero doubles; the shell is small enough for a few integration tests. Largest single lever on mock count.
`[CONTINGENT: logic-heavy domain]` Payoff scales with extractable pure logic. Orchestration code is shell-dominant with a thin core; there, lean on #2, #6, and the test-double rules instead. Measure core/shell ratio per codebase; it is not constant.

### 8. Vertical slices
Group by capability, not by layer.
Reason: review cost is driven by diff spread. Layer-grouping turns one logical change into edits across many files; slice-grouping turns it into one cohesive diff reviewed in one pass.

### 9. Locality over DRY
`[CONTINGENT: small self-contained unit, abstraction unstable or non-obvious]` Keep code read together physically together; accept duplication over a premature abstraction.
Reason: indirection costs context on every read and regeneration; a small duplicated unit is cheaper to regenerate than to patch across layers.
The test is "changes together vs varies independently," not a call count. Observable proxy: extract only after the duplicated code has already *diverged* at one site (different guards, names, error handling) — divergence is evidence of a real axis of variation, and shows you what to parameterize. Identical copies are evidence of a single unit; extracting them guesses the interface. Guard: confirm the divergence is intentional/domain-driven, not accidental drift — drift should be unified, not parameterized. (Three-plus diverging sites is a common signal, but the signal is the divergence, not the number.)

### 10. Type-first domain modeling
Think through the types, their constraints, and their invariants before touching behavior. When adding or changing a capability, first work out the domain model — what states exist, which are legal, what constrains each value, which transitions are permitted, what each operation must preserve — and encode that as types in the domain's own vocabulary (#1). Only then implement behavior against them, letting the compiler surface the cases.
Reason: constraints and invariants decided up front become structure the compiler enforces on every subsequent edit (#6); decided during implementation they become guards, comments, and tests scattered wherever the code happened to need them. Types back-filled after behavior merely describe what the code does, not what the domain requires. Front-loading the model is what makes #2 and #6 cheap instead of retrofits.
Scope: this is domain-driven in the *modeling* sense — ubiquitous language, constraints, and invariants in types. It is not a mandate for DDD layering or one-port-per-concept; see Architecture fit.
Agent: before implementing, state the types the change needs, the constraints on their values, and the invariants each operation must preserve — then check what the type system can enforce of each. If the existing types cannot express the new state, constraint, or transition, change the types first in their own step, then the behavior. Writing behavior first and retrofitting types is a violation, not a shortcut.

## Frontend application

The defaults bind components, hooks, and UI state. Most translate directly (#1, #3, #8, #9 as written; #6 and #10 via UI state modeling below). The ones that need frontend vocabulary:

- **#4 in UI terms:** assert what the user can observe — rendered output, accessible roles/names, resulting DOM state after interaction (Testing Library queries). Never assert render counts, hook call order, which child components mounted, or internal state values. Spy exception example: an analytics or audit event emitted once.
- **#7 in UI terms:** the pure core is plain functions — calendar slot/overlap layout math, five-day paging arithmetic, list sorting and grouping — importable and testable without React. Components and hooks are the shell: they call the core and own effects, subscriptions, and rendering. If logic can be tested without rendering, it does not belong inside a component.
- **#6/#10 in UI terms:** model UI state as discriminated unions (`idle | loading | loaded | error`), not independent boolean flags whose illegal combinations (`loading && error`) each need a guard. Async data, form state, and pairing/selection flows are the main candidates. Think the states and transitions through before writing the component.
- **Network doubles:** the Fake for a Google-backed port is an in-memory client (or MSW handlers) with real state, subject to the parity rule below.

## Test doubles

Taxonomy, narrowest to widest coupling:
- **Stub** — returns canned values, asserts nothing. Cheapest; use for trivial inputs a unit needs but doesn't decide on.
- **Fake** — working in-memory implementation with real state (e.g. an in-memory repository). Default choice for a port.
- **Spy** — records calls for later assertion. Use *only* for the #4 permitted exceptions where the call is the contract.
- **Mock** — framework object with preset expectations that asserts an interaction sequence. Avoid; it couples the test to implementation.

Rules:
- Prefer a Fake and assert resulting state. Reach for a Stub when a Fake would be more code than the test needs (don't hand-roll a stateful Fake where one canned return suffices — that is itself a #9 violation).
- One hand-written Fake per port, maintained beside the real adapter.
- **Parity:** the Fake and the real adapter must pass one shared contract-test suite. Run it against the Fake in the fast unit lane and against the real adapter in a slower integration lane. Without this, the Fake silently drifts from real behavior and tests pass against a fiction. (Keep the real-adapter run out of the fast lane so the live dependency doesn't gate every unit test.)
  When the real adapter is an authenticated external SaaS (the Google Calendar and Tasks clients here), a live integration lane can't run in CI on every merge. Acceptable substitute: run the shared suite against recorded real responses, or against the live API in a manually-triggered/scheduled lane. Not acceptable: skipping the shared suite — a Fake with no parity check of any kind is the drift risk the rule exists to prevent.
- High mock/patch count is a misplaced-seam signal (logic entangled with I/O, or a collaborator costly to construct). Fix the seam, not the test.

## Seam selection

> Place seams on axes of change. Put the boundary where variation actually happens.

Testability confirms a seam is clean, not correctly placed. A seam can be trivially fakeable and still cut across an axis of change, so every modification crosses it and edits both sides.
Procedure: choose the seam by axis-of-change, then check placement by fakeability. Easy to fake confirms placement. Hard to fake is a misplacement signal, not a reason for a heavier double.

## Orchestration

Types constrain structure, not time. "Already ran," "is a retry," "both effects or neither" are not expressible as types, so type/invariant coverage is lower here than in domain logic. That uncovered temporal region is where distributed state gets called "necessary."
- Handle it with idempotency keys and effect receipts: every effect carries a deterministic key; every handler takes proof-of-not-yet-done as an argument. Coordination moves into the invariant layer and the distributed-state surface shrinks.
  Example: a handler taking a `request_id` and recording a receipt for it won't duplicate the side effect on retry. The temporal guarantee ("ran once") becomes a structural invariant ("receipt exists").
- **Testing idempotency:** assert on receipt state through the receipt-store Fake (run the operation twice, assert one receipt and one effect) — this keeps it a state assertion, consistent with #4. Only where no receipt store exists does the call-count Spy apply, under the #4 permitted exception.
- `[CONTINGENT: fan-out / saga / multi-stage causal chains]` Use distributed coordination state only past simple linear reactions. For single-hop event→effect, keys and receipts suffice. Confirm any "necessary" distributed state is partial-failure recovery, not domain state that belongs in a type.

## Architecture fit

"Well-architected" means serves the three targets, not conforms to the pattern.
Uniform hexagonal + DDD manufactures mock surface: each layer (application service, domain service, mapper, repository) becomes a seam, producing inter-layer doubles and indirection that exists for symmetry. Counter with fewer, fatter, correctly-placed seams.
A port earns existence only at a boundary that varies or needs isolation (real I/O, external service, something actually swapped or faked). This is OCP applied honestly: extension seams at proven axes of variation, not at hypothetical ones. A port per seam trades an indirection layer for understanding cost on both sides.

## Review smells

- High mock/patch count → misplaced seam; logic entangled with I/O.
- One logical change spread across many files → grouped by layer, not capability.
- A port per seam → indirection for symmetry, not variation.
- Unit can't be reasoned about without constructing collaborators → violates the sorting property.
- Zero collaborators but large and complex → inlined collaborator (god-object loophole).
- Behavior-preserving refactor breaks many tests → tests coupled to interaction structure.
- A Fake with no shared contract suite against its real adapter → drift risk.
- New behavior on raw primitives, domain types absent or back-filled → wasn't modeled type-first.
- A default overridden with no `DESIGN-DEVIATION` marker → unauditable deviation; add the marker or comply.

## Targets

Fast review, low mock/patch, and easy modification are the primary consequences of the sorting property, not guarantees of it. The property is the dominant lever; the rest of this document covers the independent contributors (naming, slicing, double selection) that the property alone doesn't fix.
