using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using TmuaDesktop;

string root = Path.Combine(args.Length > 0 ? Path.GetFullPath(args[0]) : AppContext.BaseDirectory, "tmua-native-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
int assertions = 0;
void Assert(bool condition, string label) { if (!condition) throw new Exception(label); assertions++; Console.WriteLine("PASS " + label); }
byte[] pdf = Encoding.ASCII.GetBytes("%PDF-1.7\nsynthetic fixture for download integrity checks\n%%EOF");
string hash = Convert.ToHexString(SHA256.HashData(pdf)).ToLowerInvariant();
string Manifest(string name, string path = "papers/test.pdf", string? checksum = null, string? url = null)
{
    string file = Path.Combine(root, name + ".json");
    File.WriteAllText(file, JsonSerializer.Serialize(new { sources = new[] { new { label = "Test paper", path, sha256 = checksum ?? hash,
        bytes = pdf.Length, url = url ?? "https://uat-wp.s3.eu-west-2.amazonaws.com/test.pdf" } } }));
    return file;
}
var progress = new InlineProgress();
try
{
    var handler = new Handler((_, _) => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(pdf) });
    using var http = new HttpClient(handler);
    var store = new PaperStore(Manifest("valid"), Path.Combine(root, "papers"), http);
    Assert(!await store.IsReadyAsync(), "empty profile needs setup");
    await store.DownloadAsync(progress, CancellationToken.None);
    Assert(await store.IsReadyAsync(), "download matches PDF signature, length and checksum");
    Assert(handler.Calls == 1, "one request for one missing paper");
    Assert(progress.Events.Last().State == "complete", "completion is reported");
    await store.DownloadAsync(progress, CancellationToken.None);
    Assert(handler.Calls == 1, "verified cached paper causes no request");
    byte[] damaged = (byte[])pdf.Clone(); damaged[20] ^= 1;
    await File.WriteAllBytesAsync(Path.Combine(root, "papers", "test.pdf"), damaged);
    Assert(!await store.IsReadyAsync(), "same-size corruption is detected");
    await store.DownloadAsync(progress, CancellationToken.None);
    Assert(await store.IsReadyAsync() && handler.Calls == 2, "same-size corrupt paper repaired");
    Assert(!Directory.EnumerateFiles(Path.Combine(root, "papers"), "*.download-*").Any(), "no partial files after success");
    foreach (string path in new[] { "papers/../escape.pdf", "papers/sub/test.pdf", "papers/drive:test.pdf" })
    {
        bool rejected = false; try { _ = new PaperStore(Manifest(Guid.NewGuid().ToString("N"), path), Path.Combine(root, "bad")); }
        catch (InvalidDataException) { rejected = true; }
        Assert(rejected, "reject unsafe manifest path " + path);
    }
    bool hostRejected = false;
    try { _ = new PaperStore(Manifest("bad-host", url: "https://example.org/test.pdf"), Path.Combine(root, "bad-host")); }
    catch (InvalidDataException) { hostRejected = true; }
    Assert(hostRejected, "only official HTTPS source hosts accepted");
    var retryHandler = new Handler((call, _) => call == 1 ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) :
        new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(pdf) });
    using var retryHttp = new HttpClient(retryHandler);
    var retryStore = new PaperStore(Manifest("retry"), Path.Combine(root, "retry"), retryHttp);
    await retryStore.DownloadAsync(progress, CancellationToken.None);
    Assert(await retryStore.IsReadyAsync() && retryHandler.Calls == 2, "temporary HTTP failure retries successfully");
    var badHandler = new Handler((_, _) => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(damaged) });
    using var badHttp = new HttpClient(badHandler);
    var badStore = new PaperStore(Manifest("bad-content"), Path.Combine(root, "bad-content"), badHttp);
    bool integrityRejected = false;
    try { await badStore.DownloadAsync(progress, CancellationToken.None); } catch (InvalidDataException) { integrityRejected = true; }
    Assert(integrityRejected && !await badStore.IsReadyAsync(), "checksum mismatch never becomes ready");
    Assert(badHandler.Calls == 1, "checksum mismatch stops immediately");
    Assert(!Directory.EnumerateFiles(Path.Combine(root, "bad-content")).Any(), "failed verification cleans partial downloads");
    var failureHandler = new Handler((_, _) => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
    using var failureHttp = new HttpClient(failureHandler);
    var failureStore = new PaperStore(Manifest("failure"), Path.Combine(root, "failure"), failureHttp);
    bool failure = false;
    try { await failureStore.DownloadAsync(progress, CancellationToken.None); } catch (HttpRequestException) { failure = true; }
    Assert(failure && failureHandler.Calls == 3, "HTTP retries are bounded at three requests");
    var redirectHandler = new Handler((_, _) => { var response = new HttpResponseMessage(HttpStatusCode.Redirect); response.Headers.Location = new Uri("https://example.org/test.pdf"); return response; });
    using var redirectHttp = new HttpClient(redirectHandler);
    var redirectStore = new PaperStore(Manifest("redirect"), Path.Combine(root, "redirect"), redirectHttp);
    bool redirectRejected = false;
    try { await redirectStore.DownloadAsync(progress, CancellationToken.None); } catch (HttpRequestException) { redirectRejected = true; }
    Assert(redirectRejected && redirectHandler.Urls.All(uri => uri.Host == "uat-wp.s3.eu-west-2.amazonaws.com"), "redirect cannot request outside official hosts");
    using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
    bool cancelled = false; try { await store.DownloadAsync(progress, cancellation.Token); } catch (OperationCanceledException) { cancelled = true; }
    Assert(cancelled, "cancelled setup stops without downloading");
    Console.WriteLine($"{assertions} native assertions passed.");
}
finally { Directory.Delete(root, true); }

sealed class Handler(Func<int, Uri, HttpResponseMessage> respond) : HttpMessageHandler
{
    public int Calls;
    public List<Uri> Urls { get; } = [];
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    { cancellationToken.ThrowIfCancellationRequested(); Urls.Add(request.RequestUri!); return Task.FromResult(respond(++Calls, request.RequestUri!)); }
}
sealed class InlineProgress : IProgress<DownloadProgress>
{
    public List<DownloadProgress> Events { get; } = [];
    public void Report(DownloadProgress value) { lock (Events) Events.Add(value); }
}
