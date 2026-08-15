# HarmonyMaker — Worship Arrangement Grammar v1
## B1.5-Style Lead-Coupled Source-First Production Contract
### Frozen v0 Implementation Contract

> 문서 경로: `docs/WORSHIP_ARRANGEMENT_GRAMMAR_v1.md`  
> 문서 상태: **FROZEN FOR IMPLEMENTATION**  
> Grammar ID: `worship-arrangement-grammar-v1`  
> Semantic Version: `1.0.1`  
> AlgorithmVersionRegistry `grammarVersion`: `grammar-v1.0.1`  
> Canonical Grammar Config: `src/grammar/worship-arrangement-grammar-v1.0.1.canonical.json`  
> Canonical Grammar Config Semantic Digest: `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482`  
> Preset Profile Version: `preset-profile-v2-b15-v0`  
> Preset Profile Semantic Digest: `ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681`  
> Diagnostic Baseline Semantic Digest: `96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70`  
> Diagnostic Extension Semantic Digest: `aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794`  
> Full Diagnostic Registry Digest: `0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77`  
> 작성 기준일: 2026-08-13  
> 적용 모드: `worship-band-v1 / band-supported`

---

# 0. 최종 동결 선언

이 문서는 HarmonyMaker의 v0 production 보컬 하모니 문법을 구현 가능한 수준으로 완결한다.

```text
WORSHIP_ARRANGEMENT_GRAMMAR_V1_CONTRACT_COMPLETE = YES
WORSHIP_ARRANGEMENT_GRAMMAR_V1_FROZEN_FOR_IMPLEMENTATION = YES
V0_MUSICAL_STRATEGY = B1_5_STYLE_LEAD_COUPLED_CHORD_AWARE
ADDITIONAL_PREIMPLEMENTATION_LISTENING_REQUIRED = NO
B3_REQUIRED_FOR_V0 = NO
CONTROLLED_GENERATED_NCT_REQUIRED_FOR_V0 = NO
PHRASE_FINAL_REFINEMENT_REQUIRED_FOR_V0 = NO
KNOWN_LOCAL_QUALITY_LIMITATIONS_ACCEPTED_FOR_V0 = YES
SOL_ULTRA_ONE_SHOT_IMPLEMENTATION_CONTRACT_READY = YES
```

이 선언은 다음을 뜻한다.

1. 연구 단계에서 선택된 B1.5형 방향을 production 도메인 계약으로 번역한다.
2. PR #7 연구 코드를 그대로 병합하거나 두 번째 domain authority로 만들지 않는다.
3. Step 4에서 멈추는 계약이 아니다. 이 계약을 기준으로 남은 Intent, Activity, Anchor, Solver, Assembler, Validator, UI, playback/export 및 제품 통합을 끝까지 구현할 수 있다.
4. 구현 중 더 좋아 보인다는 이유만으로 B3, 생성 NCT, stable color, expressive rerank 또는 새 grammar를 발명하지 않는다.
5. 진짜 P0 모순이 아닌 이상 이 문서를 구현 단계에서 재설계하지 않는다.

## 0.1 기준선

정본 제품/domain 기준선:

```text
repository = jooa1018/HarmonyMaker
product spec = docs/HARMONYMAKER_SPEC_v3.1.5.md
accepted Step 0–3 branch = codex/bootstrap-step0-1
accepted Step 0–3 head = 04bf71835daa712b077f245b4337a68e96f3d4ee
```

연구 증거:

```text
rc.7 review evidence head = f67a456a38a3071b0f7955a6764376cd6d6f9a37
post-rc.7 B1.5 research head = 79dec6efbb555d2dad074b0a29ada600c4051c1b
```

연구 문서 우선순위:

```text
HarmonyMaker_Post_RC7_Design_Amendment_v1_1.md
> HarmonyMaker_Post_RC7_Design_Amendment_v1.md
> HarmonyMaker_Post_RC7_Grammar_Redesign_Report.md
```

단, 위 연구 문서는 이 문서가 채택한 조항의 근거이며 제품/domain 정본을 자동으로 대체하지 않는다.

## 0.2 권위 우선순위

충돌 시 다음 순서를 적용한다.

1. `HARMONYMAKER_SPEC_v3.1.5.md`의 source, exact time, performer, lifecycle, lock, digest, failure honesty 및 canonical-domain hard invariant
2. 이 문서의 WAG-specific 음악 결정, Activity/Anchor 실현, B1.5 local selector, LASI/LASC 및 pair-selection 조항
3. 이 문서와 함께 동결된 canonical JSON config
4. 명시적으로 채택된 post-rc.7 handoff 결정
5. v1.1 → v1 → original redesign report의 연구 설명
6. PR #7 코드와 rc.7 코드는 테스트/증거 참고자료일 뿐 authority가 아님

제품 spec과 이 문서 사이에 실제 모순이 발견되면 구현자가 임의로 한쪽을 재해석하지 않는다. 충돌 영역만 `BLOCKED_CONTRACT_CONTRADICTION`으로 격리하고, 독립적으로 안전한 구현은 계속한다.

---

# 1. 제품 목적과 규범어

HarmonyMaker는 다음 입력을 받는다.

- authoritative Source Lead melody;
- 사용자가 확인한 Source chord;
- song section 및 phrase;
- 실제 보컬리스트의 `hardRange`, `comfortableRange`, `preferredTessitura`;
- preset, track plan, performer assignment 및 lock.

그리고 최대 다음 성부를 결정적으로 생성한다.

```text
Lead
Upper
Lower
```

목표 사운드는 현대적인 band-supported worship/pop/ballad vocal harmony다.

이 문서의 `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`는 normative requirement다. 설명 문장과 예시는 normative 조항을 완화하지 않는다.

절대 원칙:

- Production runtime의 음표 결정에 generative AI를 사용하지 않는다.
- 같은 canonical input, algorithm version 및 config digest는 같은 semantic output을 만든다.
- 모든 음악 시간은 exact `Fraction`이다.
- Source chord를 재해석하거나 암묵적으로 고치지 않는다.
- 가짜 후보, 가짜 성공 또는 full stack에 의한 marginal 수리를 금지한다.

---

# 2. 핵심 용어

## 2.1 성부 용어

- **Lead:** 정본 Source Lead. 생성 track이 아니다.
- **Upper:** 해당 phrase에서 Lead보다 위에 배치된 하나의 generated harmony track.
- **Lower:** 해당 phrase에서 Lead보다 아래에 배치된 하나의 generated harmony track.
- **H1:** 실제 assignment에서 첫 번째 또는 유일하게 선택된 non-Lead voice. Upper로 고정되지 않는다.
- **H2:** 두 번째로 선택된 non-Lead voice. H1의 종속 chord filler가 아니라 peer standalone-capable line이다.
- **Independent harmony:** 실제 sounding pitch가 Lead와 다르고 Source chord 안에서 별도의 의미 있는 화성 관계를 갖는 generated note.
- **Lead-derived:** unison/octave doubling. v0 자동 생성 문법의 기본 independent harmony로 계산하지 않는다.
- **Marginal projection:** `Lead + Upper` 또는 `Lead + Lower`.
- **Full projection:** `Lead + Upper + Lower`.

`H1`과 `H2`는 설명용 operational label이다. Canonical identity는 `trackPlanId`, performer assignment 및 `placementRole`이다. H1/H2 문자열을 semantic ID나 digest의 독립 authority로 저장하지 않는다.

## 2.2 LASI와 LASC

**Lead-Anchored Subset Integrity (LASI)**는 machine-enforceable layer다.

- source/digest 일치;
- exact timing;
- assignment;
- hard range;
- Activity/Anchor 일치;
- Source chord legality;
- lock 준수;
- projection/dropout equivalence;
- 독립적인 구조 완결성;
- applicable crossing/collision rule;
- failure honesty.

**Lead-Anchored Subset Completeness (LASC)**는 제품/청취 layer다.

```text
Lead
Lead + Upper
Lead + Lower
Lead + Upper + Lower
```

각 projection이 band-supported 문맥에서 독립적으로 사용할 수 있어야 한다. Full trio는 나쁜 Upper 또는 Lower marginal을 수리할 수 없다.

Production runtime은 청취 승인 여부를 음표 선택 authority로 저장하지 않는다. Runtime은 다음을 분리한다.

```text
subsetHardValid
subsetStructurallyComplete
subsetPerceptibilityEligible
```

`subsetListeningAccepted`는 연구/field artifact에서만 존재할 수 있다.

## 2.3 Lead-coupled articulation

v0 기본 articulation은 다음이다.

```text
LEAD_SYLLABLE_COUPLED
+ CANONICAL_TRIGGERED_INTRA_SYLLABLE_PITCH_TRANSITION
```

의미:

- harmony syllable onset은 active 상태에서 Lead syllable onset과 일치한다.
- 새 lyric 또는 새 syllable을 발명하지 않는다.
- ordinary attack/rearticulation은 Lead articulation에서 파생한다.
- pitch trajectory는 Lead pitch와 별도로 선택할 수 있다.
- 자유로운 counter-rhythm 또는 discretionary melisma를 만들지 않는다.
- held Lead syllable 안에서도 canonical chord boundary에서는 harmony pitch를 바꿀 수 있다.

---

# 3. v0 범위와 명시적 비범위

## 3.1 v0에 포함

- B1.5-style local source-chord selection;
- Lead chord-tone과 Lead Source-NCT의 구분;
- Source-chord-aware 3rd/6th preference;
- legal continuation 및 low-motion fallback;
- direct Upper generation;
- direct Lower generation;
- performer hard/comfortable/preferred range authority;
- preferred/hard leap 분리;
- held-syllable chord-boundary adaptation;
- local hard-impossibility rest fallback;
- standalone-first, pair-second;
- LASI projection checks;
- complete/partial/blocked truth;
- deterministic IDs, digests, provenance, playback/export integration.

## 3.2 v0에서 동결하여 제외

다음은 코드에 hook이 존재하더라도 자동 생성 경로에서 비활성이다.

| 기능 | v0 상태 |
|---|---|
| B3-N whole-phrase planning | deferred |
| B3-E expressive rerank | deferred |
| generated passing/neighbor/anticipation/suspension NCT | deferred |
| controlled vocal NCT vocabulary | deferred |
| stable non-resolving color extension family | deferred |
| phrase-final/cadence special refinement | deferred |
| automatic gesture branches | deferred |
| generalized H2 joint search/refinement | deferred |
| learned runtime selection | prohibited |
| unconstrained trio optimization | prohibited |

Source chord에 명시된 suspension, omission, alteration, addition 및 extension은 deferred 기능이 아니다. 이는 Source authority이며 반드시 존중한다.

## 3.3 추가 연구 금지선

구현자는 다음 이유로 범위를 확대하지 않는다.

- 이론적으로 더 아름다울 수 있음;
- 기존 redesign 문서에 미래 hook이 있음;
- local output 하나가 완벽하지 않음;
- 모든 preset이 항상 서로 다른 음을 내지 않음;
- B3가 장기적으로 유망해 보임.

실제 완성된 제품 사용에서 구체적인 실패가 축적된 후에만 deferred backlog를 재검토한다.

---

# 4. Canonical input과 precondition

Grammar는 다음 resolved artifact만 읽는다.

```text
SongSourceDocument
PerformanceSequence
EffectiveChordTimeline
SourceLeadAtomization
SectionOccurrence / PhraseRegion
EffectiveArrangementConfig
PerformerProfile[]
VocalTrackPlan[]
PerformerTrackAssignment[]
stage-specific Locks
```

## 4.1 Source chord

