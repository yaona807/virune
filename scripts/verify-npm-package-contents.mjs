import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execNpmSync } from './npm-cli.mjs';

const PLAN_PATH = '.github/release/npm-publication-v1.json';
const FORBIDDEN_SEGMENTS = new Set(['.git', '.github', '.cache', '__tests__', 'coverage', 'fixtures', 'test', 'tests']);
const FORBIDDEN_BASENAMES = new Set([
  '.env',
  '.npmrc',
  'credentials.json',
  'id_ed25519',
  'id_rsa',
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.tsbuildinfo',
  'yarn.lock',
]);

export function verifyNpmPackageContents(root = process.cwd(), options = {}) {
  const plan = readJson(resolve(root, PLAN_PATH));
  const rootManifest = readJson(resolve(root, 'package.json'));
  const plannedPackages = array(plan.packages, '$.packages')
    .map((value, index) => plannedPackage(value, `$.packages[${index}]`))
    .sort((left, right) => compareText(left.directory, right.directory));
  assert(plannedPackages.length > 0, '$.packages', 'at least one registry package is required');
  assertUnique(plannedPackages.map(item => item.directory), '$.packages', 'directory');
  assertUnique(plannedPackages.map(item => item.registryName), '$.packages', 'registryName');
  const version = nonEmptyString(rootManifest.version, '$root.version');
  const packDryRun = options.packDryRun ?? runPackDryRun;
  const packages = [];

  for (const item of plannedPackages) {
    const manifest = readJson(resolve(root, 'packages', item.directory, 'package.json'));
    assert(manifest.name === item.registryName, `$.packages.${item.directory}.registryName`, `expected package name ${manifest.name}`);
    assert(manifest.version === version, `$.${item.directory}.version`, `must match root version ${version}`);
    const packResult = normalizePackResult(packDryRun({ root, directory: item.directory }), item.directory);
    packages.push(auditPackResult(item, manifest, packResult));
  }

  return {
    schemaVersion: 1,
    stage: 'prepublication-package-contents-audit',
    version,
    packageCount: packages.length,
    packages,
  };
}

function runPackDryRun({ root, directory }) {
  const output = execNpmSync(
    ['pack', '--dry-run', '--json', '--ignore-scripts', `./packages/${directory}`],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return output;
}

function normalizePackResult(value, directory) {
  if (Buffer.isBuffer(value) || typeof value === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(String(value));
    } catch (error) {
      throw new Error(`$.${directory}.npmPack: invalid JSON output: ${error instanceof Error ? error.message : String(error)}`);
    }
    assert(Array.isArray(parsed) && parsed.length === 1, `$.${directory}.npmPack`, 'expected exactly one npm pack result');
    return record(parsed[0], `$.${directory}.npmPackk0]`);
  }
  return record(value, `$.${directory}.npmPack`);
}

