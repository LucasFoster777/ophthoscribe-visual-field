# OphthoScribe Visual Field

An independent, local demonstration of Zeiss PDF extraction and two separate visual field display paths. Sources were selectively copied from OphthoScribe revision `478e764144fe2261b53fb477ede094a2ad4bb494`. This repository has its own history and is maintained independently; it does not require the original checkout.

## Run

Requires Node.js 22.13 or later, npm, and Python 3.

```sh
npm install
npm start
```

Open <http://127.0.0.1:4173>. The server is loopback-only. Dependencies are installed from npm; PDF processing and analysis run locally in your browser. There is no application backend, upload endpoint, account, telemetry, or automatic persistent storage.

Load the bundled synthetic examples or choose a supported local PDF, then select an examination by date, eye and pattern. The two bundled Zeiss Overview PDFs contain 25 examinations per eye across nine pages each; their golden extracted point sets are beside them in `tests/e2e/fixtures/visual-field/sources/zeiss_multi/`.

## Two views, distinct sources

**Zeiss View** is the default. It displays extracted thresholds, device-reported indices and reliability, deviation values, and significance symbols wherever the source provides them. A value absent from the PDF remains absent. In particular, the example Overview reports provide significance maps without numeric deviation maps: the numeric maps remain absent in Zeiss View.

**Dev View** calculates on first opening an eligible examination. It displays computed conventional maps and indices, Bayesian maps and posterior MD, grayscale, and engine/dataset identity. The switch is always available without application development settings. Recompute appends a separate computed block; the block selector lets you inspect earlier calculations during this browser session. Device analysis blocks are never overwritten or backfilled by calculations.

Source inspection and the original PDF remain accessible from both views. Inspect extraction regions, raw strings, parsed values, explicit absence states and protocol identity. JSON download includes the extracted graph and separately identified computed blocks. Reset clears the session, terminates workers and releases document URLs. An analysis failure leaves extracted results available.

## Supported inputs and analysis

The shipped `zeiss_multi` protocol handles its existing text-layer Zeiss FORUM Overview layout for 24-2 and 30-2 tests, using text extraction and deterministic raster-glyph reading of significance symbols. This is not a general-purpose PDF importer. Scanned reports and arbitrary layouts are unsupported. No Tesseract or OCR subsystem is included.

Derived analysis retains the copied engine's eligibility checks: a supported 24-2 grid, OD or OS laterality, an available valid age, and sufficient usable thresholds. The 30-2 examinations remain viewable, with an explanation that no supported analysis dataset is available. Missing or otherwise ineligible inputs receive an explanation in Dev View. Censored thresholds and anatomical blind points retain the source engine's handling.

## Protocol anatomy and code

- `data/directories/visual-field/`: protocol definitions, attribute vocabulary, patterns, and normative dataset.
- `js/visual-field/`: protocol detection, text and glyph readers, extraction/parsers, analysis engine, workers, grayscale, and report projection/rendering helpers.
- `js/data/visual-field/`: directory loading, graph model, assembly and computed-block adaptation.
- `js/vendor/pdfjs/`: pinned PDF.js 6.2.108 browser assets and standard fonts.
- `tests/`: the two synthetic PDFs and golden results, plus focused extraction, analysis and display tests.

A protocol identifies its source layout and anchors, names extraction regions and readers, and maps parsed Points to the graph's attribute homes. Assembly preserves source and protocol provenance while separating measurements, device analyses and computed analyses. Existing extraction, graph and analysis schemas are preserved.

Standalone adaptations provide local asset/provider registration, directory loading without application build metadata, an in-memory session with a demo subject identifier, selected-examination analysis orchestration, and read-only display/JSON controls. Encounter, patient management, notes, review/correction, persistent stores, and longitudinal workflows are excluded.

Future synchronization means explicitly selecting another OphthoScribe revision and copying/reviewing the relevant source files. There is no automatic connection back to OphthoScribe.

## Dataset and third-party status

The normative artifact `ophthoscribe-24-2-normative-lf.v1.json` is included unchanged. Its recorded redistribution status is `derived-from-suny-iu-visualfields-gpl3-unverified`, and its clinical-validation status is `not-validated`. Packaging this demonstration establishes neither redistribution clearance nor clinical validation. Its original provenance fields, including its operator-accepted label, are retained without changing those statuses.

No new open-source license is assigned. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the retained font/license files.

## Focused checks

```sh
npm run test:extraction
npm run test:analysis
npm run test:display
```

The extraction check compares both PDFs with their golden point sets and checks 25 examinations per eye and point provenance. Analysis checks cover laterality, blind spots, censored/missing thresholds, dataset provenance and deterministic grayscale. Display checks cover device/calculated separation, source absence, Bayesian layers, recomputation and computed-block selection. These checks do not establish clinical validation.
