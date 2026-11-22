/-!
# Formal Verification of `anothertodo/src/sync/merge.ts`

Models the Last-Write-Wins + Tombstone record merge in `anothertodo`,
proves why the original implementation violates CRDT commutativity (and fails
when `modified` parses to `NaN`), and proves that the fixed deterministic
merge satisfies all CRDT join-semilattice laws (Idempotence, Commutativity,
Associativity) plus Tombstone Dominance.
-/

namespace AnotherTodoMerge

/-- A single JSONL sync record from `anothertodo/src/sync/merge.ts`.
    `modified = none` represents a missing or unparseable (`NaN`) timestamp.
    `payload` represents the canonical JSON representation of the record's fields. -/
structure SyncRecord where
  id       : String
  modified : Option Int
  deleted  : Bool
  payload  : String
  deriving DecidableEq, Repr

/-! ## Part 1: Original `merge.ts` model & Counterexamples -/

/-- Exact model of `modifiedMs(remote) > modifiedMs(local)` in JS,
    where `Date.parse("bad") = NaN` and any `>` comparison with `NaN` is `false`. -/
def jsModifiedGt (rem loc : Option Int) : Bool :=
  match rem, loc with
  | some r, some l => decide (r > l)
  | _, _           => false

/-- Original single-record merge from `mergeUnion` in `src/sync/merge.ts`. -/
def mergeOneOriginal (loc rem : SyncRecord) : SyncRecord :=
  if loc.deleted && !rem.deleted then loc
  else if rem.deleted && !loc.deleted then rem
  else if jsModifiedGt rem.modified loc.modified then rem
  else loc

/-- Concrete counterexample: two edits with the exact same timestamp. -/
def recA : SyncRecord :=
  { id := "t1", modified := some 1700000000, deleted := false, payload := "{\"title\":\"A\"}" }

def recB : SyncRecord :=
  { id := "t1", modified := some 1700000000, deleted := false, payload := "{\"title\":\"B\"}" }

/-- **Bug 1 (Proven):** The original `mergeUnion` is NOT commutative.
    Machine 1 merging (A, B) gets A; Machine 2 merging (B, A) gets B. -/
theorem original_not_commutative :
    mergeOneOriginal recA recB ≠ mergeOneOriginal recB recA := by
  decide

/-- Concrete counterexample: corrupt (`NaN`) local timestamp vs valid remote timestamp. -/
def recCorrupt : SyncRecord :=
  { id := "t1", modified := none, deleted := false, payload := "{\"title\":\"corrupt\"}" }

def recValid : SyncRecord :=
  { id := "t1", modified := some 1700000000, deleted := false, payload := "{\"title\":\"valid\"}" }

/-- **Bug 2 (Proven):** A corrupt (`NaN`) local timestamp permanently blocks
    a valid remote update because `valid > NaN` evaluates to `false` in JS. -/
theorem original_nan_poisons_merge :
    mergeOneOriginal recCorrupt recValid = recCorrupt := by
  decide

/-! ## Part 2: Fixed Deterministic CRDT Merge & Formal Proofs -/

/-- Compare two `Option Int` timestamps so that any valid timestamp (`some t`)
    strictly beats a missing/invalid (`none` / `NaN`) timestamp. -/
def cmpOptInt : Option Int → Option Int → Ordering
  | none, none     => .eq
  | none, some _   => .lt
  | some _, none   => .gt
  | some a, some b => compare a b

/-- Total lexicographic order for records with the same `id`:
    1. Tombstone (`deleted = true`) beats live record (`deleted = false`).
    2. Larger valid timestamp beats smaller or invalid (`none`) timestamp.
    3. Deterministic tie-breaker on canonical `payload` string. -/
def cmpRecord (a b : SyncRecord) : Ordering :=
  match compare a.deleted b.deleted with
  | .eq =>
    match cmpOptInt a.modified b.modified with
    | .eq => compare a.payload b.payload
    | o   => o
  | o => o

/-- Fixed single-record merge: returns the greater record under `cmpRecord`. -/
def mergeOneFixed (a b : SyncRecord) : SyncRecord :=
  match cmpRecord a b with
  | .lt => b
  | .eq => a
  | .gt => a

/-! ### Helper lemmas for `cmpOptInt` and `cmpRecord` -/

private theorem cmpOptInt_refl (x : Option Int) : cmpOptInt x x = .eq := by
  cases x with
  | none => rfl
  | some a =>
    simp [cmpOptInt, compare, compareOfLessAndEq]

private theorem cmpOptInt_swap (x y : Option Int) :
    cmpOptInt x y = (cmpOptInt y x).swap := by
  cases x <;> cases y <;> simp [cmpOptInt, Ordering.swap]
  rename_i a b
  exact Std.OrientedOrd.eq_swap (a := a) (b := b)

