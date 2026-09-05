/** Friendly labels for Windows process names and browser URLs. */

const APP_ALIASES: Record<string, string> = {
  "msedge.exe": "Microsoft Edge",
  "chrome.exe": "Google Chrome",
  "firefox.exe": "Firefox",
  "brave.exe": "Brave",
  "opera.exe": "Opera",
  "code.exe": "Visual Studio Code",
  "cursor.exe": "Cursor",
  "windowsterminal.exe": "Windows Terminal",
  "windowsterminal": "Windows Terminal",
  "powershell.exe": "PowerShell",
  "cmd.exe": "Command Prompt",
  "explorer.exe": "File Explorer",
  "searchhost.exe": "Windows Search",
  "startmenuexperiencehost.exe": "Start Menu",
  "shellexperiencehost.exe": "Windows Shell",
  "applicationframehost.exe": "Windows App",
  "systemsettings.exe": "Settings",
  "taskmgr.exe": "Task Manager",
  "chatgpt.exe": "ChatGPT",
  "slack.exe": "Slack",
  "discord.exe": "Discord",
  "telegram.exe": "Telegram",
  "notion.exe": "Notion",
  "figma.exe": "Figma",
  "spotify.exe": "Spotify",
  "zoom.exe": "Zoom",
  "teams.exe": "Microsoft Teams",
  "outlook.exe": "Outlook",
  "winword.exe": "Word",
  "excel.exe": "Excel",
  "powerpnt.exe": "PowerPoint",
  "docker desktop.exe": "Docker Desktop",
  "docker desktop": "Docker Desktop",
  "rize.exe": "Rize",
  "autotrace.exe": "AutoTrace",
  "devenv.exe": "Visual Studio",
  "idea64.exe": "IntelliJ IDEA",
  "webstorm64.exe": "WebStorm",
  "notepad.exe": "Notepad",
  "notepad++.exe": "Notepad++",
};

const BROWSER_EXES = new Set([
  "msedge.exe",
  "chrome.exe",
  "firefox.exe",
  "brave.exe",
  "opera.exe",
]);

export function stripExe(name: string): string {
  return name.replace(/\.exe$/i, "").trim();
}

export function friendlyAppName(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (APP_ALIASES[key]) return APP_ALIASES[key];
  const noExe = stripExe(raw);
  const noExeKey = noExe.toLowerCase();
  if (APP_ALIASES[noExeKey]) return APP_ALIASES[noExeKey];
  // Title-case leftover process names
  if (/^[a-z0-9 ._+-]+$/i.test(noExe) && noExe.includes(" ")) {
    return noExe;
  }
  return noExe
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const trimmed = url.trim();
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const host = new URL(withScheme).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    const host = url
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      ?.replace(/^www\./, "");
    return host || null;
  }
}

export function isBrowserApp(appName: string): boolean {
  return BROWSER_EXES.has(appName.trim().toLowerCase());
}

/** Prefer website domain for browsers when URL exists; else friendly app name. */
export function activityDisplayLabel(
  appName: string,
  url?: string | null,
): string {
  if (isBrowserApp(appName)) {
    const domain = domainFromUrl(url);
    if (domain) return domain;
  }
  return friendlyAppName(appName);
}

export function appInitials(label: string): string {
  const clean = label.replace(/\.(exe|com|io|app|dev)$/i, "");
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || "?";
}

export function formatTimeAmPm(iso: string): string {
  const raw = iso.includes("T") ? iso : iso.replace(" ", "T");
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const t = iso.includes("T") ? iso.split("T")[1] : iso;
    return t?.slice(0, 8) ?? iso;
  }
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}
