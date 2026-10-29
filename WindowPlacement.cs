using System.Drawing;

namespace TmuaDesktop;

internal static class WindowPlacement
{
    internal static Rectangle InitialBounds(Rectangle workingArea, Size preferredSize)
    {
        int width = Math.Min(preferredSize.Width, workingArea.Width);
        int height = Math.Min(preferredSize.Height, workingArea.Height);
        return new Rectangle(
            workingArea.Left + (workingArea.Width - width) / 2,
            workingArea.Top + (workingArea.Height - height) / 2,
            width, height);
    }

    internal static Size MinimumSize(Rectangle workingArea) =>
        new(Math.Min(900, workingArea.Width), Math.Min(650, workingArea.Height));
}
