import { Matrix, SVD } from 'ml-matrix';

const orderedCorners = [
  { x: 512, y: 512 },
  { x: 1536, y: 512 },
  { x: 1536, y: 1536 },
  { x: 512, y: 1536 }
];
const srcCorners = [
  { x: 0, y: 0 },
  { x: 1024, y: 0 },
  { x: 1024, y: 1024 },
  { x: 0, y: 1024 }
];

function normalizePoints(pts) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length; my /= pts.length;
  let dsum = 0;
  for (const p of pts) dsum += Math.hypot(p.x - mx, p.y - my);
  const mean = dsum / pts.length;
  const s = mean > 1e-9 ? Math.SQRT2 / mean : 1;
  return { s, tx: -s * mx, ty: -s * my };
}
function applyTransform(T, p) { return { x: T.s * p.x + T.tx, y: T.s * p.y + T.ty }; }
function inverseTransform(T) { const i = 1 / T.s; return { s: i, tx: -T.tx * i, ty: -T.ty * i }; }

function solve8x8(A, b) {
  const n = 8;
  const M = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n + 1);
    for (let j = 0; j < n; j++) row[j] = A[i][j];
    row[n] = b[i];
    M.push(row);
  }
  for (let col = 0; col < n; col++) {
    let pivRow = col, piv = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > piv) { piv = v; pivRow = r; }
    }
    if (piv < 1e-14) return solveByPseudoInverse(A, b);
    if (pivRow !== col) { const tmp = M[col]; M[col] = M[pivRow]; M[pivRow] = tmp; }
    const pv = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) M[r][j] -= factor * M[col][j];
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n];
  return x;
}
function solveByPseudoInverse(A, b) {
  const n = A.length;
  const mu = 1e-6;
  const AtA = Array.from({ length: n }, () => new Array(n).fill(0));
  const Atb = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0; for (let k = 0; k < n; k++) s += A[k][i] * A[k][j];
      AtA[i][j] = s;
    }
    let s = 0; for (let k = 0; k < n; k++) s += A[k][i] * b[k];
    Atb[i] = s;
  }
  for (let i = 0; i < n; i++) AtA[i][i] += mu;
  return solve8x8(AtA, Atb);
}