- 오직 하나의 resolved `EffectiveChordTimeline`을 사용한다.
- Grammar, Anchor, Solver, Validator, accompaniment, render, export가 같은 timeline digest를 사용한다.
- `status="ok"`인 `PerformanceChordSpan`만 independent harmony candidate를 허용한다.
- `status="no-chord"`는 generated independent harmony rest를 강제한다.
- carry는 timeline resolver에서 이미 해결되어 있어야 한다.
- unconfirmed, failed, stale 또는 gap-blocked source는 upstream에서 blocking이다.

## 4.2 Source Lead atom

- `SourceLeadAtomization`은 Source, PerformanceSequence 및 EffectiveChordTimeline에서만 파생한다.
- Grammar/Solver local split은 persistent source atom이 아니다.
- 모든 decision은 정확히 하나의 canonical `TimelineAtom`과 chord span에 추적 가능해야 한다.
- SourceLeadAtomization digest mismatch는 blocking이다.

## 4.3 Performer

- `hardRange` 밖 pitch는 후보가 아니다.
- `comfortableRange` 밖이지만 hardRange 안인 pitch는 legal하나 강한 preference miss다.
- `preferredTessitura` 밖이지만 comfortableRange 안인 pitch는 legal하나 preference miss다.
- display name은 selection과 digest에 영향을 주지 않는다.
- Upper/Lower는 각각 실제 배정된 performer range에서 직접 생성한다.

## 4.4 Rights와 mode

- generation allowed use가 없는 source는 생성하지 않는다.
- Core runtime은 `worship-band-v1 / band-supported`만 허용한다.
- standalone-vocal profile은 이 grammar version의 runtime 입력이 아니다.

---

# 5. Version, config authority와 migration 계약

## 5.1 AlgorithmVersionRegistry exact values

Human-facing semantic version은 `1.0.0`이다. Persisted plan/result와 `AlgorithmVersionRegistry`가 저장하는 exact grammar value는 `grammar-v1.0.1`이다. 두 문자열을 혼용하지 않는다.

| Registry field | Frozen value |
|---|---|
| `domainSchemaVersion` | `9` |
| `digestCodecVersion` | `canonical-json-v1` |
| `chordParserVersion` | `chord-parser-v1` |
| `chordTimelineResolverVersion` | `chord-timeline-v1` |
| `performanceExpanderVersion` | `repeat-v1` |
| `sourceLeadAtomizerVersion` | `source-lead-atomizer-v1` |
| `presetProfileVersion` | `preset-profile-v2-b15-v0` |
| `candidateProjectionVersion` | `candidate-projection-v1` |
| `plannerVersion` | `planner-v2-wag1-v0-r1` |
| `grammarVersion` | `grammar-v1.0.1` |
| `activityPlannerVersion` | `activity-planner-v2-lead-coupled-v0-r1` |
| `anchorPlannerVersion` | `anchor-planner-v2-b15-local-v0-r1` |
| `solverVersion` | `solver-v2-b15-local-v0-r1` |
| `assemblerVersion` | `assembler-v2-lasc-v0-r1` |
| `validatorVersion` | `validator-v2-lasi-v0-r1` |
| `metricsVersion` | `metrics-v2-lasi-v0-r1` |
| `diagnosticRegistryVersion` | `diagnostic-registry-v3-wag1-v0` |
| `accompanimentVersion` | `accompaniment-v1` |
| `editMaterializerVersion` | `edit-materializer-v1` |
| `practiceShareCodecVersion` | `practice-share-v1` |
| `omrNormalizerVersion` | `omr-normalizer-v1` |
| `evidenceMappingVersion` | `evidence-mapping-v1` |

변경하지 않는 source/chord/atomization/candidate/accompaniment/edit/share/OMR version은 accepted Step 0–3 semantics를 보존한다는 뜻이다. 음악 선택을 바꾸는 WAG-owned downstream version은 명시적으로 갱신한다.

## 5.2 AlgorithmConfigDigestRegistry binding

WAG v1이 소유하는 아래 stage config field는 하나의 frozen canonical payload를 해시한다.

```text
WAG v1 config semantic digest
= 5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482
```

| Registry field | Exact value |
|---|---|
| `plannerConfigDigest` | `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482` |
| `grammarConfigDigest` | `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482` |
| `activityPlannerConfigDigest` | `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482` |
| `anchorPlannerConfigDigest` | `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482` |
| `solverConfigDigest` | `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482` |
| `assemblerConfigDigest` | `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482` |
| `validatorConfigDigest` | `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482` |
| `metricConfigDigest` | `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482` |

이 shared binding은 각 stage가 서로 다른 숨은 WAG config를 갖지 못하게 하고, payload 변경 시 Intent부터 validator/metrics까지 보수적으로 stale 처리한다. Stage ownership 자체를 합치는 것은 아니다.

다음 두 registry field는 WAG config digest를 복제하지 않는다.

- `diagnosticRegistryDigest`: full registry의 `semanticDigest({ registryVersion, entries })`로 별도 계산한다.
- `accompanimentConfigDigest`: accepted accompaniment config authority를 보존한다.

Version/config mismatch는 기존 `ALGORITHM_CONFIG_MISMATCH`로 block한다.

## 5.3 Diagnostic registry baseline + extension

Normative baseline:

```text
path = src/grammar/wag-v1-diagnostic-baseline.canonical.json
baseline definition count = 94
baseline semantic digest = 96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70
baseline pretty-file sha256 = 0fa15cf0652e41b1509df0f8d140bfa165726a6799a83b19eed59b58dbbbab4c
```

Normative WAG extension:

```text
path = src/grammar/wag-v1-diagnostic-extension.canonical.json
extension definition count = 5
extension semantic digest = aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794
extension pretty-file sha256 = 4be25a0ae3cc28812b85da585e1ef6f0aa2f0ce5fc560e34177aa49eee06379b
target registryVersion = diagnostic-registry-v3-wag1-v0
```

Final registry authority:

```text
final definition count = 99
merge = exact 94-code baseline + exact 5-code extension
duplicate code = blocking package/config error
entries order = code lexical order using the canonical projector
full diagnosticRegistryDigest = 0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77
```

`src/grammar/wag-v1-diagnostic-baseline.canonical.json`은 accepted Step 0–3의 94개 `DiagnosticCode` 각각에 대해 `defaultSeverity`, `blocksGeneration`, `blocksComplete`, `scope`를 정확히 한 번 정의하는 새 정본이다. v3.1.5와 accepted code에는 code set과 projector만 있었고 per-code definition table은 없었으므로, 이 baseline은 존재하던 값을 “복원”했다고 주장하지 않는다. 이 문서 v1.0.1이 그 누락을 봉합하는 production definition authority다. 구현자는 더 이상 존재하지 않는 “existing definitions”를 추정하지 않는다.

`createDiagnosticRegistry()`에 넘기는 final `Record<DiagnosticCode, DiagnosticDefinition>`은 두 frozen artifact의 exact merge여야 한다. Severity만 보고 block boolean을 파생하거나 runtime context에 따라 boolean을 바꾸지 않는다. Candidate-local rejected diagnostic은 retained sibling의 result-level diagnostic으로 자동 승격하지 않으며, OMR/share/edit 같은 operation-local diagnostic은 canonical generation result에 자동 복사하지 않는다.

`blocksGeneration=false`인 diagnostic 하나만으로 `ArrangementGenerationResult.status="blocked"`를 만들 수 없다. Stage가 실제로 유효한 결과를 만들 수 없다면 같은 result scope에 `GRAMMAR_BLOCKED` 또는 그 실패를 정확히 나타내는 다른 `blocksGeneration=true` code를 함께 emit해야 한다. 반대로 candidate-local hard rejection은 retained legal sibling이 존재하는 한 result-level blocking diagnostic으로 승격하지 않는다.

Application startup과 CI는 final 99 entries로 full digest를 재계산하여 위 exact digest와 비교한다. 불일치는 `ALGORITHM_CONFIG_MISMATCH`로 block한다.

## 5.4 Schema와 기존 artifact

- `SongSourceDocument.schemaVersion = 9`를 유지한다.
- `HarmonyProject.schemaVersion = 9`를 유지한다.
- 새 persistent lifecycle stage를 추가하지 않는다.
- 기존 rc.7 또는 research Plan/Candidate를 새 semantics로 migration하지 않는다.
- 기존 downstream artifact는 Intent부터 stale 처리하고 canonical source/chord/atomization에서 재생성한다.
- Source revision, OMR evidence, correction history, performer 및 assignment는 유효하면 그대로 보존한다.
- Research-only route와 artifact는 production dependency graph에서 제거하거나 명확히 격리한다.

## 5.5 v3.1.5에 대한 WAG-specific resolution

이 문서는 authoritative product/domain invariant를 바꾸지 않고 다음 미결정 WAG slot을 채운다.

1. `TWO_PART_PARALLEL`은 fixed-parallel interval이 아니라 B1.5형 Lead-coupled marginal grammar의 compatibility ID다.
2. `UNISON`은 generated unison이 아니라 `trackRoles=[]`인 Lead-only sentinel로 사용한다.
3. Activity attack cap은 Lead-coupled 한 track 10000 bp, 두 track 20000 bp를 허용하도록 profile v2에서 갱신한다.
4. generated NCT, Pad, suspension, expressive branch와 B3 path planning은 v0 자동 생성에서 0개다.
5. top-3 diversity는 pitch K-best 또는 B3가 아니라 immutable voice-set siblings인 `Lead+H1`, `Lead+H2`, `Lead+Upper+Lower`로 충족한다. 존재하지 않는 sibling을 만들기 위해 marginal을 변형하지 않는다.
6. Intent→Activity→Anchor→Solver ownership은 유지하며, Activity가 exact rest/note participation을 결정하기 위해 selector의 non-persistent feasibility preview를 실행할 수 있다.
7. v3.1.5 §14.5의 generic `CORE_PHRASE_SOLVER_LIMITS`는 WAG v1 자동 경로에서 비활성이다. `maxPitchCandidatesPerAnchorPerTrack`, `beamWidth`, `kBestPerTexture`, `maxSubphraseAnchors`는 별도 hidden solver config가 아니며 후보를 truncate하지 않는다. WAG v1은 exact Source chord tone × hardRange octave의 유한 공간을 전부 열거하고 local rank를 적용한다. `beamWidth = 1`은 semantic 설명일 뿐 limit field가 아니다.

# 6. PresetProfileRegistry v2

새 profile은 sparse rc.7 attack ceiling이 accepted B1.5 full-phrase articulation을 막지 않도록 attack cap을 수정한다.

| preset | max active voices | attack cap | preferred leap | hard leap | generated suspension | source color tone | octave | rhythm | max role changes/section | sustain pulses |
|---|---:|---:|---:|---:|---|---|---|---:|---:|---:|
| simple | 2 | 10000 | 4 | 7 | no | same-family에서 deprioritized | no | 0 | 0 | 2 |
| standard | 3 | 20000 | 5 | 9 | no | eligible | no | 0 | 1 | 4 |
| full | 3 | 20000 | 7 | 12 | no | eligible | user-cap-dependent | 0 | 2 | 8 |

정확한 profile registry projection은 다음이다.

```text
projectionSchema = hm-preset-profile-registry-v1
presetProfileVersion = preset-profile-v2-b15-v0
profiles order = [simple, standard, full]
presetProfileDigest = ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681
```

`profiles`는 위 canonical order의 array로 해시한다. Record insertion order, display label 또는 UI sort를 해시 authority로 사용하지 않는다. Exact semantic payload는 companion canonical JSON과 동일해야 한다.

