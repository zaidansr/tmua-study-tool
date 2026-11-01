# Verification

## Version 1.3.0 — 1 November 2026

Random mode replaces the previous Surprise me action with a persistent spaced-repetition queue.

- 88 JavaScript test groups passed: 37 frontend, 17 random-scheduler, 11 attempt-history, 15 timed-test, five PDF-import and three metadata/geometry groups. The frontend checks include all 2,285 answer choices, all 1,950 filters and the existing 600-action sequence.
- Scheduler checks verify exact 8- and 20-minute boundaries, another wrong answer restarting the shorter delay, first-try correct questions leaving the queue, due-review priority and no early repeats. Settings changes recalculate pending deadlines from the last checked time.
- Root integration checks cover clean review attempts with preserved history, saved active drafts, reloads, cross-tab settings and outcomes, reset generations, denied-storage recovery, no interruption of work or checked feedback, waiting for due reviews and the single-question case.
- 33 production-browser checks passed with isolated local data, including 8 → 20 → 8 scheduling, custom intervals and reload, marked-history retention, automatic review while waiting, paper-test locks, actual imported-PDF rendering and a 390-pixel mobile layout without horizontal overflow.
- Six publication guards passed. Public bundles still exclude exam PDFs, extracted exam text, rendered exam images and personal profiles.

Review schedules use local wall-clock time and remain on the current browser or app profile. Due reviews appear on the next-question action, or automatically when the waiting page is open; an active question is never replaced by the review timer. These checks establish covered behaviour rather than an absolute guarantee of error-free software.

## Version 1.2.0 — 1 November 2026

Attempt history and timed paper tests were checked with isolated profiles; existing user progress was not used for testing.

- 61 JavaScript test groups passed: 27 frontend, 11 attempt-history, 15 timed-test model, five PDF-import and three metadata/geometry groups. Existing coverage includes all 2,285 answer choices, 1,950 filter combinations and a seeded 600-action sequence.
- History checks cover repeated correct/wrong tries, cumulative question time across navigation and reloads, legacy migration, immutable duplicate IDs, reset generations, cross-tab changes and storage failure recovery. Regressions also cover stale marking after another tab resets progress, focus-only recovery of pending writes and fractional time preserved through navigation by tabs or URL fragments.
- Browser integration passed 32 checks: practice histories, retry/reload, a single-paper countdown, hidden marking and solution controls, locked navigation, persisted test answers and deadline, all 20 marked results, adjacent worked solutions, saved test reviews, duplicate prevention and expiry both while open and while closed.
- The final Windows build passed 12 native-host checks covering local PDF rendering, saved correctness and time, the timed paper flow, all 20 result rows, worked-solution review and persistence after reload without duplicate attempts.
- The public bundle guard continues to exclude exam PDFs, cropped exam images, extracted full text and personal profiles. Papers are viewed from the publisher or imported locally.

Practice time pauses while the page is hidden; a test's wall-clock countdown continues. Storage-denied sessions show a warning and retain recoverable state in memory, but durable saving still requires browser storage. These checks establish the covered behaviour, not an absolute guarantee of error-free software.

## Original 1.1.0 archive and application checks

The public release was checked for study behaviour, download integrity and accidental inclusion of exam content. These checks provide evidence for the covered flows; they do not guarantee that every possible error has been found or independently prove the publisher's mathematics.

## Completed checks

- **19 frontend test groups passed**, including three groups for PDF region geometry and metadata. The checks cover answer marking, navigation, filters, saved progress, bookmarks, retry, timers and damaged or unavailable local storage.
- **19 native assertions passed** for the paper store, including download verification, cache reuse, corruption repair, unsafe source rejection, bounded retries, failure cleanup and cancellation.
- **16 integration checks passed** against the production app's download and viewing flow. All 45 official PDFs downloaded and matched the expected SHA-256 hashes. The checks covered setup progress and reload, question and solution rendering, an incorrect answer followed by retry and a correct answer, bookmarks, the image dialog, PDF page links and persistence after reload.
- **All 749 question and solution regions rendered successfully**, with zero failures, using the production PDF.js renderer and the downloaded PDFs. Each result decoded with positive dimensions and non-white pixels. The full run took 68.4 seconds.
- The public web bundle contains metadata and viewing code, without exam PDFs, extracted full question or solution text, or pre-rendered question and solution images. Source files were reviewed for credentials and personal paths; generated build files and profiles are excluded from Git.

## Scope

The index contains 360 questions and 749 question or solution regions. The full render check establishes that each indexed region produces a non-empty image; it does not establish the mathematical correctness of each official solution or substitute for reading every rendered equation and diagram.

Topic labels are project study aids, rather than official classifications. PDF.js rendering can differ from the publisher's PDF viewer, so original PDF links are available when inspecting a question or solution. The checks use the released historical source PDFs and cannot establish the behaviour of future publisher replacements or every Windows installation.

## Browser version — 30 October 2026

The GitHub Pages version adds online viewing of unchanged publisher-hosted PDFs and optional local PDF imports. All 360 questions are accessible before importing files. Embedded PDF support depends on the browser; an original-PDF link appears above each viewer.

- All 26 JavaScript test groups passed, including browser imports, SHA-256 verification, partial imports, damaged-cache recovery, storage errors and the existing practice regressions.
- Six publication checks passed, including rejection of PDFs, renamed PDFs, extracted question text, rendered question images and asset paths that would break project Pages.
- Browser integration at a project-style URL verified actual publisher PDF frames, a renamed-file import, all 45 verified local imports, answer checking, bookmarks, full-size images, PDF page links and persistence after reload.
- All 749 regions rendered and decoded from the browser's IndexedDB copies, with positive dimensions and visible pixels, zero failures, in 68.4 seconds. Reopening an earlier PDF after cache eviction also passed.

The browser checks use an isolated profile and the same production scripts. They do not establish compatibility with every browser or independently verify the mathematics in the original papers. Browser progress is separate from desktop progress; clearing site data removes local imports and progress.
