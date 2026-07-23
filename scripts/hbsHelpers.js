export function registerHbsHelpers() {
  Handlebars.registerHelper("includesCI", function (haystack, needle) {
    if (!needle) return true;
    if (!haystack) return false;
    return String(haystack).toLowerCase().includes(String(needle).toLowerCase());
  });

  Handlebars.registerHelper("basename", function (path) {
    if (!path) return "";
    const stringPath = String(path);
    const parts = stringPath.split("/");
    return parts[parts.length - 1] ?? stringPath;
  });

  Handlebars.registerHelper("selectedClass", function (selectedMap, path) {
    if (!selectedMap || !path) return "";
    return selectedMap[path] ? "is-selected" : "";
  });
}
