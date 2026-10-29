using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;

namespace TmuaDesktop;

internal static class ContentBundle
{
    internal static string Prepare()
    {
        Directory.CreateDirectory(AppPaths.Content);
        using Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("TmuaDesktop.Site.zip")
            ?? throw new InvalidOperationException("The offline question archive is missing from this app.");
        using var memory = new MemoryStream();
        resource.CopyTo(memory);
        byte[] archive = memory.ToArray();
        string hash = Convert.ToHexString(SHA256.HashData(archive)).ToLowerInvariant();
        string version = hash[..12];
        string target = Path.Combine(AppPaths.Content, version);
        string completion = Path.Combine(target, ".complete");

        using var extractionLock = new Mutex(false, "Local\\TMUAStudyToolContentExtraction");
        bool acquired;
        try { acquired = extractionLock.WaitOne(TimeSpan.FromSeconds(60)); }
        catch (AbandonedMutexException) { acquired = true; }
        if (!acquired) throw new TimeoutException("Another copy of the app is preparing the question archive. Please try again shortly.");
        try
        {
            using var zip = new ZipArchive(new MemoryStream(archive, false), ZipArchiveMode.Read);
            if (File.Exists(completion) && File.ReadAllText(completion) == hash && HasArchiveFiles(target, zip))
                return target;

            string temporary = Path.Combine(AppPaths.Content, ".extract-" + Guid.NewGuid().ToString("N"));
            EnsureContained(temporary, AppPaths.Content);
            Directory.CreateDirectory(temporary);
            try
            {
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string destination = Path.GetFullPath(Path.Combine(temporary, entry.FullName));
                    EnsureContained(destination, temporary);
                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(destination);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                    using var input = entry.Open();
                    using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    input.CopyTo(output);
                }
                if (!HasArchiveFiles(temporary, zip))
                    throw new InvalidDataException("The bundled archive does not contain the complete question bank.");
                File.WriteAllText(Path.Combine(temporary, ".complete"), hash);
                // Preserve a damaged prior cache for recovery instead of deleting it.
                if (Directory.Exists(target))
                {
                    EnsureContained(target, AppPaths.Content);
                    Directory.Move(target, target + ".previous-" + Guid.NewGuid().ToString("N"));
                }
                EnsureContained(target, AppPaths.Content);
                Directory.Move(temporary, target);
                AppLog.Write("Offline archive prepared: " + version);
                return target;
            }
            catch
            {
                if (Directory.Exists(temporary))
                {
                    EnsureContained(temporary, AppPaths.Content);
                    Directory.Delete(temporary, true);
                }
                throw;
            }
        }
        finally { extractionLock.ReleaseMutex(); }
    }

    private static bool HasMainFiles(string directory) =>
        File.Exists(Path.Combine(directory, "index.html")) &&
        File.Exists(Path.Combine(directory, "data", "questions.js")) &&
        File.Exists(Path.Combine(directory, "data", "questions.json"));

    private static bool HasArchiveFiles(string directory, ZipArchive archive)
    {
        if (!HasMainFiles(directory)) return false;
        foreach (ZipArchiveEntry entry in archive.Entries)
        {
            if (string.IsNullOrEmpty(entry.Name)) continue;
            string destination = Path.GetFullPath(Path.Combine(directory, entry.FullName));
            EnsureContained(destination, directory);
            var file = new FileInfo(destination);
            // Check the entire archive, including PDFs, images, styles and fonts.
            // Length catches incomplete copies cheaply; the content comparison
            // also catches a damaged PDF/script/image whose size is unchanged.
            if (!file.Exists || file.Length != entry.Length) return false;
            using Stream bundled = entry.Open();
            using Stream cached = new FileStream(destination, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(bundled), SHA256.HashData(cached)))
                return false;
        }
        return true;
    }

    private static void EnsureContained(string path, string directory)
    {
        string root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!Path.GetFullPath(path).StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("A bundled file points outside the question archive.");
    }
}