`allowColorTones=false`는 Source chord의 explicit color tone을 삭제하거나 hard-illegal로 만들지 않는다. Simple에서는 같은 candidate family 안에서 non-color를 먼저 선택한다. 그러나 explicit chord-aware 3rd/6th family와 Source sus/omit/alter authority를 거슬러 generic root/fifth를 강제하지 않는다.

## 6.1 Attack ratio 의미

```text
harmonyAttackRatio
= total Lead-coupled lyric-bearing attack/reentry count across generated tracks
  / Source Lead lyric-bearing attack count
```

- 한 track이 모든 Lead attack을 따라가면 `10000 bp`다.
- 두 track이 모두 따라가면 `20000 bp`다.
- held syllable 내부 canonical chord-boundary pitch transition은 새 lyric attack이 아니므로 numerator에 포함하지 않는다.
- 별도의 pitch-transition metric으로 측정할 수 있다.

## 6.2 사용되지 않는 profile field

`maxSustainPrimaryPulses`와 full의 octave allowance는 schema compatibility를 위해 유지된다. 자동 Pad, generated unison 또는 octave branch를 활성화하지 않는다. Exact user lock이 기존 domain hard rule 안에서 요구할 때만 사용한다.

# 7. Grammar adapter와 legacy texture compatibility

새 lifecycle stage를 만들지 않는다.

```text
Intent
→ Activity
→ Anchor
→ local Solver
→ standalone candidates
→ pair screen
→ Section/Song assembly
→ independent Validator
```

## 7.1 `TexturePatternId` compatibility

기존 TypeScript union을 유지하기 위해 v0는 두 identifier만 자동으로 선택한다.

| stored ID | v0 normative meaning |
|---|---|
| `UNISON` | Lead-only sentinel. Generated unison event를 뜻하지 않음. `trackRoles=[]`, Activity는 generated rest. |
| `TWO_PART_PARALLEL` | B1.5형 Lead-coupled, Source-chord-aware independent harmony. 이름의 `PARALLEL`은 fixed interval을 뜻하지 않으며, `TWO_PART`는 각 `Lead + one voice` marginal을 가리키는 compatibility ID다. 두 generated track이 있으면 같은 marginal grammar가 각 track에 독립 적용된다. |

다음 ID는 자동 선택 금지다.

```text
UNISON_TO_SPLIT
ACCENT_BLOCK
SUSTAINED_PAD
SUSPENSION_RELEASE
```

해당 ID를 exact lock이 요구하되 v0 semantics로 충족할 수 없으면 조용히 대체하지 않고 existing `STAGE_LOCK_SCOPE_INVALID` 또는 `GRAMMAR_BLOCKED`로 block하고 stable reason detail을 기록한다.

## 7.2 Section Intent

`planSection()`은 section type으로 harmony를 임의로 sparse하게 만들지 않는다.

- effective harmony track 0개: Lead-only target.
- effective harmony track 1개 이상: supported Lead-sounding duration 전체에서 H1 participation을 기대한다.
- effective harmony track 2개: H2는 pair-valid할 때 선택 가능한 optional peer다.
- section label 또는 emotional guess는 harmony on/off authority가 아니다.

`SectionIntensityTarget`은 v0에서 quota 기반 note selector가 아니라 diagnostic target이다.

```text
0 harmony tracks:
  participation = 0
  divergence = 0
  exactlyTwo = 0
  exactlyThree = 0
  maxActiveVoiceCount = 1

1 harmony track:
  participation = 10000
  divergence = 10000
  exactlyTwo = 10000
  exactlyThree = 0
  maxActiveVoiceCount = 2

2 harmony tracks:
  participation = 10000
  divergence = 10000
  exactlyTwo = 0
  exactlyThree = 10000
  maxActiveVoiceCount = 3
```

Local rest fallback, N.C. 및 hard constraint 때문에 실제 metric이 target보다 낮을 수 있다. Underfill은 진단하되 가짜 note로 채우지 않는다.

`maxHarmonyAttackRatioBp = effectiveConfig.maxHarmonyAttackRatioBp`다.

`registerSpreadRange`의 단위는 sounding semitone spread다. Harmony track 0개이면 `[0, 0]`이다. 1개 이상이면 baseline-eligible decision마다 current Source chord tone을 actual performer hardRange 안에서 strict placement로 실현한 모든 local combination의 spread를 계산하고, continuity/leap/lock을 적용하기 전의 전체 feasible set에서 `[minimum, maximum]`을 얻는다. Evaluable combination이 0개면 `[0, 0]`이다. 이 값은 diagnostic target이며 note selection authority가 아니다. 임의의 성별/파트명 고정 음역을 사용하지 않는다.

## 7.3 Phrase Intent

Independent harmony가 기대되는 phrase:

```text
textureId = TWO_PART_PARALLEL
lyricPolicy = same-lyrics
splitDirective = undefined
trackRoles = selected actual track-role mapping
cadencePolicy = authoritative spec의 deterministic derivation
```

Lead-only가 정당한 phrase:

```text
textureId = UNISON
trackRoles = []
```

`UNISON` 상태에서 generated track에 unison note를 만들지 않는다.

---

# 8. Track와 placement-role 선택

## 8.1 원칙

- H1은 Upper로 고정하지 않는다.
- 한 performer만 있으면 Upper와 Lower role hypothesis를 모두 실제 range로 평가한다.
- 두 performer가 있으면 가능한 one-to-one mapping을 평가한다.
- duplicate Upper 또는 duplicate Lower는 v0에서 자동 허용하지 않는다.
- 역할은 phrase boundary에서만 바뀔 수 있다.
- section의 role-change count는 preset hard cap을 넘지 않는다.

## 8.2 `previewMarginalRoleFeasibility`

Intent stage는 exact note나 `ChordToneSpec`을 저장하지 않으면서 역할 선택을 위해 frozen pure selector의 baseline dry-run을 실행한다. 이 preview는 `IntentLock[]`까지만 읽으며, 뒤 단계 lock을 미리 import하지 않는다.

각 candidate mapping에 대해 phrase performance order로 다음 tuple을 계산한다.

```text
1. blockingDecisionCount
2. localRestDurationBp
3. hardOnlyRangeDurationBp
4. preferredMissDurationBp
5. preferredLeapExcessSemitoneSum
6. totalMotionSemitones
7. roleChangeCount
8. canonicalTrackRoleTuple
```

낮은 tuple이 우선한다.

- `blockingDecisionCount > 0`인 mapping은 eligible하지 않다.
- Duration projection은 exact Fraction에서 deterministic basis points로 변환한다.
- display name, input array order, object insertion order는 tuple에 들어가지 않는다.
- 한 track만 선택하는 Simple에서는 enabled assigned track × feasible role을 비교한다.
- Standard/Full에서 두 track을 선택하면 `{Upper, Lower}` bijection만 비교한다.
- 이전 phrase role은 persisted previous PhraseIntent에서만 읽는다.
- Preview가 계산한 pitch/tone/rest path는 persistent Intent 의미가 아니며 저장하지 않는다.

Persistent semantic authority는 최종 `PhraseArrangementIntent.trackRoles`다.

## 8.3 Preview parity와 downstream lock 경계

동일한 effective input과 동일 lock scope에서 preview recomputation key가 달라지면 구현 불일치다.

```text
same effective inputs
AND same IntentLock projection
AND recomputed preview key differs
→ WAG_V1_ROLE_PREVIEW_PARITY_MISMATCH
```

ActivityLock, AnchorLock 또는 SolverLock이 뒤 단계에서 합법적으로 eligibility를 바꾸는 것은 role-preview parity mismatch가 아니다. 각 stage는 자기 lock을 읽고 자기 stage input digest를 바꾼다. 불가능한 downstream lock은 해당 lock/stage diagnostic으로 정직하게 block한다.

# 9. Activity semantics

## 9.1 Baseline eligible grid

선택된 generated track은 phrase 안의 모든 baseline-eligible canonical Lead atom에서 independent harmony participation을 시도한다.

Baseline-eligible 조건:

1. Lead atom pitch가 존재한다.
2. 해당 exact range를 덮는 `EffectiveChordTimeline` span이 `ok`다.
3. phrase range 안이다.
4. Intent에서 해당 track-role이 active다.
5. track과 performer assignment가 유효하다.

Source Lead rest, explicit N.C., phrase 밖은 baseline rest다. Section type에 따라 임의로 첫 마디를 비우거나, verse라서 tail만 부르거나, 짧다는 이유로 sparse aesthetic branch를 만들지 않는다.

## 9.2 Activity-owned feasibility pass

Activity Planner는 `ActivityLock[]`을 적용한 뒤 각 baseline-eligible decision에 대해 frozen local selector를 **feasibility-only**로 재실행한다.

```text
hard-legal pitch exists
→ VoiceActivityDirective = independent-note / independent-harmony

hard-legal pitch does not exist
AND no ActivityLock requires sounding activity
→ VoiceActivityDirective = rest
→ candidate reason `LOCAL_REST_HARD_IMPOSSIBILITY`

hard-legal pitch does not exist
AND ActivityLock requires sounding activity
→ stage blocked
```

이 pass는 exact pitch와 `ChordToneSpec`을 persistence하지 않는다. Activity가 소유하는 의미는 exact `rest` 대 `independent-note` participation뿐이다. 이를 통해 Anchor union에 가짜 rest directive를 추가하지 않는다.

Activity feasibility preview는 **phrase/track별 canonical performance order로 순차 실행**한다. 첫 ordinary decision은 `previousSoundingPitch=undefined`, `continuityState=initial`이다. Preview가 note를 선택하면 그 non-persistent selected pitch를 다음 exact-adjacent decision의 `previousSoundingPitch`로 전달하고 `continuous`로 표시한다. Preview가 rest를 선택하면 previous pitch를 지우고 다음 sounding attempt를 `reentry`로 표시한다. Ordinary phrase boundary에서는 상태를 reset한다. §9.7의 valid exact boundary-sustain lock만 continuous 초기화를 허용한다. 이 carried path는 stage-local이며 Plan에 저장하지 않지만, 동일 effective input을 재실행하는 Anchor parity pass는 동일한 순차 상태 전이를 재현해야 한다.

## 9.3 `VoiceActivitySpan`

- 동일 Activity state의 adjacent exact decision range를 maximal span으로 coalesce한다.
- `independent-note` span은 최소 하나의 hard-legal pitch가 존재하는 decision만 포함한다.
- rest range는 명시적 `rest` span이다.
- chord boundary는 Activity on/off boundary일 필요가 없지만 local decision boundary다.
- Activity는 pitch나 chord tone을 저장하지 않는다.
- ActivityLock exact boundary는 persistent source atom을 만들지 않는 stage-local split이다.

## 9.4 Attack event

- Lead syllable onset과 같은 위치: `attack`.
- generated rest 뒤의 Lead syllable onset: `reentry`.
- phrase end 또는 explicit Lead rest 진입: `release`.
- held syllable 내부 chord boundary: 새 lyric attack event를 만들지 않는다.
- 같은 syllable의 pitch transition은 Anchor/Solver/generated-event layer에서 표현한다.

## 9.5 Activity–Anchor parity

Anchor Planner는 `independent-note` decision마다 같은 effective input과 lock projection으로 selector를 다시 실행한다.

```text
Activity = independent-note
AND Anchor receives same effective inputs
AND hard-legal candidate set is empty
→ WAG_V1_ACTIVITY_ANCHOR_FEASIBILITY_PARITY_MISMATCH
```

AnchorLock이 selected tone을 합법적으로 override하면 그 lock이 Anchor authority다. Activity와 Anchor의 input digest가 달라지는 정상 경로를 parity 오류로 오판하지 않는다.

