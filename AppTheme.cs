using Microsoft.Win32;

namespace TmuaDesktop;

internal static class AppTheme
{
    private static string PreferencePath => Path.Combine(AppPaths.Root, "app-theme.txt");
    internal static bool IsDark()
    {
        try { string saved = File.ReadAllText(PreferencePath).Trim(); if (saved is "dark" or "light") return saved == "dark"; } catch { }
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int value && value == 0;
        }
        catch { return false; }
    }
    internal static void Save(string theme)
    {
        if (theme is not ("dark" or "light")) return;
        try
        {
            Directory.CreateDirectory(AppPaths.Root);
            if (File.Exists(PreferencePath) && File.ReadAllText(PreferencePath) == theme) return;
            File.WriteAllText(PreferencePath, theme);
        }
        catch (Exception exception) { AppLog.Write("Could not retain startup theme", exception); }
    }
}
