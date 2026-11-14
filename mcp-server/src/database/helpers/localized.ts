/**
 * Strip tags from Civ 5 localization strings.
 */
export function stripTags(Text: string): string
export function stripTags(Text?: string) {
    if (!Text) return undefined;
    Text = Text.replaceAll("[ICON_BULLET]", "* ");
    Text = Text.replaceAll("[NEWLINE]", "\n");
    Text = Text.replaceAll("[SPACE]", " ");
    Text = Text.replaceAll("[TAB]", " ");
    Text = Text.replaceAll("[ENDCOLOR]", "");
    Text = Text.replaceAll(/\[LINK=(.*?)\]/g, "");
    Text = Text.replaceAll("[\\LINK]", "");
    Text = Text.replaceAll(/\[ICON_([A-Z0-9)_]*?)\]/g, "");
    Text = Text.replaceAll(/\[COLOR_([A-Z_]*?)\]/g, "");
    Text = Text.replaceAll(/\n+/g, "\n");
    Text = Text.replaceAll(/[ ]+/g, " ");

    return Text;
}