private theorem cmpOptInt_eq_iff (x y : Option Int) :
    cmpOptInt x y = .eq ↔ x = y := by
  cases x <;> cases y <;> simp [cmpOptInt]

private theorem cmpOptInt_trans_lt {x y z : Option Int}
    (h1 : cmpOptInt x y = .lt) (h2 : cmpOptInt y z = .lt) :
    cmpOptInt x z = .lt := by
  cases x <;> cases y <;> cases z <;> simp [cmpOptInt] at h1 h2 ⊢
  rename_i a b c
  exact Std.TransCmp.lt_trans (cmp := compare) h1 h2

private theorem cmpBool_swap (a b : Bool) :
    compare a b = (compare b a).swap := by
  cases a <;> cases b <;> rfl

private theorem cmpBool_eq_iff (a b : Bool) :
    compare a b = .eq ↔ a = b := by
  cases a <;> cases b <;> simp [compare]

private theorem cmpBool_trans_lt {a b c : Bool}
    (h1 : compare a b = .lt) (h2 : compare b c = .lt) :
    compare a c = .lt := by
  cases a <;> cases b <;> cases c <;> simp [compare] at h1 h2 ⊢

private theorem cmpString_swap (a b : String) :
    compare a b = (compare b a).swap := by
  exact Std.OrientedOrd.eq_swap (a := a) (b := b)

private theorem cmpString_trans_lt {a b c : String}
    (h1 : compare a b = .lt) (h2 : compare b c = .lt) :
    compare a c = .lt := by
  exact Std.TransCmp.lt_trans (cmp := compare) h1 h2

private theorem cmpRecord_refl (a : SyncRecord) : cmpRecord a a = .eq := by
  simp [cmpRecord, cmpOptInt_refl]

private theorem cmpRecord_swap (a b : SyncRecord) :
    cmpRecord a b = (cmpRecord b a).swap := by
  unfold cmpRecord
  rw [cmpBool_swap a.deleted b.deleted]
  cases h1 : compare b.deleted a.deleted <;> simp [Ordering.swap]
  rw [cmpOptInt_swap a.modified b.modified]
  cases h2 : cmpOptInt b.modified a.modified <;> simp [Ordering.swap]
  exact cmpString_swap a.payload b.payload

private theorem cmpRecord_eq_iff (a b : SyncRecord) (hid : a.id = b.id) :
    cmpRecord a b = .eq ↔ a = b := by
  constructor
  · intro h
    unfold cmpRecord at h
    cases h1 : compare a.deleted b.deleted with
    | lt => simp [h1] at h
    | gt => simp [h1] at h
    | eq =>
      simp [h1] at h
      have hd : a.deleted = b.deleted := (cmpBool_eq_iff _ _).mp h1
      cases h2 : cmpOptInt a.modified b.modified with
      | lt => simp [h2] at h
      | gt => simp [h2] at h
      | eq =>
        simp [h2] at h
        have hm : a.modified = b.modified := (cmpOptInt_eq_iff _ _).mp h2
        cases a; cases b; simp_all
  · intro h
    subst h
    exact cmpRecord_refl a

private theorem cmpRecord_trans_lt {a b c : SyncRecord}
    (h1 : cmpRecord a b = .lt) (h2 : cmpRecord b c = .lt) :
    cmpRecord a c = .lt := by
  unfold cmpRecord at h1 h2 ⊢
  cases hd1 : compare a.deleted b.deleted <;> simp [hd1] at h1
  · cases hd2 : compare b.deleted c.deleted <;> simp [hd2] at h2
    · rw [cmpBool_trans_lt hd1 hd2]
    · have : b.deleted = c.deleted := (cmpBool_eq_iff _ _).mp hd2
      rw [← this, hd1]
  · have hdeq : a.deleted = b.deleted := (cmpBool_eq_iff _ _).mp hd1
    rw [hdeq]
    cases hd2 : compare b.deleted c.deleted <;> simp [hd2] at h2 ⊢
    cases hm1 : cmpOptInt a.modified b.modified <;> simp [hm1] at h1
    · cases hm2 : cmpOptInt b.modified c.modified <;> simp [hm2] at h2
      · rw [cmpOptInt_trans_lt hm1 hm2]
      · have : b.modified = c.modified := (cmpOptInt_eq_iff _ _).mp hm2
        rw [← this, hm1]
    · have hmeq : a.modified = b.modified := (cmpOptInt_eq_iff _ _).mp hm1
      rw [hmeq]
      cases hm2 : cmpOptInt b.modified c.modified <;> simp [hm2] at h2 ⊢
      exact cmpString_trans_lt h1 h2

