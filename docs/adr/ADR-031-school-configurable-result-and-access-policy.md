# ADR-031 — School-configurable result and access policy

Status: accepted (2026-09-26, owner decision). Source: student-flow audit F01, F02, F07, F09, F14; plan `docs/STUDENT_FLOW_REMEDIATION_PLAN.md` D1/D2/D4/D5.

## Decisions

| # | Question | Decision | Where it lives |
|---|---|---|---|
| D1 | Rounding before a grade band is chosen | Per grading scale: `none` (exact percent, default) or `half_up_integer` (89.5 → 90). Bands are half-open `[min, next min)`; `max` is display only. A scale that does not start at 0 or has duplicate minimums is rejected. | `GradingScale.bandRounding` |
| D2 | Absent / exempt learners | School setting. `ABSENT_AS_ZERO` (default): unexcused absence scores 0 through the component's `countsAbsentAsZero`; exemption is excluded and the remaining weights re-spread. `ABSENT_BLOCKS`: an absence blocks publication until resolved. `ALL_BLOCK`: absences and exemptions both block. **Missing evidence (no row, or no mark and no participation) always blocks and is never re-weighted away.** | `SchoolProfile.resultAbsencePolicy` |
| D4 | Class-teacher read scope | School setting. `STREAM` (default): own stream. `CLASS`: every stream of the class. Subject teachers read only learners of their own offerings in the active year. Empty authority reads nothing. | `SchoolProfile.classTeacherScope` |
| D5 | P1–P3 learning-area weighting | Assessment policies may be scoped to a programme. Resolution specificity: subject > class > grade level > programme > term. | `AssessmentPolicy.programmeId` |

Related: formative assessments (`Assessment.contribution = formative`) never contribute to term totals; summative work counts through one component (F03). A grading scale serves one `system`; the school default is never borrowed across systems, so nursery (ECD) is never graded on the PLE scale (F14).
