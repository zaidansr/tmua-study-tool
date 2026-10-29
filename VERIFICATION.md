# Verification — 1.1.0

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