/-! ### Main CRDT Theorems for `mergeOneFixed` -/

/-- **Theorem 1 (Idempotence):** Merging a record with itself changes nothing. -/
theorem mergeOneFixed_idem (a : SyncRecord) :
    mergeOneFixed a a = a := by
  simp [mergeOneFixed, cmpRecord_refl]

/-- **Theorem 2 (Commutativity):** For records of the same task `id`,
    merging `(a, b)` gives the exact same result as merging `(b, a)`. -/
theorem mergeOneFixed_comm (a b : SyncRecord) (hid : a.id = b.id) :
    mergeOneFixed a b = mergeOneFixed b a := by
  unfold mergeOneFixed
  have hswap := cmpRecord_swap a b
  cases hba : cmpRecord b a with
  | lt =>
    rw [hba] at hswap
    simp [Ordering.swap] at hswap
    simp [hswap]
  | gt =>
    rw [hba] at hswap
    simp [Ordering.swap] at hswap
    simp [hswap]
  | eq =>
    rw [hba] at hswap
    simp [Ordering.swap] at hswap
    simp [hswap]
    exact (cmpRecord_eq_iff a b hid).mp hswap

/-- **Theorem 3 (Associativity):** Merging 3 replicas in any grouping order
    yields the exact same result. -/
theorem mergeOneFixed_assoc (a b c : SyncRecord)
    (hab : a.id = b.id) (hbc : b.id = c.id) :
    mergeOneFixed (mergeOneFixed a b) c = mergeOneFixed a (mergeOneFixed b c) := by
  unfold mergeOneFixed
  cases h1 : cmpRecord a b with
  | lt =>
    cases h2 : cmpRecord b c with
    | lt =>
      have h3 : cmpRecord a c = .lt := cmpRecord_trans_lt h1 h2
      simp [h3]
    | eq => simp [h1]
    | gt => simp [h1]
  | eq =>
    have heq : a = b := (cmpRecord_eq_iff a b hab).mp h1
    subst heq
    cases h2 : cmpRecord a c <;> simp [cmpRecord_refl, h2]
  | gt =>
    cases h2 : cmpRecord b c with
    | lt =>
      cases h3 : cmpRecord a c <;> simp
    | eq =>
      have heq : b = c := (cmpRecord_eq_iff b c hbc).mp h2
      subst heq
      simp [h1]
    | gt =>
      have hba : cmpRecord b a = .lt := by
        have hsw := cmpRecord_swap a b; rw [h1] at hsw
        cases h : cmpRecord b a <;> rw [h] at hsw <;> simp [Ordering.swap] at hsw ⊢
      have hcb : cmpRecord c b = .lt := by
        have hsw := cmpRecord_swap b c; rw [h2] at hsw
        cases h : cmpRecord c b <;> rw [h] at hsw <;> simp [Ordering.swap] at hsw ⊢
      have hca : cmpRecord c a = .lt := cmpRecord_trans_lt hcb hba
      have hac_gt : cmpRecord a c = .gt := by
        rw [cmpRecord_swap a c, hca]; rfl
      simp [h1, hac_gt]

/-- **Theorem 4 (Tombstone Dominance):** A deleted task can never be resurrected
    by merging with a live replica. -/
theorem mergeOneFixed_tombstone_left (a b : SyncRecord) (ha : a.deleted = true) :
    (mergeOneFixed a b).deleted = true := by
  unfold mergeOneFixed cmpRecord
  cases hb : b.deleted
  · simp [ha, compare]
  · cases cmpOptInt a.modified b.modified <;> simp [ha, hb]
    cases compare a.payload b.payload <;> simp [ha, hb]

theorem mergeOneFixed_tombstone_right (a b : SyncRecord) (hb : b.deleted = true) :
    (mergeOneFixed a b).deleted = true := by
  unfold mergeOneFixed cmpRecord
  cases ha : a.deleted
  · simp [hb, compare]
  · cases cmpOptInt a.modified b.modified <;> simp [ha, hb]
    cases compare a.payload b.payload <;> simp [ha, hb]

/-- **Theorem 5 (Corrupt-Timestamp Immunity):** A valid timestamp always overwrites
    a missing/corrupt (`none` / `NaN`) timestamp when `deleted` status matches. -/
theorem mergeOneFixed_valid_beats_corrupt (corrupt valid : SyncRecord)
    (hd : corrupt.deleted = valid.deleted)
    (hc : corrupt.modified = none)
    (hv : valid.modified = some t) :
    mergeOneFixed corrupt valid = valid := by
  unfold mergeOneFixed cmpRecord
  rw [hd]
  cases valid.deleted <;> simp [compare, hc, hv, cmpOptInt]

end AnotherTodoMerge
