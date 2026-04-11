# Open Mercato Hackathon — podsumowanie analizy skilli i agentic workflows

## Cel analizy
Celem było znalezienie nowych pomysłów na skille lub agentic workflows dla tracku budowy skilli i agentic flow w Open Mercato, z uwzględnieniem:
- oficjalnych skilli Open Mercato,
- zawartości repo `om-superpowers` dostarczonego w ZIP,
- unikania pomysłów, które duplikują już istniejące capability.

---

## 1. Co już istnieje

### Oficjalne skille Open Mercato
W oficjalnym repo OM są obecnie m.in.:
- `backend-ui-design`
- `code-review`
- `create-agents-md`
- `dev-container-maintenance`
- `fix-specs`
- `implement-spec`
- `integration-builder`
- `integration-tests`
- `pre-implement-spec`
- `skill-creator`
- `spec-writing`

To daje mocne pokrycie dla core flow:
- pisanie speców,
- przygotowanie do implementacji,
- implementację,
- review,
- integracje,
- testy integracyjne,
- tworzenie `AGENTS.md`.

### `om-superpowers` z ZIP-a
Po analizie dostarczonego ZIP-a repo zawiera 16 skilli:
- `om-backend-ui-design`
- `om-code-review`
- `om-cto`
- `om-data-model-design`
- `om-eject-and-customize`
- `om-implement-spec`
- `om-integration-builder`
- `om-integration-tests`
- `om-module-scaffold`
- `om-pre-implement-spec`
- `om-product-manager`
- `om-spec-writing`
- `om-system-extension`
- `om-toolkit-review`
- `om-troubleshooter`
- `om-ux`

Dodatkowo skrypt `scripts/sync-om-skills.sh` pokazuje, że część z nich jest synchronizowana z upstream Open Mercato. Dotyczy to:
- `om-code-review`
- `om-implement-spec`
- `om-spec-writing`
- `om-pre-implement-spec`
- `om-integration-tests`
- `om-integration-builder`
- `om-backend-ui-design`

To oznacza, że `om-superpowers` nie jest osobnym konkurencyjnym zestawem skilli, tylko raczej:
1. warstwą nad oficjalnymi skillami OM,
2. dodatkowymi skillami domenowymi i orkiestracyjnymi.

---

## 2. Główne wnioski z analizy

### Co jest już dobrze pokryte
Po połączeniu oficjalnych skilli OM i `om-superpowers`, dobrze pokryte są:
- product/spec discovery,
- architektura i gap analysis,
- UX,
- data model design,
- module scaffolding,
- system extension,
- customization/ejection,
- implementacja speców,
- integration builder,
- integration tests,
- code review,
- troubleshooting,
- przegląd toolkitu.

### Czego nie warto budować
Nie warto budować kolejnego:
- generycznego skilla do planowania,
- skilla do TDD,
- ogólnego code review,
- ogólnego debuggera,
- ogólnego orchestratora „plan -> code -> review”,
- kolejnego skilla do samego spec writing.

To byłoby zbyt blisko obecnego stanu.

### Gdzie są realne luki
Najbardziej obiecujące luki są w obszarach:
- intake i triage zmian,
- impact analysis,
- drift między specem a kodem,
- tenant safety / ACL,
- fixture i test data generation,
- performance validation,
- release readiness.

---

## 3. Najlepsze nowe pomysły na skille

### 1) `om-impact-map`
**Cel:** analiza blast radius zmiany.

**Co robi:**
- bierze issue, spec albo diff,
- mapuje wpływ na moduły, eventy, API, ACL, UI, migracje, testy i docs,
- zwraca listę obszarów, które trzeba uwzględnić.

**Dlaczego to ma sens:**
To wypełnia lukę między „mamy issue” a „wiemy, co naprawdę zmieniamy”. Daje bardzo praktyczny artefakt przed implementacją.

**Ocena:** bardzo mocny kandydat.

### 2) `om-spec-drift-check`
**Cel:** wykrywanie rozjazdu między specem a wdrożoną implementacją.

**Co robi:**
- porównuje spec,
- `AGENTS.md`,
- kod,
- testy,
- wypisuje drift i brakujące elementy.

**Dlaczego to ma sens:**
OM jest mocno spec-driven, ale nie ma osobnego skilla pilnującego spójności po wdrożeniu.

**Ocena:** bardzo dobry, unikalny i „OM-native”.

### 3) `om-fixture-builder`
**Cel:** generowanie realistycznych fixture i seed data dla testów oraz bugfix flow.

