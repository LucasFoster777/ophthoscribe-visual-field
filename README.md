# OphthoScribe Visual Field

A local pipeline demonstration for IRIS reviewers: **multiple inputs → one normalized clinical model → Normal/Zeiss and Dev views → JSON, relational CSV, FHIR and GraphQL**. This independent repository selectively copied extraction, display and analysis code from OphthoScribe revision `478e764144fe2261b53fb477ede094a2ad4bb494`; it neither requires nor modifies that application.

Generic outputs demonstrate integration capabilities. They are **not accepted IRIS submissions**. Registry-specific mapping, identifiers, transport and acceptance require a later agreed adapter and delivery contract.

## Run locally

Requires Node.js 22.13 or later and npm. Python is not required.

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4173**. Use this exact loopback address. After dependency installation, all extraction, calculations, state and file processing stay on the local machine. No external service, credential, account or telemetry is used. The Node service owns the session in memory; the browser holds a read-only display snapshot. Restart or **Reset** clears it. Persistence means downloading a portable session and importing it later.

## Reviewer walkthrough

1. Choose **Load synthetic demonstration**. The outcome list shows format, accepted examinations, duplicates and failures. The PDF examples contain exactly 25 examinations per eye. Structured examples add two subjects, both eyes, different dates, missing/censored values, 24-2 and 30-2, and equivalent examinations in different representations. Representation identity is preserved, so these are separate examinations.
2. Select an examination. **Zeiss View** shows extracted device values for supported PDFs; **Normal View** identifies source-supplied values explicitly. Unavailable values remain absent.
3. Open **Inspect source** for PDF regions, JSON paths, CSV rows/columns or matrix cells. Original bytes remain downloadable. Older exports may lack the original report; the interface says so.
4. Open **Dev View** to calculate an eligible examination. Inspect conventional deviation/significance maps, Bayesian posterior maps/MD, grayscale and engine/dataset identity. **Recompute** appends history; selecting a block never edits the source. Ineligible and failed calculations retain their source data.
5. Choose **Analyze eligible examinations** for batch completeness. Then choose the current examination or whole session and source-only, one named calculation, or all history. Preview/download JSON, CSV package or FHIR. Run the four supplied GraphQL examples against the same live records.
6. Download JSON with all history, reset, and reopen it. Portable sessions include original files. PDF-backed device claims are re-extracted and compared on replay; inconsistent claims are rejected. If original PDF bytes are missing, device claims become explicitly unverified source-supplied values.

These steps demonstrate behavior; they do not substitute for reviewer or clinical acceptance.

## Capability matrix

| Input | This release | Required context / fixture |
|---|---|---|
| Zeiss PDF | `zeiss_multi` text-backed FORUM Overview, 24-2 and 30-2 | Explicit synthetic subject; bundled two nine-page PDFs |
| Source JSON | Validated `visual-field-source/v1` | Explicit synthetic subject; `examples/source-bilateral.json` |
| Session / graph JSON | Version 1 canonical session, prior `extractedGraphs`/`computedAnalyses`, individual validated legacy graph | Embedded subject or explicit context; `examples/legacy-session.json`; download/reopen canonical JSON |
| Measured-threshold CSV | Strict long-form point rows, quoted fields, per-examination acceptance | Explicit subject, eye, date, pattern, units; `examples/thresholds.csv` |
| Matrix JSON | Explicit 8×10 24-2 matrix and orientation | Explicit examination context; `examples/matrix-od.json` |
| TD-only research, XML, DICOM OPV, E2E, scanned PDF, other PDF layouts | **Unsupported** | Future adapters |

Detection uses schema/content, not merely filenames. Unsupported or ambiguous data is rejected. Dates, identity and laterality are never derived from filenames, approximate ages or orientation. Age is optional for viewing; calculation requires a valid available age. Quality-control attestations remain attestations, never measured reliability.

The copied engine supports the 54-location 24-2 grid and at most two unread non-blind thresholds. Its formulas and normative dataset are unchanged. Missing reliability inputs retain the existing calculation assumption of zero; each computed block records this assumption separately from absent source reliability. Calculation can fail to converge for some inputs; the interface reports that failure and keeps the examination.

## Input contracts

CSV is UTF-8 with these case-sensitive columns (optional `age` is years):

