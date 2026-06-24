import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// 把 package.json 的版本号同步写入 manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// 在 versions.json 中登记 目标版本 -> minAppVersion（已存在则不重复写）
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!(targetVersion in versions)) {
  versions[targetVersion] = minAppVersion;
  writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
}