합법적인 `AnchorLock` 또는 `PitchLock` 때문에 downstream effective input이 달라지고, Activity가 `independent-note`로 확정한 decision의 hard-legal set이 0개가 되면 해당 lock을 소유한 stage가 `STAGE_LOCK_SCOPE_INVALID`로 block한다. Stable details에는 `reason=LOCK_INDUCED_NO_LEGAL_CANDIDATE`, stage, lock ID, phrase/track/position을 넣는다. Anchor/Solver는 rest를 만들거나 Activity span을 수정하지 않으며, input이 달라진 이 경로에 parity-mismatch code를 사용하지 않는다. Lock이 원인이 아닌 changed-input zero-set은 `GEN_NO_PITCH_CANDIDATE`와 result-level `GRAMMAR_BLOCKED`로 처리한다.

## 9.6 Local rest와 continuity

- Rest는 ordinary pitch candidate와 경쟁하지 않는다.
- 하나라도 hard-legal pitch가 있으면 aesthetic 이유로 Rest를 선택할 수 없다.
- Rest 뒤에는 ordinary melodic continuity가 reset되고 다음 sounding note는 reentry다.
- exact range와 reason을 diagnostic/provenance에 기록한다.
- local fallback 자체는 candidate를 자동 `partial`로 만들지 않는다.
- 그러나 required H1 coverage 또는 perceptibility를 잃으면 candidate는 partial/rejected/blocked semantics를 따른다.

## 9.7 Phrase boundary

v0는 canonical `PhraseRegion` boundary를 ordinary leap continuity의 release/reentry boundary로 본다. Exact user lock이 boundary sustain을 요구하는 경우만 continuity를 유지한다.

- 새 pitch는 여전히 hardRange 안이어야 한다.
- reentry register/distance는 soft diagnostic이다.
- lock으로 continuous sustain이면 `hardMaxLeapSemitones`를 그대로 적용한다.

# 10. Canonical local decision grid

Persistent 새 source atom을 만들지 않는다. Solver-local decision은 다음 canonical join에서 파생한다.

```ts
interface LocalHarmonyDecisionContext {
  readonly phraseId: string;
  readonly trackPlanId: string;
  readonly placementRole: "upper" | "lower";
  readonly sourceLeadAtomizationDigest: SemanticDigest;
  readonly leadAtomId: string;
  readonly exactRange: MusicalRange;
  readonly chordSpanId: string;
  readonly leadPitch: SpelledPitch;
  readonly trigger:
    | "LEAD_ATTACK"
    | "CANONICAL_CHORD_BOUNDARY"
    | "CANONICAL_PHRASE_BOUNDARY"
    | "CANONICAL_SECTION_BOUNDARY"
    | "STAGE_LOCK_BOUNDARY";
  readonly lyricOnset: boolean;
  readonly previousSoundingPitch?: SpelledPitch;
  readonly continuityState: "continuous" | "reentry" | "initial";
}
```

Decision boundary는 다음의 union이다.

- SourceLeadAtomization atom start;
- EffectiveChordTimeline boundary;
- phrase/section boundary;
- exact lock boundary.

v0 generated NCT boundary는 존재하지 않는다. 동시에 여러 boundary가 겹치면 trigger priority는 `LEAD_ATTACK → CANONICAL_CHORD_BOUNDARY → CANONICAL_PHRASE_BOUNDARY → CANONICAL_SECTION_BOUNDARY → STAGE_LOCK_BOUNDARY`다. Trigger는 trace/classification이며 다른 canonical boundary kind를 지우는 음악 authority가 아니다.

Ordering:

```text
performanceMeasureIndex
→ exact offset Fraction
→ track canonicalOrdinal
→ placementRole ordinal (upper, lower)
→ leadAtom canonical ordinal
→ chordSpan canonical ordinal
```

---

# 11. Source chord candidate vocabulary

## 11.1 Candidate family

```ts
type V0HarmonyCandidateFamily =
  | "LEGAL_CONTINUATION"
  | "LOW_MOTION_CHORD_TONE"
  | "CHORD_AWARE_THIRD_SIXTH"
  | "CONTEXTUAL_CHORD_TONE"
  | "REST";
```

`REST`는 hard fallback이며 ordinary ranking sibling이 아니다.

## 11.2 Candidate source

Independent note candidate는 반드시 현재 `ParsedChord.tones`의 하나를 exact spelling으로 실현한다.

```text
ParsedChord tone
→ spelled pitch class
→ all octave realizations inside performer hardRange
→ strict Upper/Lower placement filter
→ hard leap/lock filter
→ deterministic rank
```

Scale degree 또는 key-only diatonic note를 Source chord 밖에서 삽입하지 않는다.

## 11.3 Tone spelling

Normative constants:

```text
NATURAL_SEMITONE = C:0, D:2, E:4, F:5, G:7, A:9, B:11
MAJOR_SCALE_OFFSET = [0, 2, 4, 5, 7, 9, 11]
```

`ChordToneSpec tone`과 `ParsedChord.root`를 pitch class로 실현하는 exact formula:

```text
degreeClassIndex = (tone.degree - 1) mod 7
targetStep = root.step에서 degreeClassIndex만큼 diatonic letter advance
rootPc = mod12(NATURAL_SEMITONE[root.step] + root.alter)
targetPc = mod12(rootPc + MAJOR_SCALE_OFFSET[degreeClassIndex] + tone.alteration)
targetAlter = [-2, -1, 0, 1, 2] 중
              mod12(NATURAL_SEMITONE[targetStep] + value) = targetPc인 유일한 value
```

- `targetAlter`가 존재하면 `{ step: targetStep, alter: targetAlter }`가 유일한 `SpelledPitchClass`다.
- root spelling과 diatonic target letter를 보존하며 MIDI-equivalent enharmonic으로 임의 교체하지 않는다.
- `Alter` 범위 `-2..2` 안에 해가 없으면 그 tone은 `SOURCE_CHORD_TONE_SPELLING_UNREPRESENTABLE` reason으로 candidate enumeration에서 제외한다. 다른 exact Source chord tone은 계속 평가한다. 모든 tone이 제외되거나 다른 hard filter까지 합쳐 legal candidate가 0개이면 ordinary local rest/block 정책을 적용한다. 잘못된 enharmonic note를 만들지 않는다.
- octave enumeration은 hardRange와 valid MIDI/sounding range 안에서만 한다.
- 동일 semantic pitch candidate는 한 번만 남긴다.

## 11.4 Source sus/omit/alter/extension authority

- `no3` chord에서 third를 생성하지 않는다.
- sus chord에서 omitted third를 복원하지 않는다.
- explicit suspension tone은 source chord tone이다.
- explicit alteration을 natural tone으로 되돌리지 않는다.
- explicit add9/extension/color tone은 source chord tone이다.
- slash bass는 accompaniment bass authority다. Slash bass pitch class가 `ParsedChord.tones`에도 존재하지 않는 한 vocal candidate를 추가하지 않는다.

`allowColorTones=false`일 때 source color tone을 삭제하지 않는다. 다른 동등 후보보다 뒤로 보내는 `sourceColorPolicyOrdinal=1`을 사용한다. Source chord에서 유일하게 합법적인 candidate이거나 3rd/6th/continuation hierarchy가 우선하면 선택될 수 있다.

---

# 12. 3rd/6th semantics

## 12.1 Vertical relation과 chord role 분리

`3rd/6th`는 Lead와 harmony의 generic diatonic vertical relation이다. `ChordToneSpec.role`과 같은 개념이 아니다.

```text
leadDiatonicIndex = lead.octave * 7 + stepOrdinal(lead.step)
harmonyDiatonicIndex = harmony.octave * 7 + stepOrdinal(harmony.step)
genericInterval = abs(harmonyDiatonicIndex - leadDiatonicIndex) + 1
simpleGenericClass = ((genericInterval - 1) mod 7) + 1
```

`simpleGenericClass ∈ {3, 6}`이면 3rd/6th relation이다. Compound 10th/13th 등도 같은 class로 포함한다.

## 12.2 Chord-aware condition

`CHORD_AWARE_THIRD_SIXTH`가 되려면 동시에 다음을 만족해야 한다.

1. harmony candidate가 exact current Source chord tone이다.
2. strict placement를 만족한다.
3. generic relation class가 3 또는 6이다.
4. 모든 hard filter를 통과한다.

단순 key diatonic third이지만 Source chord tone이 아니면 이 family가 아니다.

## 12.3 Lead chord-tone 여부

Lead sounding pitch class가 current `ParsedChord.tones` 중 하나와 같으면 `LeadChordTone`, 아니면 `LeadSourceNct`다.

Source Lead NCT는 입력 오류가 아니다. Generated harmony가 Source chord tone으로 계속되도록 local hierarchy를 바꾼다.

---

# 13. Hard filter

Pitch candidate는 ranking 전에 다음 순서로 hard-prune한다.

1. current EffectiveChord span이 `ok`인가;
2. exact Source chord tone인가;
3. Upper이면 `candidateMidi > leadMidi`, Lower이면 `candidateMidi < leadMidi`인가;
4. performer hardRange 안인가;
5. continuous previous sounding pitch가 있으면 leap가 `hardMaxLeapSemitones` 이하인가;
6. applicable Intent/Activity/Anchor/Solver lock을 만족하는가;
7. canonical spelling/ID projection이 유효한가;
8. duplicate semantic candidate가 아닌가.

Hard filter를 soft penalty로 바꾸지 않는다.

## 13.1 Hard leap

```text
continuous motion:
  abs(candidateMidi - previousMidi) > hardMaxLeap
  → prune

rest/reentry or canonical phrase reset:
  hard leap prune를 적용하지 않음
  → hardRange는 계속 적용
  → reentry difficulty는 soft diagnostic
```

Tie 또는 same-pitch continuation의 leap는 0이다.

---

# 14. Exact local selector

모든 비교는 non-negative integer/tuple이며 lexicographic ascending이다. Floating point, negative reward, random tie-break을 금지한다.

## 14.1 공통 파생값

### Range band

```text
0 = preferredTessitura 안
    또는 preferredTessitura가 없고 comfortableRange 안
1 = comfortableRange 안이지만 preferredTessitura 밖
2 = hardRange 안이지만 comfortableRange 밖
```

### Preferred leap

```text
preferredLeapViolationOrdinal = motion > preferredMaxLeap ? 1 : 0
preferredLeapExcessSemitones = max(0, motion - preferredMaxLeap)
```

### Lead proximity

```text
0 = abs(candidateMidi - leadMidi) >= 3
1 = 2 semitones
2 = 1 semitone
```

Unison은 strict placement hard filter에서 이미 제거된다.

### Role-directed register

```text
Upper: candidateMidi ascending
Lower: -candidateMidi ascending
```

따라서 모든 상위 criterion이 같으면 Upper는 더 낮은 legal octave, Lower는 더 높은 legal octave를 선택한다.

### Source color policy

```text
0 = non-color tone 또는 allowColorTones=true
1 = role=color이고 allowColorTones=false
```

이 값은 family 바로 뒤에 놓여 같은 family 안에서 color를 강하게 deprioritize한다. Source tone을 candidate vocabulary에서 삭제하지 않는다.

### Chord-tone canonical ordinal

`ParsedChord.tones`를 다음 semantic tuple로 정렬한 0-based ordinal이다.

```text
degree
→ alteration
→ role ordinal: root, third, fifth, seventh, color, suspension
→ origin ordinal: root, quality, extension, addition, alteration, suspension
```

Parser의 원래 array order나 chord display symbol 문자열은 tie-break authority가 아니다.

## 14.2 Lead가 Source chord tone일 때

