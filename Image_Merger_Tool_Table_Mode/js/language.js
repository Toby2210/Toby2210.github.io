let currentLanguage = "zh-HK";

/**
 * Maps DOM element ids to translation keys.
 * html: use innerHTML (strings with markup); attr: set attribute instead of text.
 */
const I18N_BINDINGS = [
  { id: "title", key: "title" },
  { id: "language-label", key: "selectLanguage" },
  { id: "imagesPerRow-label", key: "imagesPerRow" },
  { id: "rowSpacing-label", key: "rowSpacing" },
  { id: "colSpacing-label", key: "colSpacing" },
  { id: "mergeAscButton", key: "mergeAsc" },
  { id: "mergeDescButton", key: "mergeDesc" },
  { id: "downloadButton", key: "download" },
  { id: "imageInput", key: "imageInputTitle", attr: "title" },
  { id: "modeImagesPerRow-label", key: "modeImagesPerRow" },
  { id: "modeTable-label", key: "modeTable" },
  { id: "tableRows-label", key: "tableRows" },
  { id: "tableCols-label", key: "tableCols" },
  { id: "tableRowSpacing-label", key: "tableRowSpacing" },
  { id: "tableColSpacing-label", key: "tableColSpacing" },
  { id: "createTableButton", key: "createTable" },
  { id: "modeSwitchMove", key: "modeSwitchMove" },
  { id: "modeSwitchResize", key: "modeSwitchResize" },
  { id: "uploadImages-label", key: "uploadImages" },
  { id: "autoFillAscButton", key: "autoFillAsc" },
  { id: "autoFillDescButton", key: "autoFillDesc" },
  { id: "clearTableButton", key: "clearTable" },
  { id: "mergeTableButton", key: "mergeTable" },
  { id: "tableImageInput", key: "selectImages", attr: "title" },
  { id: "tableDownloadButton", key: "download" },
  { id: "privacyNotice", key: "privacyNotice" },
  { id: "clearAllImagesButton", key: "clearAllImages" },
  { id: "clearAllImagesButton", key: "clearAllImagesTitle", attr: "title" },
  { id: "pasteInputLabel", key: "pasteInputTitle" },
  { id: "pasteInput", key: "pasteInputPlaceholder", attr: "placeholder" },
  { id: "pasteHint", key: "pasteHint" },
  { id: "tutorialTitle", key: "tutorialTitle" },
  { id: "step1Title", key: "step1Title", html: true },
  { id: "step1Desc", key: "step1Desc" },
  { id: "step1Item1", key: "step1Item1", html: true },
  { id: "step1Item2", key: "step1Item2", html: true },
  { id: "step1Item3", key: "step1Item3", html: true },
  { id: "step1Item4", key: "step1Item4", html: true },
  { id: "step1Action", key: "step1Action", html: true },
  { id: "step2Title", key: "step2Title", html: true },
  { id: "step2Desc", key: "step2Desc" },
  { id: "method1Title", key: "method1Title", html: true },
  { id: "method1Item1", key: "method1Item1", html: true },
  { id: "method1Item2", key: "method1Item2", html: true },
  { id: "method1Item3", key: "method1Item3", html: true },
  { id: "method1Item4", key: "method1Item4", html: true },
  { id: "method2Title", key: "method2Title", html: true },
  { id: "method2Item1", key: "method2Item1", html: true },
  { id: "method2Item2", key: "method2Item2", html: true },
  { id: "method2Item3", key: "method2Item3", html: true },
  { id: "method2Item4", key: "method2Item4", html: true },
  { id: "method2Item5", key: "method2Item5", html: true },
  { id: "step3Title", key: "step3Title", html: true },
  { id: "step3Desc", key: "step3Desc" },
  { id: "step3Item1", key: "step3Item1", html: true },
  { id: "step3Item2", key: "step3Item2", html: true },
  { id: "step3Item3", key: "step3Item3", html: true },
  { id: "step4Title", key: "step4Title", html: true },
  { id: "step4Desc", key: "step4Desc" },
  { id: "step4Item1", key: "step4Item1", html: true },
  { id: "step4Item2", key: "step4Item2", html: true },
  { id: "step4Item3", key: "step4Item3", html: true },
  { id: "step5Title", key: "step5Title", html: true },
  { id: "step5Desc", key: "step5Desc" },
  { id: "step5Item1", key: "step5Item1", html: true },
  { id: "step5Item2", key: "step5Item2", html: true },
  { id: "tip1", key: "tip1", html: true },
  { id: "tip2", key: "tip2", html: true },
  { id: "tip3", key: "tip3", html: true },
  { id: "tipHeader", key: "tipHeader", html: true },
  { id: "privacyNote", key: "privacyNote" },
  { id: "privacyHeader", key: "privacyHeader", html: true },
];

function applyI18nBinding(binding, translation) {
  const el = document.getElementById(binding.id);
  if (!el) return;
  const value = translation[binding.key];
  if (value == null) return;
  if (binding.attr) {
    el.setAttribute(binding.attr, value);
  } else if (binding.html) {
    el.innerHTML = value;
  } else {
    el.textContent = value;
  }
}

function applyLanguage(lang) {
  currentLanguage = lang;
  const translation = translations[currentLanguage];

  document.title = translation.title;
  document.documentElement.lang = currentLanguage === "zh-HK" ? "zh-HK" : "en";

  const langToggle = document.getElementById("language-toggle");
  if (langToggle) {
    langToggle.textContent = currentLanguage === "zh-HK" ? "中文" : "English";
  }

  for (const binding of I18N_BINDINGS) {
    applyI18nBinding(binding, translation);
  }

  if (typeof updateAppVersion === "function") {
    updateAppVersion(currentLanguage);
  }
}

function toggleLanguage() {
  applyLanguage(currentLanguage === "zh-HK" ? "en" : "zh-HK");
}

function initTutorialToggleIcon() {
  const details = document.getElementById("tutorialSection");
  const icon = details?.querySelector(".tutorial-toggle-btn");
  if (!details || !icon) return;

  const syncIcon = () => {
    icon.textContent = details.open ? "-" : "+";
  };
  details.addEventListener("toggle", syncIcon);
  syncIcon();
}

initTutorialToggleIcon();
