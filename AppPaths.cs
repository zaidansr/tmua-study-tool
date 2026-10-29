namespace TmuaDesktop;

internal static class AppPaths
{
    private static string root = DefaultRoot;
    private static string DefaultRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TMUAStudyTool");
    internal static string Root => root;
    internal static string WebViewData => Path.Combine(Root, "WebView2");
    internal static string Content => Path.Combine(Root, "content");
    internal static string Papers => Path.Combine(Root, "papers");

    internal static void Configure(string[] args)
    {
        string candidate = DefaultRoot;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] != "--data-dir") continue;
            if (++i >= args.Length || !Path.IsPathFullyQualified(args[i]))
                throw new ArgumentException("--data-dir requires an absolute local folder path.");
            candidate = Path.GetFullPath(args[i]);
        }
        // Apply a fully validated argument list only once. The normal app profile
        // remains the default whenever no test-profile override is supplied.
        root = candidate;
    }
}