**Co robi:**
- bierze opis buga albo use case,
- generuje minimalny zestaw danych,
- przygotowuje scenariusz pod integration tests.

**Dlaczego to ma sens:**
W praktyce bardzo często najtrudniejsze nie jest napisanie testu, tylko przygotowanie poprawnego scenariusza danych.

**Ocena:** bardzo dobry kandydat do codziennej pracy i demo.

### 4) `om-tenant-safety-check`
**Cel:** automatyczny przegląd zmian pod kątem tenant isolation.

**Co robi:**
- szuka ryzyk cross-tenant,
- sprawdza `organization_id`, filtry, scoping, query patterns,
- sygnalizuje możliwe wycieki lub błędy izolacji danych.

**Dlaczego to ma sens:**
To silnie domenowy skill, trudny do zastąpienia generycznym review.

### 5) `om-acl-designer`
**Cel:** projektowanie i walidacja modelu uprawnień.

**Co robi:**
- pomaga zaprojektować role i permissions,
- wykrywa luki w guardach,
- produkuje matrix uprawnień i edge cases.

**Dlaczego to ma sens:**
To częsty problem przy nowych modułach i rozszerzeniach, a nie ma dedykowanego skilla tylko do ACL.

---

## 4. Najciekawsze agentic workflows

### A) Issue -> Impact -> Mini-spec -> Decision -> Implement
Proponowany flow:
1. `om-impact-map`
2. `om-issue-to-mini-spec`
3. decyzja: `om-system-extension` vs `om-module-scaffold` vs `om-eject-and-customize`
4. `om-implement-spec`
5. `om-integration-tests`
6. `om-code-review`

**Dlaczego to jest dobre:**
To nie dubluje obecnych flow, tylko dokłada brakujące etapy intake i impact analysis.

### B) Bug report -> Repro data -> Failing test -> Fix -> Safety audit
Proponowany flow:
1. `om-troubleshooter`
2. `om-fixture-builder`
3. `om-integration-tests`
4. implementacja fixu
5. `om-tenant-safety-check`
6. `om-code-review`

**Dlaczego to jest dobre:**
Bardzo praktyczne, łatwe do pokazania na demo, bliskie codziennej pracy.

### C) Spec governance flow
Proponowany flow:
1. `om-spec-drift-check`
2. `create-agents-md`
3. `fix-specs`
4. opcjonalnie review i follow-up tasks

**Dlaczego to jest dobre:**
Buduje brakującą warstwę governance wokół spec-driven development.

---

## 5. Pomysł: skill do testów performance

## Werdykt
Tak — to jest sensowny pomysł, ale tylko wtedy, gdy będzie **mocno zawężony do OM**.

W analizowanym ZIP-ie nie ma osobnego skilla do tworzenia i uruchamiania testów wydajnościowych. Performance pojawia się tylko pośrednio:
- w checklistach i review,
- w architektonicznych hintach,
- przy tematach takich jak indeksy, cache, pagination, batching czy N+1,
- ale nie jako osobny, egzekwowalny workflow.

To oznacza, że **jest tu realna luka**.

---

## 6. Rekomendowany skill: `om-performance-test-builder`

### Pozycjonowanie
To nie powinien być ogólny „assistant do performance engineering”, tylko skill, który:
- bierze feature, endpoint lub use case,
- identyfikuje krytyczne ścieżki wydajnościowe,
- generuje scenariusz testowy,
- tworzy runnable testy, najlepiej w `k6`,
- pomaga zinterpretować wyniki.

### Dlaczego to ma sens w OM
Taki skill dobrze pasuje do obszarów, które już są ważne w OM:
- pagination,
- query efficiency,
- batch processing,
- cache behavior,
- indeksy,
- queue / worker throughput,
- tenant scoping,
- unikanie N+1.

Czyli nie byłby to sztuczny skill „od benchmarków”, tylko praktyczny skill do weryfikacji realnych ryzyk platformowych.

---

## 7. Spec MVP dla `om-performance-test-builder`

### Problem
Dziś performance bywa oceniany na etapie specu lub review, ale brakuje lekkiego workflow, który szybko zamienia feature lub endpoint na:
- zestaw scenariuszy obciążeniowych,
- gotowy test,
- interpretację wyniku.

### Główne zadanie skilla
Na podstawie speca, issue albo opisu endpointu skill ma:
1. rozpoznać, czy zmiana jest performance-sensitive,
2. wskazać krytyczne scenariusze testowe,
3. wygenerować test w `k6`,
4. opisać assumptions i sukces criteria,
5. zwrócić checklistę obserwacji i możliwych bottlenecków.