function computeHomography(src, dst) {
  const Tsrc = normalizePoints(src);
  const Tdst = normalizePoints(dst);
  const nSrc = src.map(p => applyTransform(Tsrc, p));
  const nDst = dst.map(p => applyTransform(Tdst, p));
  const B = [], rhs = [];
  for (let i = 0; i < 4; i++) {
    const x = nSrc[i].x, y = nSrc[i].y;
    const u = nDst[i].x, v = nDst[i].y;
    B.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.push(u);
    B.push([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.push(v);
  }
  const h = solve8x8(B, rhs);
  const H9 = [...h, 1.0];
  return denormalize(Tsrc, Tdst, H9);
}
function denormalize(Tsrc, Tdst, H9) {
  const Ti = inverseTransform(Tdst);
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H9;
  const Ts = Tsrc.s, ttx = Tsrc.tx, tty = Tsrc.ty;
  const m = [
    h0 * Ts, h1 * Ts, h0 * ttx + h1 * tty + h2,
    h3 * Ts, h4 * Ts, h3 * ttx + h4 * tty + h5,
    h6 * Ts, h7 * Ts, h6 * ttx + h7 * tty + h8,
  ];
  const a = Ti.s, btx = Ti.tx, bty = Ti.ty;
  const H = [
    a * m[0], a * m[1], a * m[2] + btx * m[8],
    a * m[3], a * m[4], a * m[5] + bty * m[8],
    m[6],      m[7],      m[8],
  ];
  const sc = H[8];
  if (Math.abs(sc) < 1e-12) return H;
  return H.map(v => v / sc);
}

function verify(name, H, src, dst) {
  console.log(`\n=== ${name} ===`);
  console.log('H =', H.map(v => v.toFixed(4)));
  let totalE = 0, maxE = 0;
  for (let i = 0; i < 4; i++) {
    const [x, y] = [src[i].x, src[i].y];
    const denom = H[6] * x + H[7] * y + H[8];
    const uPred = (H[0] * x + H[1] * y + H[2]) / denom;
    const vPred = (H[3] * x + H[4] * y + H[5]) / denom;
    const err = Math.hypot(dst[i].x - uPred, dst[i].y - vPred);
    totalE += err;
    if (err > maxE) maxE = err;
    console.log(` 点 ${i}: (${x},${y}) → 期望(${dst[i].x},${dst[i].y}) 实际(${uPred.toFixed(2)},${vPred.toFixed(2)}) 误差=${err.toFixed(3)}px`);
  }
  console.log(` 平均误差 = ${(totalE / 4).toFixed(4)}px, 最大 = ${maxE.toFixed(4)}px`);
}

// 1. H (src->dst): 把二维码像素坐标映射到模板坐标
const H_s2d = computeHomography(srcCorners, orderedCorners);
verify('H (src->dst) — 新算法', H_s2d, srcCorners, orderedCorners);

// 2. H_inv (dst->src): 把模板坐标映射回二维码像素坐标
const H_d2s = computeHomography(orderedCorners, srcCorners);
verify('H_inv (dst->src) — 新算法', H_d2s, orderedCorners, srcCorners);

// 4. 乱序角点（模拟 anchor 拖动顺序和检测器返回顺序都不同）
console.log('\n==== 非轴对齐四边形测试 ====');
// TL、TR、BR、BL 的正确顺序（屏幕坐标，y 向下）
const targetOrderCorrect = [
  { x: 500, y: 520 },     // TL
  { x: 1600, y: 500 },    // TR
  { x: 1550, y: 1500 },   // BR
  { x: 480, y: 1600 }     // BL
];
const H_correct = computeHomography(srcCorners, targetOrderCorrect);
verify('正确顺序 TL→TR→BR→BL', H_correct, srcCorners, targetOrderCorrect);

// 直接在归一化坐标中验证 H_norm
console.log('\n==== 直接在归一化坐标中验证 H_norm ====');
const Tsrc = normalizePoints(srcCorners);
const Tdst = normalizePoints(targetOrderCorrect);
const nSrc = srcCorners.map(p => applyTransform(Tsrc, p));
const nDst = targetOrderCorrect.map(p => applyTransform(Tdst, p));
const B2 = [], rhs2 = [];
for (let i = 0; i < 4; i++) {
  const x = nSrc[i].x, y = nSrc[i].y;
  const u = nDst[i].x, v = nDst[i].y;
  B2.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs2.push(u);
  B2.push([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs2.push(v);
}
const h2 = solve8x8(B2, rhs2);
const Hnorm = [...h2, 1.0];
console.log('H_norm =', Hnorm.map(v => v.toFixed(6)));
// 验证 H_norm 是否把 nSrc 映射到 nDst
for (let i = 0; i < 4; i++) {
  const [x, y] = [nSrc[i].x, nSrc[i].y];
  const denom = Hnorm[6] * x + Hnorm[7] * y + Hnorm[8];
  const uPred = (Hnorm[0] * x + Hnorm[1] * y + Hnorm[2]) / denom;
  const vPred = (Hnorm[3] * x + Hnorm[4] * y + Hnorm[5]) / denom;
  console.log(` 归一化点 ${i}: (${x.toFixed(2)},${y.toFixed(2)}) → 期望(${nDst[i].x.toFixed(2)},${nDst[i].y.toFixed(2)}) 实际(${uPred.toFixed(2)},${vPred.toFixed(2)})`);
}

// 6. 用通用矩阵乘法（非我手写的展开）来验证 denormalize 是否正确
console.log('\n==== 用通用 3x3 矩阵乘法来验证 denormalize ====');
function mat3mul(A, B) {
  const C = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j];
    C[i * 3 + j] = s;
  }
  return C;
}
function makeT(T) { return [T.s, 0, T.tx, 0, T.s, T.ty, 0, 0, 1]; }
function makeInvT(T) { const i = 1 / T.s; return [i, 0, -T.tx * i, 0, i, -T.ty * i, 0, 0, 1]; }

// 测试：inv(Tdst) * H_norm * Tsrc
const matTsrc = makeT(Tsrc);
const matTdst = makeInvT(Tdst);
// 直接再算一次 denormalizeHomography
const H_generic = mat3mul(matTdst, mat3mul(Hnorm, matTsrc));
const sc = H_generic[8];
const H_gen = H_generic.map(v => v / sc);
verify('通用矩阵乘法', H_gen, srcCorners, targetOrderCorrect);

// 7. 和我在文件里手写的 denormalizeHomography 比较
const H_manual = denormalize(Tsrc, Tdst, Hnorm);
verify('手写展开的 denormalize', H_manual, srcCorners, targetOrderCorrect);

console.log('\n==== 两种方法得到的 H 数值比对 ====');
console.log('通用:', H_gen.map(v => v.toFixed(4)));
console.log('手写:', H_manual.map(v => v.toFixed(4)));
const diff = H_gen.map((v, i) => Math.abs(v - H_manual[i]).toFixed(4));
console.log('差 :', diff);

