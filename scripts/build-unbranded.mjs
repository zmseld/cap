import fs from "node:fs/promises";
import { transform } from "lightningcss";
import { minify } from "terser";
import {
  keys,
  shipped,
  shippedKeys,
  translations,
} from "../widget/src/src/i18n/translations.js";

const PACKAGE_NAME = process.env.NPM_PACKAGE_NAME || "@abdurakhman/cap-widget";
const RAW_VERSION = process.env.PACKAGE_VERSION || process.env.GITHUB_REF_NAME || "1.0.0";
const VERSION = RAW_VERSION.replace(/^v/, "");

console.log(`🔨 Building unbranded widget: ${PACKAGE_NAME}@${VERSION}...`);

const minifyCSS = (input) => {
  const { code } = transform({
    filename: "cap.css",
    code: Buffer.from(input),
    minify: true,
    targets: {
      chrome: 90 << 16,
      firefox: 90 << 16,
      safari: (14 << 16) | (1 << 8),
    },
  });
  return code.toString();
};

const minifyJS = async (input) => {
  const res = await minify(input, {
    compress: {
      drop_console: false,
      dead_code: true,
      reduce_vars: true,
    },
    output: {
      beautify: false,
      comments: false,
    },
    mangle: true,
  });
  return res.code;
};

// 1. Читаем исходные файлы
let capJs = (await fs.readFile("./widget/src/src/cap.js", "utf-8")).replace(/\r\n/g, "\n");
const capCss = await fs.readFile("./widget/src/src/cap.css", "utf-8");
const workerJs = await fs.readFile("./widget/src/src/worker.js", "utf-8");
const floatingJs = await fs.readFile("./widget/src/src/cap-floating.js", "utf-8");

// 2. Вырезаем все упоминания кредитов и принудительного отображения
capJs = capJs
  .replace(/\n\s*#credits;\n/, "\n")
  .replace(/\n\s*this\.#enforceCredits\(\);\n/, "\n")
  .replace(/\n\s*this\.#credits = document\.createElement\("a"\);[\s\S]*?this\.#div\.appendChild\(this\.#credits\);\n/, "\n")
  .replace(/\n\s*this\.#enforceCredits\(\);\n\s*setTimeout\(\(\) => this\.#enforceCredits\(\), 100\);\n/, "\n")
  .replace(/\n\s*this\.#credits\.addEventListener\("click",[\s\S]*?\}\);\n/, "\n")
  .replace(/\n\s*#enforceCredits\(\) \{[\s\S]*?\}\n\n/, "\n");

// 3. Собираем переводы
const keepIdx = shippedKeys.map((k) => keys.indexOf(k));
const i18nRows = {};
for (const code of shipped) {
  const vals = keepIdx.map((i) => translations[code][i]);
  i18nRows[code] = vals.join("/");
}

// 4. Бандлим виджет
const minifiedWorker = await minifyJS(workerJs);
const minifiedCSS = minifyCSS(capCss);

const bundle = capJs
  .replace("%%workerScript%%", () => JSON.stringify(minifiedWorker))
  .replace("%%capCSS%%", () => minifiedCSS)
  .replace("%%i18nKeys%%", () => shippedKeys.join(","))
  .replace("%%i18nData%%", () => JSON.stringify(i18nRows));

const minifiedWidget = await minifyJS(bundle);
const minifiedFloating = await minifyJS(floatingJs);

// 5. Записываем в widget/src/ для публикации в npm
await fs.writeFile("./widget/src/cap.min.js", minifiedWidget);
await fs.writeFile("./widget/src/cap-floating.min.js", minifiedFloating);

// 6. Обновляем package.json для NPM
const pkgPath = "./widget/src/package.json";
const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
pkg.name = PACKAGE_NAME;
pkg.version = VERSION;
await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`✅ Build finished successfully! Packaged as ${PACKAGE_NAME}@${VERSION}`);
