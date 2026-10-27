const h = { get: (t, k) => k === '__esModule' ? undefined : k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : P, apply: () => P, construct: () => P };
const P = new Proxy(function(){}, h);
module.exports = P;
