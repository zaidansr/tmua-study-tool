using System.Diagnostics;

namespace TmuaDesktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            ApplicationConfiguration.Initialize();
            AppPaths.Configure(args);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (_, eventArgs) => ShowUnexpected(eventArgs.Exception);
            AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
                AppLog.Write("Unhandled process error", eventArgs.ExceptionObject as Exception);
            Application.Run(new MainWindow(new DesktopContext()));
        }
        catch (Exception exception)
        {
            ShowUnexpected(exception);
        }
    }

    private static void ShowUnexpected(Exception exception)
    {
        AppLog.Write("Unexpected application error", exception);
        MessageBox.Show("The app encountered an error. Your saved progress is kept on this device.\n\n" +
                        exception.Message + "\n\nLog: " + AppLog.LogFile,
                        "TMUA Study Tool", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}

internal static class AppLog
{
    private static readonly object Gate = new();
    internal static string LogFile => Path.Combine(AppPaths.Root, "logs", "app.log");

    internal static void Write(string message, Exception? exception = null)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogFile)!);
                File.AppendAllText(LogFile, $"{DateTimeOffset.Now:O} {message}\n{exception}\n");
            }
        }
        catch { /* Logging must never prevent the app from opening. */ }
    }

    internal static void OpenFolder()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(LogFile)!);
        Process.Start(new ProcessStartInfo(Path.GetDirectoryName(LogFile)!) { UseShellExecute = true });
    }
}
