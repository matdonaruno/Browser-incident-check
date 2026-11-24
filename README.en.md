English | [日本語](README.md)

# Input Audit

A local audit extension (Chrome / Edge, Manifest V3) that logs typing, pasting, and form submissions in the browser. The UI follows your browser's language (English / Japanese).

## Want to try it?

A trial build (v0.4.0) is distributed on GitHub. It is not on the Chrome Web Store yet.
Follow the **[trial installation guide (INSTALL.md)](INSTALL.md)** — just download the ZIP and load it into your browser (about 3 minutes).
Feedback and bug reports are welcome via Issues.

## Recording modes

- **Default (all sites)**: Metadata only. Input values are never saved.
- **Sites that record values (allowlist)**: Only on hosts you add to "Sites that record values" in the popup, the extension also saves input values, edit history (`92 → 98`), and the full set of inputs at submit/button-click time (snapshots). For table-style forms where field names are unavailable, the text of the same row (`context`) is kept as well.
- Password fields are never recorded, regardless of the allowlist.
- Intended use: tracing when an input mistake happened during web data entry, e.g. for external quality assessment (EQA) surveys / proficiency testing. For QC samples only (not for entering patient information).

## Pre-submit check and L1 rule checks (allowlisted sites only)

- Just before submission, the pre-submit check lists all inputs and blocks sending until you review them. Showing, confirming, and cancelling the check are recorded in the log.
- The L1 rule check warns about signs of trouble that can be spotted without knowing the correct values: empty fields, full-width characters, line breaks / tabs / leading or trailing spaces, units mixed into values, paste truncation / conversion / multi-line pasting / overwriting, and duplicate values across fields (possible swaps).
- When there are warnings, you cannot submit until you tick "I have reviewed all warnings and cross-check results". A warning is not a judgement of whether a value is correct — the final decision is yours. Warning counts and types are also recorded in the gate's log entries.

## Source data cross-check (L2) and restore assist (allowlisted sites only)

- In the side panel (via "Open side panel" in the popup), paste the source data (an item → value table) or import it from a CSV file. The extension proposes a mapping to the input fields; you review it and save it per host. Source data is stored only on your device and is never sent to the site.
- At the pre-submit check, inputs are cross-checked against the source data, showing matches / mismatches (with the first differing position highlighted) / digit transpositions / suspected swaps (the value matches another item's source value). The share of fields that could be cross-checked (coverage) is also shown. Comparison normalizes values as numbers (0.82 = .82 = 0.820; full-width characters, commas, and units are absorbed). As with L1 warnings, entries with mismatches cannot be submitted until you confirm you have reviewed all of them. Cross-check counts are recorded in the gate's log entries.
- Handling of source data: the cross-check only shows that an input and the source data disagree; it does not judge which side is right. Source data itself can be wrong, so use the source closest to the origin (e.g. the analyzer's printout or output). Source data in the side panel can be edited on the spot, and the cross-check re-run after editing.
- Restore assist: on an allowlisted site, if a previous input session remains in the log, a banner ("N entries from a previous input session remain") offers to restore values into the currently empty fields after you review the list (useful when a session timeout wiped your input). Showing, running, and dismissing a restore are recorded in the log.

## What is recorded / not recorded (default mode)

| Recorded | Not recorded |
|---|---|
| Time, URL (without query/hash), field attributes (tag/type/name/id/label) | **The input values themselves** |
| Character counts | Values or character counts of password fields |
| Types of things that look sensitive (creditCard / apiKey / privateKey / jwt / email / phoneJP / digits12) | |
| Destination origin, whether the submission is cross-origin or non-HTTPS | |

Storage is `chrome.storage.local` only (up to 5,000 entries / about 8 MB; older entries are deleted first when the limit is exceeded). Values are truncated at 2,000 characters per field and snapshots at 300 fields. Nothing is transmitted externally.

## Installation (development build)

- Chrome: `chrome://extensions` → Developer mode → "Load unpacked" → select `extension/`
- Edge: `edge://extensions` → Developer mode → "Load unpacked" → select `extension/`

In secret/incognito windows, nothing is recorded unless you allow the extension there in its settings.

## Tests

```bash
node --test tests/detect.test.js tests/background.test.js tests/content.test.js tests/rules.test.js tests/collate.test.js
```

## Limitations

- Detection is regex-based and can produce false positives and misses (`digits12` is especially prone to false positives).
- Input events are debounced by 800 ms and merged into one entry per field. Individual keystrokes are not recorded.
- Fake events created by page scripts (not `isTrusted`) are not recorded. As a result, on sites where JavaScript submits via `form.requestSubmit()` and the like, no submit entry is left; instead, the actual click on the submit button (with a snapshot) is recorded.
- Submissions made by JavaScript via `fetch` / XHR are not captured (only form submits).

## License

Copyright (c) 2026 matdonaruno (tari family)

This software is published under the [license (LICENSE)](LICENSE). Installation and use are free of charge, including use for business and commercial purposes. However, redistribution, sale, and distribution of modified versions are not permitted. The software is provided without warranty.