```csv
examination,subject,eye,date,pattern,x,y,value,unit,absenceReason,censored,age
visit-1,synthetic-A,OD,2026-01-10,24-2,-9,21,28.125,dB,,false,55
```

Rows sharing `examination` form one examination and must agree on context. Dates are `YYYY-MM-DD`, eye `OD` or `OS`, pattern `24-2` or `30-2`, units `dB`, and coordinates follow the canonical OD-normalized grid in degrees. `censored` is `true` or `false`. A blank value requires a nonempty `absenceReason` and remains absent, never zero. Omitted grid points become `not-supplied`. Repeated/out-of-grid coordinates and malformed numbers reject the affected examination. Proper CSV escaping, quoted commas/newlines and doubled quotes are supported. Rejected examinations are reported while valid groups remain available. Subject context fills an empty subject; embedded subject identity remains authoritative.

Matrix JSON has `schema: "visual-field-matrix/v1"`, a `context` object containing `subject`, `eye`, `date`, `pattern: "24-2"` and optional numeric `age`, plus `orientation`, `unit: "dB"`, and `matrix`. See the complete fixture. Eight rows run from y=21 to −21 in six-degree steps; ten columns run x=−27 to +27. Non-grid cells must be null. Grid cells are numbers, null (not supplied), or `{value,absenceReason,censored}`. `orientation` is `od-normalized` or `visual-field`; visual-field OS x coordinates are mirrored exactly once and that normalization is recorded. Caller-supplied context may fill missing subject/eye/date/pattern/age, never infer it. Decimal precision is retained.

Source JSON retains its original validated document separately from its normalized examination. Legacy graph migration conservatively marks noncomputed values source-supplied with unknown provenance; a legacy `printed` marker alone cannot establish a device result. Calculation histories retain their computed origin but unknown historical provenance.

The standalone canonical contract is `schema: "ophthoscribe-vf-session", version: 1`: sources (original bytes, document and graphs), examinations (context, ordered measurements, reliability, attestations, analyses and provenance), import outcomes and explicit export selection. Measurements retain value/unit, absence reason, censoring, coordinate convention, source location and normalization. Analyses have stable identifiers and `device-reported`, `source-supplied` or `computed` origins. Session import validates references, dimensions, ordering and compatibility projections before committing data. Identical bytes in the same subject context deduplicate; different byte representations stay separate. Reopening a session can append missing examinations/history but conflicting identifiers never overwrite facts.

## Batch CLI

The CLI uses the same pipeline as the service. Outcomes go to stderr; JSON goes to stdout unless `--out` is supplied. Existing output files are not overwritten. CSV output uses a new directory containing five joined tables and `selection.json`.

```sh
npm run pipeline -- --subject synthetic-A --calculate --analysis all --out session.json examples/source-bilateral.json examples/matrix-od.json examples/thresholds.csv
npm run pipeline -- --format csv --analysis all --out csv-package session.json
npm run pipeline -- --format fhir --analysis all --out bundle.json session.json
npm run pipeline -- --subject synthetic-zeiss --out pdf-session.json tests/e2e/fixtures/visual-field/sources/zeiss_multi/hvf_7724798.pdf
npm run pipeline -- --help
```

`--examination ID` and `--source ID` are repeatable selection filters. `--analysis` accepts `source-only` (default), `all`, or a stable calculation ID. Calculating does not implicitly change export selection. Invalid files do not stop a mixed batch; rejected files produce a nonzero exit status and successful imports can still be exported.

## Output contracts and API

| Pathway | Behavior |
|---|---|
| Canonical JSON | Portable session, explicit selection, original bytes/documents and distinct analysis history |
| Relational CSV | `examinations.csv`, `measurement-points.csv`, `analyses.csv`, `analysis-points.csv`, `provenance.csv`; stable joins, origin/units/missingness/source references, formula-safe text cells |
| FHIR R4 | Inspectable **collection** Bundle: Patient identifiers, source and calculated Observations/Provenance and full canonical JSON attachment. No review Tasks, encounters, transaction writes or invented standard codes |
| GraphQL | Real typed, read-only field selection, filters, pagination, source inspection and named analysis selection against current session |

