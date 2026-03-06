import{c as a}from"./createLucideIcon-CK-93n4w.js";import{u as n}from"./api-D2pf7lY1.js";import{g as o}from"./index-BbacrUqu.js";import{a as u}from"./queries-DOn2EIV9.js";import{p as i,g as c}from"./api-Dzq7kUyZ.js";/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x=a("DollarSign",[["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}],["path",{d:"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",key:"1b0p4s"}]]);/**
 * @license lucide-react v0.469.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=a("Trash2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]]),s={list:e=>["trip-days",e]};function k(e){return n({queryKey:s.list(e),queryFn:()=>c(e),enabled:!!e})}function D(e){const t=o();return u({mutationFn:({dayId:y,data:r})=>i(y,r),onSuccess:()=>t.invalidateQueries({queryKey:s.list(e)})})}export{x as D,f as T,D as a,s as d,k as u};