Rank tuple:

```text
1. thirdOrSixthFamilyOrdinal
   0 = CHORD_AWARE_THIRD_SIXTH
   1 = CONTEXTUAL_CHORD_TONE
2. sourceColorPolicyOrdinal
3. rangeBandOrdinal
4. preferredLeapViolationOrdinal
5. preferredLeapExcessSemitones
6. leadProximityOrdinal
7. motionSemitones
8. chordToneCanonicalOrdinal
9. roleDirectedRegisterOrdinal
10. canonicalPitchTuple
```

첫 decision 또는 reentry에서 previous pitch가 없으면 motion과 preferred leap 값은 0이다.

## 14.3 Lead가 Source-NCT일 때

Family classification:

```text
LEGAL_CONTINUATION:
  previous sounding pitch와 same sounding pitch
  AND 그 pitch가 current Source chord tone

LOW_MOTION_CHORD_TONE:
  motion <= 2 semitones
  AND LEGAL_CONTINUATION이 아님

CHORD_AWARE_THIRD_SIXTH:
  current Lead와 generic 3rd/6th
  AND 위 두 family가 아님

CONTEXTUAL_CHORD_TONE:
  나머지 Source chord tone
```

Rank tuple:

```text
1. legalContinuationOrdinal
   0 = LEGAL_CONTINUATION
   1 = other
2. lowMotionOrdinal
   0 = LEGAL_CONTINUATION 또는 LOW_MOTION_CHORD_TONE
   1 = other
3. thirdOrSixthFamilyOrdinal
4. sourceColorPolicyOrdinal
5. rangeBandOrdinal
6. preferredLeapViolationOrdinal
7. preferredLeapExcessSemitones
8. leadProximityOrdinal
9. motionSemitones
10. chordToneCanonicalOrdinal
11. roleDirectedRegisterOrdinal
12. canonicalPitchTuple
```

이 순서는 Lead-NCT에서 legal continuation/low motion이 generic 3rd/6th보다 먼저 이길 수 있게 한다.

## 14.4 Final tie-break

`canonicalPitchTuple`:

```text
midi
→ step ordinal C,D,E,F,G,A,B
→ alteration integer
→ octave
```

두 candidate가 모든 tuple에서 같으면 semantic duplicate다. 하나만 남긴다.

## 14.5 Rest

```text
hardLegalPitchCandidates.length > 0
→ best ranked pitch를 반드시 선택

hardLegalPitchCandidates.length = 0
AND local fallback allowed
→ REST

hardLegalPitchCandidates.length = 0
AND sounding note required by current-stage lock
→ blocking
```

Rest에 aesthetic cost를 주어 legal pitch보다 먼저 선택하게 하지 않는다.

# 15. Anchor와 Solver ownership

## 15.1 Anchor Planner

Anchor Planner가 B1.5 local selector의 semantic tone choice를 소유한다. `Activity = independent-note`인 exact decision에서만 directive를 만든다.

1. current AnchorLock을 적용한다.
2. full spelled-pitch candidate를 exact Source chord tones에서 enumerates한다.
3. lock이 없으면 frozen selector winner를 계산한다.
4. winner의 `ChordToneSpec`을 `HarmonyAnchorDirective.kind="chord-tone".selectedTone`에 저장한다.
5. exact winner pitch와 rank tuple은 optional non-semantic `LocalHarmonyDecisionTrace`에 기록할 수 있다.
6. generated NCT plan을 만들지 않는다.

```text
phraseAnchorPlan.nctPlans = []
planned-nct directive count = 0
rest Activity decision → anchor directive count = 0
```

`anchor-chord-tone` lock은 exact current chord span의 legal `ChordToneSpec`만 선택할 수 있다. Deferred `anchor-planned-nct` 또는 automatic lead-derived behavior를 요구하면 v0 contract로 조용히 치환하지 않고 existing `STAGE_LOCK_SCOPE_INVALID` 또는 `GRAMMAR_BLOCKED`로 block하고 stable reason detail을 기록한다.

## 15.2 Solver

v0 Phrase Solver는 B3/beam/whole-phrase optimizer가 아니다. v3.1.5의 generic `PhraseSolverLimits` type과 `CORE_PHRASE_SOLVER_LIMITS` constant는 schema/history compatibility를 위해 남을 수 있지만, 네 값은 이 WAG 자동 경로의 active config authority가 아니며 어느 WAG-owned digest에도 별도 hidden payload로 들어가지 않는다. Candidate space는 exact Source chord tones × performer hardRange octave를 전부 열거하므로 유한하며, cap/truncation/search-budget sibling을 만들지 않는다. `GEN_ANCHOR_LIMIT_EXCEEDED`와 `GEN_SEARCH_BUDGET_EXHAUSTED`는 registry compatibility를 위해 남지만 automatic WAG v1 path가 emit하면 안 된다.

```text
performance-order local replay
beamWidth = 1 semantic equivalent
future lookahead = none
```

Lock이 없으면 Solver는 같은 pure selector를 다시 실행한다.

- selected `ChordToneSpec`이 Anchor directive와 exact equal해야 한다.
- exact selected spelled pitch/octave를 materialize한다.
- mismatch는 `WAG_V1_ANCHOR_SOLVER_SELECTION_PARITY_MISMATCH` blocking이다.
- Solver가 더 좋아 보이는 다른 tone으로 Anchor를 바꾸지 않는다.
- Solver가 Activity span을 새로 만들거나 줄이지 않는다.

## 15.3 SolverLock

Exact `PitchLock`은 다음을 모두 만족할 때만 octave/materialization authority가 된다.

- locked pitch class가 Anchor `selectedTone`을 실현한다.
- exact Source chord tone이다.
- strict Upper/Lower placement를 지킨다.
- performer hardRange 안이다.
- continuous hard leap를 지킨다.
- same phrase/track/position scope다.

PitchLock은 Anchor tone을 re-tone하거나 뒤 decision의 path를 조용히 재설계할 수 없다. 불일치하면 기존 `STAGE_LOCK_SCOPE_INVALID`로 block한다. `findPitchAnchorConflicts()` 같은 compatibility helper에 전달하는 `realizedPitchByAnchorLockId`는 valid PitchLock을 적용한 **최종 post-PitchLock pitch**로 채운다. 적용 전 selector pitch를 넣어 valid octave override를 conflict로 오판하지 않는다.

## 15.4 Replay 목적

Anchor에는 semantic tone authority를, Solver에는 actual octave pitch materialization을 남기면서 둘이 서로 다른 selection을 구현하는 것을 방지한다. Trace는 디버깅 artifact이며 candidate content digest에 들어가지 않는다.

# 16. Held syllable과 canonical chord-boundary transition

`SourceLeadAtomization`이 held Lead note를 chord boundary에서 나눈 경우 active harmony는 새 decision을 수행한다.

## 16.1 허용

- previous harmony pitch가 새 chord에도 legal하면 common-tone continuation candidate가 된다.
- legal하지 않으면 새 Source chord tone으로 바꿀 수 있다.
- hard leap, range 및 placement를 그대로 적용한다.
- 새 lyric/syllable을 만들지 않는다.

## 16.2 Event/lyric materialization

첫 syllable onset event:

```text
lyricTokenIds = canonical Lead lyric token IDs
```

같은 syllable 내부 chord-boundary continuation event:

```text
lyricTokenIds = []
meaning = continue previous vowel, no new lyric onset
```

- 같은 pitch이면 exact boundary/provenance를 보존한 tie/continuation으로 표현한다.
- 다른 pitch이면 서로 다른 note event다. 서로 다른 pitch를 tie로 연결하지 않는다.
- playback/render adapter는 lyric empty continuation을 새 음절로 발음하지 않는다.
- discretionary boundary가 없는 same-syllable melisma는 금지한다.

Canonical trigger는 pitch change를 허용할 뿐 강제하지 않는다.

---

# 17. Direct Upper와 Lower generation

## 17.1 Upper

- 실제 Upper role performer hardRange에서 octave를 직접 열거한다.
- 모든 selected pitch는 Lead보다 높다.
- Lower 후보를 만든 뒤 octave transpose하지 않는다.

## 17.2 Lower

- 실제 Lower role performer hardRange에서 octave를 직접 열거한다.
- 모든 selected pitch는 Lead보다 낮다.
- Upper 후보를 만든 뒤 아래로 transpose하지 않는다.
- Lower를 root/fifth filler로 취급하지 않는다.

## 17.3 One-singer assignment

실제 assigned harmony singer 한 명만 있으면 Upper와 Lower role hypothesis 중 best standalone result를 선택한다. 선택된 role이 H1이다.

## 17.4 Two-singer assignment

두 generated track이 선택되면 exact role mapping은 하나의 Upper와 하나의 Lower다. 각 line을 Lead와 독립 생성한 후에만 pair를 만든다.

---

# 18. Standalone-first, pair-second

## 18.1 Marginal generation

선택된 role mapping에 대해 각 track을 다른 generated track을 보지 않고 생성한다.

```text
Lead + Upper → Upper marginal candidate
Lead + Lower → Lower marginal candidate
```

각 marginal은 다음을 독립 통과해야 한다.

- complete/approved partial structure;
- LASI hard validation;
- hard range/leap;
- Source chord respect;
- Activity/Anchor consistency;
- lyric/articulation legality;
- perceptibility;
- no peer-dependent provenance.

## 18.2 Perceptibility gate

자동 선택되는 line은 다음 중 하나를 만족해야 한다.

```text
A. sounding decision atom >= 2
OR
B. one sounding event duration >= 1 primary pulse
```

Exact user lock은 더 짧은 line을 요구할 수 있으나 provenance에 `USER_LOCKED_SHORT_EVENT`를 기록한다. 자동 one-note orphan은 complete H1/H2로 선택하지 않는다.

## 18.3 Pair formation

Marginal 통과 전에는 pair를 만들지 않는다.

Pair hard gate:

1. Upper marginal LASI pass;
2. Lower marginal LASI pass;
3. full trio hard validation pass;
4. same exact Upper/Lower event payload를 사용;
5. overlap 구간에서 `Upper > Lead > Lower`;
6. performer double booking 없음;
7. dropout equivalence pass;
8. peer-dependent NCT/meaning 없음;
9. pair overlap >= 1 primary pulse;
10. three-distinct-pitch decision >= 2.

Pair가 실패해도 marginal을 수정하거나 재생성하지 않는다.

## 18.4 Non-compensation

금지:

```text
bad Upper + good Lower + good full stack → accepted pair
bad Lower + good Upper + good full stack → accepted pair
missing chord member supplied by H2 → weak H2 accepted
```

Full stack의 chord richness는 pair diagnostic/soft value일 뿐 marginal admission ticket이 아니다.

## 18.5 Optional H2

자동 H2는 optional이다.

- pair pass → Standard/Full default candidate가 pair를 우선할 수 있다.
- pair fail → best complete H1 candidate로 정직하게 degrade한다.
- H2 부재는 H1 candidate를 `partial`로 만들지 않는다.
- exact lock이 두 harmony voice를 요구하면 pair failure는 blocking 또는 명시적 partial이다.

---

# 19. Voice-set candidate와 preset default

각 preset은 가능한 경우 다음 sibling을 보존한다.

```text
Lead-only
Lead + selected H1
Lead + alternate complete marginal, if available
Lead + Upper + Lower, if pair-valid
```

한 pair 안의 Upper/Lower event는 각 marginal sibling과 byte-identical semantic projection이어야 한다.

## 19.1 Default selection order

### Simple

```text
1. best complete one-harmony candidate
2. Lead-only, only when no harmony was expected
```

