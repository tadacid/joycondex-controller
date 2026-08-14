import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [iconsetPath, outputPath] = process.argv.slice(2);
if (!iconsetPath || !outputPath) {
  throw new Error("usage: node scripts/build-launcher-icon.mjs <iconset> <output.icns>");
}

const representations = [
  ["icp4", "icon_16x16.png"],
  ["icp5", "icon_32x32.png"],
  ["icp6", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic08", "icon_256x256.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"]
];

const chunks = [];
for (const [type, fileName] of representations) {
  const image = await readFile(join(iconsetPath, fileName));
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(image.length + 8, 4);
  chunks.push(header, image);
}

const body = Buffer.concat(chunks);
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(body.length + 8, 4);
await writeFile(outputPath, Buffer.concat([header, body]));
