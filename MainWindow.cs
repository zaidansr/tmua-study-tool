using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TmuaDesktop;

internal sealed class MainWindow : Form
{
    private readonly DesktopContext context;
    private readonly string startUrl;
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(251, 251, 247) };
    private readonly Panel statePanel = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(251, 251, 247) };
    private readonly Label stateTitle = new() { AutoSize = false, ForeColor = Color.FromArgb(23, 51, 44), Font = new Font("Segoe UI", 22, FontStyle.Regular), TextAlign = ContentAlignment.MiddleLeft };
    private readonly Label stateDetail = new() { AutoSize = false, ForeColor = Color.FromArgb(83, 104, 92), Font = new Font("Segoe UI", 11), TextAlign = ContentAlignment.TopLeft };
    private readonly FlowLayoutPanel actions = new() { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = true };
    private bool initialized;
    private readonly bool documentWindow;
    private readonly CancellationTokenSource lifetime = new();
    private bool downloadRunning;
    private string? readinessScript;

    internal MainWindow(DesktopContext context, string startUrl = DesktopContext.StartUrl, bool documentWindow = false)
    {
        this.context = context;
        this.startUrl = startUrl;
        this.documentWindow = documentWindow;
        Text = documentWindow ? DocumentTitles.FromUri(startUrl) : "TMUA Study Tool";
        Rectangle workingArea = Screen.FromPoint(Cursor.Position).WorkingArea;
        MinimumSize = WindowPlacement.MinimumSize(workingArea);
        StartPosition = FormStartPosition.Manual;
        Bounds = WindowPlacement.InitialBounds(workingArea,
            SizeFromClientSize(new Size(documentWindow ? 1100 : 1280, 900)));
        BackColor = Color.FromArgb(251, 251, 247);
        try { Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        Controls.Add(browser);
        statePanel.Controls.Add(stateTitle);
        statePanel.Controls.Add(stateDetail);
        statePanel.Controls.Add(actions);
        Controls.Add(statePanel);
        statePanel.BringToFront();
        statePanel.Resize += (_, _) => LayoutState();
        Shown += async (_, _) => await InitializeBrowserAsync();
        FormClosed += (_, _) => { lifetime.Cancel(); browser.Dispose(); };
        stateTitle.Text = "Opening TMUA…";
        stateDetail.Text = "Opening your study tool…";
        LayoutState();
    }

    private void LayoutState()
    {
        int left = Math.Max(40, (statePanel.ClientSize.Width - 680) / 2);
        int top = Math.Max(50, statePanel.ClientSize.Height / 3 - 40);
        stateTitle.SetBounds(left, top, Math.Max(200, statePanel.ClientSize.Width - 2 * left), 70);
        stateDetail.SetBounds(left, top + 80, Math.Max(200, statePanel.ClientSize.Width - 2 * left), 150);
        actions.Location = new Point(left, top + 240);
        actions.MaximumSize = new Size(Math.Max(200, statePanel.ClientSize.Width - 2 * left), 0);
    }

    private async Task InitializeBrowserAsync()
    {
        if (initialized) return;
        initialized = true;
        try
        {
            var prepared = await context.PrepareAsync();
            if (IsDisposed) return;
            await browser.EnsureCoreWebView2Async(prepared.Environment);
            if (IsDisposed) return;
            var core = browser.CoreWebView2;
            core.SetVirtualHostNameToFolderMapping(DesktopContext.HostName, prepared.ContentPath,
                CoreWebView2HostResourceAccessKind.DenyCors);
            core.SetVirtualHostNameToFolderMapping(DesktopContext.PapersHostName, AppPaths.Papers,
                CoreWebView2HostResourceAccessKind.Allow);
            await UpdateReadinessScriptAsync();
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.Settings.IsBuiltInErrorPageEnabled = true;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.NavigationStarting += OnNavigationStarting;
            core.NewWindowRequested += OnNewWindowRequested;
            if (!documentWindow) core.WebMessageReceived += OnWebMessageReceived;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.ProcessFailed += (_, e) =>
            {
                AppLog.Write("WebView2 process failed: " + e.ProcessFailedKind);
                ShowError("The app view stopped unexpectedly.", "Close and reopen the app. Your saved progress is kept on this device.");
            };
            core.NavigationCompleted += (_, e) =>
            {
                if (e.IsSuccess)
                {
                    statePanel.Visible = false;
                    browser.Focus();
                }
                else if (e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                {
                    AppLog.Write("Navigation failed: " + e.WebErrorStatus);
                    ShowError("The question bank could not open.", "The offline files may need to be prepared again. Close and reopen the app.\n\nDetails: " + e.WebErrorStatus);
                }
            };
            core.Navigate(startUrl);
        }
        catch (WebView2RuntimeNotFoundException exception)
        {
            AppLog.Write("WebView2 runtime missing", exception);
            ShowError("Microsoft WebView2 is needed to open the app.",
                "Install Microsoft's WebView2 runtime, then reopen TMUA.", true);
        }
        catch (Exception exception)
        {
            AppLog.Write("Startup failed", exception);
            ShowError("The app could not start.", exception.Message + "\n\nYour saved progress has not been cleared.");
        }
    }

    private async Task UpdateReadinessScriptAsync()
    {
        var core = browser.CoreWebView2;
        if (readinessScript is not null) core.RemoveScriptToExecuteOnDocumentCreated(readinessScript);
        readinessScript = await core.AddScriptToExecuteOnDocumentCreatedAsync(
            "window.TMUA_CONTENT_READY=" + (context.ContentReady ? "true" : "false") + ";");
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (downloadRunning || IsDisposed || !Uri.TryCreate(e.Source, UriKind.Absolute, out Uri? source) ||
            source.Scheme != Uri.UriSchemeHttps || !source.IsDefaultPort ||
            !source.Host.Equals(DesktopContext.HostName, StringComparison.OrdinalIgnoreCase) || source.AbsolutePath != "/index.html") return;
        try
        {
            if (e.WebMessageAsJson.Length > 2048) return;
            using JsonDocument message = JsonDocument.Parse(e.WebMessageAsJson);
            if (!message.RootElement.TryGetProperty("type", out JsonElement type) || type.GetString() != "download-papers") return;
            downloadRunning = true;
            var progress = new Progress<DownloadProgress>(state =>
            {
                // Completion is sent only after readiness has been installed for the next page load.
                if (state.State != "complete") _ = SendDownloadProgressAsync(state);
            });
            await context.Papers.DownloadAsync(progress, lifetime.Token);
            if (IsDisposed) return;
            context.MarkContentReady();
            await UpdateReadinessScriptAsync();
            await SendDownloadProgressAsync(new("complete", context.Papers.Count, context.Papers.Count, "Papers are ready for offline study."));
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
        catch (Exception exception)
        {
            AppLog.Write("Paper download failed", exception);
            await SendDownloadProgressAsync(new("error", 0, context.Papers.Count,
                "The papers could not be downloaded. Check your connection and retry. " + exception.Message));
        }
        finally { downloadRunning = false; }
    }

    private async Task SendDownloadProgressAsync(DownloadProgress state)
    {
        if (IsDisposed || lifetime.IsCancellationRequested || browser.CoreWebView2 is null) return;
        try
        {
            string json = JsonSerializer.Serialize(state, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            await browser.CoreWebView2.ExecuteScriptAsync("window.tmuaDownloadProgress&&window.tmuaDownloadProgress(" + json + ");");
        }
        catch (Exception exception) when (exception is ObjectDisposedException or InvalidOperationException or System.Runtime.InteropServices.COMException)
        { AppLog.Write("Could not update download progress", exception); }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (e.Uri == "about:blank") return;
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && DesktopContext.IsAppUri(uri)) return;
        e.Cancel = true;
        if (uri is not null && DesktopContext.IsExternalUri(uri)) OpenExternal(uri.AbsoluteUri);
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
        if (DesktopContext.IsAppUri(uri))
        {
            // Local papers and full-size images stay in the desktop app.
            new MainWindow(context, uri.AbsoluteUri, true).Show(this);
        }
        else if (DesktopContext.IsExternalUri(uri)) OpenExternal(uri.AbsoluteUri);
    }

    private void ShowError(string title, string detail, bool runtimeMissing = false)
    {
        if (IsDisposed) return;
        stateTitle.Text = title;
        stateTitle.Font = new Font("Segoe UI", 18, FontStyle.Regular);
        stateDetail.Text = detail;
        actions.Controls.Clear();
        if (runtimeMissing)
            actions.Controls.Add(ActionButton("Get Microsoft WebView2", () => OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/")));
        actions.Controls.Add(ActionButton("Open log folder", AppLog.OpenFolder));
        actions.Controls.Add(ActionButton("Close", Close));
        statePanel.Visible = true;
        statePanel.BringToFront();
        LayoutState();
    }

    private static Button ActionButton(string title, Action action)
    {
        var button = new Button
        {
            Text = title, AutoSize = true, Padding = new Padding(14, 7, 14, 7),
            Margin = new Padding(0, 0, 10, 10), FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 10), BackColor = Color.FromArgb(228, 238, 229),
            ForeColor = Color.FromArgb(23, 51, 44)
        };
        button.Click += (_, _) => action();
        return button;
    }

    private static void OpenExternal(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || !DesktopContext.IsExternalUri(uri)) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception exception) { AppLog.Write("Could not open external link", exception); }
    }
}
