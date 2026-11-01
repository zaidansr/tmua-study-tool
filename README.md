# TMUA Study Tool

A free study tool for practising TMUA questions, with official worked solutions, topic and year filters, bookmarks, a timer and saved progress. Use it in a browser or download the Windows app. No account is required.

## Open in your browser

Open [TMUA Study Tool](https://zaidansr.github.io/tmua-study-tool/). You can start practising immediately: the website displays the original publisher-hosted PDF at the relevant page, with answer checking, filters and progress. An **Open original PDF** link is also available if your browser cannot display the embedded document.

For individual question crops and local paper viewing, optionally import one or more original PDFs downloaded from the official archive. Imports are checked against the expected SHA-256 hashes and saved in your browser's local database. The website hosts the app and question index; exam files are served by the publisher or kept in your own browser.

Browser papers and progress stay in that browser's local storage. They are separate from the Windows app's data. Clearing site data removes the browser's saved papers and progress. Viewing the publisher's embedded PDFs requires an internet connection. Once the page is open, viewing imported papers does not contact the publisher; the Windows app provides the complete offline setup.

## Attempt history and test mode

Each question has an **Attempt history** section with the date, answer, result and time for every checked try. **Try again** starts a new try and preserves the previous ones. Practice time accumulates when you revisit a question and survives reloads; it pauses when the page is hidden. An older saved answer is imported once as an earlier attempt, with unknown timing shown as unrecorded.

Open **Test mode**, choose one paper and a time limit, then start. The default is 75 minutes. While the test is running, navigation stays within that paper and marking, answer keys and worked solutions are unavailable. The countdown continues in the background and after reloads. Submit the test or let the timer expire to see every question marked, including unanswered questions, with a **Worked solution** button beside each result. Completed tests can be reopened from **Previous tests**. Each submitted question also appears in its attempt history.

History, active tests, responses and progress stay in this browser or app profile on this device. Clearing site data removes them. Browser and desktop profiles are separate.

## Random mode

Open **Random mode** from the navigation or the button below a practice question. It picks from the full question bank. A wrong answer schedules the question for **8 minutes** later. A correct review schedules it for **20 minutes** later; another wrong answer restarts the shorter interval. Once a question has been missed, later correct reviews keep using the longer interval. A question answered correctly on its first random-mode try leaves the queue.

Due reviews take priority when you select **Next question**. The current question stays on screen while you work or read feedback. If every available question is finished or waiting, the next due review appears automatically while the waiting page is open. Review deadlines continue while the app is closed, and the active question, attempt history and queue survive reloads.

Expand **Settings** in Random mode to change either interval (whole minutes from 1 to 1440). Changes also update waiting reviews from their last checked time. Random-mode scheduling uses answers checked in Random mode; ordinary practice and timed tests keep their existing behaviour. **Reset progress** clears the queue together with attempts, tests and bookmarks, while retaining interval settings.

## Download and use

1. Download `TMUA-Study-Tool-windows-x64.zip` from [Releases](https://github.com/zaidansr/tmua-study-tool/releases/latest).
2. Extract the ZIP, then open `TMUA-Study-Tool.exe` on Windows 10 or 11, x64.
3. Select **Download official papers**. The app retrieves 45 original PDFs directly from the publisher for your personal study and checks their SHA-256 hashes.
4. Practise offline after that first download. Original-paper links and worked solutions open inside the app; external links open in your browser.

The app includes its .NET runtime. It also needs [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/), which is already present on many Windows computers. If it is missing, the app links to Microsoft's download page.

## Coverage

The question index covers 360 questions across 18 papers: the 2016 practice papers, 2017–2023 past papers and the specimen papers. It includes the publisher's worked solutions and answer keys. Topic labels are study aids added by this project. Search covers question identifiers and metadata, rather than the full mathematical text.

This is an independent project. It is not affiliated with or endorsed by UAT-UK, Cambridge University Press & Assessment or Pearson VUE. For current test information and additional browser-based sample tests, use the [official preparation page](https://esat-tmua.ac.uk/tmua-preparation-materials/).

## Papers and licensing

The public repository, hosted website and executable do **not** contain exam PDFs, extracted question text, question images or solution images. The app displays individual questions from the unchanged PDFs downloaded onto your computer. Exam materials retain their original copyright and are subject to the [publisher's terms of use](https://esat-tmua.ac.uk/website-terms-of-use/); they are not covered by this project's MIT licence.

The app's original source code is available under the [MIT licence](LICENSE). Bundled dependencies have their own licences; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Local data

Papers, app content and progress are stored under `%LOCALAPPDATA%\TMUAStudyTool`. Answers and bookmarks stay on your computer. The app does not require a server or send study progress to this project. Requests to download papers go directly to the publisher, and browser links contact the sites you open.

For an isolated profile, run `TMUA-Study-Tool.exe --data-dir C:\absolute\test-profile`.

## Build

Install the .NET 10 SDK and run from the repository root:

```powershell
.\scripts\build.ps1
```

The build packages `web/` and publishes a self-contained Windows x64 executable. An internet connection is needed to restore the pinned WebView2 SDK package and fetch the pinned PDF.js package, whose checksum the build verifies. PDF.js is bundled into the executable with its licences; the local fonts and their licences are included in the source. Building the app does not download exam papers.

To build only the static website, run `./scripts/build-pages.ps1` with PowerShell 7. It fetches the same pinned PDF.js dependency, checks that exam content and extracted text fields are absent, and writes the Pages artifact to `.build/pages/`. It does not run .NET or download exam papers. The Pages workflow deploys this directory on pushes to `main`.

## Report a problem

Open a [GitHub issue](https://github.com/zaidansr/tmua-study-tool/issues) with the app version, question identifier and steps to reproduce it. Avoid attaching personal study data or copies of exam material. Automated checks and review reduce mistakes, but do not guarantee an error-free app or independently prove every official mathematical solution.

See [verification notes](VERIFICATION.md) for the checks performed on this release and their limits.
