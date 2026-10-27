import React from 'react';
const UNITLESS = new Set(['opacity','zIndex','flex','flexGrow','flexShrink','fontWeight','lineHeight_']);
export function css(style){
  const s = flatten(style); const out = {};
  for (const [k,v] of Object.entries(s)) {
    if (v == null) continue;
    if (k === 'transform' && Array.isArray(v)) { out.transform = v.map(t=>{const [n,val]=Object.entries(t)[0]; return `${n}(${typeof val==='number'&&/translate/.test(n)?val+'px':val})`;}).join(' '); continue; }
    if (k==='shadowColor'||k==='shadowOffset'||k==='shadowOpacity'||k==='shadowRadius'||k==='elevation') continue;
    if (k==='paddingHorizontal'){out.paddingLeft=out.paddingRight=v;continue}
    if (k==='paddingVertical'){out.paddingTop=out.paddingBottom=v;continue}
    if (k==='marginHorizontal'){out.marginLeft=out.marginRight=v;continue}
    if (k==='marginVertical'){out.marginTop=out.marginBottom=v;continue}
    out[k] = typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v;
  }
  if (!out.display) out.display = 'flex';
  if (!out.flexDirection) out.flexDirection = 'column';
  return out;
}
export function flatten(s){ if(!s) return {}; if(Array.isArray(s)) return Object.assign({}, ...s.map(flatten)); return s; }
export const StyleSheet = { create: s=>s, flatten, absoluteFillObject:{position:'absolute',left:0,top:0,right:0,bottom:0}, absoluteFill:{position:'absolute',left:0,top:0,right:0,bottom:0}, hairlineWidth:1 };
export function View({style, children, pointerEvents}){ return React.createElement('div',{style:css(style)},children); }
export function Text({style, children}){ const c=css(style); c.display='inline'; return React.createElement('span',{style:c},children); }
export const Image = () => null;
export const Pressable = View; export const TouchableOpacity = View;
export const Platform = { OS:'ios', select:o=>o.ios ?? o.default };
export const PixelRatio = { get:()=>2, roundToNearestPixel:x=>x };
export const useWindowDimensions = () => ({width:400,height:800,scale:2,fontScale:1});
export const Dimensions = { get:()=>({width:400,height:800}) };
export const AppState = { addEventListener:()=>({remove(){}}), currentState:'active' };
export const AccessibilityInfo = { isReduceMotionEnabled:async()=>true, addEventListener:()=>({remove(){}}) };
export default { View, Text, StyleSheet, Platform };