Simple은 자동 pair를 만들지 않는다.

### Standard

```text
1. complete pair
2. best complete one-harmony candidate
3. Lead-only, only when no harmony was expected
```

### Full

```text
1. complete pair
2. best complete one-harmony candidate
3. Lead-only, only when no harmony was expected
```

Standard와 Full이 같은 music을 생성할 수 있다. Preset 차이를 만들기 위해 불필요한 note를 삽입하지 않는다. Range/leap/color/role-change config 차이가 실제 후보 차이를 만들 때만 결과가 달라진다.

## 19.2 H1 선택 key

여러 complete marginal이 있으면 다음 lexicographic key를 사용한다.

```text
1. candidateStatus class: complete before partial
2. LASI pass
3. localRestDurationBp
4. hardOnlyRangeDurationBp
5. preferredMissDurationBp
6. preferredLeapExcessSemitoneSum
7. totalMotionSemitones
8. leadProximityDurationBp
9. canonical track ordinal
10. placementRole ordinal: upper, lower
11. candidate content digest
```

H1 label은 이 결과에서 파생한다.

---

# 20. Section/Song assembly

## 20.1 No re-solve

Assembler는 phrase candidate의 pitch, Activity, Anchor 또는 role을 수정하지 않는다.

- performance order로 candidate를 연결한다.
- phrase boundary는 기본 reentry다.
- exact continuous lock만 boundary hard leap를 만든다.
- role-change count와 max cap을 검증한다.
- NCT unresolved state는 항상 empty다.
- repeated source phrase에 새 변주를 발명하지 않는다.

## 20.2 Boundary state

기존 `PhraseBoundaryState`를 사용한다.

- first/last pitch by track;
- ending activity;
- placement role;
- unresolved NCT IDs = `[]`;
- recent texture ID는 compatibility trace이며 음악 선택 authority가 아니다.

추가 hidden cache를 금지한다.

## 20.3 Candidate diversity

v0 candidate diversity는 whole-phrase pitch K-best가 아니라 voice-set sibling으로 충족한다.

```text
Lead-only / Upper-only / Lower-only / pair
```

같은 semantic voice-set의 근소한 pitch 변형 top-K를 강제로 만들지 않는다. B3/K-best bank diversity는 deferred다.

## 20.4 Deterministic order

```text
preset ordinal
→ candidateStatus ordinal
→ default-selection preference ordinal
→ voice-set cardinality
→ track canonical ordinal tuple
→ placement role tuple
→ contentDigest
```

## 20.4.1 `canonicalPathKey` exact format

`ArrangementCandidate.canonicalPathKey`는 non-empty ASCII string이며 candidate content digest나 v0 candidate ordering authority가 아니다.

Lead-only exact key:

```text
wag1-local-v1|tx=0
```

Generated-harmony candidate exact format:

```text
wag1-local-v1|tx=<textureOrdinal>|d=<decisionOrdinal>,tr=<trackOrdinal>,a=<activityTransitionOrdinal>,dir=<directiveOrdinal>,m=<midi>,s=<stepOrdinal>,x=<alter>,o=<octave>|...
```

- `textureOrdinal`은 zero-based canonical texture order다: `UNISON=0`, `UNISON_TO_SPLIT=1`, `TWO_PART_PARALLEL=2`, `ACCENT_BLOCK=3`, `SUSTAINED_PAD=4`, `SUSPENSION_RELEASE=5`. v0 automatic generated harmony는 `tx=2`다.
- segment는 canonical local decision order의 zero-based `decisionOrdinal`로 정렬한다.
- `trackOrdinal`은 `GeneratedHarmonyTrackPlan.canonicalOrdinal`인 `1 | 2`다.
- `directiveOrdinal`은 `ArrangementAnchorPlan`의 canonical decision/track order에서 해당 directive의 zero-based ordinal이다.
- `stepOrdinal`: `C=0, D=1, E=2, F=3, G=4, A=5, B=6`.
- `activityTransitionOrdinal`: `rest=0, attack=1, continuous=2, reentry=3, release=4`.
- rest/release처럼 pitch/directive가 없는 segment는 `dir=-1,m=-1,s=-1,x=0,o=-1`을 사용한다.
- decimal safe integer와 literal ASCII field label만 사용한다. whitespace, locale formatting, raw entity ID, display label은 금지한다.
- key/value separator는 `=`, field separator는 `,`, segment separator는 `|`다.

---

# 21. Generated event provenance

Independent generated note:

```text
source = "anchor"
originDirectiveId = selected chord-tone Anchor directive ID
```

`source="planned-nct"`는 v0 자동 output에 나타나면 안 된다.

각 event는 다음으로 추적 가능해야 한다.

```text
candidate content digest
→ generated event deterministic ID
→ trackPlanId
→ exact range
→ originDirectiveId
→ chordSpanId / selectedTone
→ sourceLeadAtomizationDigest + leadAtomId via decision trace/join
```

## 21.1 LocalHarmonyDecisionTrace

Optional non-semantic trace:

```ts
interface LocalHarmonyDecisionTrace {
  readonly id: string;
  readonly trackPlanId: string;
  readonly placementRole: "upper" | "lower";
  readonly leadAtomId: string;
  readonly chordSpanId: string;
  readonly trigger:
    | "LEAD_ATTACK"
    | "CANONICAL_CHORD_BOUNDARY"
    | "CANONICAL_PHRASE_BOUNDARY"
    | "CANONICAL_SECTION_BOUNDARY"
    | "STAGE_LOCK_BOUNDARY";
  readonly leadIsSourceChordTone: boolean;
  readonly candidateFamily: V0HarmonyCandidateFamily;
  readonly selectedTone: ChordToneSpec | null;
  readonly selectedPitch: SpelledPitch | null;
  readonly rankTuple: readonly number[];
  readonly rejectionReasonCodes: readonly string[];
}
```

Trace text, candidate siblings 및 rejection listing은 musical content digest에 들어가지 않는다.

## 21.2 Event split/merge

- canonical chord/phrase/occurrence boundary를 넘는 event를 만들지 않는다.
- same-pitch adjacent event는 renderer adapter에서 시각적으로 묶을 수 있으나 canonical timing/provenance를 잃지 않는다.
- different-pitch event를 tie로 위장하지 않는다.

---

# 22. IDs, digests, config authority

## 22.1 Frozen artifacts

WAG config:

```text
path = src/grammar/worship-arrangement-grammar-v1.0.1.canonical.json
semantic digest = 5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482
pretty-file sha256 = 676780f8ceacda6d88c5724156f84f95fb5b337b4d13d16342f5342cb617330d
```

Preset profile registry:

```text
version = preset-profile-v2-b15-v0
semantic digest = ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681
projection order = [simple, standard, full]
```

Diagnostic registry artifacts:

```text
baseline path = src/grammar/wag-v1-diagnostic-baseline.canonical.json
baseline semantic digest = 96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70
baseline pretty-file sha256 = 0fa15cf0652e41b1509df0f8d140bfa165726a6799a83b19eed59b58dbbbab4c
extension path = src/grammar/wag-v1-diagnostic-extension.canonical.json
extension semantic digest = aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794
extension pretty-file sha256 = 4be25a0ae3cc28812b85da585e1ef6f0aa2f0ce5fc560e34177aa49eee06379b
full registryVersion = diagnostic-registry-v3-wag1-v0
full definition count = 99
full diagnosticRegistryDigest = 0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77
```

Application startup에서 project `semanticDigest()`와 동일한 canonical codec으로 semantic projection을 재계산한다. Pretty JSON file hash, WAG config semantic digest, baseline/extension digest와 full diagnostic registry digest를 혼용하지 않는다.

## 22.2 Included semantic inputs

최소 다음이 applicable stage digest에 포함된다.

- grammar ID와 `grammar-v1.0.1` registry version;
- exact WAG config digest;
- preset profile version/digest;
- full diagnostic registry version/digest;
- effective config digest;
- SourceLeadAtomization digest;
- EffectiveChordTimeline digest;
- performer canonical ranges;
- track/assignment canonical ordinals;
- selected trackRoles;
- Activity spans/attacks;
- Anchor selected tones;
- stage locks;
- solver/assembler/validator/metrics versions/config digests.

## 22.3 Excluded

- display name;
- UI label;
- diagnostic `messageKo`;
- trace display order;
- listening preference text;
- wall-clock time;
- thread completion order;
- object insertion order;
- random UUID;
- metrics/diagnostics from candidate musical content digest when authoritative spec excludes them.

## 22.4 Shared WAG config binding

다음 WAG-owned fields는 모두 `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482`다.

```text
plannerConfigDigest
grammarConfigDigest
activityPlannerConfigDigest
anchorPlannerConfigDigest
solverConfigDigest
assemblerConfigDigest
validatorConfigDigest
metricConfigDigest
```

이는 하나의 exact frozen payload를 여러 stage가 읽는다는 뜻이며 stage lifecycle ownership을 합치지 않는다.

## 22.5 Separate digest authorities

- `diagnosticRegistryDigest`: `diagnostic-registry-v3-wag1-v0` full entries의 exact hash.
- `accompanimentConfigDigest`: accepted accompaniment config의 exact hash.
- `presetProfileDigest`: `[simple, standard, full]` profile projection의 exact hash.

위 값을 WAG config digest로 대체하지 않는다.

## 22.6 Mismatch

Wrong registry version, config/profile/diagnostic digest 또는 frozen file hash는 구현 시작/재생성 전에 block한다. Runtime은 existing registry mismatch code를 사용한다.

# 23. Failure semantics

## 23.1 Phrase harmony expectation

각 phrase에서 다음 exact 순서로 expectation을 계산한다.

```text
effective maxHarmonyTracks = 0
OR no enabled assigned generated track
OR eligible sounding decision count = 0
→ harmonyExpectation = none

eligible sounding decisions are entirely below the perceptibility floor
AND no existing stage lock requires harmony
→ harmonyExpectation = none

otherwise
→ harmonyExpectation = H1-required
```

Perceptibility floor는 자동 line에 대해 `>= 2 sounding decisions` 또는 `>= 1 primary pulse single sustain`이다. Exact valid user lock은 shorter line을 요구할 수 있다.

H2는 optional이다. 단, existing stage locks가 두 generated track의 sounding behavior를 collectively 요구하면 pair/H2가 required다. 새 `PairLock` schema를 발명하지 않는다.

## 23.2 Complete

`complete` 조건:

- 적어도 하나의 hard-valid complete candidate가 존재한다.
- `blocksComplete=true` diagnostic이 없다.
- H1-required phrase에는 independently valid/perceptible H1이 존재한다.
- local rest fallback은 허용 정책 안에서만 존재한다.
- selected pair는 모든 LASI projection을 통과한다.
- optional H2 absence는 complete를 훼손하지 않는다.
- N.C. 또는 expectation none에서 Lead-only가 되는 것은 partial이 아니다.

## 23.3 Partial

`partial`은 구조적으로 필요한 H1 coverage 일부가 빠졌지만 안전하고 명확히 표시 가능한 독립 구간 candidate가 존재할 때만 사용한다.

- returned event는 모두 hard-valid다.
- missing exact ranges와 reason을 제공한다.
- `WAG_V1_PARTIAL_REQUIRED_COVERAGE`가 `blocksComplete=true`, `blocksGeneration=false`로 존재한다.
- optional H2 부재, 낮은 beauty proxy, warning, candidate diversity 부족은 partial 사유가 아니다.
- partial candidate를 complete처럼 default 표시하지 않는다.

## 23.4 Blocked

`blocked` 조건:

- candidate array가 비어 있다.
- 최소 하나의 `blocksGeneration=true` diagnostic이 있다.

