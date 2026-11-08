/**
 * CLI 身份。单独成文件，避免为了让 main 认识版本号而去 import package.json。
 *
 * 这个数是 `--version` 与 `--help` 首行**打给用户看**的，所以它写错就等于对外说谎。
 * 它曾长期停在 0.1.0 而产物已是 0.7.0 —— 正因为 `check-version.mjs` 当时只查四份
 * package.json，这一处是唯一的漏网点。现在由那个门直接读本文件钉住。
 */
export const CLI_NAME = 'photo';
export const CLI_VERSION = '0.7.0';
