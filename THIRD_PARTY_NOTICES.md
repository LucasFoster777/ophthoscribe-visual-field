# Third-party notices

No new license is granted by this repository. Application source was selectively copied from OphthoScribe revision `478e764144fe2261b53fb477ede094a2ad4bb494`; original source headers are retained.

## PDF.js

The vendored browser distribution is Mozilla PDF.js (`pdfjs-dist`) version 6.2.108, licensed under the Apache License, Version 2.0. The full license is retained at `js/vendor/pdfjs/LICENSE`; copyright notices remain in the distribution files. The matching npm package is used by the local extraction tests.

PDF.js standard fonts retain their separate notices:

- `js/vendor/pdfjs/standard_fonts/LICENSE_FOXIT`
- `js/vendor/pdfjs/standard_fonts/LICENSE_LIBERATION`

## Normative dataset

`data/directories/visual-field/datasets/ophthoscribe-24-2-normative-lf.v1.json` is copied unchanged, including provenance. It describes a 54-location table calibrated by Lucas Foster from the SUNY-IU normative dataset associated with the visualFields R package, with central locations from the 10-2 surface and peripheral locations from 24-2.

The artifact records `redistributionRights: derived-from-suny-iu-visualfields-gpl3-unverified` and `clinicalValidation: not-validated`. Inclusion does not establish redistribution permission, settle underlying licensing, or establish clinical validity. No replacement license is assigned to the dataset.

## Test dependencies and examples

`@napi-rs/canvas` is an npm-installed development dependency for PDF rasterization in extraction tests. Its own package license and notices are distributed with the dependency; it is not vendored into this repository. npm-installed dependencies retain their upstream licenses.

The two Zeiss Overview PDFs are documented synthetic demo patient examples, as recorded in their accompanying fixture README. Vendor names identify the source report format and do not imply endorsement.