예:

- source/chord/atomization stale;
- registry/config/profile mismatch;
- invalid assignment/range;
- required H1이 어느 구간에서도 hard-valid하지 않음;
- existing locks가 요구한 exact note 또는 two-track behavior가 impossible;
- no legal local candidate and current-stage lock forbids rest;
- Anchor/Solver parity mismatch;
- dropout projection mismatch.

H1-required인데 harmony를 만들 수 없을 때 fake Lead-only candidate를 넣어 `complete`를 만들지 않는다.

# 24. Independent validator와 LASI matrix

Validator는 생성기와 독립적으로 같은 canonical source/timeline을 읽는다.

## 24.1 Projection 생성

Pair candidate에서 regeneration 없이 exact projection을 만든다.

```text
P0  = Lead
PU  = Lead + exact Upper events
PL  = Lead + exact Lower events
PUL = Lead + exact Upper + exact Lower events
```

한 track을 mute한 projection에서 surviving track의 다음 값이 pair와 exact equal이어야 한다.

- event ranges;
- pitches;
- ties;
- lyric associations;
- origin directive IDs;
- anchor decisions;
- content projection;
- boundary state.

Generated event ID, candidate ID 및 candidate content digest는 각 sibling의 own content digest에서 파생되므로 sibling 간 동일할 필요가 없고 dropout equivalence 비교 대상이 아니다. 비교는 위 semantic payload projection에 대해 수행한다. Marginal sibling의 `realizedAnchors`에는 surviving track directive만 존재하고, pair의 `realizedAnchors`는 두 marginal anchor set의 immutable union이어야 한다. Peer-track anchor를 marginal에 섞지 않는다.

## 24.2 Marginal hard checks

각 `Lead + voice`:

- source/chord/atomization digest parity;
- event overlap/tie;
- hardRange;
- strict placement;
- continuous hard leap;
- exact Source chord tone respect;
- no3/sus/omission/alteration respect;
- Activity state;
- Anchor selected tone;
- lyric onset/continuation;
- no generated NCT;
- lock;
- perceptibility;
- structural required coverage;
- no peer-dependent provenance.

## 24.3 Full hard checks

- 두 marginal pass;
- Upper > Lead > Lower;
- no performer double booking;
- full timing/tie consistency;
- pair overlap/perceptibility;
- dropout equivalence;
- no full-stack-only repair.

## 24.4 Soft diagnostics

- comfortable/preferred misses;
- preferred leap excess;
- Lead proximity;
- repeated directed 3rd/6th runs;
- same-direction co-motion;
- phrase-final protrusion proxy;
- pair crowding/register spread;
- unnecessary root/fifth duplication;
- source color tone unused;
- local rest fallback;
- target underfill.

Known local quality limitation metric은 측정할 수 있지만 v0 selector에 새 terminal rerank로 넣지 않는다.

---

# 25. Metrics

## 25.1 Required marginal metrics

- independent sounding duration;
- participation coverage;
- local rest fallback duration/count;
- 3rd/6th relation duration;
- legal continuation count/duration;
- low-motion count/duration;
- contextual chord-tone count/duration;
- hard/comfortable/preferred range duration;
- max leap;
- preferred leap excess;
- Lead proximity duration;
- longest repeated directed relation run;
- source chord respect;
- perceptibility result;
- first/last pitch and role.

## 25.2 Pair metrics

- three-distinct-pitch duration;
- exactly-two/exactly-three pitch coverage;
- Upper–Lower spread distribution;
- pair overlap duration;
- dropout parity;
- worse marginal metric alongside pair total;
- full trio incremental distinct-pitch duration over each marginal.

## 25.3 Existing FullSongMetrics

- `sourceChordRespect`는 selected independent notes에 대해 100%여야 한다. Independent note가 0개이면 `numerator=0`, `denominator=0`, `valueBp=null`, `unavailableReason=NO_EVALUABLE_ITEMS`가 valid하며 100% assertion을 적용하지 않는다.
- generated NCT가 없으므로 `plannedNctResolution`은 denominator 0과 nullable value를 정직하게 표현한다.
- density는 actual simultaneous distinct pitch로 계산한다.
- unison/Lead-derived가 없는 independent output을 harmonic divergence로 정확히 계산한다.

Metrics는 candidate content digest의 음악 authority가 아니다.

---

# 26. Diagnostic registry와 candidate reason codes

## 26.1 기존 DiagnosticCode 재사용

다음은 새 code를 만들지 않는다.

| Condition | Existing DiagnosticCode |
|---|---|
| version/config mismatch | `ALGORITHM_CONFIG_MISMATCH` |
| preset profile mismatch | `PRESET_PROFILE_VERSION_MISMATCH` |
| impossible/deferred exact lock | `STAGE_LOCK_SCOPE_INVALID` 또는 `ANCHOR_LOCK_INVALID` |
| no feasible role mapping / role conflict | `TRACK_ROLE_CONFLICT` 또는 `NO_ELIGIBLE_TEXTURE` |
| local sounding decision에 pitch가 없음 | `GEN_NO_PITCH_CANDIDATE` |
| invalid generated range/crossing/chord role | 기존 `GENERATED_*` code |
| generic grammar contract failure | `GRAMMAR_BLOCKED` |

기존 source/range/lock/timeline code를 WAG prefix로 중복 생성하지 않는다.

## 26.2 최소 diagnostic extension

Registry version: `diagnostic-registry-v3-wag1-v0`  
Extension semantic digest: `aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794`

| Code | defaultSeverity | blocksGeneration | blocksComplete | scope |
|---|---|---:|---:|---|
| `WAG_V1_ACTIVITY_ANCHOR_FEASIBILITY_PARITY_MISMATCH` | `blocking` | true | true | `anchor` |
| `WAG_V1_ANCHOR_SOLVER_SELECTION_PARITY_MISMATCH` | `blocking` | true | true | `solver` |
| `WAG_V1_DROPOUT_PROJECTION_MISMATCH` | `blocking` | true | true | `validation` |
| `WAG_V1_PARTIAL_REQUIRED_COVERAGE` | `error` | false | true | `validation` |
| `WAG_V1_ROLE_PREVIEW_PARITY_MISMATCH` | `blocking` | true | true | `planner` |

- 세 parity/mismatch code는 구현 corruption이며 sibling candidate로 숨기지 않는다.
- `WAG_V1_DROPOUT_PROJECTION_MISMATCH`는 pair가 immutable marginal payload를 바꾼 경우다.
- `WAG_V1_PARTIAL_REQUIRED_COVERAGE`만 `blocksGeneration=false`, `blocksComplete=true`다. 따라서 hard-valid partial candidate를 반환할 수 있지만 complete로 승격할 수 없다.

Registry의 boolean은 runtime context에 따라 바꾸지 않는다. Full registry digest는 이 extension만 해시한 값이 아니라 preserved existing definitions와 exact merge한 뒤 계산한다.

## 26.3 Candidate reason codes

아래 값은 `DiagnosticCode`가 아니라 candidate/trace rejection reason이다.

```text
LOCAL_REST_HARD_IMPOSSIBILITY
OPTIONAL_MARGINAL_NOT_PERCEPTIBLE
OPTIONAL_MARGINAL_LASI_REJECTED
OPTIONAL_PAIR_LASI_REJECTED
OPTIONAL_PAIR_DEGRADED_TO_SINGLE
SOURCE_CHORD_TONE_SPELLING_UNREPRESENTABLE
```

Optional candidate를 retained set에서 제외하는 것과 전체 generation blocking을 구분한다. reason code는 canonical stable string이지만 free-form UI message는 semantic authority가 아니다.

# 27. Required test fixtures

PR #7 research fixture는 production semantics로 직접 import하지 않고 canonical product fixture로 재작성한다. 최소 다음 case를 보존한다.

| Fixture ID | Required assertion |
|---|---|
| `hm-original-major-stepwise-v0` | Source-chord-aware 3rd/6th, full Lead-coupled activity, deterministic output |
| `hm-original-minor-phrase-v0` | direct Lower, minor Source chord respect |
| `hm-original-slash-chord-v0` | slash bass가 vocal tone set을 임의 확장하지 않음 |
| `hm-original-sus-omission-v0` | sus/omission authority, generic third 복원 금지 |
| `hm-original-add9-v0` | explicit extension candidate 보존 |
| `hm-original-lead-nct-passing-v0` | legal continuation/low motion이 generic relation보다 우선 가능 |
| `hm-original-held-common-tone-v0` | held syllable common-tone hold |
| `hm-original-held-no-common-upper-v0` | chord boundary에서 Upper pitch transition, 새 lyric 없음 |
| `hm-original-held-no-common-lower-v0` | chord boundary에서 Lower pitch transition, 새 lyric 없음 |
| `hm-original-upper-range-v0` | actual Upper hard/comfortable/preferred range |
| `hm-original-lower-range-v0` | actual Lower direct generation |
| `hm-original-hard-range-edge-v0` | hard prune, fallback/rest/failure honesty |
| `hm-original-lead-only-negative-v0` | Lead-only가 fake harmony로 계산되지 않음 |

추가 production fixture:

- one assigned singer whose Lower mapping beats Upper;
- two singers with both possible role bijections;
- no3, altered extension, N.C., carried chord gap;
- exact ActivityLock rest와 Activity feasibility preview;
- Activity note → Anchor same-input feasibility parity;
- exact note lock impossible 또는 Anchor tone과 불일치한 SolverLock;
- pair optional failure;
- pair required failure;
- local rest followed by reentry;
- phrase boundary reset;
- display-name rename digest invariance;
- input array permutation determinism;
- candidate dropout equivalence;
- same semantic input 101-run digest parity;
- browser band-supported playback and mute/solo parity;
- `hm-original-accidental-root-spelling-v0`: E-flat minor 또는 다른 non-C accidental-bearing root에서 exact root-relative chord tone을 실현한다;
- `hm-original-unrepresentable-spelling-v0`: otherwise parseable tone이 `Alter -2..2` 밖을 요구하면 `SOURCE_CHORD_TONE_SPELLING_UNREPRESENTABLE`로 제외하고 ordinary rest/block semantics를 적용한다;
- `hm-original-activity-hard-leap-dead-end-v0`: sequential Activity preview가 이전 pitch를 이어받아 false parity mismatch 대신 honest rest를 선택한다;
- `hm-original-lock-induced-no-candidate-v0`: valid downstream AnchorLock/PitchLock divergence가 hard-legal set을 비우면 owning stage가 `STAGE_LOCK_SCOPE_INVALID` + `LOCK_INDUCED_NO_LEGAL_CANDIDATE`로 block한다;
- `hm-diagnostic-registry-merge-v0`: exact 94 baseline + exact 5 extension, 99 unique codes, exact pinned full registry digest 및 `blocksGeneration=false`-only blocked result 금지를 검증한다.

---

# 28. Acceptance invariants

## 28.1 Property invariants

모든 generated independent note에 대해:

```text
current chord status = ok
pitch class ∈ exact ParsedChord.tones
pitch ∈ performer hardRange
Upper → pitch > Lead
Lower → pitch < Lead
continuous leap <= hardMaxLeap
originDirectiveId exists
new lyric token invented = false
planned NCT = false
```

Pair에 대해:

```text
Upper marginal pass
Lower marginal pass
full pass
muted projection == stored marginal
full cannot alter marginal payload
```

## 28.2 Determinism

동일 canonical input과 version/config에서 최소 101회 반복해 다음이 하나여야 한다.

- Intent digest;
- Activity digest;
- Anchor digest;
- candidate content digest;
- candidate order;
- selected default candidate;
- generated event IDs;
- render semantic document.

