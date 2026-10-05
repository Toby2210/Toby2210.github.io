/** Bump when releasing user-visible changes. */
const APP_VERSION = "1.0.0";

function updateAppVersion(lang) {
  const el = document.getElementById("appVersion");
  if (!el) return;
  const label = lang === "en" ? "Version" : "版本";
  el.textContent = `${label} ${APP_VERSION}`;
}

updateAppVersion("zh-HK");
