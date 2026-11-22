/-!
# Formal Verification of the CI Gatekeeping Pipeline (`CIGate.lean`)

Models `.github/workflows/ci.yml` as a typed state machine & dependency DAG
and proves four practical CI engineering guarantees:

1. **`ci_dag_acyclic`**: Every job strictly precedes its dependents under a
   topological rank (no circular `needs:` deadlock is possible).
2. **`merge_iff_all_gates_pass`**: A PR is mergeable *if and only if* every
   required gate (`checkLinux`, `checkMac`, `checkWin`, `auditProd`, `formal`)
   strictly passed — no skipped or failed gate can silently green-wash a merge.
3. **`prod_audit_blocks_real_vuln` & `dev_advisory_does_not_break_ci`**:
   Separating runtime (`--omit=dev`) audit from dev-only advisories guarantees
   zero false-positive CI outages from upstream lint/test tooling while still
   blocking any moderate+ production vulnerability.
4. **`concurrency_latest_wins`**: Under `concurrency: cancel-in-progress: true`,
   any non-empty sequence of pushes to a branch leaves at most one active run,
   and that active run is always the latest commit.
-/

namespace CIGate

/-- Required CI jobs in `.github/workflows/ci.yml`. -/
inductive Job where
  | checkLinux
  | checkMac
  | checkWin
  | auditProd
  | formal
  | mergeReady
  deriving DecidableEq, Repr

/-- Possible execution outcomes of a GitHub Actions job. -/
inductive Outcome where
  | pending
  | passed
  | failed
  | skipped
  deriving DecidableEq, Repr

/-! ## 1. Workflow DAG Acyclicity -/

/-- Direct `needs:` edges (`dependsOn downstream upstream`). -/
def dependsOn (downstream upstream : Job) : Prop :=
  match downstream, upstream with
  | .mergeReady, .checkLinux => True
  | .mergeReady, .checkMac   => True
  | .mergeReady, .checkWin   => True
  | .mergeReady, .auditProd  => True
  | .mergeReady, .formal     => True
  | _, _                     => False

/-- Topological rank witnessing acyclicity. -/
def jobRank : Job → Nat
  | .mergeReady => 1
  | _           => 0

/-- **Theorem 1 (DAG Acyclicity):** Every `needs:` edge goes strictly from
    a lower rank to a higher rank, so no dependency cycle can exist. -/
theorem ci_dag_acyclic (d u : Job) (h : dependsOn d u) :
    jobRank u < jobRank d := by
  cases d <;> cases u <;> simp [dependsOn, jobRank] at h ⊢

/-! ## 2. Non-Bypassable Merge Gate -/

/-- Snapshot of all required CI gate outcomes for a PR. -/
structure GateReport where
  checkLinux : Outcome
  checkMac   : Outcome
  checkWin   : Outcome
  auditProd  : Outcome
  formal     : Outcome
  deriving DecidableEq, Repr

/-- Merge gate decision function. -/
def canMerge (r : GateReport) : Bool :=
  r.checkLinux == .passed &&
  r.checkMac   == .passed &&
  r.checkWin   == .passed &&
  r.auditProd  == .passed &&
  r.formal     == .passed

/-- **Theorem 2 (No Silent Bypass):** `canMerge r = true` if and only if
    every single required gate strictly equals `.passed` (never `.failed`,
    `.skipped`, or `.pending`). -/
theorem merge_iff_all_gates_pass (r : GateReport) :
    canMerge r = true ↔
      r.checkLinux = .passed ∧
      r.checkMac   = .passed ∧
      r.checkWin   = .passed ∧
      r.auditProd  = .passed ∧
      r.formal     = .passed := by
  unfold canMerge
  simp [Bool.and_eq_true, beq_iff_eq, and_assoc]

/-! ## 3. Stable Audit Policy (`--omit=dev --audit-level=moderate`) -/

/-- Security audit report separating production runtime vs dev-only advisories. -/
structure AuditSummary where
  prodModeratePlus : Nat
  devAdvisories    : Nat
  deriving DecidableEq, Repr

/-- Production-focused audit gate: blocks on any moderate+ runtime vulnerability,
    immune to upstream dev-tooling noise. -/
def auditGate (s : AuditSummary) : Outcome :=
  if s.prodModeratePlus == 0 then .passed else .failed

/-- **Theorem 3a (Real Security Gate):** Any moderate+ production vulnerability
    strictly fails the audit gate. -/
theorem prod_audit_blocks_real_vuln (s : AuditSummary) (h : s.prodModeratePlus > 0) :
    auditGate s = .failed := by
  unfold auditGate
  have hne : s.prodModeratePlus ≠ 0 := by omega
  simp [hne]

/-- **Theorem 3b (No False-Positive Dev Noise):** When runtime dependencies have
    0 moderate+ vulnerabilities, upstream dev-only advisories never break CI. -/
theorem dev_advisory_does_not_break_ci (s : AuditSummary) (h : s.prodModeratePlus = 0) :
    auditGate s = .passed := by
  unfold auditGate
  simp [h]

/-! ## 4. Concurrency (`cancel-in-progress: true`) -/

/-- State of a GitHub Actions concurrency group for a single branch ref. -/
structure ConcurrencyGroup where
  activeRun : Option Nat  -- commit sequence number of the sole active run
  deriving DecidableEq, Repr

/-- Pushing a new commit cancels any in-progress run and activates the new commit. -/
def onPush (_g : ConcurrencyGroup) (commitId : Nat) : ConcurrencyGroup :=
  { activeRun := some commitId }

/-- Replay a stream of pushes on a branch. -/
def replayPushes (init : ConcurrencyGroup) (commits : List Nat) : ConcurrencyGroup :=
  commits.foldl onPush init

/-- **Theorem 4 (Latest Commit Always Wins):** After any non-empty sequence of
    pushes, the sole active run in the concurrency group is the last pushed commit. -/
theorem concurrency_latest_wins (init : ConcurrencyGroup) (commits : List Nat)
    (last : Nat) (h : commits.getLast? = some last) :
    (replayPushes init commits).activeRun = some last := by
  induction commits generalizing init with
  | nil => simp at h
  | cons c cs ih =>
    cases cs with
    | nil =>
      simp [replayPushes, onPush] at h ⊢
      exact h
    | cons c2 cs2 =>
      simp [replayPushes] at h ⊢
      exact ih (onPush init c) h

end CIGate