function auditPackResult(item, manifest, result) {
  assert(result.name === manifest.name, `$.${item.directory}.npmPack.name`, `expected ${manifest.name}`);
  assert(result.version === manifest.version, `$.${item.directory}.npmPack.version`, `expected ${manifest.version}`);
  const bundled = array(result.bundled, `$.${item.directory}.npmPack.bundled`);
  assert(bundled.length === 0, `$.${item.directory}.npmPack.bundled`, 'registry package dry-run must not bundle dependencies');
  const packedFiles = array(result.files, `$.${item.directory}.npmPack.files`)
    .map((value, index) => packedFile(value, `$.${item.directory}.npmPack.files[${index}]`));
  assert(packedFiles.length > 0, `$.${item.directory}.npmPack.files`, 'npm pack dry-run must contain files');
  assertUnique(packedFiles.map(file => file.path), `$.${item.directory}.npmPackk.files`, 'path');
  if (result.entryCount !== undefined) {
    assert(result.e[žPÛÝ[OOHXÚÙYš[\Ë›[™Ý	‰Ú][K™\™XÝÜž_K›œTXÚË™[žPÛÝ[	Û]\Ý\]X[š[\È[™Ý	ÊNÂˆB‚ˆÛÛœÝ[\ÈH\œ˜^JX[šY™\Ý™š[\Ë	‰Ú][K™\™XÝÜž_K™š[\Ø
Bˆ›X\

˜[YK[™^
HOˆX[šY™\Ýš[T[J˜[YK	‰Ú][K™\™XÝÜž_K™š[\ÖÉÚ[™^WX
JNÂˆ\ÜÙ\
[\Ë›[™Ýˆ	‰Ú][K™\™XÝÜž_K™š[\Ø	Ùš[\È[ÝÛ\Ý\È™\]Z\™Y	ÊNÂˆ\ÜÙ\[š\]YJ[\Ë	‰Ú][K™\™XÝÜž_K™š[\Ø	Ùš[H[IÊNÂ‚ˆÛÛœÝ]ÈHXÚÙYš[\Ë›X\
š[HOˆš[Kœ]
KœÛÜ
ÛÛ\\™U^
NÂˆ\ÜÙ\
]Ëš[˜ÛY\Ê	ÜXÚØYÙKšœÛÛ‰ÊK	‰Ú][K™\™XÝÜž_K›œTXÚË™š[\Ø	ÜXÚØYÙKšœÛÛˆ\È™\]Z\™Y	ÊNÂˆ›Üˆ
ÛÛœÝ]Ùˆ]ÊHÂˆ\ÜÙ\
ˆ]OOH	ÜXÚØYÙKšœÛÛ‰È[\ËœÛÛYJ[HOˆX]Ú\Ô[J][JJKˆ	‰Ú][K™\™XÝÜž_K›œTXÚË™š[\Øˆ[›™^XÝYš[HÝ]ÚYHXÚØYÙKšœÛÛˆš[\È[ÝÛ\Ýˆ	Ü]Xˆ
NÂˆ\ÜÙ\ØY™TXÚÙY]
]][K™\™XÝÜžJNÂˆBˆ›Üˆ
ÛÛœÝ[HÙˆ[\ÊHÂˆ\ÜÙ\
ˆ]ËœÛÛYJ]OˆX]Ú\Ô[J][JJKˆ	‰Ú][K™\™XÝÜž_K™š[\Øˆ[ÝÛ\Ý[žHÙ\È›ÝÙ[XÝ[žHXÚÙYš[Nˆ	Ü[_Xˆ
NÂˆB‚ˆ›Üˆ
ÛÛœÝ\™Ù]ÙˆÛÛXÝX[šY™\Ý\™Ù]ÊX[šY™\Ý™^ÜË	‰Ú][K™\™XÝÜž_K™^ÜØ
JHÂˆ\ÜÙ\\™Ù]XÚÙY
]Ë\™Ù]	‰Ú][K™\™XÝÜž_K™^ÜØ
NÂˆBˆYˆ
X[šY™\Ý˜š[ˆOOH[™Yš[™Y
HÂˆYˆ
\[ÙˆX[šY™\Ý˜š[ˆOOH	ÜÝš[™ÉÊHÂˆ\ÜÙ\\™Ù]XÚÙY
]ËX[šY™\Ý˜š[‹	‰Ú][K™\™XÝÜž_K˜š[˜
NÂˆH[ÙHÂˆÛÛœÝš[œÈH™XÛÜ™
X[šY™\Ý˜š[‹	‰Ú][K™\™XÝÜž_K˜š[˜
NÂˆ›Üˆ
ÛÛœÝÛ˜[YK\™Ù]HÙˆØš™XÝ™[šY\Êš[œÊJHÂˆ\ÜÙ\\™Ù]XÚÙY
]Ë\™Ù]	‰Ú][K™\™XÝÜž_K˜š[‹‰Û˜[Y_X
NÂˆBˆBˆB‚ˆÛÛœÝš[TÙ]ÚLMˆHÜ™X]R\Ú
	ÜÚLM‰ÊK\]J	Ü]Ëš›Ú[Š	×‰Ê_W˜
K™YÙ\Ý
	Ú^	ÊNÂˆÛÛœÝ[œXÚÙYž]\ÈHXÚÙYš[\Ëœ™YXÙJ
Ý[š[JHOˆÝ[
Èš[KœÚ^™K
NÂˆ™]\›ˆÂˆ\™XÝÜžNˆ][K™\™XÝÜžKˆ™YÚ\ÝžS˜[YNˆ][Kœ™YÚ\ÝžS˜[YKˆš[PÛÝ[ˆ]Ë›[™Ýˆš[TÙ]ÚLM‹ˆ[œXÚÙYž]\ËˆNÂŸB‚™[˜Ý[Ûˆ[›™YXÚØYÙJ˜[YK]
HÂˆÛÛœÝ][HH™XÛÜ™
˜[YK]
NÂˆ™]\›ˆÂˆ\™XÝÜžNˆY[YšY\Š][K™\™XÝÜžK	Ü]K™\™XÝÜžX
Kˆ™YÚ\ÝžS˜[YNˆXÚØYÙS˜[YJ][Kœ™YÚ\ÝžS˜[YK	Ü]Kœ™YÚ\ÝžS˜[YX
KˆNÂŸB‚™[˜Ý[ÛˆXÚÙYš[J˜[YK]
HÂˆÛÛœÝ][HH™XÛÜ™
˜[YK]
NÂˆÛÛœÝš[T]HØ[›ÛšXØ[™[]]™T]
][Kœ]	Ü]Kœ]
NÂˆ\ÜÙ\
[X™\‹š\Ò[YÙ\Š][KœÚ^™JH	‰ˆ][KœÚ^™HH	Ü]KœÚ^™X	Ù^XÝYH›Û‹[™YØ]]™H[YÙ\‰ÊNÂˆ™]\›ˆÈ]ˆš[T]Ú^™Nˆ][KœÚ^™HNÂŸB‚™[˜Ý[ÛˆX[šY™\Ýš[T[J˜[YK]
HÂˆÛÛœÝ[HHØ[›ÛšXØ[™[]]™T]
˜[YK]
NÂˆ\ÜÙ\
KÖÏË×WKÝK\Ý
[JK]	ÙÛØ˜™Yš[\È[šY\È\™H›ÝÝ\ÜYžHHÝ\œ™[]Y]ÛÛ˜XÝ	ÊNÂˆ™]\›ˆ[Kœ™\XÙJ×ÉÝK	ÉÊNÂŸB‚™[˜Ý[ÛˆØ[›ÛšXØ[™[]]™T]
˜[YK]
HÂˆÛÛœÝ^H›Û‘[\TÝš[™Ê˜[YK]
NÂˆ\ÜÙ\
]^š[˜ÛY\Ê	×	ÊK]	Ø˜XÚÜÛ\Ú\È\™H›ÝØ[›ÛšXØ[XÚØYÙH]ÊNÂˆ\ÜÙ\
]^œÝ\ÕÚ]
	ËÉÊK]	ØXœÛÛ]HXÚØYÙH]È\™H›Ü˜šY[‰ÊNÂˆÛÛœÝ›Ü›X[^™YHÜÚ^››Ü›X[^™J^
NÂˆ\ÜÙ\
›Ü›X[^™YOOH^]	ÜXÚØYÙH]]\Ý[™XYH™H›Ü›X[^™Y	ÊNÂˆ\ÜÙ\
^OOH	Ë‰È	‰ˆ^OOH	Ë‹‰È	‰ˆ]^œÝ\ÕÚ]
	Ë‹‹ÉÊK]	ÜXÚØYÙH]˜]™\œØ[\È›Ü˜šY[‰ÊNÂˆ™]\›ˆ^ÂŸB‚™[˜Ý[ÛˆX]Ú\Ô[J][JHÂˆ™]\›ˆ]OOH[H]œÝ\ÕÚ]
	Ü[_KØ
NÂŸB‚™[˜Ý[Ûˆ\ÜÙ\ØY™TXÚÙY]
]\™XÝÜžJHÂˆÛÛœÝÝÙ\ˆH]ÓÝÙ\Ø\ÙJ
NÂˆÛÛœÝÙYÛY[ÈHÝÙ\‹œÜ]
	ËÉÊNÂˆÛÛœÝ˜\Ù[˜[YHHÙYÛY[Ë˜]
LJHÏÈ	ÉÎÂˆ›Üˆ
ÛÛœÝÙYÛY[ÙˆÙYÛY[ÊHÂˆ\ÜÙ\
Q“Ô’QS—ÔÑQÓQS•Ëš\ÊÙYÛY[
K	‰Ù\™XÝÜž_K›œTXÚË™š[\Ø]™[ÜY[[Û›H]\È›Ü˜šY[Žˆ	Ü]X
NÂˆBˆ\ÜÙ\
Q“Ô’QS—ÐTÑSSQTËš\Ê˜\Ù[˜[YJK	‰Ù\™XÝÜž_K›œTXÚË™š[\ØYÚ\š\ÚÈ]™[ÜY[ÜˆÜ™Y[X[š[H\È›Ü˜šY[Žˆ	Ü]X
NÂˆ\ÜÙ\
K×ŠÎœ[_LŸžÙ^JIÚ]K\Ý
˜\Ù[˜[YJK	‰Ù\™XÝÜž_K›œTXÚË™š[\ØÜ™Y[X[[ZÙHš[H\È›Ü˜šY[Žˆ	Ü]X
NÂˆ\ÜÙ\
K×ŠÎ\ÝÜXÊWŠÎ–ØÛWOÖÚ\Þß–ØÛWOÝßœ×›X\
IÚ]K\Ý
˜\Ù[˜[YJK	‰Ù\™XÝÜž_K›œTXÚË™š[\Ø\Ý\Y˜XÝ\È›Ü˜šY[Žˆ	Ü]X
NÂˆYˆ
×ŠÎßÞ]ßÝÊIÚ]K\Ý
˜\Ù[˜[YJJHÂˆ\ÜÙ\
×™ŠÎß]ßÝÊIÚ]K\Ý
˜\Ù[˜[YJK	‰Ù\™XÝÜž_K›œTXÚË™š[\Ø˜]È\TØÜš\ÛÝ\˜ÙH\È›Ü˜šY[Žˆ	Ü]X
NÂˆBŸB‚™[˜Ý[ÛˆÛÛXÝX[šY™\Ý\™Ù]Ê˜[YK]™\Ý[H×JHÂˆYˆ
˜[YHOOH[™Yš[™Y˜[YHOOH[
H™]\›ˆ™\Ý[ÂˆYˆ
\[Ùˆ˜[YHOOH	ÜÝš[™ÉÊHÂˆ™\Ý[œ\Ú
˜[YJNÂˆ™]\›ˆ™\Ý[ÂˆBˆYˆ
\œ˜^Kš\Ð\œ˜^J˜[YJJHÂˆ›Üˆ
][™^HÈ[™^˜[YK›[™ÝÈ[™^
ÏHJHÛÛXÝX[šY™\Ý\™Ù]Ê˜[YVÚ[™^K	Ü]VÉÚ[™^WX™\Ý[
NÂˆ™]\›ˆ™\Ý[ÂˆBˆÛÛœÝ][HH™XÛÜ™
˜[YK]
NÂˆ›Üˆ
ÛÛœÝÚÙ^K™\ÝYHÙˆØš™XÝ™[šY\Ê][JJHÛÛXÝX[šY™\Ý\™Ù]Ê™\ÝY	Ü]K‰ÚÙ^_X™\Ý[
NÂˆ™]\›ˆ™\Ý[ÂŸB‚™[˜Ý[Ûˆ\ÜÙ\\™Ù]XÚÙY
]Ë˜[YK]
HÂˆÛÛœÝ\™Ù]H›Û‘[\TÝš[™Ê˜[YK]
NÂˆ\ÜÙ\
\™Ù]œÝ\ÕÚ]
	Ë‹ÉÊK]	ÜXÚØYÙH\™Ù]]\Ý™H™[]]™H[™Ý\Ú]‹ÉÊNÂˆ\ÜÙ\
]\™Ù]š[˜ÛY\Ê	Ê‰ÊK]	ÝÚ[Ø\™XÚØYÙH\™Ù]È™\]Z\™H^XÚ]]Y]Ý\Ü	ÊNÂˆÛÛœÝXÚÙY]HØ[›ÛšXØ[™[]]™T]
\™Ù]œÛXÙJŠK]
NÂˆ\ÜÙ\
]Ëš[˜ÛY\ÊXÚÙY]
K]\™Ù]\ÈZ\ÜÚ[™Èœ›ÛHœHXÚÈÛÛ[Îˆ	Ý\™Ù]X
NÂŸB‚™[˜Ý[Ûˆ™XYœÛÛŠ]
HÂˆ™]\›ˆ”ÓÓ‹œ\œÙJ™XYš[TÞ[˜Ê]	Ý]Ž	ÊJNÂŸB™[˜Ý[Ûˆ\œ˜^J˜[YK]
HÂˆ\ÜÙ\
\œ˜^Kš\Ð\œ˜^J˜[YJK]	Ù^XÝY[ˆ\œ˜^IÊNÂˆ™]\›ˆ˜[YNÂŸB™[˜Ý[Ûˆ™XÛÜ™
˜[YK]
HÂˆ\ÜÙ\
˜[YHOOH[	‰ˆ\[Ùˆ˜[YHOOH	ÛØš™XÝ	È	‰ˆP\œ˜^Kš\Ð\œ˜^J˜[YJK]	Ù^XÝY[ˆØš™XÝ	ÊNÂˆ™]\›ˆ˜[YNÂŸB™[˜Ý[Ûˆ›Û‘[\TÝš[™Ê˜[YK]
HÂˆ\ÜÙ\
\[Ùˆ˜[YHOOH	ÜÝš[™ÉÈ	‰ˆ˜[YKš[J
K›[™Ýˆ]	Ù^XÝYH›Û‹Y[\H›Û‹]Ú]\ÜXÙHÝš[™ÉÊNÂˆ™]\›ˆ˜[YNÂŸB™[˜Ý[ÛˆY[YšY\Š˜[YK]
HÂˆÛÛœÝ^H›Û‘[\TÝš[™Ê˜[YK]
NÂˆ\ÜÙ\
×–ØK^ŒNWVØK^ŒNKWJ‰ÝK\Ý
^
K]	Ú[˜[YXÚØYÙH\™XÝÜžIÊNÂˆ™]\›ˆ^ÂŸB™[˜Ý[ÛˆXÚØYÙS˜[YJ˜[YK]
HÂˆÛÛœÝ˜[YHH›Û‘[\TÝš[™Ê˜[YK]
NÂˆ\ÜÙ\
×ŠÎØK^ŒNWVØK^ŒNK—ËWJ—ÖØK^ŒNWVØK^ŒNK—ËWJŸØK^ŒNWVØK^ŒNK—ËWJŠIÝK\Ý
˜[YJK]	Ú[˜[YœHXÚØYÙH˜[YIÊNÂˆ™]\›ˆ˜[YNÂŸB™[˜Ý[Ûˆ\ÜÙ\[š\]YJ˜[Y\Ë]˜[YJHÂˆÛÛœÝÙY[ˆH™]ÈÙ]

NÂˆ›Üˆ
ÛÛœÝ˜[YHÙˆ˜[Y\ÊHÂˆ\ÜÙ\
\ÙY[‹š\Ê˜[YJK]\XØ]H	Û˜[Y_H	Ý˜[Y_X
NÂˆÙY[‹˜Y
˜[YJNÂˆBŸB™[˜Ý[Ûˆ\ÜÙ\
ÛÛ™][Û‹]Y\ÜØYÙJHÂˆYˆ
XÛÛ™][ÛŠH›ÝÈ™]È\œ›ÜŠ	Ü]Nˆ	ÛY\ÜØYÙ_X
NÂŸB™[˜Ý[ÛˆÛÛ\\™U^
YšYÚ
HÂˆ™]\›ˆYšYÚÈLHˆYˆšYÚÈHˆÂŸB‚˜ÛÛœÝ\™Ý”]H›ØÙ\ÜË˜\™Ý–ÌWNÂšYˆ
\™Ý”]OOH[™Yš[™Y	‰ˆ[\Ü›Y]K\›OOH]Ñš[UT“
™\ÛÛ™J\™Ý”]
JKš™YŠHÂˆÛÛœÝ™\Ý[H™\šYžSœTXÚØYÙPÛÛ[Ê
NÂˆ›ØÙ\ÜËœÝÝ]Üš]J	Ò”ÓÓ‹œÝš[™ÚYžJ™\Ý[[Š_W˜
NÂŸB