다음 변화는 음악 digest를 바꾸지 않는다.

- display name;
- UI label;
- diagnostic text;
- input array의 비권위 순서.

다음 semantic 변화는 applicable earliest stage와 downstream digest를 바꾼다.

- confirmed Source chord tone semantics;
- source Lead pitch/rhythm/lyric production emphasis;
- performer range;
- assignment;
- selected role;
- preset profile/config/version;
- lock;
- grammar rank tuple/config.

## 28.3 Playback/export

- Lead/Upper/Lower mute와 solo가 exact candidate projection을 사용한다.
- mute 후 surviving line을 regeneration하지 않는다.
- accompaniment는 동일 EffectiveChordTimeline을 사용한다.
- N.C. accompaniment/harmony는 silence다.
- held-syllable chord-boundary pitch change가 새 lyric으로 발음되지 않는다.
- actual event cursor와 tie/continuation이 exact range에 맞는다.
- browser, render, playback, export가 서로 다른 pitch decision을 만들지 않는다.

---

# 29. Implementation Definition of Done

Sol Ultra 또는 다른 implementation agent가 완료를 선언하려면 전부 만족해야 한다.

1. 시작 시 repository, branch, exact accepted head 및 dirty state를 검증한다.
2. authoritative spec과 이 exact contract/config/diagnostic-baseline/diagnostic-extension/freeze manifest를 읽는다.
3. contract SHA-256, WAG config file SHA-256, config semantic digest `5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482`, preset digest `ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681`, diagnostic baseline digest `96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70`, diagnostic extension digest `aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794`, full registry digest `0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77`를 재계산한다.
4. accepted Step 0–3를 회귀 없이 보존한다.
5. rc.7/PR #7 research code를 production authority로 import하지 않는다.
6. exact AlgorithmVersionRegistry와 WAG-owned config digest bindings를 갱신한다.
7. frozen 94-code diagnostic baseline과 5-code extension을 exact merge하고 full `diagnosticRegistryDigest`가 pinned value와 일치함을 검증한다.
8. Intent role preview, Activity-owned feasibility/rest materialization, Anchor selector, Solver replay/lock policy, standalone candidate, pair screen, assembler, validator, metrics를 구현한다.
9. deferred feature flag가 모두 false이고 generated NCT plan count가 0임을 테스트한다.
10. TypeScript strict, lint, unit/integration/property test, build가 통과한다.
11. deterministic 101-run regression이 통과한다.
12. 모든 required fixture와 display-name/input-order digest invariance가 통과한다.
13. browser에서 Lead/Upper/Lower/full playback, mute/solo, held-syllable transition 및 band accompaniment를 검증한다.
14. complete/partial/blocked와 diagnostic registry booleans가 contract truth table과 일치한다.
15. dead code, unresolved TODO, placeholder, review-only route의 production dependency를 정리한다.
16. clean checkout에서 end-to-end 생성→검증→render→playback/export를 다시 실행한다.
17. 최종 evidence report에 command, commit, artifact digest, verified full diagnostic registry digest, pass/fail 및 진짜 external blocker를 기록한다.

완료 금지 표현:

```text
architecture implemented, therefore complete
most tests pass
human listening remains, therefore blocked
Step 4 ready, therefore stop
prototype works, therefore production complete
```

현재 handoff에서 B1.5 v0 방향에 필요한 listening decision은 이미 끝났다. 구현자는 자동화 가능한 제품 작업을 끝까지 수행한다.

# 29.1 Independent audit closure (v1.0.1)

이 revision은 independent pre-implementation audit의 blocking findings를 다음처럼 봉합한다.

- diagnostic baseline 94 definitions + extension 5 definitions + exact full registry digest;
- root-relative `ChordToneSpec → SpelledPitchClass` formula와 unrepresentable spelling failure;
- Activity sequential non-persistent previous-pitch state;
- downstream Anchor/Solver lock divergence zero-candidate ownership;
- generic `CORE_PHRASE_SOLVER_LIMITS`의 WAG v1 비활성화와 exhaustive local enumeration;
- Simple Lead-only guard, complete `SectionIntensityTarget`, dropout ID exclusion, trigger taxonomy, post-PitchLock conflict input, canonicalPathKey, zero-denominator metric 및 README pinning clarification.

이 correction은 B1.5 musical strategy, candidate rank tuple, deferred scope 또는 standalone-first/pair-second semantics를 변경하지 않는다.

# 30. Change control

이 문서 동결 후 다음은 semantic version/config 변경 없이 수정할 수 없다.

- candidate family 순서;
- rank tuple field/order;
- hard filter;
- profile values;
- activity participation policy;
- rest fallback;
- held-syllable transition;
- role mapping key;
- pair gate;
- LASI projection;
- failure semantics;
- default preset candidate preference.

변경 절차:

```text
concrete product failure
→ reproducible fixture
→ proposed minimal amendment
→ version/config digest bump
→ regression and playback evidence
→ explicit acceptance
```

단순 미적 추측으로 이 계약을 재개방하지 않는다.

---

# 31. Deferred backlog after v0

완성된 제품 사용에서 구체적인 실패가 관찰될 때만 다음 순서로 검토한다.

1. phrase-final/local stability;
2. controlled Source-compatible generated NCT;
3. B3-N whole-phrase planning;
4. B3-E expressive rerank;
5. stable color;
6. advanced gesture branches;
7. constrained H2 joint refinement;
8. learned offline assistance. Production runtime note authority는 계속 deterministic해야 한다.

Deferred item은 v0 completion blocker가 아니다.

---

# Appendix A — Pure selector and Activity feasibility pseudocode

```ts
function selectLocalHarmonyDecision(
  context: LocalHarmonyDecisionContext,
  chord: ParsedChord,
  performer: PerformerProfile,
  config: EffectiveArrangementConfig,
): LocalSelectionResult {
  const candidates = enumerateExactSourceChordPitches(chord, performer.hardRange)
    .filter((pitch) => strictPlacement(pitch, context.leadPitch, context.placementRole))
    .filter((pitch) => hardLeapLegal(pitch, context))
    .filter((pitch) => currentStageLocksAllow(pitch, context))
    .map((pitch) => classifyAndRank(pitch, context, chord, performer, config))
    .sort(compareLexicographicRankThenCanonicalPitch);

  if (candidates.length > 0) {
    return { status: "note", selected: candidates[0], trace: candidates };
  }

  if (localRestFallbackAllowed(context)) {
    return { status: "rest", reason: "HARD_IMPOSSIBILITY", trace: [] };
  }

  return { status: "blocked", code: "GEN_NO_PITCH_CANDIDATE" };
}

function materializeActivityDecision(
  contextAfterActivityLocks: LocalHarmonyDecisionContext,
): VoiceActivityDirective {
  const preview = selectLocalHarmonyDecision(
    contextAfterActivityLocks,
    contextAfterActivityLocks.chord,
    contextAfterActivityLocks.performer,
    contextAfterActivityLocks.config,
  );

  if (preview.status === "note") {
    // Do not persist preview.selected pitch or tone in Activity.
    return { state: "independent-note", behavior: "independent-harmony" };
  }
  if (preview.status === "rest") return { state: "rest" };
  throw blocked(preview.code);
}
```

# Appendix B — Marginal/pair pseudocode

```ts
upper = generateStandalone(trackUpper, role="upper", lead, chords, activity, anchors)
lower = generateStandalone(trackLower, role="lower", lead, chords, activity, anchors)

upperValid = validateMarginal(lead, upper)
lowerValid = validateMarginal(lead, lower)

if (upperValid) retain(LeadPlusUpper)
if (lowerValid) retain(LeadPlusLower)

if (upperValid && lowerValid) {
  pair = composeWithoutMutation(upper, lower)
  if (validatePairAndDropout(pair)) retain(pair)
}

selectPresetDefaultFromRetainedVoiceSets()
```

# Appendix C — Worked decisions

## C.1 C major, Lead C4, Upper

Source tones: C, E, G. Legal Upper candidates inside range include E4, G4, C5, …

- E4 = generic 3rd, Source chord tone;
- A-like key diatonic candidate is absent because it is not a C chord tone;
- all else equal E4 wins before contextual G4/C5.

## C.2 C major, Lead D4 Source-NCT, previous harmony E4

E4 is still a C chord tone and same as previous harmony pitch.

```text
E4 → LEGAL_CONTINUATION
G4/C5/... → later families
```

따라서 E4 may win even when another candidate forms a 3rd/6th with Lead.

## C.3 Held Lead C4, chord C → Dm, Upper

첫 span에서 E4가 선택될 수 있다. Dm boundary에서 E4는 더 이상 Source chord tone이 아니다. 같은 syllable/vowel을 유지하면서 Dm의 legal Upper chord tone으로 새 local decision을 한다. 새 lyric onset은 만들지 않는다.

## C.4 Csus4/no3

ParsedChord tone set에 third가 없으면 candidate enumerator에도 third가 없다. Lead와 generic 3rd 관계라는 이유로 omitted tone을 복원하지 않는다.

## C.5 Lower-only performer

Lower hardRange에서 직접 후보를 열거하고 `candidateMidi < leadMidi`를 적용한다. Lower가 H1이며 Upper proxy를 만들지 않는다.

---

# Appendix D — Frozen decision ledger

```text
SOURCE_FIRST = REQUIRED
DETERMINISTIC = REQUIRED
GENERATIVE_AI_NOTE_AUTHORITY = PROHIBITED
EXACT_FRACTION = REQUIRED
REAL_PERFORMER_RANGE = REQUIRED
LEAD_COUPLED_ARTICULATION = REQUIRED
CANONICAL_HELD_SYLLABLE_TRANSITION = REQUIRED
B1_5_LOCAL_SELECTOR = REQUIRED
SOURCE_CHORD_TONE_ONLY_GENERATED_NOTES = REQUIRED
DIRECT_UPPER = REQUIRED
DIRECT_LOWER = REQUIRED
H1_FIXED_TO_UPPER = FALSE
H2_DEPENDENT_FILLER = FALSE
LASI = REQUIRED
LASC = PRODUCT_REQUIREMENT
STANDALONE_FIRST_PAIR_SECOND = REQUIRED
PAIR_REPAIRS_MARGINAL = PROHIBITED
GENERATED_NCT = DEFERRED
B3 = DEFERRED
PHRASE_FINAL_REFINEMENT = DEFERRED
ADDITIONAL_LISTENING_BEFORE_IMPLEMENTATION = NOT_REQUIRED
ACTIVITY_OWNS_REST_VS_NOTE = REQUIRED
ANCHOR_OWNS_SELECTED_CHORD_TONE = REQUIRED
SOLVER_OWNS_EXACT_PITCH_MATERIALIZATION = REQUIRED
CONFIG_SEMANTIC_DIGEST = 5a71f18d5687c4884f8dad209c162f39b8152c1e3030fc4af4b429c7c41f4482
PRESET_PROFILE_DIGEST = ae0fce2af71b10e7f387521b22fe737cb840f02881b95121761b2953154cd681
DIAGNOSTIC_BASELINE_DIGEST = 96e396a1fdb97a9cc9eba2b21a20c709cd5a96285126bfba1a406cba2f42ef70
DIAGNOSTIC_EXTENSION_DIGEST = aee570a5fc6110107979c40708ebb0b48f645e23853a0e75084854c2cd6ce794
FULL_DIAGNOSTIC_REGISTRY_DIGEST = 0bdb9f5067cba55dad165d3679460a04f21e98b450a4624fa21eca1ffa3dcc77
IMPLEMENT_THROUGH_PRODUCT_COMPLETION = REQUIRED
```
