using System.Globalization;
using System.Text.RegularExpressions;

namespace TmuaDesktop;

internal static class DocumentTitles
{
    internal static string FromUri(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out Uri? uri)) return "TMUA — Document";
        string name = Uri.UnescapeDataString(Path.GetFileNameWithoutExtension(uri.AbsolutePath));
        Match question = Regex.Match(name,
            @"^(?<year>20\d{2}|specimen)-p(?<paper>[12])-q(?<number>\d+)(?:-(?<part>\d+))?$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (question.Success)
        {
            string year = question.Groups["year"].Value.Equals("specimen", StringComparison.OrdinalIgnoreCase)
                ? "Specimen" : question.Groups["year"].Value;
            string title = $"TMUA — {year} Paper {question.Groups["paper"].Value} Question {question.Groups["number"].Value}";
            string part = question.Groups["part"].Value;
            return int.TryParse(part, out int partNumber) && partNumber > 1 ? title + $" · Part {partNumber}" : title;
        }
        name = Regex.Replace(name, @"^TMUA[-_\s]*", "", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        name = Regex.Replace(name.Replace('-', ' ').Replace('_', ' '), @"\s+", " ").Trim();
        return name.Length == 0 ? "TMUA — Document" : "TMUA — " + CultureInfo.InvariantCulture.TextInfo.ToTitleCase(name);
    }
}
