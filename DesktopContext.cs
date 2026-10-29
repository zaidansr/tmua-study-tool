using Microsoft.Web.WebView2.Core;

namespace TmuaDesktop;

internal sealed class DesktopContext
{
    internal const string HostName = "tmua.local";
    internal const string PapersHostName = "papers.tmua.local";
    internal const string StartUrl = "https://tmua.local/index.html";
    private Task<(string ContentPath, CoreWebView2Environment Environment)>? preparation;
    internal PaperStore Papers { get; private set; } = null!;
    internal bool ContentReady { get; private set; }

    internal Task<(string ContentPath, CoreWebView2Environment Environment)> PrepareAsync() =>
        preparation ??= PrepareCoreAsync();

    private async Task<(string, CoreWebView2Environment)> PrepareCoreAsync()
    {
        string content = await Task.Run(ContentBundle.Prepare);
        Papers = new PaperStore(Path.Combine(content, "data", "sources.json"), AppPaths.Papers);
        ContentReady = await Papers.IsReadyAsync();
        Directory.CreateDirectory(AppPaths.WebViewData);
        // A stable virtual HTTPS origin and profile retain localStorage across app updates.
        var environment = await CoreWebView2Environment.CreateAsync(null, AppPaths.WebViewData);
        AppLog.Write("WebView2 runtime " + environment.BrowserVersionString);
        return (content, environment);
    }

    internal static bool IsAppUri(Uri uri) =>
        uri.Scheme == Uri.UriSchemeHttps &&
        (uri.Host.Equals(HostName, StringComparison.OrdinalIgnoreCase) ||
         uri.Host.Equals(PapersHostName, StringComparison.OrdinalIgnoreCase)) && uri.IsDefaultPort;

    internal void MarkContentReady() => ContentReady = true;

    internal static bool IsExternalUri(Uri uri) =>
        (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) && !IsAppUri(uri);
}
