# Third-party notices

The MIT licence at the repository root covers this project's original code. It does not replace the following licences or grant rights to the exam materials.

## Official TMUA materials

Past papers, worked solutions and answer keys are published by UAT-UK and Cambridge Assessment / Cambridge University Press & Assessment. They retain their original copyright. The application downloads original PDFs directly from the official sources for personal study; the public repository and executable do not bundle those documents or their rendered question and solution images.

- [Official preparation materials](https://esat-tmua.ac.uk/tmua-preparation-materials/)
- [UAT-UK website terms of use](https://esat-tmua.ac.uk/website-terms-of-use/)

Source URLs, file hashes, page coordinates, question identifiers, answer letters and project topic labels appear in `web/data/`. Inclusion of this index does not imply publisher endorsement.

## PDF.js 5.4.624

Mozilla PDF.js contributors. Licensed under Apache License 2.0. The build fetches the pinned package and verifies its checksum, then includes the browser modules, CMaps, standard fonts and WebAssembly support files under `web/vendor/pdfjs/` in the executable. That generated directory contains the supplied licence files. Some support assets carry their own notices alongside those files.

- [Project](https://github.com/mozilla/pdf.js)
- [PDF.js licence](https://github.com/mozilla/pdf.js/blob/v5.4.624/LICENSE)

## DM Sans and Libre Caslon Display

The bundled WOFF2 fonts are licensed under the SIL Open Font License 1.1. Copyright notices and complete licences are preserved in:

- [`DM-Sans-OFL.txt`](web/assets/fonts/DM-Sans-OFL.txt)
- [`Libre-Caslon-Display-OFL.txt`](web/assets/fonts/Libre-Caslon-Display-OFL.txt)

Download sources and checksums are recorded in `web/assets/fonts/provenance.json`. No Google Fonts request is needed while studying.

## Microsoft components

The application uses the Microsoft WebView2 SDK package `Microsoft.Web.WebView2` version `1.0.4314.35` and the .NET 10 runtime. These components are distributed under their respective Microsoft licences. WebView2 Runtime is a separate Microsoft component installed on the user's computer.

- [WebView2 SDK package](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4314.35)
- [.NET runtime licence](https://github.com/dotnet/runtime/blob/main/LICENSE.TXT)
- [.NET third-party notices](https://github.com/dotnet/runtime/blob/main/THIRD-PARTY-NOTICES.TXT)