Browser CSV download is a JSON package mapping these filenames to CSV text; the CLI writes actual files. Original documents/graphs are archival and remain unchanged even when a selected export includes only some canonical examinations or analysis blocks. The export states this distinction.

FHIR uses local terminology namespaces, date-only values when only dates exist, and unknown Observation status unless explicitly supplied. Export does not finalize anything. Detailed absence reasons, censoring and point provenance survive in the canonical attachment where they have no structural mapping; projection limitations are stated in the Bundle. No IRIS profile is claimed.

Local endpoints: `POST /api/import` (`{name,base64,context}`), `GET /api/session`, `GET /api/outcomes`, `GET /api/examinations`, `POST /api/analyze` (`{examinationIds?,force?}`), `GET /api/sources/:id/original`, `POST /api/reset` (`{}`), `GET /api/export?format=json|csv|fhir&analysis=source-only|all|ID` (optional comma-separated `sourceIds`/`examinationIds`), and `POST /graphql` (`{query,variables?,operationName?}`). POST bodies are JSON. Browser origins/Host are restricted to the displayed application address; local command-line clients do not need an Origin header.

GraphQL examples are executable in the UI. For example:

```graphql
query {
  sources(subject: "synthetic-A") {
    id name format originalAvailable provenance { adapterVersion detail }
  }
  examinations(subject: "synthetic-A", eye: "OD", pattern: "24-2", limit: 10) {
    id eye date
    measurements { id value unit absenceReason censored sourceLocation }
    analyses(selection: "all") { id origin globals { md psd vfi } provenance { detail } }
  }
}
```

Supply a returned analysis ID to `analyses(selection: "ID")` to compare a selected calculation with source blocks. Filters also include `dateFrom`, `dateTo` and `sourceId`; pagination uses `offset` and `limit` (1–200).

Limits: 32 MiB per source file (128 MiB for portable sessions), 100 sources / 2,000 examinations per session, approximately 135 MiB original bytes, 100 analysis blocks per examination, 100 PDF pages, 120-second import and 10-second calculation worker limits. Reset terminates workers. GraphQL is query-only with 16,384 characters, depth/expanded-cost limits and a 4 MiB result cap. These are demonstration bounds, not hosted multi-user controls.

## Architecture and maintenance

```text
PDF / source JSON / session JSON / CSV / matrix JSON
    → adapters + contract validation
    → shared in-memory Pipeline (sources, normalized examinations, history)
    → local API → Normal/Zeiss + Dev browser projections
    → optional calculation workers → appended computed blocks
    → selection → portable JSON / relational CSV / FHIR / GraphQL
```

`js/pipeline/` owns adapters, contract, service-independent state, calculation boundary and outputs. `server.mjs` serves only public assets and the loopback API; `pipeline.mjs` is the CLI. `js/session.mjs` is a browser API client, not a second clinical store. `js/data/visual-field/` and `js/visual-field/` retain the copied model, extraction, analysis and rendering modules. `data/directories/visual-field/` contains vocabulary, protocols and the normative dataset. PDF.js browser assets are pinned under `js/vendor/pdfjs/`.

Add adapters with representative fixtures, preserve the canonical contract, verify affected paths, update this matrix and push a runnable increment. XML/DICOM, research reconstruction, IRIS-specific mapping, hosted operation and real-patient deployment are future milestones. There is no automatic synchronization with OphthoScribe.

## Dataset and third-party status

The normative artifact `ophthoscribe-24-2-normative-lf.v1.json` is included unchanged. Its recorded redistribution status is `derived-from-suny-iu-visualfields-gpl3-unverified`, and its clinical-validation status is `not-validated`. Packaging this demonstration establishes neither redistribution clearance nor clinical validation. Its original provenance fields, including its operator-accepted label, remain intact.

No new open-source license is assigned. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and retained font/license files.

## Focused verification

```sh
npm run test:extraction
npm run test:analysis
npm run test:display
npm run test:pipeline
```

The two PDF goldens verify 25 examinations per eye and extraction provenance. Input checks cover formats, malformed data, orientation, missingness, migration and replay. Pipeline/output checks exercise cancellation/retry, source/calculated separation, recomputation, selections, and agreement between JSON, CSV, FHIR and GraphQL. The browser walkthrough checks rendered behavior; neither automated checks nor this demonstration establish clinical validation.
