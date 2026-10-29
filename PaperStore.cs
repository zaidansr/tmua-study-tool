using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace TmuaDesktop;

internal sealed record PaperSource(string Label, Uri Url, string FileName, long Bytes, string Sha256);
internal sealed record DownloadProgress(string State, int Completed, int Total, string Message);

internal sealed class PaperStore
{
    private readonly IReadOnlyList<PaperSource> sources;
    private readonly string directory;
    private readonly HttpClient client;
    private readonly SemaphoreSlim gate = new(1, 1);
    private static readonly HttpClient Client = new(new HttpClientHandler { AllowAutoRedirect = false })
    {
        Timeout = TimeSpan.FromMinutes(3)
    };

    internal PaperStore(string manifestPath, string directory, HttpClient? client = null)
    {
        this.directory = Path.GetFullPath(directory);
        this.client = client ?? Client;
        using JsonDocument manifest = JsonDocument.Parse(File.ReadAllText(manifestPath));
        sources = manifest.RootElement.GetProperty("sources").EnumerateArray().Select(item =>
        {
            string path = item.GetProperty("path").GetString() ?? "";
            string fileName = path.StartsWith("papers/", StringComparison.Ordinal) ? path[7..] : "";
            string checksum = item.GetProperty("sha256").GetString() ?? "";
            long bytes = item.GetProperty("bytes").GetInt64();
            if (string.IsNullOrWhiteSpace(fileName) || fileName != Path.GetFileName(fileName) ||
                fileName.Contains('/') || fileName.Contains('\\') || fileName.Contains(':') ||
                !fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ||
                checksum.Length != 64 || !checksum.All(Uri.IsHexDigit) || bytes < 5 || bytes > 40_000_000 ||
                !Uri.TryCreate(item.GetProperty("url").GetString(), UriKind.Absolute, out Uri? url) || !IsPublisherUri(url))
                throw new InvalidDataException("The paper manifest contains an invalid source.");
            return new PaperSource(item.GetProperty("label").GetString() ?? fileName, url, fileName, bytes, checksum.ToLowerInvariant());
        }).ToArray();
        if (sources.Count == 0 || sources.Select(source => source.FileName).Distinct(StringComparer.OrdinalIgnoreCase).Count() != sources.Count)
            throw new InvalidDataException("The paper manifest is empty or contains duplicate paths.");
        Directory.CreateDirectory(this.directory);
    }

    internal int Count => sources.Count;

    private static bool IsPublisherUri(Uri uri) => uri.Scheme == Uri.UriSchemeHttps && uri.IsDefaultPort &&
        string.IsNullOrEmpty(uri.UserInfo) && (uri.Host.Equals("uat-wp.s3.eu-west-2.amazonaws.com", StringComparison.OrdinalIgnoreCase) ||
        uri.Host.Equals("esat-tmua.ac.uk", StringComparison.OrdinalIgnoreCase));

    internal async Task<bool> IsReadyAsync(CancellationToken cancellationToken = default)
    {
        foreach (PaperSource source in sources)
            if (!await IsValidAsync(Path.Combine(directory, source.FileName), source, cancellationToken).ConfigureAwait(false)) return false;
        return true;
    }

    internal async Task DownloadAsync(IProgress<DownloadProgress> progress, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            int completed = 0;
            progress.Report(new("downloading", 0, Count, "Checking local papers…"));
            await Parallel.ForEachAsync(sources, new ParallelOptions { MaxDegreeOfParallelism = 3, CancellationToken = cancellationToken },
                async (source, token) =>
                {
                    string target = Path.Combine(directory, source.FileName);
                    if (!await IsValidAsync(target, source, token).ConfigureAwait(false))
                    {
                        for (int attempt = 1; ; attempt++)
                        {
                            try { await DownloadOneAsync(source, target, token).ConfigureAwait(false); break; }
                            catch (Exception exception) when (attempt < 3 && (exception is HttpRequestException or IOException) && !token.IsCancellationRequested)
                            { await Task.Delay(TimeSpan.FromSeconds(attempt), token).ConfigureAwait(false); }
                        }
                    }
                    int done = Interlocked.Increment(ref completed);
                    progress.Report(new("downloading", done, Count, $"Downloaded {done} of {Count} papers."));
                }).ConfigureAwait(false);
            progress.Report(new("complete", Count, Count, "Papers are ready for offline study."));
        }
        finally { gate.Release(); }
    }

    private async Task DownloadOneAsync(PaperSource source, string target, CancellationToken cancellationToken)
    {
        string temporary = target + ".download-" + Guid.NewGuid().ToString("N");
        try
        {
            Uri current = source.Url;
            HttpResponseMessage? response = null;
            try
            {
                for (int redirects = 0; ; redirects++)
                {
                    response = await client.GetAsync(current, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
                    if ((int)response.StatusCode is not (301 or 302 or 303 or 307 or 308)) break;
                    Uri? location = response.Headers.Location;
                    if (redirects >= 4 || location is null) throw new HttpRequestException("The publisher redirected too many times.");
                    Uri next = location.IsAbsoluteUri ? location : new Uri(current, location);
                    if (!IsPublisherUri(next)) throw new HttpRequestException("The publisher redirected outside the official download hosts.");
                    response.Dispose();
                    response = null;
                    current = next;
                }
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength is long length && length != source.Bytes)
                    throw new InvalidDataException("The publisher file changed. Check for an updated app release.");
                await using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
                await using (Stream input = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false))
                {
                    byte[] buffer = new byte[81920];
                    long total = 0;
                    int count;
                    while ((count = await input.ReadAsync(buffer, cancellationToken).ConfigureAwait(false)) != 0)
                    {
                        total += count;
                        if (total > source.Bytes) throw new InvalidDataException("The publisher file is larger than expected.");
                        await output.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
                    }
                }
                if (!await IsValidAsync(temporary, source, cancellationToken).ConfigureAwait(false))
                    throw new InvalidDataException("The paper did not match its verified PDF checksum. Check for an updated app release.");
                File.Move(temporary, target, true);
            }
            finally { response?.Dispose(); }
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static async Task<bool> IsValidAsync(string path, PaperSource source, CancellationToken cancellationToken)
    {
        try
        {
            if (!File.Exists(path) || new FileInfo(path).Length != source.Bytes) return false;
            await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
            byte[] signature = new byte[5];
            if (await input.ReadAsync(signature, cancellationToken).ConfigureAwait(false) != 5 || !signature.AsSpan().SequenceEqual("%PDF-"u8)) return false;
            input.Position = 0;
            byte[] hash = await SHA256.HashDataAsync(input, cancellationToken).ConfigureAwait(false);
            return CryptographicOperations.FixedTimeEquals(hash, Convert.FromHexString(source.Sha256));
        }
        catch (IOException) { return false; }
    }
}
