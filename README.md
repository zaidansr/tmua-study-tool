# TMUA Study Tool

A free Windows app for practising TMUA questions, with official worked solutions, topic and year filters, bookmarks, a timer and saved progress. No account is required.

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

The public repository and executable do **not** contain exam PDFs, extracted question text, question images or solution images. The app displays individual questions from the unchanged PDFs downloaded onto your computer. Exam materials retain their original copyright and are subject to the [publisher's terms of use](https://esat-tmua.ac.uk/website-terms-of-use/); they are not covered by this project's MIT licence.

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

## Report a problem

Open a [GitHub issue](https://github.com/zaidansr/tmua-study-tool/issues) with the app version, question identifier and steps to reproduce it. Avoid attaching personal study data or copies of exam material. Automated checks and review reduce mistakes, but do not guarantee an error-free app or independently prove every official mathematical solution.

See [verification notes](VERIFICATION.md) for the checks performed on this release and their limits.