### Wejście
Skill powinien przyjmować np.:
- spec lub issue,
- endpoint / route / use case,
- typ obciążenia: `read-heavy`, `write-heavy`, `bulk`, `queue`,
- oczekiwany wolumen,
- target SLA/SLO,
- ewentualne ograniczenia środowiska.

### Wyjście
Skill powinien generować:
- listę krytycznych scenariuszy performance,
- test `k6`,
- przykładowe payloady lub założenia dot. danych,
- metryki do obserwacji,
- krótką interpretację: gdzie mogą być bottlenecks.

---

## 8. Zakres MVP

### Najlepszy zakres na hackathon
Najlepiej ograniczyć MVP do trzech typów scenariuszy:

#### 1) API performance tests
- list endpoints,
- search endpoints,
- detail endpoints,
- CRUD read/write hot paths.

#### 2) Bulk / command execution tests
- importy,
- batch update,
- masowe operacje domenowe,
- dłuższe workflow commandowe.

#### 3) Queue / worker throughput smoke tests
- jobs,
- retry behavior,
- throughput under load,
- latency pod rosnącym wolumenem.

### Czego nie robić w MVP
Nie zaczynać od:
- frontend rendering performance,
- browser perf,
- pełnego UI load testingu,
- szerokiego distributed benchmarking frameworka.

To zbyt duży scope na hackathon.

---

## 9. Co musi być OM-specific
Żeby ten skill nie był zbyt generyczny, musi wymuszać analizę takich rzeczy jak:
- tenant scope,
- expected cardinality,
- pagination strategy,
- batch size,
- cache behavior,
- index assumptions,
- queue worker thresholds,
- ryzyko N+1,
- data size assumptions.

To właśnie odróżni go od zwykłego generatora testów `k6`.

---

## 10. Proponowany output pattern

### A. Performance test plan
- test target,
- typ obciążenia,
- krytyczne scenariusze,
- assumptions,
- success criteria.

### B. Generated test file
Np. plik `k6` dla konkretnego endpointu lub flow.

### C. Analysis summary
- spodziewane bottlenecks,
- co monitorować,
- jak interpretować wynik,
- kiedy wynik sugeruje potrzebę zmian architektonicznych.

---

## 11. Demo flow na hackathon

### Demo scenario
1. Bierzemy realny endpoint albo feature z OM.
2. Skill analizuje spec lub route.
3. Skill proponuje 2-3 scenariusze obciążeniowe.
4. Skill generuje test `k6`.
5. Uruchamiamy test.
6. Skill interpretuje wyniki i wskazuje potencjalne problemy.

### Dlaczego to jest dobry demo case
- ma jasny input,
- ma namacalny output,
- łatwo pokazać wartość,
- nie dubluje istniejących skilli,
- jest praktyczny dla zespołu.

---

## 12. Ranking rekomendacji

### Top 3 overall
1. `om-impact-map`
2. `om-spec-drift-check`
3. `om-fixture-builder`

### Gdzie wpada `om-performance-test-builder`
Dałbym go jako **mocny kandydat z drugiej grupy**, razem z:
- `om-tenant-safety-check`,
- `om-acl-designer`.

### Ocena `om-performance-test-builder`
- **nowość względem obecnych skilli:** wysoka
- **wartość praktyczna:** wysoka
- **łatwość zademonstrowania:** średnio-wysoka
- **ryzyko rozlania scope:** wysokie

Wniosek: **bardzo dobry pomysł, jeśli MVP będzie wąskie i mocno osadzone w OM**.

---

## 13. Ostateczna rekomendacja

Jeśli celem jest zbudowanie czegoś:
- nowego,
- praktycznego,
- mało zdublowanego,
- dobrze wyglądającego na demo,

najmocniejsze opcje to:

### Opcja 1 — najbardziej strategiczna
`om-spec-drift-check`

### Opcja 2 — najbardziej praktyczna w codziennym development
`om-impact-map`

### Opcja 3 — bardzo dobry kandydat techniczny z dużym demo value
`om-performance-test-builder`

Jeśli zespół chce pokazać coś bardziej „engineering-heavy” i łatwego do demonstracji live, to **`om-performance-test-builder` jest bardzo sensownym wyborem**, o ile scope pozostanie wąski: API + bulk + queue smoke tests, najlepiej z generowaniem `k6` i interpretacją wyników.
